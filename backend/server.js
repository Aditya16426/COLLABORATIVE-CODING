// server.js



const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const cors = require("cors");

const app = express();
app.use(cors({
  origin: "*",
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-RapidAPI-Key",
    "X-RapidAPI-Host"
  ],
  credentials: true
}));




const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ✅ MongoDB Connection
const mongoURI = "mongodb://127.0.0.1:27017/collab_editor";
mongoose
  .connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.log(err));

const codeSchema = new mongoose.Schema({ roomId: String, content: String });
const Code = mongoose.model("Code", codeSchema);

// ✅ In-memory room store
const rooms = {};

// Helper: generate unique 6-digit room ID
function generateRoomId() {
  let roomId;
  do {
    roomId = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms[roomId]);
  return roomId;
}

// ✅ Create Room
app.get("/create-room", (req, res) => {
  const roomId = generateRoomId();
  rooms[roomId] = { ownerId: null, users: {}, code: "", version: 0 };
  res.json({ roomId });
});

// Serve editor page
app.get("/editor.html", (req, res) => {
  res.sendFile(__dirname + "/public/editor.html");
});

// ✅ Socket.IO Real-time Logic
io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  socket.on("joinRoom", async ({ roomId, role, username, color }) => {
    if (!rooms[roomId]) return socket.emit("error", "Room does not exist");

    if (!rooms[roomId].ownerId && role === "owner")
      rooms[roomId].ownerId = socket.id;

    rooms[roomId].users[socket.id] = { role, username, color };
    socket.join(roomId);

    let codeDoc = await Code.findOne({ roomId });
    if (!codeDoc) {
      codeDoc = new Code({ roomId, content: "" });
      await codeDoc.save();
    }

    rooms[roomId].code = codeDoc.content;
    rooms[roomId].version = rooms[roomId].version || 0;

    // Send code and version to joining user
    socket.emit("loadCode", {
      code: rooms[roomId].code,
      role,
      version: rooms[roomId].version,
    });

    io.to(roomId).emit("updateUsers", rooms[roomId].users);
  });

  // ✅ Versioned Patch Handling
  socket.on("applyPatch", async ({ roomId, patch, baseVersion }) => {
    const room = rooms[roomId];
  if (!room) return;

  const userRole = room.users[socket.id]?.role;
  if (!userRole || userRole === "viewer") return;

  // ⚠️ Temporarily disable version conflict rejection to fix flicker
  // (We still bump version later, just don't reject mismatched versions)

  // Apply patch
  const { start, removed, inserted } = patch;
  const old = room.code || "";
  const before = old.slice(0, start);
  const after = old.slice(start + removed);
  const updated = before + inserted + after;

  room.code = updated;
  room.version += 1;

    let codeDoc = await Code.findOne({ roomId });
    if (!codeDoc) codeDoc = new Code({ roomId, content: updated });
    else codeDoc.content = updated;
    await codeDoc.save();

    // Broadcast updated patch
    socket.to(roomId).emit("remotePatch", {
      patch,
      senderId: socket.id,
      version: room.version,
    });

    // Acknowledge sender
    socket.emit("patchApplied", { version: room.version });
  });

  // ✅ Cursor move broadcasting
  socket.on("cursorMove", ({ roomId, cursorPos, username, color }) => {
    socket
      .to(roomId)
      .emit("userCursorMoved", { username, cursorPos, color, socketId: socket.id });
  });

  // ✅ Broadcast programming language change
      socket.on("languageChanged", ({ roomId, newLang }) => {
        const room = rooms[roomId];
        if (!room) return;

        const userRole = room.users[socket.id]?.role;
        if (userRole !== "owner") return; // only owner can trigger this

        io.to(roomId).emit("languageChanged", { newLang });
      });


  // ✅ Role management
  socket.on("changeRole", ({ roomId, targetId, newRole }) => {
    const changerRole = rooms[roomId]?.users[socket.id]?.role;
    if (changerRole !== "owner") return;
    if (rooms[roomId]?.users[targetId]) {
      rooms[roomId].users[targetId].role = newRole;
      io.to(roomId).emit("updateUsers", rooms[roomId].users);
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) targetSocket.emit("roleChanged", newRole);
    }
  });

  // ✅ Kick user
  socket.on("kickUser", ({ roomId, targetId }) => {
    const changerRole = rooms[roomId]?.users[socket.id]?.role;
    if (changerRole !== "owner") return;
    if (rooms[roomId]?.users[targetId]) {
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) {
        targetSocket.emit("kicked");
        targetSocket.leave(roomId);
      }
      delete rooms[roomId].users[targetId];
      io.to(roomId).emit("updateUsers", rooms[roomId].users);
    }
  });

  // ✅ Handle disconnect
  socket.on("disconnect", () => {
    for (let rid in rooms) {
      if (rooms[rid].users[socket.id]) {
        delete rooms[rid].users[socket.id];
        io.to(rid).emit("updateUsers", rooms[rid].users);
      }
    }
    console.log("🔴 User disconnected:", socket.id);
  });
});

const axios = require("axios");
const bodyParser = require("body-parser");

app.use(bodyParser.json());

app.options("/judge0", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-RapidAPI-Key, X-RapidAPI-Host");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  return res.sendStatus(200);
});

app.post("/judge0", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-RapidAPI-Key, X-RapidAPI-Host");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  try {
    const payload = req.body;

    const jResp = await fetch(
      "https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RapidAPI-Key": "f50bc12eeamsh25c5458a36642d2p18adf7jsna42e097447e2",
          "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await jResp.json();
    return res.json(data);

  } catch (err) {
    return res.status(500).json({ error: err.toString() });
  }
});





server.listen(3000, () =>
  console.log("🚀 Server running on http://localhost:3000")
);
