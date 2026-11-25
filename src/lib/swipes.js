/* ---------- swipes ----------

   A reply can hold several versions. Regenerating no longer throws the old
   one away: it adds a version, and the arrows (or a sideways swipe on the
   bubble) move between them. Whichever version is showing is the one the
   conversation continues from.

   `content` is always the version on screen, so everything else in the app —
   the prompt, the history list, editing, export — keeps reading one field and
   never has to know swipes exist. The versions live beside it:

     swipes    [{ text, via?, reasoning?, reasoningMs? }]   every version, oldest first
     swipeIdx  number                                     which one `content` is

   A message that has never been regenerated has neither field; it is a list
   of one. A version's other fields (the model that wrote it, its thinking
   and how long that took) sit on the message beside `content` the same way.
   A message whose thinking is kept never sends it back: the prompt reads
   `content` only. */

const EXTRAS = ["via", "reasoning", "reasoningMs"];
/* Absent rather than undefined, so none shows up as a stray key. */
const extrasOf = (o) => Object.fromEntries(EXTRAS.filter((k) => o?.[k] != null && o[k] !== "").map((k) => [k, o[k]]));

/* Every version of a message, the plain single-version case included. */
export function swipeList(m) {
  if (Array.isArray(m?.swipes) && m.swipes.length) return m.swipes;
  return [{ text: m?.content || "", ...extrasOf(m) }];
}

export const swipeIndex = (m) => {
  const n = swipeList(m).length;
  const i = Number.isInteger(m?.swipeIdx) ? m.swipeIdx : n - 1;
  return Math.min(Math.max(0, i), n - 1);
};

/* `via` names the model that wrote a version when it was not the one picked. */
function withVersion(m, v) {
  const rest = { ...m };
  for (const k of EXTRAS) delete rest[k];
  return { ...rest, content: v.text, ...extrasOf(v) };
}

/* A new version, shown straight away. `thought`: { reasoning, reasoningMs }. */
export function addSwipe(m, text, via, thought) {
  const swipes = [...swipeList(m), { text, ...extrasOf({ via, ...thought }) }];
  return withVersion({ ...m, swipes, swipeIdx: swipes.length - 1, at: Date.now() }, swipes[swipes.length - 1]);
}

/* Show version i (clamped). */
export function showSwipe(m, i) {
  const list = swipeList(m);
  const k = Math.min(Math.max(0, i), list.length - 1);
  return withVersion({ ...m, swipes: list, swipeIdx: k }, list[k]);
}

/* An edit changes the version on screen and leaves the others alone. */
export function editMessage(m, text) {
  if (!Array.isArray(m?.swipes) || !m.swipes.length) return { ...m, content: text };
  const k = swipeIndex(m);
  const swipes = m.swipes.map((v, i) => (i === k ? { ...v, text } : v));
  return { ...m, swipes, content: text };
}
