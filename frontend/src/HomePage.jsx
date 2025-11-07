// src/HomePage.jsx
import React, { useState } from "react";

export default function HomePage() {
  const [roomId, setRoomId] = useState("");

  const createRoom = async () => {
    const res = await fetch("/create-room");
    const data = await res.json();
    window.location.href = `/editor?room=${data.roomId}&role=owner`;
  };

  const joinRoom = () => {
    if (roomId.trim()) {
      window.location.href = `/editor?room=${roomId}&role=viewer`;
    } else {
      alert("Enter a Room ID!");
    }
  };

  return (
    <div style={{ textAlign: "center", padding: "40px" }}>
      <h2>Welcome to Collaborative Coding</h2>
      <button
        onClick={createRoom}
        style={{ padding: "10px 20px", margin: "10px", cursor: "pointer" }}
      >
        Create Room
      </button>
      <br />
      <input
        type="text"
        placeholder="Enter Room ID"
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        style={{ padding: "8px", margin: "10px" }}
      />
      <button
        onClick={joinRoom}
        style={{ padding: "10px 20px", margin: "10px", cursor: "pointer" }}
      >
        Join Room
      </button>
    </div>
  );
}
