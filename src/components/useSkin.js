import { useEffect, useState, useSyncExternalStore } from "react";
import { installedSkins, onSkinsChange } from "../skins/store.js";
import { isBuiltInSkin, loadSkin, loadedRevision, loadedSkin, onSkinsLoaded, skinRevision, wearSkin } from "../skins/skins.js";

/* The skins added on this device (skins/store.js); re-renders when one is
   added, updated or removed. */
export const useInstalledSkins = () => useSyncExternalStore(onSkinsChange, installedSkins, installedSkins);

/* A number that changes each time a skin pack finishes loading, so what is
   read from loaded packs (their scenes) is read again. */
export const useLoadedSkins = () => useSyncExternalStore(onSkinsLoaded, loadedRevision, loadedRevision);

/* The skin picked in Look (appearance.skin): loads it the first time, then
   puts it on (skins/skins.js). Returns its parts once it is worn, or null
   for the looks that come with the app (Nova, Minimal: only their
   stylesheet changes) or while it loads; if it cannot load, the standard
   look stays. A new version of the worn skin is put on in its place. */
export function useSkin(id) {
  useInstalledSkins();
  const rev = skinRevision(id);
  const [mod, setMod] = useState(() => (!isBuiltInSkin(id) && loadedSkin(id)) || null);
  useEffect(() => {
    let alive = true;
    if (isBuiltInSkin(id)) { wearSkin(id); setMod(null); return undefined; }
    loadSkin(id).then((m) => {
      if (!alive) return;
      if (!m) { wearSkin("nova"); setMod(null); return; }
      wearSkin(id);
      setMod(m);
    }, (error) => {
      console.warn("Could not put the skin on:", error?.message || error);
      if (alive) { wearSkin("nova"); setMod(null); }
    });
    return () => { alive = false; };
  }, [id, rev]);
  return mod;
}
