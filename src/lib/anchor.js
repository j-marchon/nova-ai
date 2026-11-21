import { swipeIndex } from "./swipes.js";

/* ---------- anchors ----------

   Things a chat makes up alongside the story (the world log in memory.js,
   the phone in phone.js) are pinned to the message they were written after:
   its id and which version of it was showing.

     anchor = { id, swipe }          strict: part of the story only while
                                     that message exists with that version on
                                     screen, so swiping hides what came from
                                     the old one, swiping back brings it back,
                                     and a branch cut before the message drops it
     anchor = { id, swipe, any }     loose (`any: true`): part of the story
                                     while that message exists, whatever
                                     version shows. What the persona does on
                                     the phone, and what the phone writes in
                                     answer, is loose: a regenerated reply
                                     does not undo it.

   Nothing has to be reconciled when the chat changes; the items are read
   through this. */

export function anchorOf(message) {
  if (!message?.id) return null;
  return { id: message.id, swipe: swipeIndex(message) };
}

/* The chat's start: what was written before any message (the phone's seed)
   hangs here and is always part of the story, whatever is swiped or cut. */
export const ROOT_ANCHOR = Object.freeze({ id: "@start", swipe: 0 });
export const isRootAnchor = (anchor) => anchor?.id === ROOT_ANCHOR.id;

/* A loose anchor on `message` (any version), or ROOT_ANCHOR when there is
   no message (an empty chat). */
export function looseAnchorOf(message) {
  if (!message?.id) return ROOT_ANCHOR;
  return { id: message.id, swipe: swipeIndex(message), any: true };
}

export function anchorVisible(anchor, messages) {
  if (isRootAnchor(anchor)) return true;
  if (!anchor?.id || !Array.isArray(messages)) return false;
  const m = messages.find((x) => x?.id === anchor.id);
  if (!m) return false;
  if (anchor.any === true) return true;
  return swipeIndex(m) === (Number.isInteger(anchor.swipe) ? anchor.swipe : 0);
}

/* A stored anchor, or null when it is not one. */
export function cleanAnchor(a) {
  if (!a || typeof a !== "object" || typeof a.id !== "string" || !a.id) return null;
  return { id: a.id, swipe: Number.isInteger(a.swipe) && a.swipe >= 0 ? a.swipe : 0, ...(a.any === true ? { any: true } : {}) };
}
