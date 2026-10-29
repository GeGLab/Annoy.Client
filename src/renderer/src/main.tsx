import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";
import { applyTheme } from "./lib/theme.ts";
import { getState } from "./store.ts";

applyTheme(getState().settings.theme, getState().settings);

if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
