import { useEffect, useState } from "react";

/* "auto" follows the phone's own light/dark setting, live. Returns the scheme
   actually in force, "dark" or "light", and keeps the page behind the app
   (overscroll, the status bar on Android) in step with it. */
const query = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null);

export function useSystemLight() {
  const [light, setLight] = useState(() => !!query()?.matches);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const on = (e) => setLight(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return light;
}

export function useResolvedScheme(pref) {
  const sysLight = useSystemLight();
  const scheme = pref === "auto" ? (sysLight ? "light" : "dark") : pref === "light" ? "light" : "dark";
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = scheme;
    root.classList.toggle("dark", scheme === "dark");
    const bg = scheme === "light" ? "#ffffff" : "#000000";
    document.body.style.background = bg;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  }, [scheme]);
  return scheme;
}
