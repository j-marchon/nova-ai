import { CARD_AVATAR_PX, IMPORT_BG_PX, b64ToBytes, cardFields, characterFromCard } from "./cards.js";
import { readImage } from "./util.js";

/* ---------- Chub ----------

   Chub's public API, the same calls SillyTavern makes:

     search   GET api.chub.ai/search?...        → { data: { nodes, count } }
     card     GET api.chub.ai/api/characters/{author}/{slug}?full=true
                                                 → { node: { definition, ... } }

   Chub's own field names do not match the card's. Its `personality` is the
   main description, `tavern_personality` is the personality field, and its
   `description` is the creator's notes — mapped here the way SillyTavern
   maps them.

   Requests go through Capacitor's native HTTP in the Android app, which is
   not subject to the browser's cross-origin rules; in a browser they are a
   plain fetch. */
export const CHUB_API = "https://api.chub.ai";

/* An image with no declared type will not decode from a data URL, and native
   HTTP hands back bare bytes, so the type is read from the file itself. */
export function imageMime(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "image/png";
}

export async function chubGet(url, { binary = false } = {}) {
  const http = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.Plugins?.CapacitorHttp;
  if (http) {
    const r = await http.request({
      url,
      method: "GET",
      headers: { Accept: binary ? "*/*" : "application/json" },
      responseType: binary ? "arraybuffer" : "json",
    });
    if (r.status >= 400) throw new Error(`Chub answered ${r.status}.`);
    if (binary) return typeof r.data === "string" ? b64ToBytes(r.data) : new Uint8Array(r.data);
    return typeof r.data === "string" ? JSON.parse(r.data) : r.data;
  }
  let res;
  try {
    res = await fetch(url, { headers: binary ? {} : { Accept: "application/json" } });
  } catch {
    throw new Error("Could not reach Chub. Check your connection.");
  }
  if (!res.ok) throw new Error(`Chub answered ${res.status}.`);
  return binary ? new Uint8Array(await res.arrayBuffer()) : res.json();
}

/* A search result, trimmed to what the browser shows and what a favourite
   needs to keep so the Favorites view works without a request. */
export const chubHit = (n) => ({
  fullPath: n.fullPath,
  name: n.name || n.fullPath,
  tagline: n.tagline || "",
  avatar: n.avatar_url || n.max_res_url || `https://avatars.charhub.io/avatars/${n.fullPath}/avatar.webp`,
  topics: Array.isArray(n.topics) ? n.topics : [],
  stars: n.starCount ?? null,
  chats: n.nChats ?? null,
  favorites: n.n_favorites ?? null,
  tokens: n.nTokens ?? n.n_tokens ?? null,
  nsfw: !!(n.nsfw_image || n.nsfw || n.nsfl),
});

/* Adult content by Chub's own flags or tags. Used on top of the request's
   own filter, since a card's flags are set by its author and tags are not
   always consistent. Older saved favourites carry only their topics. */
const ADULT_TAG = /^(nsfw|nsfl|explicit|smut|lewd|18\+|adult)$/i;
export const isAdultHit = (h) => !!h?.nsfw || (h?.topics || []).some((t) => ADULT_TAG.test(String(t).trim()));

export const CHUB_PAGE = 24;

/* `safe` (the default) asks Chub for no NSFW or NSFL cards and drops any
   that still come back flagged or tagged as adult. */
export async function chubSearch({ q = "", page = 1, sort = "download_count", safe = true }) {
  /* "random" is not a Chub sort: it is a random page of the popular list,
     shuffled here, so every visit and every shuffle shows different cards. */
  const random = sort === "random";
  const run = async (pg) => {
    const p = new URLSearchParams({
      search: q,
      first: String(CHUB_PAGE),
      page: String(pg),
      sort: random ? "download_count" : sort,
      asc: "false",
      nsfw: safe ? "false" : "true",
      nsfl: safe ? "false" : "true",
      include_forks: "true",
      venus: "false",
    });
    const r = await chubGet(`${CHUB_API}/search?${p}`);
    const nodes = r?.data?.nodes || r?.nodes || [];
    const all = nodes.filter((n) => n?.fullPath).map(chubHit);
    /* `raw` is what the page held before filtering, so paging still knows
       when Chub has run out */
    return { hits: safe ? all.filter((h) => !isAdultHit(h)) : all, raw: all.length, count: r?.data?.count ?? r?.count ?? null };
  };
  if (!random) return run(page);
  let r = await run(1 + Math.floor(Math.random() * (q ? 5 : 100)));
  if (!r.hits.length) r = await run(1);
  for (let i = r.hits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r.hits[i], r.hits[j]] = [r.hits[j], r.hits[i]];
  }
  return r;
}

/* chub.ai/characters/author/slug, characterhub.org/characters/author/slug,
   or just author/slug. Query strings and trailing slashes are ignored. */
export function parseChubPath(str) {
  const clean = String(str || "").trim().split(/[?#]/)[0].replace(/\/+$/, "");
  const parts = clean.split("/").filter(Boolean);
  const host = parts.findIndex((x) => /(^|\.)(chub\.ai|characterhub\.org)$/i.test(x));
  let rest = host >= 0 ? parts.slice(host + 1) : parts.filter((x) => !/^https?:$/i.test(x));
  if (rest[0]?.toLowerCase() === "characters") rest = rest.slice(1);
  if (rest.length !== 2 || rest.some((x) => x.includes("."))) return null;
  return rest.join("/");
}

/* Chub's public description (its `description`, the card's creator notes)
   arrives as markdown with HTML mixed in. Shown as plain text: tags and
   image embeds go, links keep their words. */
export function plainNotes(text) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[*_]{2,}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* The full public description of one card, for its detail sheet. Cached, so
   opening the same card twice costs one request. */
const notesCache = new Map();
export async function chubNotes(fullPath) {
  if (notesCache.has(fullPath)) return notesCache.get(fullPath);
  const r = await chubGet(`${CHUB_API}/api/characters/${fullPath}?full=true`);
  const node = r?.node || {};
  const out = plainNotes(node.description || node.definition?.description || "");
  notesCache.set(fullPath, out);
  return out;
}

export async function chubImport(fullPath) {
  const r = await chubGet(`${CHUB_API}/api/characters/${fullPath}?full=true`);
  const node = r?.node;
  const d = node?.definition;
  if (!d) throw new Error("Chub did not return that character.");
  const fields = cardFields({
    name: d.name || node.name,
    description: d.personality,
    personality: d.tavern_personality,
    scenario: d.scenario,
    first_mes: d.first_message,
    alternate_greetings: d.alternate_greetings,
    mes_example: d.example_dialogs,
    creator_notes: d.description,
    system_prompt: d.system_prompt,
    post_history_instructions: d.post_history_instructions,
    character_book: d.embedded_lorebook || d.character_book || null,
    creator: fullPath.split("/")[0],
    tags: node.topics,
  });
  /* The picture is fetched and stored like any other avatar so the card
     works offline. If that fails, the remote address is kept instead. */
  const imageUrl = node.max_res_url || node.avatar_url;
  let avatar = "";
  let background = "";
  if (imageUrl) {
    try {
      const bytes = await chubGet(imageUrl, { binary: true });
      const blob = new Blob([bytes], { type: imageMime(bytes) });
      /* Chub serves GIFs and animated WebPs too; those are kept moving */
      avatar = (await readImage(blob, CARD_AVATAR_PX, 0.85)).data;
      background = (await readImage(blob, IMPORT_BG_PX, 0.85)).data;
    } catch {
      avatar = imageUrl;
      background = imageUrl;
    }
  }
  const ch = characterFromCard(fields, avatar, { kind: "chub", fullPath }, background);
  /* the card's public description and one-line tagline come along, so the
     card still says what it is once it is yours */
  const notes = plainNotes(d.description || node.description);
  return {
    ...ch,
    ...(node.tagline ? { tagline: String(node.tagline).trim() } : {}),
    ...(notes ? { creatorNotes: notes } : {}),
  };
}
