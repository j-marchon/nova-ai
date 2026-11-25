/* ---------- one chat as a file ----------

   SillyTavern's chat format, so a chat moves both ways: a .jsonl whose first
   line is a header ({ user_name, character_name, create_date, chat_metadata })
   and every line after it one message ({ name, is_user, is_system, send_date,
   mes, swipes?, swipe_id? }). Nova's own fields that SillyTavern has no place
   for (pictures, a side character's id) ride in each message's `extra`, which
   SillyTavern keeps and ignores. */

import { DEFAULT_AUTHORS_NOTE, fromGroupChat } from "./data.js";
import { swipeList } from "./swipes.js";
import { uid } from "./util.js";

const stDate = (ms) => new Date(ms || Date.now()).toISOString();

/* A reply's thinking, the way SillyTavern keeps it in `extra` */
const thoughtOut = (v) => (v?.reasoning ? { reasoning: v.reasoning, ...(v.reasoningMs ? { reasoning_duration: v.reasoningMs } : {}) } : {});
const thoughtIn = (x) => (typeof x?.reasoning === "string" && x.reasoning.trim()
  ? { reasoning: x.reasoning, ...(Number(x.reasoning_duration) > 0 ? { reasoningMs: Number(x.reasoning_duration) } : {}) }
  : {});

/* `names`: { user, char } as the chat shows them */
export function chatToJsonl(chat, { user = "You", char = "Character" } = {}) {
  const head = {
    user_name: user,
    character_name: char,
    create_date: stDate(chat.createdAt),
    chat_metadata: { nova: { kind: chat.kind || "character", title: chat.title || "" } },
  };
  const lines = (chat.messages || []).map((m) => {
    const isUser = m.role === "user";
    const isSystem = m.role === "system";
    const versions = swipeList(m);
    const swipes = versions.map((x) => x.text);
    const extra = {
      ...(m.images?.length ? { nova_images: m.images } : {}),
      ...(m.image ? { image: m.image } : {}),
      ...(m.speakerId ? { nova_speaker_id: m.speakerId } : {}),
      ...(isSystem ? { type: "narrator" } : {}),
      ...(m.hidden ? { nova_hidden: true } : {}),
      ...thoughtOut(m),
    };
    return {
      name: isUser ? user : m.speaker || (isSystem ? "Narrator" : char),
      is_user: isUser,
      /* SillyTavern leaves an is_system message out of the prompt */
      is_system: isSystem || !!m.hidden,
      send_date: stDate(m.at),
      mes: m.content || "",
      ...(swipes.length > 1 ? {
        swipes,
        swipe_id: Math.max(0, Math.min(swipes.length - 1, m.swipeIdx ?? swipes.length - 1)),
        swipe_info: versions.map((v) => ({ send_date: stDate(m.at), extra: thoughtOut(v) })),
      } : {}),
      extra,
    };
  });
  return [head, ...lines].map((o) => JSON.stringify(o)).join("\n") + "\n";
}

/* A .jsonl read back: { characterName, userName, messages }. Throws with a
   sentence a person can act on when the file is not a chat. */
export function readChatJsonl(text) {
  const rows = String(text || "")
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l, i) => {
      try { return JSON.parse(l); } catch { throw new Error(`Line ${i + 1} is not valid JSON. Is this a SillyTavern chat (.jsonl)?`); }
    });
  if (!rows.length) throw new Error("That file is empty.");
  const head = rows[0] && !("mes" in rows[0]) ? rows.shift() : {};
  const msgs = rows.filter((r) => r && typeof r === "object" && "mes" in r);
  if (!msgs.length) throw new Error("No messages found. Is this a SillyTavern chat (.jsonl)?");
  const characterName = String(head.character_name || msgs.find((r) => !r.is_user && !r.is_system)?.name || "").trim();
  const userName = String(head.user_name || msgs.find((r) => r.is_user)?.name || "").trim();

  /* SillyTavern marks a message left out of the prompt is_system; Nova's own
     files mark their narration so too (with type "narrator" since hidden
     messages came in, and with nothing before that) */
  const fromNova = !!head.chat_metadata?.nova;
  const messages = msgs.map((r) => {
    const extra = r.extra && typeof r.extra === "object" ? r.extra : {};
    const role = r.is_user ? "user"
      : extra.type === "narrator" || (r.is_system && fromNova && !extra.nova_hidden) ? "system"
      : "assistant";
    const hidden = !!extra.nova_hidden || (!!r.is_system && !(fromNova && role === "system"));
    const at = Date.parse(r.send_date) || Date.now();
    const swipes = Array.isArray(r.swipes) ? r.swipes.filter((x) => typeof x === "string") : [];
    const idx = Number.isInteger(r.swipe_id) ? Math.max(0, Math.min(swipes.length - 1, r.swipe_id)) : swipes.length - 1;
    const content = String(swipes.length > 1 ? swipes[idx] : r.mes ?? "");
    const name = String(r.name || "").trim();
    const info = Array.isArray(r.swipe_info) ? r.swipe_info : [];
    /* each version's thinking; the shown one's may only be on the message */
    const thoughtAt = (i) => thoughtIn(info[i]?.extra?.reasoning ? info[i].extra : i === idx ? extra : null);
    const versions = swipes.map((t, i) => ({ text: t, ...thoughtAt(i) }));
    return {
      id: uid(),
      role,
      content,
      at,
      ...(hidden ? { hidden: true } : {}),
      ...(role === "assistant" && name && name !== characterName ? { speaker: name } : {}),
      ...(role === "system" && name ? { speaker: name } : {}),
      ...(swipes.length > 1 ? { swipes: versions, swipeIdx: idx, ...thoughtAt(idx) } : thoughtIn(extra)),
      ...(Array.isArray(extra.nova_images) && extra.nova_images.length ? { images: extra.nova_images } : {}),
      ...(typeof extra.image === "string" && extra.image ? { image: extra.image } : {}),
      ...(extra.nova_speaker_id ? { speakerId: extra.nova_speaker_id } : {}),
    };
  });
  const kind = head.chat_metadata?.nova?.kind === "group" ? "group" : "character";
  return { characterName, userName, kind, title: head.chat_metadata?.nova?.title || "", messages };
}

/* A new chat for one of your characters from an imported file. The card is
   found by name; null when there is no card by that name.

   A group chat exported before 3.2 is named after the group, so its cards
   are found from who spoke instead (by id, then by name, in the order they
   first spoke), and it becomes a character chat with Scope the way a saved
   group does (data.js fromGroupChat). */
export function chatFromImport(parsed, characters = []) {
  if (parsed.kind === "group") return groupFromImport(parsed, characters);
  const want = parsed.characterName.toLowerCase();
  const character = characters.find((c) => c.name?.trim().toLowerCase() === want);
  if (!character) return null;
  const now = Date.now();
  return {
    id: uid(),
    kind: "character",
    characterId: character.id,
    personaId: "",
    greetingId: "",
    ...(parsed.title ? { title: parsed.title } : {}),
    authorsNote: { ...DEFAULT_AUTHORS_NOTE },
    bookmarks: [],
    messages: parsed.messages,
    createdAt: parsed.messages[0]?.at || now,
    updatedAt: now,
  };
}

function groupFromImport(parsed, characters) {
  const ids = [];
  for (const m of parsed.messages) {
    if (m.role !== "assistant") continue;
    const want = m.speaker?.trim().toLowerCase();
    const card = characters.find((c) => c.id === m.speakerId) || (want ? characters.find((c) => c.name?.trim().toLowerCase() === want) : null);
    if (card && !ids.includes(card.id)) ids.push(card.id);
  }
  if (!ids.length) return null;
  const now = Date.now();
  return fromGroupChat({
    id: uid(),
    kind: "group",
    memberIds: ids,
    name: parsed.title || parsed.characterName,
    personaId: "",
    authorsNote: { ...DEFAULT_AUTHORS_NOTE },
    bookmarks: [],
    messages: parsed.messages,
    createdAt: parsed.messages[0]?.at || now,
    updatedAt: now,
  }, characters);
}
