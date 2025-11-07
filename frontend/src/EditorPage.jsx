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

  const editorRef = useRef(null);
  const cursorLayerRef = useRef(null);
  const cursorTags = useRef({});
  const prevValueRef = useRef("");
  const isApplyingRemote = useRef(false);

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

    // Always show name popup after entering room
    const savedName = localStorage.getItem("username") || "";
    const savedColor = localStorage.getItem("userColor") || randomDarkColor();

    setUserColor(savedColor);
    setTempName(savedName); // pre-fill last used name
    setShowNameModal(true);
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

    s.on("loadCode", ({ code, role: newRole }) => {
      if (editorRef.current) editorRef.current.setValue(code || "");
      prevValueRef.current = code || "";
      setRole(newRole || roleParam);
    });

    s.on("remotePatch", ({ patch }) => applyRemotePatch(patch));
    s.on("updateUsers", (users) => setUsers(users));
    s.on("userCursorMoved", handleRemoteCursor);

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
  const computePatch = (oldStr, newStr) => {
    let start = 0;
    const minLen = Math.min(oldStr.length, newStr.length);
    while (start < minLen && oldStr[start] === newStr[start]) start++;
    let endOld = oldStr.length - 1;
    let endNew = newStr.length - 1;
    while (endOld >= start && endNew >= start && oldStr[endOld] === newStr[endNew]) {
      endOld--;
      endNew--;
    }
    const removed = endOld >= start ? endOld - start + 1 : 0;
    const inserted = endNew >= start ? newStr.slice(start, endNew + 1) : "";
    return { start, removed, inserted };
  };

  const applyRemotePatch = (patch) => {
    if (!editorRef.current) return;
    const { start, removed, inserted } = patch;
    const old = prevValueRef.current;
    const updated = old.slice(0, start) + inserted + old.slice(start + removed);
    isApplyingRemote.current = true;
    editorRef.current.setValue(updated);
    prevValueRef.current = updated;
    isApplyingRemote.current = false;
  };

  const handleEditorChange = (newValue) => {
    if (isApplyingRemote.current || role === "viewer") return;
    const patch = computePatch(prevValueRef.current, newValue);
    if (patch.removed === 0 && patch.inserted === "") return;
    prevValueRef.current = newValue;
    socket.emit("applyPatch", { roomId, patch });
    sendCursorPosition();
  };

  const sendCursorPosition = () => {
    if (!editorRef.current) return;
    const pos = editorRef.current.getPosition();
    const layout = editorRef.current.getScrolledVisiblePosition(pos);
    if (!layout) return;
    socket.emit("cursorMove", {
      roomId,
      cursorPos: { top: layout.top, left: layout.left },
      username,
      color: userColor,
    });
  };

  const handleRemoteCursor = ({ username, cursorPos, color, socketId }) => {
    if (!cursorLayerRef.current) return;
    if (!cursorTags.current[socketId]) {
      const tag = document.createElement("div");
      tag.className = "cursorTag";
      tag.textContent = username;
      tag.style.borderLeftColor = color;
      tag.style.background = "rgba(0,0,0,0.85)";
      cursorLayerRef.current.appendChild(tag);
      cursorTags.current[socketId] = tag;
    }

    const tag = cursorTags.current[socketId];
    tag.style.top = `${cursorPos.top}px`;
    tag.style.left = `${cursorPos.left}px`;
    tag.style.display = "block";
    clearTimeout(tag._hideTimeout);
    tag._hideTimeout = setTimeout(() => (tag.style.display = "none"), 2000);
  };

  // Toolbar actions
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
        <Editor
          height="calc(100vh - 50px)"
          width="100vw"
          defaultLanguage="javascript"
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

      {/* 🆕 Name Popup (Always shown when joining) */}
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
