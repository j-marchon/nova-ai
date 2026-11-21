/* ---------- putting things back ----------

   An undo restores what one change removed or replaced, without throwing
   away anything that happened since. Lists are matched by id:

     - an item the change removed comes back, in its old place
     - an item the change replaced goes back to how it was, unless it has
       been changed again since (then the newer version stays)
     - an item removed again since stays removed
     - an item added since stays, after the restored ones

   `before` and `after` are the list either side of the change; `current`
   is the list as it is now. */
export function restoreList(current, before, after) {
  const cur = new Map((current || []).map((x) => [x?.id, x]));
  const aft = new Map((after || []).map((x) => [x?.id, x]));
  const out = [];
  const seen = new Set();
  for (const b of before || []) {
    const id = b?.id;
    seen.add(id);
    if (!aft.has(id)) { out.push(cur.get(id) || b); continue; } // removed by the change
    if (!cur.has(id)) continue;                                   // removed since
    const now = cur.get(id);
    out.push(now === aft.get(id) ? b : now);                      // replaced by the change, or changed since
  }
  for (const x of current || []) if (!seen.has(x?.id)) out.push(x);
  return out;
}

/* The same for a patch of top-level lists on the app data: each list the
   patch touched is restored, everything else is left as it is now. */
export function undoPatch(d, before, patch) {
  const out = { ...d };
  for (const k of Object.keys(patch)) {
    out[k] = Array.isArray(before[k]) ? restoreList(d[k], before[k], patch[k]) : before[k];
  }
  return out;
}
