/* ---------- keeping the prompt from growing forever ----------

   Every request resends the whole conversation, because that is the only way
   a stateless chat API knows what happened. Left unbounded that means the
   prompt grows without limit: slower every turn, and eventually past the
   model's context window, where it simply fails.

   So the oldest messages get dropped once the conversation passes a budget. */

/* Good enough to decide what to drop. 3.6 characters per token is a fair
   average for English prose; being exact here would mean shipping a tokeniser
   for every model, and the budget has slack in it anyway. */
export const estTokens = (s) => Math.ceil((s || "").length / 3.6);

/* per-message framing the server adds around each turn */
export const MSG_OVERHEAD = 4;

/* Trim from the oldest end until the history fits.

   The subtlety is *where* the cut lands, not how much gets dropped. Servers
   cache the longest prompt prefix they have seen before; anything after the
   first differing token has to be reprocessed. So if the oldest kept message
   changes on every turn, the cache never hits and every single message costs a
   full reprocess of the whole conversation — worse than not trimming at all.

   A plain "drop until it fits" does exactly that, because a long conversation
   sits permanently over budget: the cut point creeps forward by one message
   each turn and drags the prefix with it.

   So the cut index is quantised to a multiple of CUT_STEP. It is rounded up,
   never down, so the result is always inside the budget — and because a turn
   only adds two messages, the quantised index holds still for several turns at
   a stretch. The prefix then stays byte-identical across those turns and the
   cache keeps hitting; the reprocess cost lands once per CUT_STEP/2 turns
   instead of every turn. */
export const CUT_STEP = 20;

/* What one message costs the window. A message hidden from the AI is never
   sent, so it costs nothing (the prompt leaves it out after the cut). */
export const msgTokens = (m) => (m?.hidden ? 0 : estTokens(m?.content) + MSG_OVERHEAD);

/* Where the window starts: how many of the oldest messages are left out.
   Zero while everything fits. */
export function historyCut(history, budget) {
  const MIN_KEEP = 4;
  if (history.length <= MIN_KEEP) return 0;

  const tok = history.map(msgTokens);
  let total = tok.reduce((a, b) => a + b, 0);
  if (total <= budget) return 0;

  /* smallest cut that fits */
  let cut = 0;
  while (cut < history.length - MIN_KEEP && total > budget) {
    total -= tok[cut];
    cut++;
  }

  /* round it up onto the step grid so it stops moving every turn */
  const snapped = Math.ceil(cut / CUT_STEP) * CUT_STEP;
  return Math.min(snapped, history.length - MIN_KEEP);
}

/* `covered` is how many leading messages the long-term memory has already
   summarised (see memory.js); the window never starts past it, so nothing
   leaves before it has been written down. Infinity — memory off — is the old
   behaviour exactly. The one exception is a window grown past twice the
   budget, which trims regardless: a summariser that keeps failing must not
   grow the prompt without limit. */
export function trimHistory(history, budget, covered = Infinity) {
  const cut = historyCut(history, budget);
  if (cut <= covered) return history.slice(cut);
  const kept = history.slice(covered);
  const size = kept.reduce((n, m) => n + msgTokens(m), 0);
  return size > budget * 2 ? history.slice(cut) : kept;
}
