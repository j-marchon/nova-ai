import { createElement } from "react";
import NOVA_SCENES from "./scenes/nova.json";
import { isPackId, readPack } from "./pack.js";
import { installedSkins, onSkinsChange, packBytes } from "./store.js";
import { SkinBackground, SkinSplash } from "./Scene.jsx";
import { installEffects } from "./effects.js";

/* ---------- skins: whole new looks for the same app ----------

   Nova's own look is "nova". "minimal" also comes with the app: plain black,
   monochrome, with no grid, grain or effects (index.css, under
   html[data-skin="minimal"]). Every other skin is a pack added on this
   device (Settings → Look → Add skin), kept by store.js and checked by
   pack.js. Wearing one puts its stylesheet in the page, scoped to
   html[data-skin="<id>"], draws its background and startup screen with
   the app's skin engine (Scene.jsx), and switches on its effects
   (effects.js). Nothing about what the app can do changes with the skin.

   The skin picked is kept in the saved appearance (appearance.skin), and
   mirrored in localStorage so the startup screen can wear it before the
   saved data has loaded. A pick whose skin is not on this device (a
   restored backup without its skins, a removed skin) shows the standard
   look; the pick itself is kept, so it comes back when the skin is added. */

export const STANDARD = { id: "nova", name: "Nova", note: "The standard look", swatch: "radial-gradient(60% 80% at 70% 45%, oklch(0.75 0 0), oklch(0.18 0 0) 45%, oklch(0 0 0) 80%)" };
/* Nova's own backgrounds: layered night scenes,
   served beside the app at scenes/nova/ */
const NOVA_SCENE_BASE = () => `${import.meta.env?.BASE_URL || "/"}scenes/nova/`;

/* The layered scenes a skin draws behind every screen, or null: Nova's
   own, or a pack's once it has loaded. { scenes, base }. A component pass
   useLoadedSkins() as `rev`, so it reads again when a pack finishes loading
   (the compiler memoises calls by their arguments). */
export function sceneSetOf(id, rev = 0) { // eslint-disable-line no-unused-vars
  if (id === "nova") return { scenes: NOVA_SCENES, base: NOVA_SCENE_BASE() };
  const scenes = loaded.get(id)?.scenes;
  return scenes?.length ? { scenes, base: "" } : null;
}

/* plain: no grid, grain, background picture or ambient light */
export const MINIMAL = { id: "minimal", name: "Minimal", note: "Plain black, no grain or effects", swatch: "oklch(0 0 0)", scheme: "dark", surface: true, plain: true };
const BUILT_IN = [STANDARD, MINIMAL];
const builtIn = (id) => BUILT_IN.find((k) => k.id === id) || null;
export const isBuiltInSkin = (id) => !!builtIn(id);

/* Skins sold separately to supporters. They are listed whether or not they
   are on this device, so everyone can see them; one that is not added yet
   shows as locked until its file is added. */
/* where supporters get them: the Ko-fi page */
export const SUPPORT_URL = "https://ko-fi.com/bjmar";
export const SUPPORTER_SKINS = [
  { id: "aero", name: "Aero", note: "Supporter skin", swatch: "linear-gradient(180deg, oklch(0.83 0.08 235), oklch(0.97 0.02 215) 58%, oklch(0.84 0.09 225))", locked: true },
];

/* Nova and Minimal first, then the added skins in the order they were
   added, then the supporter skins not on this device yet. */
export function skinList(installed = installedSkins()) {
  const have = new Set(installed.map((m) => m.id));
  return [...BUILT_IN, ...installed, ...SUPPORTER_SKINS.filter((k) => !have.has(k.id))];
}
const metaOf = (id) => builtIn(id) || installedSkins().find((m) => m.id === id) || null;

/* a well-formed pick, whether or not that skin is on this device */
export const isSkinId = (id) => isBuiltInSkin(id) || isPackId(id);
/* whether this device can wear it */
export const canWear = (id) => !!metaOf(id);
export const skinOf = (appearance) => (canWear(appearance?.skin) ? appearance.skin : "nova");
/* a skin drawn for one mode only wears it whatever Mode says ("light"), or
   null when Mode decides; the saved Mode is left alone, so it comes back
   when the skin comes off */
export const skinScheme = (id) => metaOf(id)?.scheme || null;
/* a skin that draws its own surface leaves Grid and grain with nothing to do */
export const skinSurface = (id) => !!metaOf(id)?.surface;
/* a plain skin shows no background picture, grid or grain at all */
export const skinPlain = (id) => !!metaOf(id)?.plain;
/* what the list of skins changed to, so a pick follows an updated pack */
export const skinRevision = (id) => { const m = isBuiltInSkin(id) ? null : metaOf(id); return m ? `${m.version}:${m.addedAt || 0}` : ""; };

const KEY = "nova-skin";
/* the skin picked last on this device, for the startup screen */
export function storedSkin() {
  try {
    const id = localStorage.getItem(KEY);
    return canWear(id) ? id : "nova";
  } catch {
    return "nova";
  }
}

const loaded = new Map();
/* a pack finishing loading, for components (useLoadedSkins in useSkin.js) */
let loadedRev = 0;
const loadedListeners = new Set();
export const onSkinsLoaded = (fn) => { loadedListeners.add(fn); return () => loadedListeners.delete(fn); };
export const loadedRevision = () => loadedRev;
const markLoaded = () => { loadedRev++; for (const fn of loadedListeners) fn(); };
const pending = new Map();

/* the worn skin's parts, once loaded (null for the standard look):
   { Background, Splash, install } */
export const loadedSkin = (id) => loaded.get(id) || null;

function styleFor(id) {
  return document.head.querySelector(`style[data-skin-pack="${id}"]`);
}

function build(pack) {
  /* the stylesheet goes in once loaded; it is inert until the attribute
     is on the root */
  let el = styleFor(pack.id);
  if (!el) {
    el = document.createElement("style");
    el.dataset.skinPack = pack.id;
    document.head.appendChild(el);
  }
  el.textContent = pack.css;
  const mod = { pack };
  if (pack.background?.root) mod.Background = (props) => createElement(SkinBackground, { ...props, spec: pack.background });
  /* a pack's layered scenes are drawn by LayeredScene (App.jsx) */
  if (pack.background?.scenes?.length) mod.scenes = pack.background.scenes;
  if (pack.splash) mod.Splash = (props) => createElement(SkinSplash, { ...props, spec: pack.splash });
  mod.install = () => installEffects(pack.effects);
  return mod;
}

export function loadSkin(id) {
  if (isBuiltInSkin(id) || !canWear(id)) return Promise.resolve(null);
  if (loaded.has(id)) return Promise.resolve(loaded.get(id));
  if (!pending.has(id)) {
    const job = packBytes(id).then((bytes) => {
      if (!bytes) throw new Error(`The ${id} skin is not on this device.`);
      const mod = build(readPack(bytes));
      if (pending.get(id) === job) { loaded.set(id, mod); pending.delete(id); markLoaded(); }
      return mod;
    }, (error) => { throw error; });
    job.catch(() => { if (pending.get(id) === job) pending.delete(id); });
    pending.set(id, job);
  }
  return pending.get(id);
}

let undo = null;
let worn = "nova";
/* Put a loaded skin on (its stylesheet is already in the page once loaded;
   the attribute is what switches it on). Anything else goes back to the
   standard look. */
export function wearSkin(id) {
  const next = canWear(id) && (isBuiltInSkin(id) || loaded.has(id)) ? id : "nova";
  try { localStorage.setItem(KEY, next); } catch { /* private mode */ }
  if (next === worn) return next;
  undo?.();
  undo = null;
  worn = next;
  const root = document.documentElement;
  if (next === "nova") delete root.dataset.skin;
  else {
    root.dataset.skin = next;
    undo = loaded.get(next)?.install?.() || null;
  }
  return next;
}

/* A skin added again (a new version) or removed: forget the loaded copy,
   take it off if it is worn, so the next wear reads the new one. */
const seen = new Map();
onSkinsChange(() => {
  const now = new Map(installedSkins().map((m) => [m.id, skinRevision(m.id)]));
  for (const [id, r] of seen) {
    if (now.get(id) === r) continue;
    if (worn === id) wearSkin("nova");
    loaded.delete(id);
    pending.delete(id);
    styleFor(id)?.remove();
  }
  seen.clear();
  for (const [id, r] of now) seen.set(id, r);
});
for (const m of installedSkins()) seen.set(m.id, skinRevision(m.id));
