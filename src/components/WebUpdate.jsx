import { useEffect, useState } from "react";
import { activity } from "../lib/activity.js";

export function WebUpdate({ prepare }) {
  const [worker, setWorker] = useState(null);
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
  const update = async () => {
    if (activity.get().some(job => job.status === 'running' || job.status === 'queued')) {
      setNote('Finish or cancel active requests before updating.');
      return;
    }
    try {
      await prepare();
      if (activity.get().some(job => job.status === 'running' || job.status === 'queued')) {
        setNote('Finish or cancel active requests before updating.');
        return;
      }
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      worker.postMessage('ACTIVATE');
    } catch { setNote('Save failed. Retry or export your data before updating.'); }
  };
  if (!worker && !note) return null;
  return <div role="status" className="fixed top-0 inset-x-0 z-[9998] p-3 bg-zinc-900 text-white">
    {worker && <button className="underline p-2" onClick={update}>Update available — save and reload</button>}
    {note}
  </div>;
}
