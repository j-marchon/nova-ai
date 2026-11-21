import { keepIfCovered } from "./memory.js";
import { uid } from "./util.js";

/* ---------- bookmarks & story branching ---------- */

/**
 * Normalizes a bookmark object ensuring id, messageId, label, and createdAt.
 */
export function normalizeBookmark(b) {
  if (!b || typeof b !== "object") return null;
  return {
    id: b.id || uid(),
    messageId: String(b.messageId || ""),
    label: typeof b.label === "string" ? b.label.trim() : (b.label ? String(b.label).trim() : ""),
    createdAt: Number.isFinite(b.createdAt) ? b.createdAt : Date.now(),
  };
}

/**
 * Adds a new bookmark/checkpoint to a chat.
 */
export function addBookmark(chat, { messageId, label } = {}) {
  const bm = normalizeBookmark({ messageId, label, createdAt: Date.now() });
  const bookmarks = [...(chat?.bookmarks || []), bm];
  return {
    ...chat,
    bookmarks,
    updatedAt: Date.now(),
  };
}

/**
 * Removes a bookmark by ID.
 */
export function removeBookmark(chat, bookmarkId) {
  return {
    ...chat,
    bookmarks: (chat?.bookmarks || []).filter((b) => b.id !== bookmarkId),
    updatedAt: Date.now(),
  };
}

/**
 * Duplicates a chat up to messageId (inclusive), creating a new branch.
 */
export function createChatBranch(chat, { messageId, bookmark, label, branchTitle, baseTitle, characterName } = {}) {
  if (!chat) return null;
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const targetId = messageId || bookmark?.messageId;
  const targetIdx = targetId ? messages.findIndex((m) => m.id === targetId) : -1;

  // Duplicate the chat up to target message ID (inclusive)
  const slicedMessages = targetIdx >= 0
    ? messages.slice(0, targetIdx + 1).map((m) => ({ ...m }))
    : messages.map((m) => ({ ...m }));

  const branchLabel = (label ?? bookmark?.label ?? "").trim() || "Checkpoint";
  const base = baseTitle || chat.title || characterName || "Chat";
  const newTitle = branchTitle || `${base} (Branch: ${branchLabel})`;

  // Keep bookmarks that exist within the branched messages
  const keptIds = new Set(slicedMessages.map((m) => m.id));
  const branchBookmarks = (Array.isArray(chat.bookmarks) ? chat.bookmarks : [])
    .filter((b) => keptIds.has(b.messageId))
    .map((b) => ({ ...b }));

  const now = Date.now();
  const newChat = {
    ...chat,
    id: uid(),
    title: newTitle,
    createdAt: now,
    updatedAt: now,
    messages: slicedMessages,
    bookmarks: branchBookmarks,
    memory: keepIfCovered(chat.memory, slicedMessages),
    scene: keepIfCovered(chat.scene, slicedMessages),
  };

  return newChat;
}
