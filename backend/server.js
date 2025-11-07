// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const mongoURI = "mongodb://127.0.0.1:27017/collab_editor";
mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.log(err));

const codeSchema = new mongoose.Schema({ roomId: String, content: String });
const Code = mongoose.model('Code', codeSchema);

const rooms = {};

function generateRoomId() {
  let roomId;
  do {
    roomId = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms[roomId]);
  return roomId;
}

app.get('/create-room', (req, res) => {
  const roomId = generateRoomId();
  rooms[roomId] = { ownerId: null, users: {}, code: "" };
  res.json({ roomId });
});

app.get('/editor.html', (req, res) => {
  res.sendFile(__dirname + '/public/editor.html');
});

io.on('connection', (socket) => {
  console.log('🟢 User connected:', socket.id);

  socket.on('joinRoom', async ({ roomId, role, username, color }) => {
    if (!rooms[roomId]) return socket.emit('error', 'Room does not exist');

    if (!rooms[roomId].ownerId && role === 'owner') rooms[roomId].ownerId = socket.id;
    rooms[roomId].users[socket.id] = { role, username, color };
    socket.join(roomId);

    let codeDoc = await Code.findOne({ roomId });
    if (!codeDoc) {
      codeDoc = new Code({ roomId, content: "" });
      await codeDoc.save();
    }
    rooms[roomId].code = codeDoc.content;

    socket.emit('loadCode', { code: rooms[roomId].code, role });
    io.to(roomId).emit('updateUsers', rooms[roomId].users);
  });

  socket.on('applyPatch', async ({ roomId, patch }) => {
    const room = rooms[roomId];
    if (!room) return;

    const userRole = room.users[socket.id]?.role;
    if (!userRole || userRole === 'viewer') return;

    const { start, removed, inserted } = patch;
    const old = room.code || "";
    const before = old.slice(0, start);
    const after = old.slice(start + removed);
    const updated = before + inserted + after;
    room.code = updated;

    let codeDoc = await Code.findOne({ roomId });
    if (!codeDoc) codeDoc = new Code({ roomId, content: room.code });
    else codeDoc.content = room.code;
    await codeDoc.save();

    socket.to(roomId).emit('remotePatch', { patch, senderId: socket.id });
  });

  socket.on('cursorMove', ({ roomId, cursorPos, username, color }) => {
    socket.to(roomId).emit('userCursorMoved', { username, cursorPos, color, socketId: socket.id });
  });

  socket.on('changeRole', ({ roomId, targetId, newRole }) => {
    const changerRole = rooms[roomId]?.users[socket.id]?.role;
    if (changerRole !== 'owner') return;
    if (rooms[roomId]?.users[targetId]) {
      rooms[roomId].users[targetId].role = newRole;
      io.to(roomId).emit('updateUsers', rooms[roomId].users);
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) targetSocket.emit('roleChanged', newRole);
    }
  });

  socket.on('kickUser', ({ roomId, targetId }) => {
    const changerRole = rooms[roomId]?.users[socket.id]?.role;
    if (changerRole !== 'owner') return;
    if (rooms[roomId]?.users[targetId]) {
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) {
        targetSocket.emit('kicked');
        targetSocket.leave(roomId);
      }
      delete rooms[roomId].users[targetId];
      io.to(roomId).emit('updateUsers', rooms[roomId].users);
    }
  });

  socket.on('disconnect', () => {
    for (let rid in rooms) {
      if (rooms[rid].users[socket.id]) {
        delete rooms[rid].users[socket.id];
        io.to(rid).emit('updateUsers', rooms[rid].users);
      }
    }
    console.log('🔴 User disconnected:', socket.id);
  });
});

server.listen(3000, () => console.log('🚀 Server running on http://localhost:3000'));
