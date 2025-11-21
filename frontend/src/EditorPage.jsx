import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import Editor from "@monaco-editor/react";
import "./styles.css";

export default function EditorPage() {
  const [socket, setSocket] = useState(null);
  const [role, setRole] = useState("viewer");
  const [roomId, setRoomId] = useState("");
  const [username, setUsername] = useState("");
  const [userColor, setUserColor] = useState("");
  const [users, setUsers] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [toast, setToast] = useState("");
  const [showNameModal, setShowNameModal] = useState(false);
  const [tempName, setTempName] = useState("");

 const [language, setLanguage] = useState("python");


  const editorRef = useRef(null);
  const cursorLayerRef = useRef(null);
  const cursorTags = useRef({});
  const prevValueRef = useRef("");
  const isApplyingRemote = useRef(false);
  const versionRef = useRef(0); // ✅ added for version tracking
  
// Execution panel state
const [outputVisible, setOutputVisible] = useState(false);
const [outputContent, setOutputContent] = useState("");
const [running, setRunning] = useState(false);

const [stdinValue, setStdinValue] = useState("");
const [askInput, setAskInput] = useState(false);


// Pyodide instance ref
const pyodideRef = useRef(null);
const pyodideLoadingRef = useRef(false);

// Judge0 config (for C/C++/Java remote execution) - configure these values
// ✅ Use free public Judge0 endpoint (no API key needed)
const JUDGE0_API_HOST = "https://judge0-ce.p.rapidapi.com"; // keep this base
const JUDGE0_API_KEY = ""; // leave empty (no key)

  const randomDarkColor = () => {
    const r = Math.floor(Math.random() * 140);
    const g = Math.floor(Math.random() * 140);
    const b = Math.floor(Math.random() * 140);
    return `rgb(${r},${g},${b})`;
  };

  // 🧠 Main setup
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    const roleParam = params.get("role") || "viewer";
    setRoomId(room);
    setRole(roleParam);

    const savedName = localStorage.getItem("username") || "";
    const savedColor = localStorage.getItem("userColor") || randomDarkColor();
    setUserColor(savedColor);
    setTempName(savedName);
    setShowNameModal(true);
  }, []);


  // 🚫 CUSTOM REFRESH WARNING MESSAGE - Add this after existing useEffect
useEffect(() => {
  const handleBeforeUnload = (event) => {
    // Your custom warning message
    const message = "DO NOT REFRESH THE EDITOR PAGE! Your code will get merged and conflicted with other users.";
    
    // Set the custom message for the browser dialog
    event.preventDefault();
    event.returnValue = message;
    return message;
  };

  // Add event listener
  window.addEventListener('beforeunload', handleBeforeUnload);

  // Cleanup
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
}, []);

  // 🆕 Connect after name entered
  const handleJoinWithName = () => {
    const name = tempName.trim() || "Guest";
    localStorage.setItem("username", name);
    localStorage.setItem("userColor", userColor);
    setUsername(name);
    setShowNameModal(false);
    connectToSocket(name, userColor, roomId, role);
  };

  const connectToSocket = (savedName, savedColor, room, roleParam) => {
    const s = io();
    setSocket(s);
    s.emit("joinRoom", { roomId: room, role: roleParam, username: savedName, color: savedColor });

    s.on("loadCode", ({ code, role: newRole, version }) => {
      if (editorRef.current) editorRef.current.setValue(code || "");
      prevValueRef.current = code || "";
      versionRef.current = typeof version === "number" ? version : 0; // ✅ version synced
      setRole(newRole || roleParam);
    });

    s.on("remotePatch", ({ patch, version }) => {
      applyRemotePatch(patch);
      if (typeof version === "number") versionRef.current = version;
    });

    s.on("patchApplied", ({ version }) => {
      if (typeof version === "number") versionRef.current = version;
    });

    s.on("updateUsers", (users) => setUsers(users));
    s.on("userCursorMoved", handleRemoteCursor);

    // 🔄 Listen for language changes from the owner
      s.on("languageChanged", ({ newLang }) => {
        setLanguage(newLang);
      });


    s.on("roleChanged", (newRole) => {
      setRole(newRole);
      alert(`Your role changed to ${newRole.toUpperCase()}`);
    });

    s.on("kicked", () => {
      alert("You were removed by the owner.");
      window.location.href = "/";
    });

    s.on("error", (msg) => alert("Error: " + msg));

    return () => {
      try {
        s.disconnect();
      } catch (e) {}
    };
  };

  // 🧩 Patch and cursor handling
const computePatch = (oldText, newText) => {
  if (oldText === newText) return null;

  let start = 0;
  while (
    start < oldText.length &&
    start < newText.length &&
    oldText[start] === newText[start]
  ) {
    start++;
  }

  let oldEnd = oldText.length;
  let newEnd = newText.length;

  while (
    oldEnd > start &&
    newEnd > start &&
    oldText[oldEnd - 1] === newText[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  return {
    start,
    removed: oldEnd - start,
    inserted: newText.slice(start, newEnd)
  };
};

function detectInputNeed(code) {
  if (!code) return false;
  return /input\s*\(|scanf\s*\(|cin\s*>>|new\s+Scanner|Scanner\s+/.test(code);
}

  const applyRemotePatch = (patch) => {
  if (!patch || !editorRef.current) return;

  const model = editorRef.current.getModel();
  if (!model) return;

  const { start, removed, inserted } = patch;

  const startPos = model.getPositionAt(start);
  const endPos = model.getPositionAt(start + removed);

  const edit = {
    range: new window.monaco.Range(
      startPos.lineNumber,
      startPos.column,
      endPos.lineNumber,
      endPos.column
    ),
    text: inserted,
    forceMoveMarkers: true,
  };

  isApplyingRemote.current = true;
  model.pushEditOperations([], [edit], () => null);
  isApplyingRemote.current = false;

  prevValueRef.current = model.getValue();
};


const _cursorLastSentRef = useRef(0);
const _cursorThrottleMs = 80; // send at most ~12 times/sec

const sendCursorPosition = () => {
  const editor = editorRef.current;
  if (!editor || !socket) return;

  const pos = editor.getPosition();
  if (!pos) return;

  const now = Date.now();
  if (now - _cursorLastSentRef.current < _cursorThrottleMs) return;
  _cursorLastSentRef.current = now;

  // emit logical caret position (line/column) — more reliable cross-clients
  socket.emit("cursorMove", {
    roomId,
    cursorPos: { lineNumber: pos.lineNumber, column: pos.column },
    username,
    color: userColor,
  });
};

  const handleEditorChange = (newValue) => {
    if (isApplyingRemote.current || role === "viewer") return;
    const patch = computePatch(prevValueRef.current, newValue);
    if (patch.removed === 0 && patch.inserted === "") return;
    prevValueRef.current = newValue;
    socket.emit("applyPatch", { roomId, patch, baseVersion: versionRef.current }); // ✅ versioned
    sendCursorPosition();
  };

  

const handleRemoteCursor = ({ username, cursorPos, color, socketId }) => {
  const editor = editorRef.current;
  const layer = cursorLayerRef.current;
  if (!editor || !layer || !cursorPos || !socketId) return;

  // ensure tag exists
  if (!cursorTags.current[socketId]) {
    const tag = document.createElement("div");
    tag.className = "cursorTag";
    tag.textContent = username || "";
    tag.style.borderLeftColor = color || "#fff";
    tag.style.background = "rgba(0,0,0,0.85)";
    tag.style.position = "absolute";
    tag.style.zIndex = 998;
    tag.style.whiteSpace = "nowrap";
    tag.style.pointerEvents = "none";
    layer.appendChild(tag);
    cursorTags.current[socketId] = tag;
  }

  const tag = cursorTags.current[socketId];

  // Try monaco API to get visible pixel position for the logical position
  let screenPos = null;
  try {
    // preferred: getScrolledVisiblePosition takes { lineNumber, column }
    if (typeof editor.getScrolledVisiblePosition === "function") {
      screenPos = editor.getScrolledVisiblePosition({
        lineNumber: cursorPos.lineNumber,
        column: cursorPos.column || 1,
      });
    }
  } catch (e) {
    screenPos = null;
  }

  // Fallback: compute top from line number and left ~ start of editor
  if (!screenPos) {
    try {
      const topForLine = editor.getTopForLineNumber(cursorPos.lineNumber || 1);
      // getScrollTop gives how much has been scrolled
      const scrollTop = editor.getScrollTop ? editor.getScrollTop() : 0;
      const editorLeft = 8; // small padding fallback
      screenPos = { top: topForLine - scrollTop, left: editorLeft };
    } catch (e) {
      // Last fallback: place at top-left
      screenPos = { top: 0, left: 0 };
    }
  }

  // position the tag
  tag.style.top = `${Math.max(0, screenPos.top)}px`;
  tag.style.left = `${Math.max(0, screenPos.left)}px`;
  tag.style.display = "block";

  // reset/hide after 2s
  clearTimeout(tag._hideTimeout);
  tag._hideTimeout = setTimeout(() => {
    // keep it hidden rather than removing so we can reuse DOM node
    tag.style.display = "none";
  }, 2000);
};

  // ---------- Helpers for running code ----------

// Load Pyodide lazily for Python execution
// ------------------------------
// 🔥 OFFLINE PYODIDE LOADER
// Place FULL pyodide folder inside: public/pyodide/
// ------------------------------

async function loadPyodideIfNeeded() {
  // Already loaded?
  if (pyodideRef.current) return pyodideRef.current;

  // Loading has started: wait for completion
  if (pyodideLoadingRef.current) {
    while (!pyodideRef.current) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return pyodideRef.current;
  }

  pyodideLoadingRef.current = true;

  // Load pyodide.js from public/pyodide/
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");

    // MUST match exactly
    script.src = "/pyodide/pyodide.js";

    script.onload = async () => {
      if (!window.loadPyodide) {
        reject("❌ loadPyodide is missing. Wrong Pyodide version or bad folder.");
        return;
      }

      try {
        const pyodide = await window.loadPyodide({
          indexURL: "/pyodide",
        });

        pyodideRef.current = pyodide;
        pyodideLoadingRef.current = false;
        resolve(pyodide);
      } catch (e) {
        reject("❌ Pyodide failed: " + e);
      }
    };

    script.onerror = () => reject("❌ Cannot load /pyodide/pyodide.js");

    document.head.appendChild(script);
  });
}







// Run JavaScript directly in browser


// Run Python with Pyodide
// ✅ Run via Judge0 (for C / C++ / Java) — CORS-friendly version
async function runOnJudge0(source, language_id) {
  try {
    const payload = {
      source_code: source,
      language_id,
      stdin: ""
    };

    // ✅ Your backend URL (dev tunnels)
    const url = "https://ffhw2s0h-3000.inc1.devtunnels.ms/judge0";

    // ❗ DO NOT send RapidAPI headers from frontend
    const headers = {
      "Content-Type": "application/json"
    };

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return `❌ Judge0 error: ${response.status}\n${errorText}`;
    }

    const data = await response.json();

    // ✅ Proper output handling
    if (data.stderr) return `❌ Runtime Error:\n${data.stderr}`;
    if (data.compile_output) return `⚙️ Compilation Error:\n${data.compile_output}`;
    if (data.stdout) return `✅ Output:\n${data.stdout}`;

    return "⚠️ No output received.";
  } catch (err) {
    return `🚨 Judge0 request failed:\n${err}`;
  }
}













// Map your language string to Judge0 language IDs
function judge0LanguageId(lang) {
  return {
    c: 49,        // GCC C
    cpp: 54,      // G++ C++
    java: 91,     // Java 17
    python: null, // local
   // local
  }[lang];
}

// Run Python with Pyodide + capture stdout
async function runPython(code) {
  const pyodide = await loadPyodideIfNeeded();

  try {
    let output = "";

    // capture print()
    pyodide.globals.set("print", (...args) => {
      output += args.join(" ") + "\n";
    });

    // FIX: ensure io module exists
    await pyodide.loadPackage("io").catch(() => {});

    // FIX: ensure sys exists
    await pyodide.runPythonAsync("import sys");

    // set custom stdin if input() required
    if (window.stdinValue !== undefined) {
      await pyodide.runPythonAsync(`
import io, sys
sys.stdin = io.StringIO("""${window.stdinValue}""")
      `);
    }

    const result = await pyodide.runPythonAsync(code);

    if (result !== undefined) {
      output += String(result) + "\n";
    }

    return output.trim() || "(no output)";
  } catch (e) {
    return "❌ Python Error:\n" + e;
  }
}






// Load external Python libraries into Pyodide
async function loadPythonPackages(pyodide) {
  const pkgs = ["numpy", "pandas", "matplotlib", "seaborn", "scikit-learn"];

  try {
    setOutputContent("📦 Loading Python packages...");

    for (const pkg of pkgs) {
      await pyodide.loadPackage(pkg);
      console.log(`Loaded: ${pkg}`);
    }

    return "✅ All Python packages loaded successfully.";
  } catch (err) {
    return "❌ Failed to load packages: " + err;
  }
}


async function runFinal(stdinText = "") {
  if (!editorRef.current) return;
  const code = editorRef.current.getValue() || "";
  setRunning(true);
  setOutputVisible(true);
  setOutputContent("🔄 Running your code...");
  try {
    let output = "";
    if (language === "javascript") {
      if (stdinText) window.prompt = () => stdinText.split("\n").shift();
      output = await runJavaScript(code);
    } else if (language === "python") {
      // ensure pyodide is loaded
      const pyodide = await loadPyodideIfNeeded();
      if (stdinText) {
        pyodide.setStdout && pyodide.setStdout((s) => (output += s));
        pyodide.setStderr && pyodide.setStderr((s) => (output += s));
        // micropip / pyodide stdin approach: set sys.stdin in code if needed
        // we'll prefix code to provide input via a variable
        const wrapped = `import sys\nsys.stdin = io.StringIO(${JSON.stringify(stdinText)})\n` + code;
        output = await runPython(wrapped);
      } else {
        output = await runPython(code);
      }
    } else {
      const langId = judge0LanguageId(language);
      if (!langId) output = "❌ Execution for this language not configured.";
      else {
        const payload = { source_code: code, language_id: langId, stdin: stdinText };
        const resp = await runOnJudge0(payload.source_code, payload.language_id); // your runOnJudge0 expects source+id
        output = resp || "(no output)";
      }
    }
    setOutputContent(output || "(no output)");
  } catch (err) {
    setOutputContent("❌ Error: " + (err?.message || String(err)));
  } finally {
    setRunning(false);
  }
}

// Main runner function for Run button
async function runCode() {
  console.log("LANG ID:", judge0LanguageId(language));

  if (!editorRef.current) return;
  const code = editorRef.current.getValue() || "";
  if (detectInputNeed(code)) {
  setAskInput(true);
  setOutputVisible(true);
  setOutputContent("⏳ Program requires input — enter it then click Submit & Run.");
  setRunning(false);
  return;
}

// otherwise continue to run normally (call runFinal with empty stdin)
await runFinal("");
  setRunning(true);
  setOutputVisible(true);
  setOutputContent("🔄 Running your code...");

  try {
    let output = "";

    if (language === "javascript") {
      output = await runJavaScript(code);

    } else if (language === "python") {
      setOutputContent("🐍 Loading Python runtime...");

      const pyodide = await loadPyodideIfNeeded();

      const loadMsg = await loadPythonPackages(pyodide);
      console.log(loadMsg);

      output = await runPython(code);

    } else {
      const langId = judge0LanguageId(language);
      if (!langId) {
        output = "❌ Execution for this language not configured.";
      } else {
        setOutputContent("☁️ Sending code to online compiler...");
        const resp = await runOnJudge0(code, langId);
        output = resp || "(no output)";
      }
    }

    setOutputContent(output || "(no output)");

  } catch (err) {
    setOutputContent("⚠️ Error: " + err.message);
  } finally {
    setRunning(false);
  }
}



  // 🔧 Toolbar actions
  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      showToast("✅ Room ID copied!");
    } catch {
      showToast("❌ Copy failed!");
    }
  };

  const leaveRoom = () => {
    if (window.confirm("Are you sure you want to leave this room?")) {
      try {
        socket.disconnect();
      } catch (e) {}
      window.location.href = "/";
    }
  };

  const changeName = () => {
    const newName = prompt("Enter new display name:")?.trim();
    if (newName && newName !== username) {
      localStorage.setItem("username", newName);
      setUsername(newName);
      socket.emit("joinRoom", { roomId, role, username: newName, color: userColor });
      showToast(`✅ Name changed to ${newName}`);
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2000);
  };

  const handleRoleChange = (targetId, newRole) => {
    socket.emit("changeRole", { roomId, targetId, newRole });
  };

  const handleKick = (targetId, name) => {
    if (window.confirm(`Kick ${name}?`)) {
      socket.emit("kickUser", { roomId, targetId });
    }
  };

  return (
    <div className="mainContainer">
      {/* 🧭 Toolbar */}
      <div className="topToolbar">
        <button onClick={() => setDrawerOpen(!drawerOpen)} className="toolbarBtn">
          {drawerOpen ? "⮜ Hide Panel" : "☰ Show Panel"}
          
        </button>
        {/* 🔽 Language Selection Dropdown */}
            {/* 🔽 Language Selection Dropdown (Only Owner Can Change) */}
          {/* 🔽 Language Selection Dropdown (Only Owner Can Change) */}
          <select
            className="langSelect"
            value={language}
            onChange={(e) => {
              if (role === "owner") {
                setLanguage(e.target.value);
                socket?.emit("languageChanged", { roomId, newLang: e.target.value });
              }
            }}
            disabled={role !== "owner"}
            title={role !== "owner" ? "Only the owner can change the language" : ""}
          >
            {/* <option value="javascript">JavaScript</option> */}
            <option value="python">Python</option>
            <option value="cpp">C++</option>
            <option value="c">C</option>
            <option value="java">Java</option>
          </select>

                      {/* Run button */}
            <button
              className="toolbarBtn"
              onClick={() => {
                // open output only when run is clicked
                setOutputVisible(true);
                runCode();
              }}
              disabled={running}
            >
              {running ? "Running..." : "Run"}
            </button>



        <span className="toolbarTitle">🧠 Collaborative Editor</span>
        <div className="toolbarActions">
          <button onClick={changeName} className="toolbarBtn">✏️ Change Name</button>
          <button onClick={copyRoomId} className="toolbarBtn">📋 Copy Room ID</button>
          <button onClick={leaveRoom} className="toolbarBtn leave">🚪 Leave Room</button>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {/* Monaco Editor */}
      <div className="editorContainer">
        {askInput && (
  <div
    style={{
      padding: "12px",
      background: "#111",
      marginBottom: "8px",
      border: "1px solid #333",
      borderRadius: "6px",
    }}
  >
    <strong style={{ color: "#9fdf9f" }}>Program Input</strong>

    <textarea
      value={stdinValue}
      onChange={(e) => setStdinValue(e.target.value)}
      placeholder="Enter program input here..."
      rows={4}
      style={{
        width: "100%",
        marginTop: "8px",
        padding: "8px",
        background: "#222",
        color: "#fff",
        border: "1px solid #444",
        borderRadius: "6px",
      }}
    />

    <div style={{ marginTop: "8px", textAlign: "right" }}>
      <button
        className="toolbarBtn"
        onClick={() => {
          setAskInput(false);
          runFinal(stdinValue);
        }}
      >
        Submit & Run
      </button>
    </div>
  </div>
)}

        <Editor
            height="calc(100vh - 50px)"
            width="100vw"
            language={language}
          onMount={(editor) => (editorRef.current = editor)}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            automaticLayout: true,
            readOnly: role === "viewer",
          }}
        />
        <div id="cursorTags" ref={cursorLayerRef}></div>
        
        {/* Output panel — hidden until run is clicked */}
            {outputVisible && (
              <div className="outputPanel">
                <div className="outputHeader">
                  <strong>Output</strong>
                  <button className="toolbarBtn" onClick={() => setOutputVisible(false)}>Close</button>
                </div>
                <pre className="outputContent">
                  {outputContent || (running ? "Running..." : "No output")}
                </pre>
              </div>
            )}

      </div>

      {/* Drawer */}
      <div className={`drawer ${drawerOpen ? "open" : ""}`}>
        <h2>Room Info</h2>
        <p><strong>Room ID:</strong> {roomId}</p>
        <p><strong>Your Role:</strong> {role.toUpperCase()}</p>
        <p><strong>Your Name:</strong> {username}</p>

        <h3>Participants</h3>
        <ul className="userList">
          {Object.entries(users).map(([id, info]) => (
            <li key={id} style={{ borderLeft: `4px solid ${info.color}` }}>
              {info.username} ({info.role})
              {role === "owner" && id !== socket.id && (
                <div className="ownerButtons">
                  <button onClick={() => handleRoleChange(id, "editor")} className="actionBtn">Make Editor</button>
                  <button onClick={() => handleRoleChange(id, "viewer")} className="actionBtn">Make Viewer</button>
                  <button onClick={() => handleKick(id, info.username)} className="kickBtn">Kick</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {/* 🆕 Name Popup */}
      {showNameModal && (
        <div className="nameModalOverlay">
          <div className="nameModal">
            <h2>Welcome to the Room 👋</h2>
            <p>Please enter your name to join:</p>
            <input
              type="text"
              className="nameInput"
              placeholder="Enter your name..."
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
            />
            <button className="joinBtn" onClick={handleJoinWithName}>Join</button>
          </div>
        </div>
      )}
    </div>
  );
}
