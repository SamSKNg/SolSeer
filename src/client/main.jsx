import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./desktop.css";

document.documentElement.classList.toggle("desktop-app", Boolean(window.solseerDesktop));
createRoot(document.getElementById("root")).render(<App />);
