import { normalizeUiScale } from "./uiScale.js";
import { isPackId } from "../skins/pack.js";
import { DEFAULT_PROVIDERS, newProvider, providersFromLegacy } from "./providers.js";
import { DEFAULT_STYLE, STYLE_PRESETS, customStyleList, tuningKey } from "./styles.js";
import { uid } from "./util.js";
import { normalizeBookmark } from "./bookmarks.js";
import { SCOPE_MODES, castMember, ensembleTitle } from "./scope.js";
import { LEVELS, normalizeHandset } from "./phone.js";
export * from "./bookmarks.js";

/* The old in-story phone was removed. Saves, backups and cards from
   before then can still carry its fields; they are dropped on load, never
   read. */
export const LEGACY_PHONE_CHAT_KEYS = ["phone", "phoneMode", "phonePaused", "phonePausedTick", "phoneAutoSetup", "phoneWorld"];
const withoutPhone = (x) => {
  if (!x || typeof x !== "object" || !("phone" in x)) return x;
  const { phone, ...rest } = x;
  return rest;
};

/* The social media feature was removed in 3.2. Its worlds (top-level
   `socialWorlds`), global settings (`settings.social`), per-card switch
   (`social`) and these chat fields are dropped on load, never read. */
export const LEGACY_SOCIAL_CHAT_KEYS = ["socialWorldId", "socialMode", "socialUsage", "socialContext", "socialPaused"];
const withoutSocial = (x) => {
  if (!x || typeof x !== "object" || !("social" in x)) return x;
  const { social, ...rest } = x;
  return rest;
};

/* How much of the conversation is resent on each request. Declared up here
   because emptyData reads it, and a const referenced before its declaration
   throws on module load rather than being hoisted. */
export const DEFAULT_HISTORY_TOKENS = 3000;

/* Ceiling on the memory slider. Raised from 16k: the free models worth using
   now carry 256K-1M windows, so 16k was leaving most of the context unused on
   exactly the models people are told to pick. */
export const MAX_HISTORY_TOKENS = 32000;

/* Style ids from earlier versions. Renamed ones keep the choice; anything
   else (removed presets, custom and imported prompts) falls back to the
   default. */
export const RENAMED_PRESETS = { imersivo: "immersive", direto: "neutral", direct: "neutral" };

/* ---------- data ---------- */

/* per-character / per-universe look. Lives on the character itself,
   so every story can have its own colours and backdrop. */
export const DEFAULT_THEME = { userBubble: "accent", aiBubble: "#000000", bubbleAlpha: 0.8, bg: null, bgs: null, bgSeconds: 20 };

/* Blend a bubble colour toward transparent. Works with hex and with
   var(--acc), which is why this is color-mix and not an rgba string. */
export function withAlpha(color, a) {
  const pct = Math.round(Math.max(0, Math.min(1, a ?? 1)) * 100);
  if (pct >= 100) return color;
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

export const themeOf = (item) => ({ ...DEFAULT_THEME, ...(item?.theme || {}) });

/* Backgrounds used to be a single object on theme.bg. They are now a list
   on theme.bgs; the old field is still read so existing chats keep theirs. */
/* There is no cap on the list any more. There used to be one — sixty, with a
   warning from twelve — and both existed only because localStorage gave the
   whole app about 5MB to work with and a screen-sized JPEG is a few hundred
   KB of that. Storage is IndexedDB now, so the arithmetic that produced those
   numbers no longer holds and the limit went with it. */
export function bgListOf(theme) {
  if (theme?.bgs?.length) return theme.bgs;
  if (theme?.bg) return [theme.bg];
  return [];
}

/* A Nova Scope chat's backdrop: the host's pictures and videos first, then
   those of every linked card, each picture once. The host's theme still
   decides the timing and the colours. */
export function castBgListOf(theme, cards = []) {
  const seen = new Set();
  const out = [];
  for (const t of [theme, ...cards.map((c) => themeOf(c))]) {
    for (const b of bgListOf(t)) {
      if (!b?.image || seen.has(b.image)) continue;
      seen.add(b.image);
      out.push(b);
    }
  }
  return out;
}

/* ---------- opening scenarios ----------

   A character or universe can now hold several different ways of starting,
   and you choose between them inside the chat rather than at creation time.

   The list lives on `greetings`; the old single `firstMessage` (characters)
   and `opening` (universes) fields are still written on save and still read
   here, so a card made before this update opens with exactly one scenario and
   nothing had to be migrated. Anything else in the app that reads
   `firstMessage` keeps working for the same reason.

   Ids are stable across edits because a chat stores which scenario it opened
   with, and reordering the list must not silently change what an open chat
   thinks it is showing. */
export function greetingsOf(item) {
  if (!item) return [];
  const list = Array.isArray(item.greetings) ? item.greetings.filter((g) => g && String(g.text || "").trim()) : [];
  if (list.length) return list;
  const single = item.opening || item.firstMessage;
  return single ? [{ id: "g0", label: "", text: single }] : [];
}

/* Trims empties, guarantees ids, and keeps the legacy single field in step
   with the first entry. Both create forms save through this. */
export function packGreetings(rows, legacyKey) {
  const clean = (Array.isArray(rows) ? rows : [])
    .map((g) => ({ id: g.id || uid(), label: String(g.label || "").trim(), text: String(g.text || "") }))
    .filter((g) => g.text.trim());
  return { greetings: clean, [legacyKey]: clean[0]?.text || "" };
}

/* A chat's author's note (prompt.js): just its text. It is always sent
   three messages up, every turn, as a user message; the role, depth and
   interval older notes stored are dropped on load. */
export const DEFAULT_AUTHORS_NOTE = {
  text: "",
};

/* Saved author's notes, kept in settings.authorNotePresets as
   { id, name, text }. Bad entries are dropped, and so are the role, depth,
   interval and date older presets carried. */
export function normalizeNotePresets(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const x of list) {
    if (!x || typeof x !== "object" || typeof x.text !== "string" || !x.text.trim()) continue;
    let id = typeof x.id === "string" && x.id ? x.id : uid();
    if (seen.has(id)) id = uid();
    seen.add(id);
    const name = (typeof x.name === "string" ? x.name.trim() : "") || x.text.trim().slice(0, 30);
    out.push({
      id,
      name,
      text: x.text,
    });
  }
  return out;
}

/* Picture making (imageGen.js): AI Horde needs no account */
export const DEFAULT_IMAGE_GEN = {
  provider: "ai_horde",
  apiKey: "",
  endpoint: "",
  model: "",
  aspectRatio: "portrait",
  negativePrompt: "blurry, low quality, distorted, extra limbs, bad anatomy, deformed, watermark, signature",
};

/* Reading aloud (tts.js): the system voice, unless an endpoint is set */
export const DEFAULT_VOICE_SETTINGS = {
  voice: "",
  rate: 1.0,
  pitch: 1.0,
  dialogueOnly: false,
};

export const emptyData = {
  username: "",
  personas: [],
  characters: [],
  universes: [],
  /* standalone lorebooks, attached to chats one by one */
  lorebooks: [],
  chats: [],
  settings: {
    /* Saved providers, each with its own key, model and favourites, and the
       one replies come from. See lib/providers.js. */
    providers: DEFAULT_PROVIDERS,
    activeProvider: "openrouter",
    /* Check for updates (lib/updates.js): on, until the user turns it off */
    updateCheck: true,
    /* Which generation of these defaults the data has been moved onto
       (see DEFAULTS_GEN); a restore of an older backup keeps this device's */
    defaultsGen: 0,
    /* Backup switches (Settings → You), followed by Sync's Send too:
       API keys in the file (off), the skins added here (off) */
    backupCredentials: false,
    /* Which model writes cards in the create forms, on OpenRouter. "" follows
       the chat model, which is what it always used to do silently. */
    writerModel: "",
    stylePreset: DEFAULT_STYLE,
    /* A fresh install already starts on Neutral. Without this the one-time
       move onto it in normalizeData ran on the second launch and reset
       whatever style had been picked in the first. */
    neutralIntroduced: true,
    /* Custom: which prompt in the list is picked, and the imported ones */
    customStyleId: "",
    customStyles: [],
    /* Fine tuning, keyed by model id and then style id:
       { [model]: { [style]: { on, temperature, top_p, … } } }.
       A style with no entry for the model, or with `on` false, uses its own
       defaults. */
    modelTuning: {},
    /* thinking on or off per model id; unset falls back to `thinking` */
    modelThinking: {},
    /* how much of the conversation is resent each turn */
    historyTokens: DEFAULT_HISTORY_TOKENS,
    /* off by default: on a reasoning model, thinking is the whole reason the
       first word took thirty seconds to appear */
    thinking: false,
    /* Phrases to keep out of replies, one per line. Empty means off. */
    bannedPhrases: "",
    /* Starred Chub cards, kept whole so the Favorites view needs no request. */
    chubFavorites: [],
    /* Pin each chat to the endpoint that answered it last, so the character
       block stays in that provider's prefix cache between turns. */
    stickySession: true,
    /* the Nova Bridge bar at the top of Providers, expanded or folded */
    bridgeCardOpen: false,
    /* the computer's address for Nova Bridge as seen from another device, kept
       so switching between "This device" and "Another device" keeps it */
    bridgeLan: "",
    /* Prefer endpoints that are currently answering fast, so a request is not
       parked behind a congested provider's queue. */
    latencyRouting: true,
    /* Long-term memory: messages leaving the conversation window are
       summarised instead of forgotten. About one extra request every ten
       exchanges, and only in chats long enough to need it. */
    memoryOn: false,
    /* Scene notes, rewritten every this many replies. 0 is off. */
    sceneEvery: 0,
    /* Send a card's own system prompt and post-history instructions. */
    cardInstructions: true,
    /* Lorebooks: on, how many recent messages are searched for keywords,
       and how many tokens matched entries may use per reply. */
    loreOn: true,
    loreDepth: 4,
    loreBudget: 800,
    /* your own one-tap messages above the message box; none to start */
    quickReplies: [],
    /* saved author's notes: [{id,name,text}] */
    authorNotePresets: [],
    /* translation (translate.js): the language, and whether new replies are
       translated as they arrive */
    translateTargetLang: "en",
    translateReplies: false,
    /* recall older messages that match the newest one (rag.js) */
    ragOn: false,
    /* the phone new chats start with (phone.js): "off" | "light" | "lively" */
    phoneDefault: "off",
    voice: { ...DEFAULT_VOICE_SETTINGS },
    imageGen: { ...DEFAULT_IMAGE_GEN },
  },
  /* What has actually been spent through this app, accumulated from the cost
     OpenRouter reports on each reply. */
  ledger: { spent: 0, replies: 0, tokensIn: 0, tokensOut: 0, lastTtft: null, lastTtfb: null, ttfbAvg: null, lastModel: null, byModel: {} },
  appearance: {
    /* the look: "nova" (standard) or the id of a skin pack (skins/skins.js);
       kept even while that skin is not on this device */
    skin: "nova",
    /* the skin in chats too (Look → Skin in chats); off, chats wear Nova's own */
    skinInChat: false,
    accent: "#ffffff",
    /* "dark" | "light" | "auto" (follows the phone) */
    scheme: "dark",
    uiScale: 1,
    /* the page backdrop behind every tab: a preset id, or a custom image */
    bgPreset: "none",
    bgImage: null,
    /* framing of an animated custom backdrop; null for a baked still */
    bgFrame: null,
    bgOpacity: 0.75,
    /* which theme preset was applied last, purely so the card can show it */
    preset: null,
    /* character and universe grids: "large" (two across) or "xl" (one) */
    cardSize: "large",
    /* a line of description on every card, at every size; small cards put
       it under the picture */
    cardDesc: true,
    /* ambient effects behind the pages: flowing accent light, film grain */
    fx: { flow: false, grain: false },
    /* "full" | "calm" (no ambient animation) | "off" (nothing moves) */
    motion: "full",
    /* chat and phone-message bubbles: "full" (the whole width, roomy on a
       phone) or "aligned" (yours on the right, theirs on the left) */
    bubbles: "full",
  },
};

export const SCHEMES = ["dark", "light", "auto"];
export const MOTIONS = ["full", "calm", "off"];
/* backdrops dropped in 2.5, which fall back to plain black */

export function migrateLegacy(old) {
  const d = JSON.parse(JSON.stringify(emptyData));
  d.username = old.username || "";
  d.personas = old.personas || [];
  d.characters = old.characters || [];
  d.chats = (old.chats || []).map((c) => ({ kind: "character", authorsNote: { ...DEFAULT_AUTHORS_NOTE }, bookmarks: [], ...c }));
  Object.assign(d.settings, providersFromLegacy({
    apiKey: old.settings?.apiKey || "",
    model: old.settings?.provider === "openrouter" ? old.settings?.model : "",
  }));
  return d;
}

const isRecord = (x) => !!x && typeof x === "object" && !Array.isArray(x);
/* A list of records with anything else in it dropped: a damaged store or
   backup can hold a null where a character was, and one null used to stop
   the whole app from loading. */
const records = (list) => (Array.isArray(list) ? list.filter(isRecord) : list);

/* ---------- group chats, from before 3.2 ----------

   A group chat (`kind: "group"`, a list of `memberIds`) is a character chat
   with Nova Scope now: the first member whose card still exists is the
   host (`characterId`), and the other living members join the Scope cast
   linked to their cards. The cast it had is kept, Scope is switched on
   (Manual) if it was off, and the group's name becomes the chat's title,
   or failing that the members' names. `memberIds`, `name` and the group's
   own `theme` go (the host's look is used, as in any character chat); the
   replies keep their `speaker` / `speakerId`. Anything that is not a group
   comes back as it was, so running this twice changes nothing. */
export function fromGroupChat(chat, characters = []) {
  if (!isRecord(chat) || chat.kind !== "group") return chat;
  const byId = new Map((characters || []).filter(isRecord).map((c) => [c.id, c]));
  const ids = [...new Set((Array.isArray(chat.memberIds) ? chat.memberIds : []).filter((x) => typeof x === "string" && x))];
  const hostId = ids.find((id) => byId.has(id)) || ids[0] || "";
  const old = isRecord(chat.scope) ? chat.scope : {};
  const oldCast = (Array.isArray(old.cast) ? old.cast : []).filter((m) => isRecord(m) && m.characterId !== hostId);
  const already = new Set(oldCast.map((m) => m.characterId).filter(Boolean));
  const joined = ids
    .filter((id) => id !== hostId && byId.has(id) && !already.has(id))
    .map((id) => castMember({ id: `member-${id}`, name: byId.get(id).name || "Unnamed", characterId: id }));
  const cast = [...joined, ...oldCast];
  const { memberIds: _ids, name: _name, theme: _theme, ...rest } = chat;
  const title = chat.title?.trim()
    ? chat.title
    : typeof chat.name === "string" && chat.name.trim()
    ? chat.name.trim()
    : ensembleTitle([byId.get(hostId), ...cast.map((m) => byId.get(m.characterId))].filter(Boolean));
  return {
    ...rest,
    kind: "character",
    characterId: hostId,
    greetingId: typeof chat.greetingId === "string" ? chat.greetingId : "",
    ...(title ? { title } : {}),
    scope: { ...old, mode: SCOPE_MODES.includes(old.mode) && old.mode !== "off" ? old.mode : "manual", cast },
  };
}

/* Shape-fixing and the run of small migrations, kept apart from where the
   bytes came from so both storage paths get the same treatment. */
/* Defaults that changed on purpose, applied once to data from before. The
   marker travels with the data, so an update never applies them again and a
   later choice stays. A backup that predates them does not bring its old
   values back over this device's (keepDeviceDefaults). */
export const DEFAULTS_GEN = 1;
export function keepDeviceDefaults(current, restored, predates) {
  if (!predates || !restored) return restored;
  return {
    ...restored,
    settings: { ...restored.settings, updateCheck: current?.settings?.updateCheck !== false, defaultsGen: DEFAULTS_GEN },
    appearance: { ...restored.appearance, skinInChat: current?.appearance?.skinInChat === true },
  };
}

export function normalizeData(input) {
      const p = isRecord(input) ? { ...input } : {};
      for (const k of ["settings", "ledger", "appearance"]) if (!isRecord(p[k])) delete p[k];
      for (const k of ["characters", "universes", "personas", "chats", "lorebooks"]) {
        if (k in p) p[k] = Array.isArray(p[k]) ? records(p[k]) : [];
      }
      if (p.settings) {
        p.settings = { ...p.settings };
        if ("providers" in p.settings && Array.isArray(p.settings.providers)) p.settings.providers = records(p.settings.providers);
        if (!isRecord(p.settings.voice)) delete p.settings.voice;
        if (!isRecord(p.settings.imageGen)) delete p.settings.imageGen;
      }
      p.lorebooks = (p.lorebooks || []).map((b) => (Array.isArray(b.entries) ? { ...b, entries: records(b.entries) } : b));
      p.characters = (p.characters || []).map((c) => (isRecord(c.lorebook) && Array.isArray(c.lorebook.entries) ? { ...c, lorebook: { ...c.lorebook, entries: records(c.lorebook.entries) } } : c));
      const d = {
        ...emptyData, ...p,
        settings: { ...emptyData.settings, ...(p.settings || {}) },
        ledger: { ...emptyData.ledger, ...(p.ledger || {}) },
        appearance: { ...emptyData.appearance, ...(p.appearance || {}) },
      };
      /* defaults that changed (DEFAULTS_GEN): once per data set */
      if (!(Number(p.settings?.defaultsGen) >= DEFAULTS_GEN)) {
        d.settings.updateCheck = true;
        d.appearance.skinInChat = false;
      }
      d.settings.defaultsGen = Math.max(DEFAULTS_GEN, Number(p.settings?.defaultsGen) || 0);
      /* the retired social feature's worlds and settings */
      delete d.socialWorlds;
      delete d.settings.social;
      /* The old global fine tuning and saved prompts are gone; drop what they
         left behind so nothing can quietly override the selected style. */
      if (!d.settings.modelTuning || typeof d.settings.modelTuning !== "object") d.settings.modelTuning = {};
      if (!d.settings.modelThinking || typeof d.settings.modelThinking !== "object") d.settings.modelThinking = {};
      delete d.settings.advancedOn;
      delete d.settings.advanced;
      delete d.settings.prompts;
      delete d.settings.autoFallback;
      /* Providers replaced the three fixed sources (OpenRouter, Google, your
         server). Each one in use becomes a saved provider, keeping its key,
         model and favourites, and the old fields go. */
      if (!Array.isArray(p.settings?.providers)) Object.assign(d.settings, providersFromLegacy(p.settings || {}));
      for (const k of ["apiKey", "model", "baseUrl", "source", "googleKey", "googleModel", "favoriteModels"]) delete d.settings[k];
      d.settings.providers = d.settings.providers.map((x) => ({ ...newProvider(x.preset), ...x }));
      if (!d.settings.providers.some((x) => x.id === d.settings.activeProvider)) d.settings.activeProvider = d.settings.providers[0]?.id || "";
      if (!d.settings.voice || typeof d.settings.voice !== "object") {
        d.settings.voice = { ...DEFAULT_VOICE_SETTINGS };
      } else {
        d.settings.voice = {
          ...d.settings.voice,
          voice: typeof d.settings.voice.voice === "string" ? d.settings.voice.voice : "",
          rate: typeof d.settings.voice.rate === "number" ? Math.max(0.5, Math.min(2.0, d.settings.voice.rate)) : 1.0,
          pitch: typeof d.settings.voice.pitch === "number" ? Math.max(0.5, Math.min(2.0, d.settings.voice.pitch)) : 1.0,
          dialogueOnly: Boolean(d.settings.voice.dialogueOnly),
        };
      }
      /* Fine tuning used to be one set per style for every model. That set
         was tuned on whichever model was in use, so it moves under that
         model's id; other models start from the style defaults. */
      {
        const old = d.settings.styleTuning;
        if (old && typeof old === "object" && Object.keys(old).length) {
          const key = tuningKey(d.settings);
          d.settings.modelTuning = { ...d.settings.modelTuning, [key]: { ...old, ...(d.settings.modelTuning[key] || {}) } };
        }
        delete d.settings.styleTuning;
      }
      {
        const id = RENAMED_PRESETS[d.settings.stylePreset] || d.settings.stylePreset;
        d.settings.stylePreset = STYLE_PRESETS.some((x) => x.id === id) ? id : DEFAULT_STYLE;
        /* Neutral arrived as the new default; move everyone onto it once.
           Read from the saved settings, not the merged defaults, so it runs
           exactly once and a later choice of another style is kept. */
        if (!p.settings?.neutralIntroduced) d.settings.stylePreset = DEFAULT_STYLE;
        d.settings.neutralIntroduced = true;
        if (!Array.isArray(d.settings.customStyles)) d.settings.customStyles = [];
        /* the retired "Evening Truth" slot, and any text pasted into it */
        d.settings.customStyles = d.settings.customStyles.filter((x) => x && typeof x === "object");
        if (!customStyleList(d.settings).some((x) => x.id === d.settings.customStyleId)) d.settings.customStyleId = d.settings.customStyles[0]?.id || "";
      }
      /* Legacy accent and effect fields remain exportable; monochrome UI ignores them. */
      /* Appearance gained effects, motion, shape and type in 2.4. The nested
         effects object is merged on its own so a partial one keeps the rest,
         and anything unrecognised falls back to the default. */
      {
        const ap = d.appearance;
        const savedFx = p.appearance?.fx && typeof p.appearance.fx === "object" ? p.appearance.fx : {};
        ap.fx = { flow: savedFx.flow ?? emptyData.appearance.fx.flow, grain: savedFx.grain ?? emptyData.appearance.fx.grain };
        /* the backdrops that used to ship are gone: black, or your picture */
        if (ap.bgPreset !== "custom" || !ap.bgImage) ap.bgPreset = "none";
        /* panels are glass now; the opacity slider is gone */
        delete ap.uiAlpha;
        if (!SCHEMES.includes(ap.scheme)) ap.scheme = emptyData.appearance.scheme;
        if (!MOTIONS.includes(ap.motion)) ap.motion = emptyData.appearance.motion;
        if (ap.skin !== "nova" && ap.skin !== "minimal" && !isPackId(ap.skin)) ap.skin = emptyData.appearance.skin;
        ap.uiScale = normalizeUiScale(ap.uiScale);
        /* one typeface and continuous corners now; the pickers are gone */
        delete ap.shape;
        delete ap.font;
      }
      /* the memory slider used to stop at 16k */
      if (d.settings.historyTokens > MAX_HISTORY_TOKENS) d.settings.historyTokens = MAX_HISTORY_TOKENS;
      /* older versions kept bubble colours globally — hand them to any
         character that does not have its own look yet */
      const legacyTheme = p.appearance && (p.appearance.userBubble || p.appearance.aiBubble || p.appearance.bg)
        ? { userBubble: DEFAULT_THEME.userBubble,
            aiBubble: p.appearance.aiBubble || DEFAULT_THEME.aiBubble,
            bg: p.appearance.bg || null }
        : null;
      if (legacyTheme) {
        d.characters = (d.characters || []).map((c) => (c.theme ? c : { ...c, theme: legacyTheme }));
        d.universes = (d.universes || []).map((u) => (u.theme ? u : { ...u, theme: legacyTheme }));
      }
      /* Your bubble follows the app's accent on every card. Done once, so a
         colour picked for one character afterwards is kept. */
      if (!d.settings.userBubbleAccent) {
        const toAccent = (x) => ({ ...x, theme: { ...(x.theme || DEFAULT_THEME), userBubble: "accent" } });
        d.characters = (d.characters || []).map(toAccent);
        d.universes = (d.universes || []).map(toAccent);
        d.settings.userBubbleAccent = true;
      }
      d.characters = (d.characters || []).map((c) => ({
        ...withoutSocial(withoutPhone(c)),
        sprites: c.sprites && typeof c.sprites === "object" ? c.sprites : {},
      }));
      /* the retired phone's card setup, settings and usage ledger */
      d.universes = (d.universes || []).map((u) => withoutSocial(withoutPhone(u)));
      delete d.settings.phone;
      /* 3.2's automatic phone refresh is gone (Sync to chat replaces it) */
      delete d.settings.phoneAutoRefresh;
      d.ledger = withoutPhone(d.ledger);
      /* group chats become character chats with Scope (fromGroupChat) */
      d.chats = (d.chats || []).map((c) => {
        const item = { ...fromGroupChat(c, d.characters) };
        const an = item.authorsNote;
        item.authorsNote = an && typeof an === "object"
          ? { text: typeof an.text === "string" ? an.text : DEFAULT_AUTHORS_NOTE.text }
          : { ...DEFAULT_AUTHORS_NOTE };
        item.bookmarks = Array.isArray(item.bookmarks) ? item.bookmarks.map(normalizeBookmark).filter(Boolean) : [];
        /* the retired phone's world and switches */
        for (const k of LEGACY_PHONE_CHAT_KEYS) delete item[k];
        /* the retired social feature's chat link and switches */
        for (const k of LEGACY_SOCIAL_CHAT_KEYS) delete item[k];
        /* the phone (phone.js): kept when valid, dropped otherwise */
        if ("handset" in item) {
          const h = normalizeHandset(item.handset);
          if (h) item.handset = h;
          else delete item.handset;
        }
        /* a universe's world log (memory.js addHappening): shape only */
        if ("world" in item) {
          if (!isRecord(item.world)) delete item.world;
          else item.world = { ...item.world, log: Array.isArray(item.world.log) ? item.world.log.filter((e) => isRecord(e) && typeof e.text === "string") : [] };
        }
        if (Array.isArray(item.messages)) {
          item.messages = item.messages.filter(isRecord).map((m) => {
            const norm = { ...m };
            if (Array.isArray(m.images)) {
              norm.images = m.images.filter((img) => img && (typeof img === "string" || img.url));
            }
            return norm;
          });
        }
        return item;
      });
      if (![0, 2, 4, 8].includes(d.settings.sceneEvery)) d.settings.sceneEvery = emptyData.settings.sceneEvery;
      if (!LEVELS.includes(d.settings.phoneDefault)) d.settings.phoneDefault = "off";
      if (!Array.isArray(d.lorebooks)) d.lorebooks = [];
      if (!Array.isArray(d.settings.quickReplies)) d.settings.quickReplies = [];
      d.settings.authorNotePresets = normalizeNotePresets(d.settings.authorNotePresets);
      /* the retired free Gemma writer */
      if (d.settings.writerModel === "google/gemma-4-31b-it:free") d.settings.writerModel = "";
      /* the writer is per provider now; the old single id only ever reached
         OpenRouter, so it moves to the OpenRouter provider's slot */
      if (!d.settings.writerModels || typeof d.settings.writerModels !== "object" || Array.isArray(d.settings.writerModels)) {
        const writers = {};
        const or = (d.settings.providers || []).find((p) => p?.preset === "openrouter");
        if (d.settings.writerModel && or?.id) writers[or.id] = d.settings.writerModel;
        d.settings.writerModels = writers;
      }
      d.settings.writerModels = Object.fromEntries(Object.entries(d.settings.writerModels).filter(([, v]) => typeof v === "string" && v && v !== "google/gemma-4-31b-it:free"));
      /* switches and samplers earlier builds kept at the top of settings */
      for (const k of ["modelFallback", "autoFallback", "quickRepliesOn", "rag", "dry_multiplier", "dry_base", "dry_allowed_length", "dry_sequence_breakers", "top_a", "mirostat_mode", "mirostat_tau", "mirostat_eta", "cfg_scale", "dynatemp_min", "dynatemp_max", "dynatemp_exponent"]) delete d.settings[k];
      if (!d.settings.imageGen || typeof d.settings.imageGen !== "object") {
        d.settings.imageGen = { ...DEFAULT_IMAGE_GEN };
      } else {
        d.settings.imageGen = { ...DEFAULT_IMAGE_GEN, ...d.settings.imageGen };
      }
  return d;
}
