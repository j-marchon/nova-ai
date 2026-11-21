import { historyCut } from "./window.js";
import { anchorVisible } from "./anchor.js";

/* ---------- long-term memory and the scene ----------

   Two notes a chat keeps about itself, each written by a short side request
   to the same model, in the background, after a reply has arrived.

   MEMORY — the story so far.
   The conversation window (Settings → Conversation memory) drops the oldest
   messages once a chat outgrows it. Before this, whatever fell off the front
   was simply gone: the character forgot the first night, the name of the
   town, the promise. Now those messages are summarised into a running
   account before they leave, and the account is sent in their place.

   It is tied to the same cut point trimHistory already uses, which only moves
   in steps of CUT_STEP messages to keep the provider's prefix cache warm. The
   summary is rewritten exactly when the cut moves — the one moment the cached
   prefix is lost anyway — so memory costs one request roughly every ten
   exchanges and no extra cache misses at all.

   Nothing is dropped before it has been summarised. trimHistory is told how
   far the summary reaches and never cuts past it, so a summary that is slow,
   failed, or switched off for a while just means a longer window until it
   catches up. (Past twice the budget the window trims anyway; a broken
   summariser must not grow the prompt without limit.)

     chat.memory = { summary, lastId, count, at, error? }

   `lastId` is the last message the summary covers. If that message stops
   existing — the chat was cut back to before it — the summary describes
   events that no longer happened, and it is discarded.

   SCENE — where things stand right now.
   Small models lose track of the physical scene fast: who is in the room,
   what they are wearing, that someone is bleeding, that it is night. Every
   few replies a side request rewrites a short fixed-shape note of it, which
   rides at the end of the prompt, next to the reply-style line. The end of
   the prompt changes every turn anyway, so this never touches the cache.

     chat.scene = { text, lastId, at, error? } */

/* Index of the message a note reaches, or -1 when it is gone. */
export const coveredIndex = (history, note) => (note?.lastId ? history.findIndex((m) => m.id === note.lastId) : -1);

/* How many leading messages the summary covers. */
export function memoryCovered(history, memory) {
  if (!memory?.summary?.trim()) return 0;
  return coveredIndex(history, memory) + 1;
}

/* The summary, only while the message it reaches still exists. */
export function activeSummary(history, memory) {
  return memoryCovered(history, memory) > 0 ? memory.summary.trim() : "";
}

/* What needs summarising before the next request: the messages between what
   the summary covers and where the window now starts. Null when nothing does. */
export function memoryDue(history, budget, memory) {
  const cut = historyCut(history, budget);
  const covered = memoryCovered(history, memory);
  if (cut <= covered) return null;
  return { from: covered, to: cut, previous: covered ? memory.summary.trim() : "" };
}

/* After the chat has been cut back (messages deleted, or a reply regenerated
   further up), keep a note only if what it covers still exists. */
export function keepIfCovered(note, messages) {
  if (!note?.lastId) return note || null;
  return messages.some((m) => m.id === note.lastId) ? note : null;
}

/* After deleting one message: a note that ended on it now ends on the one
   before, which still covers everything else it described. */
export function afterDeleting(note, messages, id) {
  if (!note?.lastId || note.lastId !== id) return note || null;
  const i = messages.findIndex((m) => m.id === id);
  const prev = i > 0 ? messages[i - 1] : null;
  return prev ? { ...note, lastId: prev.id } : null;
}

/* ---------- the scene ---------- */

/* Replies since the scene note was written (all of them when there is none). */
function repliesSince(history, scene) {
  const from = coveredIndex(history, scene) + 1;
  return history.slice(from).filter((m) => m.role === "assistant").length;
}

/* Due every `every` replies, and after the first exchange when there is no
   note yet — by then the opening has set a scene worth writing down. */
export function sceneDue(history, scene, every) {
  if (!every || every < 1) return false;
  if (!history.some((m) => m.role === "user")) return false;
  const n = repliesSince(history, scene);
  if (!scene?.text?.trim() || coveredIndex(history, scene) === -1) return n >= 1;
  return n >= every;
}

/* ---------- the side requests ---------- */

/* "Name: text" lines, the way a transcript reads. */
export function transcript(messages, { userName, charName }) {
  return messages
    .map((m) => `${m.role === "user" ? userName : m.speaker || charName}: ${String(m.content || "").trim()}`)
    .join("\n\n");
}

const LANGUAGE = "Write it in the language the story itself is written in.";

/* The memory keeps a fixed shape so the model reads it the same way every
   turn: where the story began (written once, then carried over as is), what
   has happened since, both leads as they stand, who else matters, and the
   facts that must stay true. */
export function summaryRequest({ previous, messages, userName, charName }) {
  const system =
    "You keep the long-term memory of an ongoing roleplay. You are given the memory so far and the next part of the story; return the updated memory.\n\n" +
    "Answer in exactly this format and nothing else:\n" +
    "[BEGINNING= a brief overview of the initial scenario at the start of the story. If the memory so far already has one, copy it unchanged.]\n" +
    "[RECENT= brief bullet points of the relevant events that are not covered in BEGINNING, in order.]\n" +
    `[${charName}=\n- Appearance: current clothing and state (only what their description does not already say).\n- Demeanor: current demeanor.]\n` +
    `[${userName}=\n- Appearance: current clothing and state.]\n` +
    "[Side Characters= a brief overview of the characters who are present now, or absent but still relevant.]\n" +
    "[IMPORTANT STRINGS= setting rules (facts about the world that stay true whatever the scene), possible threats, unresolved threads, objects that matter to the story, and other details that remain relevant.]\n" +
    "[CURRENTLY: day, date | time | location | weather, temp°C]\n\n" +
    "Keep decisions, promises, revealed secrets, changes in relationships, injuries, possessions and the names of people and places. " +
    "Compress older events in RECENT harder than new ones. Estimates are allowed in CURRENTLY. Stay under 500 words. Never use em-dashes.\n\n" +
    `${LANGUAGE} No commentary and no preamble, only the memory itself.`;
  const user =
    `[Memory so far]\n${previous || "None yet. This is the beginning of the story."}\n\n` +
    `[Next part of the story]\n${transcript(messages, { userName, charName })}\n\n` +
    "Return the updated memory.";
  return { system, user };
}

/* The tracker: where the scene stands right now, in a fixed bracketed
   shape. It is written by a side request every few replies rather than
   appended to each reply, so it costs nothing in the reply itself and never
   shows up in the chat. */
export function sceneRequest({ previous, messages, userName, charName }) {
  const system =
    "You keep the tracker for an ongoing roleplay: a short record of where the scene stands right now, so the next reply does not contradict it.\n\n" +
    "Answer in exactly this format and nothing else:\n" +
    "[day, date | time (morning, noon, afternoon, evening, night) | location | weather, temp°C]\n\n" +
    `[${charName}: current appearance, clothing, state.]\n` +
    `[${userName}: current appearance, clothing, state.]\n\n` +
    "[Present side characters: name, role, objectives (if any).]\n\n" +
    "[IMPORTANT STRINGS: possible threats, unresolved important threads, objects or details that matter to the story, and anything else that remains relevant.]\n\n" +
    "Keep it factual and concise, under 400 tokens. Estimates are allowed for day, date, time and weather; never invent anything else the story has not established. Never use em-dashes. " +
    `${LANGUAGE}`;
  const user =
    (previous ? `[Tracker so far]\n${previous}\n\n` : "") +
    `[Latest part of the story]\n${transcript(messages, { userName, charName })}\n\n` +
    "Return the updated tracker.";
  return { system, user };
}

/* The messages a scene update reads: everything since the last note, capped
   to the most recent dozen — the scene is about now, not the whole chat. */
export function sceneWindow(history, scene) {
  const from = Math.max(0, coveredIndex(history, scene) + 1);
  const since = history.slice(from);
  return (since.length ? since : history).slice(-12);
}

/* Model output tidied: think blocks, fences and a stray heading dropped. */
export function cleanNote(text) {
  return String(text || "")
    .replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/^\s*#+\s*(updated )?(memory|notes|scene|tracker)[^\n]*\n/i, "")
    /* the tracker as it would appear in a reply: wrapper and label dropped */
    .replace(/<\/?details>/gi, "")
    .replace(/^\s*Tracker\s*=\s*\n/i, "")
    .trim();
}

/* ---------- the world tracker (universe chats) ----------

   A universe is a world, not a room: the people in it go on with their own
   lives while the scene is elsewhere. Its tracker is the scene tracker with
   three more lines (who is here and what they are doing, where everyone
   else is, and one thing going on off-screen), written by the same side
   request, so the world moves on without an extra model call. It runs every
   two replies in every universe chat (replyJob.js runNotes).

   The off-screen line is also kept as a short world log on the chat
   (`chat.world.log`, see addHappening), anchored to the message it was
   written after, so a swipe or a branch takes it back out of the story. */

const NO_EM_DASH = "Never use em-dashes.";

export function worldSceneRequest({ previous, messages, userName, worldName, characters = [], locations = [] }) {
  const names = (list) => (list || []).map((x) => (typeof x === "string" ? x : x?.name)).map((s) => String(s || "").trim()).filter(Boolean);
  const people = names(characters);
  const places = names(locations);
  const world = worldName || "the world";
  const system =
    `You keep the tracker for an ongoing roleplay set in the world of "${world}": a short record of where the scene stands right now and what the rest of the world is doing, so the next reply does not contradict it and the world keeps moving.\n\n` +
    "Answer in exactly this format and nothing else:\n" +
    "[day, date | time (morning, noon, afternoon, evening, night) | location | weather, temp°C]\n\n" +
    "[Here: everyone present in the scene, and what each of them is doing right now.]\n" +
    `[${userName}: current appearance, clothing, state.]\n\n` +
    `[Elsewhere:\n- Name: where they are, what they are up to and why\n(one line for every character of the world who is not present)]\n\n` +
    '[Happening: one thing going on off-screen right now that could reach this scene, or "quiet".]\n\n' +
    "[IMPORTANT STRINGS: possible threats, unresolved important threads, objects or details that matter to the story, and anything else that remains relevant.]\n\n" +
    (people.length ? `The characters of this world: ${people.join(", ")}.\n` : "") +
    (places.length ? `Its places: ${places.join(", ")}.\n` : "") +
    "Characters move only in ways the story and the time that has passed allow, each following their own goals, plans and routine; someone who just left cannot be across the world a minute later. " +
    "Keep what the story has established; where it has not said where someone is, give them a plausible place and activity that fits who they are. " +
    `The Happening line is small and concrete (a visitor on the way, news spreading, weather turning, a plan going ahead), not a twist; write "quiet" when nothing would. ` +
    `Keep it factual and concise, under 450 tokens. Estimates are allowed for day, date, time and weather. ${NO_EM_DASH} ${LANGUAGE}`;
  const user =
    (previous ? `[Tracker so far]\n${previous}\n\n` : "") +
    `[Latest part of the story]\n${transcript(messages, { userName, charName: world })}\n\n` +
    "Return the updated tracker.";
  return { system, user };
}

/* The bracketed blocks of a tracker note, as [label, body] pairs. A block
   runs from its opening bracket to the first closing one, across lines. */
function noteBlocks(text) {
  const out = [];
  const s = String(text || "");
  let i = 0;
  while ((i = s.indexOf("[", i)) !== -1) {
    const end = s.indexOf("]", i + 1);
    if (end === -1) { out.push(s.slice(i + 1).trim()); break; }
    out.push(s.slice(i + 1, end).trim());
    i = end + 1;
  }
  return out;
}

const labelled = (blocks, label) => {
  const re = new RegExp(`^\\**${label}\\**\\s*[:=]\\s*`, "i");
  const hit = blocks.find((b) => re.test(b));
  return hit == null ? null : hit.replace(re, "").trim();
};

/* Time, place and weather from a tracker's first line: the first block
   with `|` in it ("day, date | time | location | weather"). */
export function sceneHead(text) {
  const head = noteBlocks(text).find((b) => b.split("|").length >= 3);
  if (!head) return { when: "", place: "", weather: "" };
  const parts = head.split("|").map((p) => p.trim());
  return { when: parts.slice(0, 2).filter(Boolean).join(", "), place: parts[2] || "", weather: parts.slice(3).filter(Boolean).join(", ") };
}

const QUIET = /^(quiet|none|nothing|n\/a|-)?[.!]?$/i;

/* A world tracker note, read: tolerant of missing or reordered lines. */
export function parseWorldNote(text) {
  const blocks = noteBlocks(text);
  const { when, place, weather } = sceneHead(text);
  const here = labelled(blocks, "Here") || "";
  const rawElse = labelled(blocks, "Elsewhere") || "";
  const elsewhere = [];
  for (const line of rawElse.split(/\n|;\s*(?=[^;]*[:,])/)) {
    const l = line.replace(/^\s*[-*•]\s*/, "").trim();
    if (!l || /^\(.*\)$/.test(l)) continue;
    const m = l.match(/^\**([^:,]{1,60}?)\**\s*[:,]\s*(.+)$/);
    if (m) elsewhere.push({ name: m[1].trim(), text: m[2].trim() });
  }
  const h = (labelled(blocks, "Happening") || "").trim();
  const happening = QUIET.test(h.replace(/^["']|["']$/g, "")) ? "" : h;
  return { when, place, weather, here, elsewhere, happening };
}

/* ---------- the world log ---------- */

export const WORLD_LOG_CAP = 12;

const wordSet = (t) => new Set(String(t || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2));
/* the same thing said twice in a row, more or less */
export function nearDuplicate(a, b) {
  const x = wordSet(a), y = wordSet(b);
  if (!x.size || !y.size) return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
  let same = 0;
  for (const w of x) if (y.has(w)) same++;
  return same / Math.min(x.size, y.size) >= 0.7;
}

/* The chat's world after the tracker wrote `happening` after `anchor`:
   appended unless it is empty or repeats the newest entry, oldest dropped
   past the cap. Returns the same world when nothing changes. */
export function addHappening(world, happening, anchor, id, messages) {
  const log = Array.isArray(world?.log) ? world.log : [];
  const text = String(happening || "").trim().slice(0, 300);
  if (!text || !anchor?.id) return world;
  /* compared with the newest line still part of the story, not one hidden
     on another swipe (when the messages are given) */
  const shown = Array.isArray(messages) ? log.filter((e) => anchorVisible(e?.anchor, messages)) : log;
  if (shown.length && nearDuplicate(shown[shown.length - 1].text, text)) return world;
  return { ...(world || {}), log: [...log, { id, text, anchor }].slice(-WORLD_LOG_CAP) };
}

/* The log entries still part of the story (anchor.js). */
export function visibleLog(chat) {
  const log = Array.isArray(chat?.world?.log) ? chat.world.log : [];
  return log.filter((e) => e && typeof e.text === "string" && anchorVisible(e.anchor, chat?.messages));
}
