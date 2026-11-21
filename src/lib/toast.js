/* ---------- short messages at the top of the screen ----------

   Anything can raise one without passing callbacks around: a save that
   failed, or "Message deleted" with an Undo. The host (components/
   Toasts.jsx) piles them into one deck under the activity island, newest
   on top. Every toast goes by itself after a while, an Undo offer too (it
   gets a little longer); only the activity island stays. Stored oldest
   first (the newest is the last item). */

let items = [];
let next = 0;
const subs = new Set();
const emit = () => { for (const fn of subs) fn(); };

/* the most kept at once: past it the oldest goes first */
export const TOAST_CAP = 12;

export const toasts = {
  get: () => items,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

function push(t) {
  items = [...items, t].slice(-TOAST_CAP);
  emit();
  return t.id;
}

/* `tone`: "warn" for something that went wrong */
export function showToast(text, { tone, ms = 6000 } = {}) {
  return push({ id: ++next, text, tone, ms });
}

/* `restore` puts back what was just done; called at most once. */
export function undoToast(text, restore, { ms = 8000 } = {}) {
  let done = false;
  return push({ id: ++next, text, ms, undo: () => { if (!done) { done = true; restore(); } } });
}

export function dismissToast(id) {
  if (!items.some((t) => t.id === id)) return;
  items = items.filter((t) => t.id !== id);
  emit();
}

/* every toast showing slides away (the screen changed under them) */
export function leaveToasts() {
  if (!items.length) return;
  items = items.map((t) => (t.leaving ? t : { ...t, leaving: true }));
  emit();
}

/* tests */
export function clearToasts() {
  items = [];
  emit();
}
