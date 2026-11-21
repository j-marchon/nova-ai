import { useSyncExternalStore } from "react";

export { useStableActions } from "../../components/stable.js";

/* ---------- the reply being written, outside React state ----------

   A streamed reply used to live in the chat view's own state, so every
   painted frame re-rendered the whole conversation — every bubble, the
   composer, the cast strip — to change one bubble at the bottom. Now the
   text sits in this little store and only the parts that show it subscribe:
   the streaming bubble, and a message being continued in place. The view
   itself only learns that a reply started and that it ended.

     text   what has arrived so far (scrubbed, ready to show)
     think  the model's thinking so far, shown only while its panel is open */

export function createStreamStore() {
  let state = { text: "", think: "" };
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const k of Object.keys(patch)) if (state[k] !== patch[k]) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const fn of subs) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/* One field of the store; `null` subscribes to nothing, so a closed thinking
   panel costs no renders while the model thinks. */
export function useStream(store, field) {
  return useSyncExternalStore(
    store.subscribe,
    () => (field ? store.get()[field] : null),
    () => (field ? store.get()[field] : null),
  );
}
