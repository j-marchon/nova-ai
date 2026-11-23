import { unzipSync, strFromU8 } from "fflate";

/* ---------- skin packs ----------

   A skin is a zip of data: a manifest, one stylesheet, pictures, fonts and
   GLSL shaders. Nothing in it runs as code in the page. The app's own skin
   engine (Scene.jsx, effects.js, shader.js) draws what the manifest
   describes. So a pack bought from Ko-fi, passed along in a backup, or made
   by anyone can only change how Nova looks, never what it can do or see.

   readPack checks a zip and turns it into what the engine uses. It is the
   one way in for a pack (Look → Add skin, a restored backup, Sync), so
   every rule a pack has to follow lives here:
   - limited size and file count, and only known file types;
   - the stylesheet may only point at files in the pack (no @import, no
     remote url(), no CSS escapes that could spell one out), because a
     remote url() in a selector-driven rule could report what is on the
     screen;
   - the same goes for every string in the manifest: styles and keyframes
     are data, but a url() or image-set() in one would still fetch;
   - pictures are only ever shown through <img> or CSS, never inlined, so
     any script inside an SVG never runs;
   - shaders run on the GPU, which has no way to reach the page.

   */

export const SKIN_API = 1;
export const MAX_ZIP_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024;
const MAX_FILES = 200;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TEXT = 512 * 1024;
const MAX_SHADER = 64 * 1024;
const MAX_NODES = 600;
const MAX_DEPTH = 12;

export class SkinError extends Error {}
const fail = (msg) => { throw new SkinError(msg); };

const TYPES = {
  css: "text/css", json: "application/json", frag: "text/plain", glsl: "text/plain", txt: "text/plain", md: "text/markdown",
  svg: "image/svg+xml", png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
};
const IMAGES = new Set(["svg", "png", "webp", "jpg", "jpeg"]);
const FONTS = new Set(["woff2", "woff", "ttf", "otf"]);
const ext = (path) => (/\.([a-z0-9]+)$/i.exec(path)?.[1] || "").toLowerCase();

/* A skin id ends up in html[data-skin="…"] and in storage keys. */
export const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
/* "nova" and "minimal" are the app's own looks, so no pack can take their place */
export const isPackId = (id) => typeof id === "string" && SKIN_ID.test(id) && id !== "nova" && id !== "minimal";

/* "1", "1.2" or "1.2.3"; compared part by part */
const VERSION = /^\d{1,4}(\.\d{1,4}){0,2}$/;
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/* anything in a style, keyframe or swatch that could fetch or smuggle */
const UNSAFE = /url\s*\(|image-set\s*\(|\bsrc\s*\(|@import|expression\s*\(|javascript:|\\|<\/?\s*style/i;
const checkString = (s, where) => {
  if (typeof s !== "string") fail(`${where} must be text.`);
  if (s.length > 4000) fail(`${where} is too long.`);
  if (UNSAFE.test(s)) fail(`${where} may not hold url(), image-set(), @import or backslashes. Point at pack files from the stylesheet instead.`);
  return s;
};

/* the bytes of a file as a data: URL, for <img src> and CSS url() alike
   (fonts have to be data:, which the desktop app's CSP allows) */
function dataUrl(bytes, type) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

/* unzip within the limits, with paths made relative to the manifest */
function unpack(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) fail("That file is empty.");
  if (bytes.length > MAX_ZIP_BYTES) fail(`That skin is larger than Nova accepts (${MAX_ZIP_BYTES / 1048576} MB).`);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail("That file is not a skin. Skins are .zip files.");
  let total = 0, count = 0;
  let raw;
  try {
    raw = unzipSync(bytes, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        if (++count > MAX_FILES) fail("That skin has too many files.");
        if (f.originalSize > MAX_FILE) fail(`${f.name} is too large.`);
        total += f.originalSize;
        if (total > MAX_TOTAL) fail("That skin is larger than Nova accepts once unpacked.");
        return true;
      },
    });
  } catch (e) {
    if (e instanceof SkinError) throw e;
    fail("That zip could not be opened. Download the skin again.");
  }
  const names = Object.keys(raw).filter((n) => !n.startsWith("__MACOSX/") && !n.split("/").some((p) => p.startsWith(".")));
  /* a pack zipped as its folder: the manifest one level down */
  const manifestAt = names.find((n) => n === "manifest.json") || names.find((n) => /^[^/]+\/manifest\.json$/.test(n));
  if (!manifestAt) fail("That zip has no manifest.json, so it is not a Nova skin.");
  const base = manifestAt.slice(0, -"manifest.json".length);
  const files = new Map();
  for (const n of names) {
    if (!n.startsWith(base)) continue;
    const path = n.slice(base.length);
    if (!path || path.includes("\\") || path.split("/").some((p) => p === ".." || p === "")) fail(`${n} has a path Nova does not accept.`);
    if (!TYPES[ext(path)]) fail(`${path} is a kind of file a skin may not hold.`);
    files.set(path, raw[n]);
  }
  return files;
}

/* a path written in the manifest or the stylesheet, against the pack */
function resolve(files, from, ref, kinds, what) {
  if (typeof ref !== "string" || !ref || ref.length > 200) fail(`${what} needs a file name.`);
  let path = ref.replace(/^\.\//, "");
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  const parts = [];
  for (const p of (dir + path).split("/")) {
    if (p === "." || p === "") continue;
    if (p === "..") { if (!parts.length) fail(`${what} points outside the skin.`); parts.pop(); } else parts.push(p);
  }
  path = parts.join("/");
  if (!files.has(path)) fail(`${what} points at ${ref}, which is not in the skin.`);
  if (kinds && !kinds.has(ext(path))) fail(`${what} points at ${ref}, which is the wrong kind of file.`);
  return path;
}

/* The stylesheet, with every url() turned into the pack file it names. */
export function packCss(text, files, from = "skin.css") {
  if (text.length > MAX_TEXT) fail("The stylesheet is too large.");
  if (text.includes("\\")) fail("The stylesheet may not use backslashes (CSS escapes). Write characters out instead.");
  if (/@import/i.test(text)) fail("The stylesheet may not use @import. Put everything in one file.");
  if (/image-set\s*\(|\bsrc\s*\(/i.test(text)) fail("The stylesheet may not use image-set() or src(). Use url() with a pack file.");
  if (/url\s+\(/i.test(text)) fail("The stylesheet has a url ( with a space; write url(…).");
  const URL_FN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]*))\s*\)/gi;
  const all = text.match(/url\(/gi)?.length || 0;
  let seen = 0;
  const out = text.replace(URL_FN, (_m, a, b, c) => {
    seen++;
    const ref = a ?? b ?? c;
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) fail(`The stylesheet points at ${ref}. A skin may only use its own files.`);
    const path = resolve(files, from, ref, new Set([...IMAGES, ...FONTS]), "A url() in the stylesheet");
    return `url("${dataUrl(files.get(path), TYPES[ext(path)])}")`;
  });
  if (seen !== all) fail("The stylesheet has a url() Nova could not read.");
  return out;
}

const TAGS = new Set(["div", "span", "img", "canvas", "p"]);
const CLASS = /^[A-Za-z0-9_ -]{0,200}$/;
const STYLE_KEY = /^(--[a-z0-9-]{1,40}|[a-z][a-zA-Z]{1,40})$/;
const FRAME_KEYS = new Set(["transform", "opacity", "offset", "easing", "rotate", "scale", "translate", "composite"]);
const DIRECTIONS = new Set(["normal", "reverse", "alternate", "alternate-reverse"]);
const FILLS = new Set(["none", "forwards", "backwards", "both", "auto"]);
const EASE = /^(linear|ease|ease-in|ease-out|ease-in-out|cubic-bezier\(\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\))$/;
const num = (v, min, max, where) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) fail(`${where} must be a number from ${min} to ${max}.`);
  return v;
};
const ease = (v, where) => (typeof v === "string" && EASE.test(v) ? v : fail(`${where} must be linear, ease… or cubic-bezier(…).`));

function style(obj, where) {
  if (obj == null) return undefined;
  if (typeof obj !== "object" || Array.isArray(obj)) fail(`${where} must be a set of styles.`);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!STYLE_KEY.test(k)) fail(`${where} has a style Nova does not accept: ${k}.`);
    out[k] = typeof v === "number" ? num(v, -1e6, 1e6, `${where}.${k}`) : checkString(v, `${where}.${k}`);
  }
  return out;
}

function animation(a, where) {
  if (!a || typeof a !== "object") fail(`${where} must describe an animation.`);
  if (!Array.isArray(a.keyframes) || !a.keyframes.length || a.keyframes.length > 24) fail(`${where}.keyframes must be a list of up to 24 frames.`);
  const keyframes = a.keyframes.map((f, i) => {
    if (!f || typeof f !== "object") fail(`${where}.keyframes[${i}] must be a frame.`);
    const out = {};
    for (const [k, v] of Object.entries(f)) {
      if (!FRAME_KEYS.has(k)) fail(`${where}.keyframes[${i}] may only animate transform and opacity (not ${k}).`);
      if (k === "offset" || k === "opacity") out[k] = num(v, 0, 1, `${where}.keyframes[${i}].${k}`);
      else if (k === "easing") out[k] = ease(v, `${where}.keyframes[${i}].easing`);
      else if (k === "composite") out[k] = ["replace", "add", "accumulate"].includes(v) ? v : fail(`${where} composite is replace, add or accumulate.`);
      else out[k] = checkString(v, `${where}.keyframes[${i}].${k}`);
    }
    return out;
  });
  const t = a.timing || {};
  const timing = { duration: num(t.duration, 1, 3600000, `${where}.timing.duration`) };
  if (t.delay != null) timing.delay = num(t.delay, -3600000, 3600000, `${where}.timing.delay`);
  if (t.iterations != null) timing.iterations = t.iterations === "infinite" ? Infinity : num(t.iterations, 0, 1e6, `${where}.timing.iterations`);
  if (t.direction != null) timing.direction = DIRECTIONS.has(t.direction) ? t.direction : fail(`${where}.timing.direction is not one Nova knows.`);
  if (t.fill != null) timing.fill = FILLS.has(t.fill) ? t.fill : fail(`${where}.timing.fill is not one Nova knows.`);
  if (t.easing != null) timing.easing = ease(t.easing, `${where}.timing.easing`);
  /* "ambient" plays whenever the field moves; "scene" also holds still
     while a chat is open, behind the text */
  const group = a.group == null ? "ambient" : ["ambient", "scene"].includes(a.group) ? a.group : fail(`${where}.group is ambient or scene.`);
  return { keyframes, timing, group };
}

const SHADER_KINDS = new Set(["field", "glyph"]);
function shader(s, files, where) {
  if (!s || typeof s !== "object") fail(`${where} must describe a shader.`);
  if (!SHADER_KINDS.has(s.kind)) fail(`${where}.kind is field or glyph.`);
  const path = resolve(files, "manifest.json", s.frag, new Set(["frag", "glsl"]), `${where}.frag`);
  const bytes = files.get(path);
  if (bytes.length > MAX_SHADER) fail(`${where}.frag is too large.`);
  const uniforms = {};
  for (const [k, v] of Object.entries(s.uniforms || {})) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,30}$/.test(k) || ["t", "res", "px", "tex"].includes(k)) fail(`${where}.uniforms has a name Nova does not accept: ${k}.`);
    uniforms[k] = num(v, -1e6, 1e6, `${where}.uniforms.${k}`);
  }
  return { kind: s.kind, frag: strFromU8(bytes), uniforms, fps: s.fps == null ? 30 : num(s.fps, 1, 60, `${where}.fps`) };
}

/* the tree the engine draws, with file names turned into the files */
function tree(root, files, where) {
  let count = 0;
  const walk = (n, path, depth) => {
    if (++count > MAX_NODES) fail(`${where} has too many parts.`);
    if (depth > MAX_DEPTH) fail(`${where} is nested too deeply.`);
    if (!n || typeof n !== "object" || Array.isArray(n)) fail(`${path} must be a part.`);
    const tag = n.tag || "div";
    if (!TAGS.has(tag)) fail(`${path}.tag must be one of: ${[...TAGS].join(", ")}.`);
    const out = { tag };
    if (n.class != null) out.class = CLASS.test(n.class) ? n.class : fail(`${path}.class has characters Nova does not accept.`);
    if (n.style != null) out.style = style(n.style, `${path}.style`);
    if (n.text != null) {
      if (typeof n.text !== "string" || n.text.length > 200) fail(`${path}.text must be short text.`);
      if (n.children) fail(`${path} has text and parts; give the text its own part.`);
      out.text = n.text;
    }
    if (n.src != null) {
      if (tag !== "img") fail(`${path}.src is only for img.`);
      const p = resolve(files, "manifest.json", n.src, IMAGES, `${path}.src`);
      out.src = dataUrl(files.get(p), TYPES[ext(p)]);
    }
    if (n.shader != null) {
      if (tag !== "canvas") fail(`${path}.shader is only for canvas.`);
      out.shader = shader(n.shader, files, `${path}.shader`);
    }
    if (tag === "canvas") {
      if (n.width != null) out.width = num(n.width, 1, 4096, `${path}.width`);
      if (n.height != null) out.height = num(n.height, 1, 4096, `${path}.height`);
    }
    if (n.animate != null) out.animate = animation(n.animate, `${path}.animate`);
    /* left out on a phone-sized screen */
    if (n.phone === false) out.phone = false;
    /* decoration, hidden from screen readers */
    if (n.hidden === true) out.hidden = true;
    if (n.children != null) {
      if (!Array.isArray(n.children)) fail(`${path}.children must be a list.`);
      out.children = n.children.map((c, i) => walk(c, `${path}.children[${i}]`, depth + 1));
    }
    return out;
  };
  const out = walk(root, where, 0);
  if (out.tag !== "div") fail(`${where} must be a div.`);
  return out;
}

/* Layered scenes (LayeredScene.jsx): pictures with their place, pivot and
   motion as plain numbers, and a few effects the app draws. */
const SCENE_FX = new Set(["glints", "sweep", "bubbles", "motes"]);
const nums = (v, n, min, max, where) => {
  if (!Array.isArray(v) || v.length !== n) fail(`${where} must be ${n} numbers.`);
  return v.map((x, i) => num(x, min, max, `${where}[${i}]`));
};
function scenes(list, files) {
  if (!Array.isArray(list) || !list.length || list.length > 8) fail("background.scenes must be a list of up to 8 scenes.");
  const picture = (ref, where) => {
    const p = resolve(files, "manifest.json", ref, IMAGES, where);
    return dataUrl(files.get(p), TYPES[ext(p)]);
  };
  const comp = (c, where) => {
    if (!c || typeof c !== "object") fail(`${where} must describe a scene.`);
    if (!Array.isArray(c.layers) || !c.layers.length || c.layers.length > 16) fail(`${where}.layers must be a list of up to 16 layers.`);
    if (c.fx != null && (!Array.isArray(c.fx) || c.fx.length > 8)) fail(`${where}.fx must be a list of up to 8 effects.`);
    return {
      width: num(c.width, 1, 8192, `${where}.width`),
      height: num(c.height, 1, 8192, `${where}.height`),
      period: num(c.period, 1, 600, `${where}.period`),
      layers: c.layers.map((l, i) => {
        const lw = `${where}.layers[${i}]`;
        if (!l || typeof l !== "object") fail(`${lw} must be a layer.`);
        if (l.frames != null && (!Array.isArray(l.frames) || l.frames.length > 121)) fail(`${lw}.frames must be a list of up to 121 frames.`);
        return {
          src: picture(l.src, `${lw}.src`),
          rect: nums(l.rect, 4, -1, 2, `${lw}.rect`),
          ...(l.pivot != null ? { pivot: nums(l.pivot, 2, -1, 2, `${lw}.pivot`) } : {}),
          ...(l.depth != null ? { depth: num(l.depth, 0, 4, `${lw}.depth`) } : {}),
          ...(l.frames != null ? {
            frames: l.frames.map((f, k) => {
              const fw = `${lw}.frames[${k}]`;
              const [o, x, y, r, sc, a] = nums(f, 6, -1000, 1000, fw);
              return [num(o, 0, 1, `${fw}[0]`), x, y, num(r, -360, 360, `${fw}[3]`), num(sc, 0, 10, `${fw}[4]`), num(a, 0, 1, `${fw}[5]`)];
            }),
          } : {}),
        };
      }),
      fx: (c.fx || []).map((f, i) => {
        const fw = `${where}.fx[${i}]`;
        if (!SCENE_FX.has(f?.kind)) fail(`${fw}.kind is glints, sweep, bubbles or motes.`);
        const out = { kind: f.kind };
        for (const [k, [min, max]] of Object.entries({ count: [0, 40], size: [1, 200], period: [1, 600], angle: [-180, 180], strength: [0, 1] })) {
          if (f[k] != null) out[k] = num(f[k], min, max, `${fw}.${k}`);
        }
        if (f.area != null) out.area = nums(f.area, 4, 0, 1, `${fw}.area`);
        return out;
      }),
    };
  };
  const ids = new Set();
  return list.map((s, i) => {
    const w = `background.scenes[${i}]`;
    if (!s || typeof s !== "object") fail(`${w} must be a scene.`);
    if (typeof s.id !== "string" || !SKIN_ID.test(s.id) || ids.has(s.id)) fail(`${w}.id must be a short, unique, lowercase name.`);
    ids.add(s.id);
    if (typeof s.name !== "string" || !s.name.trim() || s.name.length > 40) fail(`${w}.name must be up to 40 characters.`);
    if (s.desktop == null && s.phone == null) fail(`${w} needs a desktop or a phone version.`);
    return {
      id: s.id,
      name: s.name.trim(),
      ...(s.thumb != null ? { thumb: picture(s.thumb, `${w}.thumb`) } : {}),
      ...(s.desktop != null ? { desktop: comp(s.desktop, `${w}.desktop`) } : {}),
      ...(s.phone != null ? { phone: comp(s.phone, `${w}.phone`) } : {}),
    };
  });
}

function effects(e) {
  if (e == null) return {};
  if (typeof e !== "object") fail("effects must be a set of effects.");
  const cls = (v, where) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(v) ? v : fail(`${where} must be a class name.`));
  const out = {};
  if (e.layer != null) out.layer = cls(e.layer, "effects.layer");
  if (e.entry != null) {
    if (!Array.isArray(e.entry) || e.entry.length > 24) fail("effects.entry must be a list of up to 24 rules.");
    out.entry = e.entry.map((r, i) => {
      const w = `effects.entry[${i}]`;
      if (typeof r?.match !== "string" || r.match.length > 200 || !/^[\w\s.,#[\]="':()>*+~-]+$/.test(r.match)) fail(`${w}.match must be a CSS selector.`);
      return {
        match: r.match,
        ...(r.y != null ? { y: num(r.y, -200, 200, `${w}.y`) } : {}),
        ...(r.x != null ? { x: num(r.x, -200, 200, `${w}.x`) } : {}),
        ...(r.scale != null ? { scale: num(r.scale, 0, 3, `${w}.scale`) } : {}),
        ...(r.duration != null ? { duration: num(r.duration, 0, 5, `${w}.duration`) } : {}),
        ...(r.ease != null ? { ease: ease(r.ease, `${w}.ease`) } : {}),
      };
    });
  }
  if (e.ripple != null) out.ripple = { class: cls(e.ripple.class, "effects.ripple.class"), size: num(e.ripple.size ?? 64, 8, 400, "effects.ripple.size"), duration: num(e.ripple.duration ?? 520, 50, 4000, "effects.ripple.duration") };
  if (e.glint != null) out.glint = { class: cls(e.glint.class, "effects.glint.class") };
  if (e.sendBubbles != null) out.sendBubbles = { class: cls(e.sendBubbles.class, "effects.sendBubbles.class"), count: num(e.sendBubbles.count ?? 7, 1, 20, "effects.sendBubbles.count") };
  if (e.tabDroplet != null) out.tabDroplet = !!e.tabDroplet;
  if (e.dockShine != null) out.dockShine = { duration: num(e.dockShine.duration ?? 7000, 500, 60000, "effects.dockShine.duration") };
  return out;
}

/* The zip, checked, as { id, name, …, css, background, splash, effects }.
   Throws a SkinError with a sentence for the person adding it. */
export function readPack(input) {
  const files = unpack(input);
  let m;
  try { m = JSON.parse(strFromU8(files.get("manifest.json"))); } catch { fail("manifest.json is not valid JSON."); }
  if (!m || typeof m !== "object") fail("manifest.json is empty.");
  if (m.skinApi !== SKIN_API) {
    if (typeof m.skinApi === "number" && m.skinApi > SKIN_API) fail("This skin needs a newer version of Nova. Update Nova, then add it again.");
    fail("manifest.json does not say which skin format it uses (skinApi).");
  }
  if (!isPackId(m.id)) fail("The skin's id must be lowercase letters, digits and dashes (and not \"nova\" or \"minimal\").");
  if (typeof m.name !== "string" || !m.name.trim() || m.name.length > 40) fail("The skin needs a name of up to 40 characters.");
  if (typeof m.version !== "string" || !VERSION.test(m.version)) fail("The skin's version must look like 1.0.0.");
  const pack = {
    id: m.id,
    name: m.name.trim(),
    note: typeof m.note === "string" ? m.note.slice(0, 120) : "",
    author: typeof m.author === "string" ? m.author.slice(0, 60) : "",
    version: m.version,
    scheme: m.scheme === "light" || m.scheme === "dark" ? m.scheme : null,
    surface: !!m.surface,
    swatch: m.swatch == null ? "" : checkString(m.swatch, "swatch"),
    css: "",
    background: null,
    splash: null,
    effects: effects(m.effects),
  };
  if (m.css != null) {
    const path = resolve(files, "manifest.json", m.css, new Set(["css"]), "css");
    pack.css = packCss(strFromU8(files.get(path)), files, path);
  }
  if (m.background != null) {
    const b = m.background;
    if (b.root == null && b.scenes == null) fail("background needs a root or scenes.");
    pack.background = {
      ...(b.root != null ? { root: tree(b.root, files, "background.root") } : {}),
      ...(b.scenes != null ? { scenes: scenes(b.scenes, files) } : {}),
    };
  }
  if (m.splash != null) {
    const s = m.splash;
    pack.splash = {
      root: tree(s.root, files, "splash.root"),
      introMs: num(s.introMs ?? 1500, 0, 10000, "splash.introMs"),
      leaveMs: num(s.leaveMs ?? 700, 0, 5000, "splash.leaveMs"),
      quietIntroMs: num(s.quietIntroMs ?? 450, 0, 10000, "splash.quietIntroMs"),
      quietLeaveMs: num(s.quietLeaveMs ?? 250, 0, 5000, "splash.quietLeaveMs"),
    };
  }
  return pack;
}

/* Just what the list in Look needs, kept beside the zip. */
export const packMeta = (p) => ({ id: p.id, name: p.name, note: p.note, author: p.author, version: p.version, scheme: p.scheme, surface: p.surface, swatch: p.swatch });
