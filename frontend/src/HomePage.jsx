// src/HomePage.jsx
import React, { useState } from "react";
import "./Homepage.css";

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
    <div className="home-container">

      {/* Animated floating shapes */}
      <div className="orb orb1"></div>
      <div className="orb orb2"></div>
      <div className="orb orb3"></div>
      <div className="particles"></div>

      <div className="home-card">
        <h2 className="home-title">Fusion Flow </h2>
        <h3>From solo debugging and Squad Coding </h3>

        <button onClick={createRoom} className="btn-primary">
          Create Room
        </button>

        <input
          type="text"
          placeholder="Enter Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          className="input-box"
        />

        <button onClick={joinRoom} className="btn-secondary">
          Join Room
        </button>
      </div>
      &nbsp; 
      <div className="steps-container">
  <h2>How It Works</h2>

  <p>1. Create a room and instantly receive a unique room ID.</p>
  <p>2. Share that room ID with your friends.</p>
  <p>3. Everyone enters the same room ID and edits code in real-time.</p>
  <p>4. No refresh required. All changes sync instantly.</p>
</div>
    </div>

    
  );
}