// src/App.jsx
import React from "react";
import HomePage from "./HomePage";
import EditorPage from "./EditorPage";
import "./styles.css";

export default function App() {
  return window.location.pathname === "/editor" ? <EditorPage /> : <HomePage />;
}
