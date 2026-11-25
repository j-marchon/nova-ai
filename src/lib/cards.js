import { DEFAULT_THEME, greetingsOf } from "./data.js";
import { readImage, uid } from "./util.js";
import { isVideo, videoStill } from "./video.js";
import { bookFrom, toCharacterBook } from "./lore.js";
import { unzipSync } from "fflate";
import { depthPromptOf } from "./tavern.js";

/* ---------- character cards: import and export ----------

   The Character Card format every roleplay frontend outside the closed
   platforms shares (SillyTavern, Chub, and the exporters for the rest). A
   card is either JSON, or a PNG of the character with that JSON hidden in a
   tEXt chunk: keyword "chara" for V1/V2, "ccv3" for V3, value base64 of the
   UTF-8 JSON. V1 is a flat object; V2 and V3 wrap the same fields in `data`.

   A card's system prompt and post-history instructions are kept, on the
   character as systemPrompt and postHistoryInstructions, and sent under the
   card's name (see buildApiMessages for where, and how they share the
   prompt with the reply style). The card's lorebook (character_book) is
   kept too, as `lorebook`, and goes back out on export; see lore.js for how
   it is sent without breaking the prompt cache. */

/* A latin-1 string as bytes; a plain loop, which is much faster than
   Uint8Array.from with a mapper on megabyte card chunks. */
const latin1Bytes = (s) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export const b64ToBytes = (b64) => latin1Bytes(atob(b64));

/* Bytes as a latin-1 string, one char per byte. In slices, because spreading
   a large array into String.fromCharCode overflows the call stack. */
export function latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

export const bytesToB64 = (bytes) => btoa(latin1(bytes));

export const utf8 = new TextEncoder();

export const unutf8 = new TextDecoder();

/* Every text chunk in a PNG, by keyword. tEXt is latin-1 by spec, but the
   value here is always base64, so the bytes read straight through. iTXt is
   read too when uncompressed, since a few exporters use it. */
export function pngTextChunks(bytes) {
  const out = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || view.getUint32(0) !== 0x89504e47) return out;
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + len);
    if (type === "tEXt" || type === "iTXt") {
      const nul = body.indexOf(0);
      /* a keyword is 1-79 bytes by spec */
      if (nul > 0 && nul < 80) {
        const key = latin1(body.subarray(0, nul));
        let rest = body.subarray(nul + 1);
        if (type === "iTXt") {
          /* compression flag, method, then language and translated keyword */
          if (rest[0] !== 0) { at += 12 + len; continue; }
          rest = rest.subarray(2);
          const a = rest.indexOf(0);
          const b = rest.indexOf(0, a + 1);
          rest = rest.subarray(b + 1);
        }
        /* a card with a big lorebook has a text chunk of megabytes */
        out[key] = latin1(rest);
      }
    }
    if (type === "IEND") break;
    at += 12 + len;
  }
  return out;
}

export const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* A PNG with one tEXt chunk added just before IEND. Any existing chunk with
   the same keyword is dropped first, so re-exporting never stacks two. */
export function pngWithText(bytes, key, value) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [bytes.subarray(0, 8)];
  let at = 8;
  let iend = null;
  while (at + 8 <= bytes.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const chunk = bytes.subarray(at, at + 12 + len);
    const body = bytes.subarray(at + 8, at + 8 + len);
    const nul = type === "tEXt" ? body.indexOf(0) : -1;
    const sameKey = nul > 0 && nul < 80 && latin1(body.subarray(0, nul)) === key;
    if (type === "IEND") { iend = chunk; break; }
    if (!sameKey) parts.push(chunk);
    at += 12 + len;
  }
  const data = latin1Bytes(`${key}\0${value}`);
  const chunk = new Uint8Array(12 + data.length);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, data.length);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
  chunk.set(data, 8);
  cv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  parts.push(chunk, iend || Uint8Array.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* V1, V2 and V3 all reduced to one flat shape. */
export function cardFields(json) {
  const d = json && typeof json === "object" && json.data && typeof json.data === "object" ? json.data : json || {};
  const s = (v) => (typeof v === "string" ? v : "");
  return {
    name: s(d.name) || s(d.char_name),
    description: s(d.description) || s(d.char_persona),
    personality: s(d.personality),
    scenario: s(d.scenario) || s(d.world_scenario),
    first_mes: s(d.first_mes) || s(d.char_greeting),
    alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.filter((g) => typeof g === "string" && g.trim()) : [],
    mes_example: s(d.mes_example) || s(d.example_dialogue),
    creator_notes: s(d.creator_notes),
    character_book: d.character_book && typeof d.character_book === "object" ? d.character_book : null,
    system_prompt: s(d.system_prompt),
    post_history_instructions: s(d.post_history_instructions),
    creator: s(d.creator),
    characterVersion: s(d.character_version),
    tagline: s(d.extensions?.nova?.tagline),
    greetingLabels: Array.isArray(d.extensions?.nova?.greetingLabels) ? d.extensions.nova.greetingLabels.map(s) : [],
    tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === "string") : [],
    sprites: (d.sprites && typeof d.sprites === "object") ? d.sprites : (d.extensions?.sprites && typeof d.extensions.sprites === "object") ? d.extensions.sprites : {},
    depthPrompt: depthPromptOf(d.extensions?.depth_prompt),
    /* SillyTavern regex scripts, kept as they are so they go back out whole */
    regexScripts: Array.isArray(d.extensions?.regex_scripts)
      ? d.extensions.regex_scripts.filter((x) => x && typeof x === "object" && typeof x.findRegex === "string")
      : [],
  };
}

/* Older cards write <BOT> and <USER>; Nova, like everything current, uses
   {{char}} and {{user}}, which are filled in when a chat is sent. */
export const macros = (t) => String(t || "").replace(/<bot>/gi, "{{char}}").replace(/<user>/gi, "{{user}}");

/* An opening message is shown on screen and saved into the chat, so its
   macros are filled once, when it is placed, rather than at send time. */
export const fillNames = (t, charName, userName) =>
  String(t || "").replace(/\{\{char\}\}/gi, charName || "").replace(/\{\{user\}\}/gi, userName || "You");

/* An imported card's picture doubles as its chat background, at 75% so the
   bubbles stay readable over it. Kept apart from the avatar and larger, since
   it fills the whole screen. Centred and unzoomed; it can be reframed in the
   character's look settings like any other background. */
export const IMPORT_BG_OPACITY = 0.75;

export const IMPORT_BG_PX = 1600;

export const importedBackground = (image) =>
  image
    ? {
        image,
        opacity: IMPORT_BG_OPACITY,
        scale: 1,
        nx: 0,
        ny: 0,
        aspect: typeof window !== "undefined" && window.innerHeight ? +(window.innerWidth / window.innerHeight).toFixed(4) : 0.5625,
      }
    : null;

/* The card's own lorebook, named after the character. */
function lorebookOf(f) {
  const b = f.character_book ? bookFrom(f.character_book, f.name || "Lorebook") : null;
  if (!b) return null;
  return { ...b, name: b.name || f.name, entries: b.entries.map((e) => ({ ...e, content: macros(e.content) })) };
}

/* A card, as a Nova character. `source` records where it came from, so the
   Chub browser can tell what is already imported. */
export function characterFromCard(fields, avatar, source, background) {
  const f = fields;
  const lorebook = lorebookOf(f);
  const greetings = [f.first_mes, ...f.alternate_greetings]
    .map((t) => macros(t).trim())
    .filter(Boolean)
    .map((text, i) => ({ id: uid(), label: f.greetingLabels?.[i] ?? (i === 0 ? "" : `Alternate ${i}`), text }));
  return {
    id: uid(),
    name: f.name.trim() || "Imported character",
    description: macros(f.description).trim(),
    scenario: macros(f.scenario).trim(),
    ...(f.tagline ? { tagline: f.tagline } : {}),
    ...(f.characterVersion ? { characterVersion: f.characterVersion } : {}),
    personality: macros(f.personality).trim(),
    greetings,
    firstMessage: greetings[0]?.text || "",
    exampleDialogs: macros(f.mes_example).trim(),
    systemPrompt: macros(f.system_prompt).trim(),
    postHistoryInstructions: macros(f.post_history_instructions).trim(),
    ...(lorebook ? { lorebook } : {}),
    ...(f.depthPrompt ? { depthPrompt: { ...f.depthPrompt, prompt: macros(f.depthPrompt.prompt).trim() } } : {}),
    ...(f.regexScripts?.length ? { regexScripts: f.regexScripts } : {}),
    sprites: f.sprites && typeof f.sprites === "object" ? f.sprites : {},
    avatar: avatar || "",
    theme: { ...DEFAULT_THEME, ...(background ? { bgs: [importedBackground(background)] } : {}) },
    ...(f.tags.length ? { tags: f.tags } : {}),
    ...(f.creator ? { creator: f.creator } : {}),
    ...(f.creator_notes.trim() ? { creatorNotes: f.creator_notes.trim() } : {}),
    ...(source ? { source } : {}),
    importedAt: Date.now(),
  };
}

/* Avatars are stored larger for imports than for hand-made characters
   (220px), because the big card view shows them at close to full width. */
export const CARD_AVATAR_PX = 640;

/* A CharX file (RisuAI, SillyTavern): a zip holding card.json, a V3 card,
   and its pictures, named in data.assets by an embeded:// address (Risu's
   spelling). The main "icon" asset is the avatar. Only those two entries
   are unpacked. */
const EMBEDDED = /^(?:embedd?ed:\/\/|__asset:)/i;
const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", webp: "image/webp", gif: "image/gif", apng: "image/apng", avif: "image/avif", bmp: "image/bmp" };
const zipPath = (p) => p.replace(/\\/g, "/").replace(/^\.?\/+/, "");
export function readCharx(bytes) {
  let entry;
  try { entry = unzipSync(bytes, { filter: (f) => zipPath(f.name) === "card.json" })["card.json"]; } catch { entry = null; }
  if (!entry) throw new Error("no card.json in it");
  const json = JSON.parse(unutf8.decode(entry));
  const icons = (Array.isArray(json?.data?.assets) ? json.data.assets : [])
    .filter((a) => String(a?.type).toLowerCase() === "icon" && EMBEDDED.test(String(a.uri || "")))
    .map((a) => ({ name: String(a.name || ""), path: zipPath(String(a.uri).replace(EMBEDDED, "")), ext: String(a.ext || "").toLowerCase().replace(/^\./, "") }))
    .map((a) => ({ ...a, ext: a.ext || a.path.split(".").pop().toLowerCase() }))
    .filter((a) => IMAGE_TYPES[a.ext]);
  const icon = icons.find((a) => a.name.toLowerCase() === "main") || icons[0];
  const picture = icon ? Object.values(unzipSync(bytes, { filter: (f) => zipPath(f.name) === icon.path }))[0] : null;
  return { json, image: picture ? new Blob([picture], { type: IMAGE_TYPES[icon.ext] }) : null };
}

/* One file from the picker: a PNG card, a JSON card or a CharX. */
export async function importCardFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  let json;
  let avatar = "";
  let background = "";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) {
    let image;
    try { ({ json, image } = readCharx(bytes)); }
    catch (e) { throw new Error(`${file.name} is a zip, but not a CharX card (${e.message}).`); }
    if (image) {
      avatar = await readImage(image, CARD_AVATAR_PX, 0.85).then((r) => r.data, () => "");
      background = await readImage(image, IMPORT_BG_PX, 0.85).then((r) => r.data, () => "");
    }
  } else if (isPng) {
    const text = pngTextChunks(bytes);
    const raw = text.ccv3 || text.chara;
    if (!raw) throw new Error(`${file.name} is an image, but not a character card.`);
    json = JSON.parse(unutf8.decode(b64ToBytes(raw)));
    /* an animated PNG card stays animated, as avatar and backdrop alike */
    avatar = await readImage(file, CARD_AVATAR_PX, 0.85).then((r) => r.data, () => "");
    background = await readImage(file, IMPORT_BG_PX, 0.85).then((r) => r.data, () => "");
  } else {
    try { json = JSON.parse(unutf8.decode(bytes)); }
    catch { throw new Error(`${file.name} is not a PNG, JSON or CharX character card.`); }
  }
  const fields = cardFields(json);
  if (!fields.name && !fields.description && !fields.first_mes) throw new Error(`${file.name} has no character in it.`);
  return characterFromCard(fields, avatar, { kind: "file", name: file.name }, background);
}

/* A Nova character as a V2 card: the avatar (or a plain placeholder) as a
   PNG, with the card in a "chara" chunk. Greetings go back out as
   first_mes plus alternate_greetings, the same shape they came in. */
export function characterCardJson(ch) {
  const greetings = greetingsOf(ch);
  const greets = greetings.map((g) => g.text);
  const nova = { ...ch.extensions?.nova };
  if (ch.tagline) nova.tagline = ch.tagline;
  if (greetings.some((g) => g.label)) nova.greetingLabels = greetings.map((g) => g.label || "");
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: {
      name: ch.name || "",
      description: ch.description || "",
      personality: ch.personality || "",
      scenario: ch.scenario || "",
      first_mes: greets[0] || "",
      alternate_greetings: greets.slice(1),
      mes_example: ch.exampleDialogs || "",
      creator_notes: ch.creatorNotes || "",
      system_prompt: ch.systemPrompt || "",
      post_history_instructions: ch.postHistoryInstructions || "",
      ...(toCharacterBook(ch.lorebook) ? { character_book: toCharacterBook(ch.lorebook) } : {}),
      tags: ch.tags || [],
      creator: ch.creator || "",
      character_version: ch.characterVersion || "",
      extensions: {
        ...(ch.extensions || {}),
        ...(Object.keys(nova).length ? { nova } : {}),
        ...(ch.sprites && Object.keys(ch.sprites).length ? { sprites: ch.sprites } : {}),
        ...(depthPromptOf(ch.depthPrompt) ? { depth_prompt: depthPromptOf(ch.depthPrompt) } : {}),
        ...(ch.regexScripts?.length ? { regex_scripts: ch.regexScripts } : {}),
      },
    },
  };
}

export async function characterCardPng(ch) {
  const card = characterCardJson(ch);
  const canvas = document.createElement("canvas");
  /* a card is a PNG, so a video avatar goes out as its first frame */
  const picture = isVideo(ch.avatar) ? await videoStill(ch.avatar).catch(() => "") : ch.avatar;
  const img = picture
    ? await new Promise((res) => {
        const i = new Image();
        i.crossOrigin = "anonymous";
        i.onload = () => res(i);
        i.onerror = () => res(null);
        i.src = picture;
      })
    : null;
  if (img) {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d").drawImage(img, 0, 0);
  } else {
    canvas.width = 400;
    canvas.height = 533;
    const g = canvas.getContext("2d");
    g.fillStyle = "#18181b";
    g.fillRect(0, 0, 400, 533);
  }
  let blob;
  try {
    blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  } catch {
    blob = null;
  }
  /* a remote avatar without CORS taints the canvas; fall back to the
     placeholder rather than failing the export */
  if (!blob) return characterCardPng({ ...ch, avatar: "" });
  const png = new Uint8Array(await blob.arrayBuffer());
  return pngWithText(png, "chara", bytesToB64(utf8.encode(JSON.stringify(card))));
}

/* Hand a file to the user. In a browser that is a download. In the Android
   app a download link does nothing, so the file is written to Documents/Nova
   on the phone itself: nothing goes through the share sheet or any cloud,
   and a file there outlives the app being uninstalled. Returns where it went,
   for the message that says so.

   `data` is a string (written as UTF-8), a Uint8Array, or an iterable (sync
   or async) of string pieces, such as backupParts(): a backup with every
   picture in it can be hundreds of MB, and handed to the native side as one
   string it takes the app down with it. On the phone it goes across in small
   pieces into `<name>.part`, which is renamed only once complete, so a file
   under the final name is never a truncated one. `onProgress(fraction)` is
   called as it goes when the size is known (string or bytes). */
export const LOCAL_FOLDER = "Nova";
export async function saveFile(name, data, mime, { folder = LOCAL_FOLDER, onProgress } = {}) {
  const P = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
  if (P?.Filesystem) {
    const path = `${folder}/${name}`;
    await writeChunked(P.Filesystem, path, data, { onProgress });
    return `Documents/${path}`;
  }
  const url = URL.createObjectURL(await toBlob(data, mime));
  onProgress?.(1);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return `Downloads/${name}`;
}

/* Pieces are folded into Blobs every few MB, so the strings can be let go of
   as the file is built rather than all held to the end. */
async function toBlob(data, mime) {
  if (typeof data === "string" || data instanceof Uint8Array) return new Blob([data], { type: mime });
  const blobs = [];
  let batch = [];
  let size = 0;
  for await (const piece of data) {
    batch.push(piece);
    size += piece.length;
    if (size >= 4 * 1024 * 1024) { blobs.push(new Blob(batch)); batch = []; size = 0; }
  }
  return new Blob([...blobs, ...batch], { type: mime });
}

/* The most text handed to the native side in one call. Each call through
   the Capacitor bridge has a fixed cost, so fewer, larger calls write a big
   library faster; 1 MB is still small next to what a phone's WebView holds. */
export const WRITE_CHUNK = 1024 * 1024;

const breath = () => new Promise((resolve) => setTimeout(resolve, 0));
const quietly = async (fn) => { try { await fn(); } catch {} };

/* A cut point at or below `at` that does not split a surrogate pair. */
function cutAt(s, at) {
  const c = s.charCodeAt(at - 1);
  return c >= 0xd800 && c <= 0xdbff ? at - 1 : at;
}

/* String pieces regrouped into chunks of at most `cap` UTF-16 units: small
   pieces are joined, big ones split. */
export async function* textChunks(pieces, cap = WRITE_CHUNK) {
  let buf = "";
  for await (const piece of pieces) {
    if (typeof piece !== "string") throw new TypeError("saveFile pieces must be strings");
    buf += piece;
    while (buf.length >= cap) {
      const at = cutAt(buf, cap);
      yield buf.slice(0, at);
      buf = buf.slice(at);
    }
  }
  if (buf) yield buf;
}

/* Capacitor's Filesystem (or anything with its writeFile, appendFile,
   rename, stat and deleteFile), writing `data` to `path` through
   `path.part`. Binary goes as base64 without an encoding, which the plugin
   decodes call by call (Android and web alike) before appending the bytes,
   so each call carries a whole number of 3-byte groups: no padding in the
   middle of the file. A failure while writing removes the .part; one while moving it into place keeps it. */
export async function writeChunked(fs, path, data, { directory = "DOCUMENTS", onProgress, chunk = WRITE_CHUNK } = {}) {
  const part = `${path}.part`;
  let first = true;
  const put = async (text, binary) => {
    const opts = { path: part, data: text, directory, ...(binary ? {} : { encoding: "utf8" }) };
    if (first) {
      first = false;
      await fs.writeFile({ ...opts, recursive: true });
    } else {
      await fs.appendFile(opts);
    }
    /* let the screen paint between pieces */
    await breath();
  };
  try {
    if (data instanceof Uint8Array) {
      const step = Math.max(3, Math.floor((chunk * 3) / 4 / 3) * 3);
      for (let i = 0; i < data.length || first; i += step) {
        await put(bytesToB64(data.subarray(i, i + step)), true);
        onProgress?.(data.length ? Math.min(1, (i + step) / data.length) : 1);
      }
    } else if (typeof data === "string") {
      for await (const text of textChunks([data], chunk)) {
        await put(text, false);
      }
      if (first) await put("", false);
      onProgress?.(1);
    } else if (data && (typeof data[Symbol.iterator] === "function" || typeof data[Symbol.asyncIterator] === "function")) {
      for await (const text of textChunks(data, chunk)) await put(text, false);
      if (first) await put("", false);
    } else {
      throw new TypeError("saveFile needs a string, bytes or string pieces");
    }
  } catch (e) {
    await quietly(() => fs.deleteFile({ path: part, directory }));
    throw e;
  }
  /* The piece is complete. If the move fails the .part stays: it may be the
     only whole copy left. */
  await moveOnto(fs, part, path, directory);
}

/* Rename, and if a file of that name is in the way, set it aside as
   `.old`, rename again, and only then delete it. If the second rename
   fails the old file is put back and the new one stays where it is. */
async function moveOnto(fs, from, to, directory) {
  const move = () => fs.rename({ from, to, directory, toDirectory: directory });
  try {
    await move();
  } catch (e) {
    let exists = false;
    try { await fs.stat({ path: to, directory }); exists = true; } catch {}
    if (!exists) throw e;
    const old = `${to}.old`;
    await quietly(() => fs.deleteFile({ path: old, directory }));
    await fs.rename({ from: to, to: old, directory, toDirectory: directory });
    try {
      await move();
    } catch (err) {
      await quietly(() => fs.rename({ from: old, to, directory, toDirectory: directory }));
      throw err;
    }
    await quietly(() => fs.deleteFile({ path: old, directory }));
  }
}

export const fileSafe = (s) => String(s || "character").replace(/[\\/:*?"<>|]+/g, "").trim() || "character";
