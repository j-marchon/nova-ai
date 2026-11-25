import { useEffect, useState } from "react";
import { UpdateDialog } from "./UpdateDialog.jsx";

/* The web app's update: a new release waiting in the service worker. Update
   saves the library and reloads into it. */
export function WebUpdate({ prepare }) {
  const [worker, setWorker] = useState(null);
  const [later, setLater] = useState(false);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:' || window.Capacitor?.isNativePlatform?.()) return;
    let alive = true;
    let registration;
    const inspect = () => { if (alive && registration?.waiting) setWorker(registration.waiting); };
    const found = () => registration.installing?.addEventListener('statechange', inspect);
    navigator.serviceWorker.register('/sw.js').then(r => {
      registration = r;
      inspect();
      r.addEventListener('updatefound', found);
    }).catch(() => { if (alive) setNote('Offline installation unavailable. You can continue online.'); });
    return () => { alive = false; registration?.removeEventListener('updatefound', found); };
  }, []);
  if (worker && !later) {
    return <UpdateDialog detail="Nova reloads into it with your library saved." prepare={prepare} onLater={() => setLater(true)}
      install={() => {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
        worker.postMessage('ACTIVATE');
      }} />;
  }
  if (!note) return null;
  return <div role="status" className="fixed top-0 inset-x-0 z-[9998] p-3 bg-zinc-900 text-white">{note}</div>;
}
