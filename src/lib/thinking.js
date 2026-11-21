/* ---------- thinking models ----------

   This is what was making replies take half a minute to appear, and what was
   producing bubbles containing nothing but "…".

   Nemotron, and every other reasoning model, spends tokens thinking before it
   writes anything. Those tokens do not arrive on `delta.content`; OpenRouter
   puts them on `delta.reasoning`. The stream reader only ever looked at
   `content`, so for the whole length of the thinking phase the app received
   data, threw it away, and showed the three-dot placeholder. Nothing was
   stuck — the reply had simply not started yet.

   Worse, the thinking is charged against `max_tokens`. The Natural preset
   capped a reply at 260 tokens, which a model can easily spend entirely on
   thinking, and then the response ends with an empty `content`. That is where
   the "…" came from (`acc.trim() || "…"` used to save it as a message), and
   where "cut short" came from too: thinking took most of the budget and the
   reply ran out of room halfway through a sentence.

   Three things fix it:

     1. Ask the model not to think. OpenRouter's `reasoning: { enabled: false }`
        covers models that support the switch; Nemotron and Qwen want it as a
        system-prompt directive instead, which is what THINK_OFF does below.
     2. Read `delta.reasoning` anyway, in case a model thinks regardless, and
        show it as "Thinking…" rather than silence.
     3. Strip inline <think> blocks out of the visible text, since some
        providers stream the thinking on `content` inside tags. */

/* Family-specific switches. Both of these are documented model behaviour, not
   guesses: the directive has to be in the system prompt, and it goes first. */
export function thinkDirective(model, on) {
  const id = (model || "").toLowerCase();
  if (/nemotron/.test(id)) return on ? "detailed thinking on" : "detailed thinking off";
  if (/qwen/.test(id)) return on ? "/think" : "/no_think";
  return null;
}

/* Tags used by models that stream their thinking as ordinary content. */
export const THINK_OPEN = /<\s*(think|thinking|thought|reason|reasoning)\s*>/i;

export const THINK_CLOSE = /<\s*\/\s*(think|thinking|thought|reason|reasoning)\s*>/i;

/* could still turn out to be the front half of one of those tags */
export const PARTIAL_TAG = /^<\/?[a-zA-Z]{0,9}$/;

/* Splits a token stream into visible text and thinking, tolerating tags that
   arrive split across two chunks. Feed it every chunk, then flush(). */
export function makeThinkFilter() {
  let buf = "";
  let inside = false;

  const step = (final) => {
    let text = "";
    let reasoning = "";

    for (;;) {
      if (inside) {
        const close = buf.match(THINK_CLOSE);
        if (!close) break;
        reasoning += buf.slice(0, close.index);
        buf = buf.slice(close.index + close[0].length);
        inside = false;
      } else {
        const open = buf.match(THINK_OPEN);
        const close = buf.match(THINK_CLOSE);
        /* A closing tag with no opening one: happens when the thinking came
           down the reasoning field and only its tail landed in content. */
        if (close && (!open || close.index < open.index)) {
          text += buf.slice(0, close.index);
          buf = buf.slice(close.index + close[0].length);
          continue;
        }
        if (!open) break;
        text += buf.slice(0, open.index);
        buf = buf.slice(open.index + open[0].length);
        inside = true;
      }
    }

    /* Hold back a trailing fragment only when it could really be a tag
       opening, so ordinary text is never delayed. */
    let keep = buf.length;
    if (!final) {
      const lt = buf.lastIndexOf("<");
      if (lt !== -1 && PARTIAL_TAG.test(buf.slice(lt))) keep = lt;
    }
    if (inside) reasoning += buf.slice(0, keep);
    else text += buf.slice(0, keep);
    buf = buf.slice(keep);

    return { text, reasoning };
  };

  return {
    push(chunk) { buf += chunk; return step(false); },
    flush() { return step(true); },
  };
}
