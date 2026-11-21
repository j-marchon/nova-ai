/* roleplay text: *action* in italics, **emphasis** in bold

   Memoised on purpose. A streaming reply re-renders ChatPage many times a
   second, and without memo every already-finished message in the conversation
   re-runs this split on every one of those renders. In a long chat that is the
   single most expensive thing on the screen. */
/* The bubble is whitespace-pre-wrap, so a blank line in the text is a real
   blank line on screen — that is what the layout rules in FORMAT are
   written against. Models are inconsistent about how many they emit, though,
   so four newlines get flattened to one gap here rather than opening a hole
   in the middle of the reply.

   A single-asterisk span may now run over a line break, since an action block
   long enough to wrap used to lose its styling and show its asterisks raw. It
   still cannot cross a blank line, which is what stops one unclosed asterisk
   from italicising everything after it. */
export const RP_SPAN = /(\*\*\*(?:[^*\n]|\n(?!\n))+\*\*\*|\*\*(?:[^*\n]|\n(?!\n))+\*\*|\*(?:[^*\n]|\n(?!\n))+\*)/g;

export function tidyRP(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* A reply stopped by the token cap ends mid-word. Cutting back to the last
   finished sentence reads as a pause instead of a glitch — but only when that
   leaves most of the reply intact, otherwise there is nothing left to keep. */
export function trimToSentence(text) {
  const t = text.trimEnd();
  /* an even count means every *action* in the string is closed */
  const closed = (s) => (s.split("*").length - 1) % 2 === 0;

  let cut = Math.max(t.lastIndexOf("."), t.lastIndexOf("!"), t.lastIndexOf("?"), t.lastIndexOf("\n"));
  /* a closing asterisk ends an action cleanly and is often the better stop.
     An opening one is not — cutting there strands the marker. */
  const star = t.lastIndexOf("*");
  if (star > cut && closed(t.slice(0, star + 1))) cut = star;

  let out = cut > 0 && cut >= t.length * 0.5 ? t.slice(0, cut + 1).trimEnd() : t;
  /* an unclosed action would render as a literal asterisk, so drop it and
     whatever fragment follows it */
  if (!closed(out)) out = out.replace(/\*[^*]*$/, "").trimEnd();
  return out || t;
}

/* The scene tracker rides on the last message, and some models (Gemma) copy
   it into their reply, above or below the story. A run of lines at either
   end of the reply is dropped when every line in it is tracker-shaped and
   at least one is unmistakably the tracker: a line of the current tracker
   itself, its label, or the "day | time | place | weather" line. Brackets
   in the middle of a reply, and a lone OOC bracket at the end, are kept. */
export function stripTracker(text, tracker = "") {
  const norm = (s) => s.toLowerCase().replace(/[\s*_`>]+/g, " ").trim();
  const known = new Set(String(tracker).split("\n").map(norm).filter((l) => l.length > 3));
  const label = /^[\s*_#>(]*(private )?(scene )?tracker\b|^\(?end of (private )?tracker|^<\/?(details|summary|tracker)>|^```/i;
  const strong = (l) => known.has(norm(l)) || label.test(l) || /^\[[^\]]*\|[^\]]*\|[^\]]*\|/.test(l.trim());
  const shaped = (l) => !l.trim() || strong(l) || /^\s*\[|\]\s*$/.test(l) || /^\s*-\s/.test(l) || /^\s*-{3,}\s*$/.test(l);

  let lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const cut = (from) => {
    /* from the end inwards (or the start), take the longest tracker-shaped run */
    const order = from === "end" ? [...lines].reverse() : lines;
    let n = 0;
    let hit = false;
    while (n < order.length && shaped(order[n])) { if (strong(order[n])) hit = true; n++; }
    if (!hit || n === order.length) return;
    lines = from === "end" ? lines.slice(0, lines.length - n) : lines.slice(n);
  };
  cut("end");
  cut("start");
  return lines.join("\n").trim();
}

/* Hidden notes. Some prompts have the model keep character and
   location sheets, goals and relation changes inside <!-- XML comments -->,
   which are meant to be invisible to the reader. The text is kept in the
   message, so the model still sees its own notes next turn; only the bubble
   leaves them out. While a reply streams, a comment that has opened but not
   closed yet is hidden too, so the sheet never flashes up mid-reply. */
const NOTE = /<!--[\s\S]*?-->/g;

export function hideNotes(text) {
  const s = String(text ?? "");
  if (!s.includes("<!--")) return s;
  return s.replace(NOTE, "").replace(/<!--[\s\S]*$/, "").replace(/\n{3,}/g, "\n\n").trim();
}

/* The notes on their own, so an edit of the visible text can put them back. */
export function notesOf(text) {
  return (String(text ?? "").match(NOTE) || []).join("\n");
}

/* A continuation added to the end of a reply. Models asked to continue
   sometimes restate the last words first, and sometimes start a new sentence
   without a space; both are mended here so the join reads as one text. */
export function joinContinuation(text, more) {
  const a = String(text ?? "");
  let b = String(more ?? "");
  if (!b) return a;
  /* the longest start of the continuation that repeats the reply's end */
  for (let k = Math.min(a.length, b.length, 400); k >= 12; k--) {
    if (a.endsWith(b.slice(0, k))) { b = b.slice(k); break; }
  }
  if (!a || !b || /\s$/.test(a) || /^\s/.test(b) || /^[,.;:!?)\]}…'’-]/.test(b)) return a + b;
  return /[.!?…"”*)\]]$/.test(a) ? `${a} ${b}` : a + b;
}
