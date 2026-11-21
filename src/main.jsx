import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import "./index.css";
import { loadSkin, storedSkin, wearSkin } from "./skins/skins.js";
import { reconcileSkins } from "./skins/store.js";

/* A promise nobody handled is a bug somewhere; say so where it can be seen. */
window.addEventListener("unhandledrejection", (e) => { console.error("Unhandled promise rejection", e.reason); });

// Hold the writer lock for the document lifetime, including pending storage writes.
async function boot() {
  if (window.Capacitor?.isNativePlatform?.()) return mount();
  const root = document.getElementById("root");
  root.textContent = "Nova is open in another tab. Close that tab to continue here.";
  if (!navigator.locks) {
    root.textContent = "Nova needs a browser with Web Locks and HTTPS to protect your saved chats. Please use a current browser.";
    return;
  }
  try {
    await navigator.locks.request("nova-writer", async () => {
      mount();
      await new Promise(() => {});
    });
  } catch {
    root.textContent = "Nova could not secure access to storage. Reload to try again.";
  }
}
function mount() {
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

}
/* A skin picked on this device is put on before the first frame, so the
   startup screen and the app open in it rather than changing look once
   they are up. It is read from this device's own storage; if it is slow
   or missing, the standard look carries on. */
function wearStoredSkin() {
  const id = storedSkin();
  if (id === "nova") return Promise.resolve();
  const late = new Promise((resolve) => setTimeout(resolve, 1500));
  return Promise.race([loadSkin(id).then(() => { wearSkin(id); }), late]).catch(() => {});
}
wearStoredSkin().then(boot);
reconcileSkins().catch(() => {});
