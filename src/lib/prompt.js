import { activeModel } from "./api.js";
import { DEFAULT_HISTORY_TOKENS } from "./data.js";
import { genParams, thinkingOn } from "./styles.js";
import { thinkDirective } from "./thinking.js";
import { trimHistory } from "./window.js";
import { activeSummary, memoryCovered } from "./memory.js";
import { DEFAULT_LORE_BUDGET, DEFAULT_SCAN_DEPTH, selectLore } from "./lore.js";
import { runMacros } from "./macros.js";
import { applyPromptRegex } from "./tavern.js";
import { searchRelevantContext } from "./rag.js";

/* ---------- prompt assembly ---------- */

/* ---------- habits the model has fallen into in this chat ----------

   What a local backend does with DRY and banned-string samplers, done the
   only way an API allows: by reading the last few replies and telling the
   model what it keeps doing. It sees three habits, the ones that make every
   character sound the same:

     openers    two or more recent replies starting with the same words
     questions  most recent replies ending on a question
     phrases    the same four-word run turning up in several replies

   Only replies still in the recent window count, so a habit drops out on its
   own once the model stops. Nothing is sent when nothing repeats.

   The notes describe a habit; they never quote it. They used to — "do not
   open with 'Her eyes narrow…' again" — which is the same mistake the ban
   list is careful to avoid: a phrase written into the prompt is a phrase put
   in front of the model, right at the point of writing. Large models mostly
   read that as the prohibition it is. Small ones copy what they are shown,
   and the note became the strongest vote *for* the habit it was meant to
   break. So the detection is unchanged and the note only names the kind of
   repetition and asks for something new, which gives a small model nothing
   to copy. */
export const REPEAT_WINDOW = 6;

/* The ban list, one phrase per line in Settings. Matched case-insensitively
   anywhere in the reply. It is never put in the prompt up front — naming a
   phrase to avoid puts it in front of the model — only in the one-off note on
   a rewrite, after the model has already used it. */
export function bannedList(raw) {
  const seen = new Set();
  for (const line of String(raw || "").split("\n")) {
    const p = line.trim().toLowerCase();
    if (p.length >= 2) seen.add(p);
  }
  return [...seen];
}

export function bannedHits(text, list) {
  const t = text.toLowerCase();
  return list.filter((p) => t.includes(p));
}

/* Words too common to make a four-word run a "phrase" worth mentioning. */
export const STOPWORDS = new Set(("a an the and or but so of to in on at for with from by as is are was were be been it its " +
  "i you he she they we me him her them us my your his their our this that there what not no do does did " +
  "just then if into up out about like have has had will would can could " +
  "don't i'm it's can't won't i'll you're that's didn't isn't what's i've").split(" "));

/* speech and narration alike, lowercase, markup and punctuation out */
export const words = (t) => t.toLowerCase().replace(/[*_"“”]/g, " ").replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);

export function repetitionNotes(history) {
  const recent = history.filter((m) => m.role === "assistant").slice(-REPEAT_WINDOW).map((m) => m.content || "");
  if (recent.length < 2) return [];
  const notes = [];

  /* Openers: the first three words, narration and speech alike, or failing
     that the first two — "*leans in*" is a habit too — as long as they are
     not both filler ("I don't" is not a habit worth naming). */
  const commonOpener = (n) => {
    const count = new Map();
    for (const t of recent) {
      const w = words(t).slice(0, n);
      if (w.length < n || w.every((x) => STOPWORDS.has(x))) continue;
      const k = w.join(" ");
      count.set(k, (count.get(k) || 0) + 1);
    }
    return [...count].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const opener = commonOpener(3) || commonOpener(2);
  if (opener) notes.push("Several of your recent replies opened the same way; open this one with a different subject, action or line.");

  /* Questions: the last three replies, judged on their final sentence. */
  const last3 = recent.slice(-3);
  const asked = last3.filter((t) => /\?\s*[*"”]*\s*$/.test(t.trim())).length;
  if (last3.length >= 2 && asked >= 2) notes.push("Your recent replies ended on a question; end this one on something else.");

  /* Phrases: four-word runs found in at least three different replies,
     skipping runs made of filler words. Overlapping runs from the same
     phrase are collapsed so one habit is named once. */
  const seen = new Map();
  for (const t of recent) {
    const w = words(t);
    const mine = new Set();
    for (let i = 0; i + 4 <= w.length; i++) {
      const run = w.slice(i, i + 4);
      if (run.filter((x) => !STOPWORDS.has(x)).length < 2) continue;
      mine.add(run.join(" "));
    }
    for (const k of mine) seen.set(k, (seen.get(k) || 0) + 1);
  }
  const picked = [];
  for (const [k] of [...seen].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])) {
    /* runs sharing a content word are the same habit seen through a
       different window, so name only the most frequent one */
    const content = k.split(" ").filter((x) => !STOPWORDS.has(x));
    if (picked.some((p) => content.some((x) => p.split(" ").includes(x)))) continue;
    picked.push(k);
    if (picked.length === 3) break;
  }
  if (picked.length) notes.push("Some wording keeps coming back across your recent replies; use fresh wording and images instead of echoing earlier replies.");

  return notes;
}

/* ---------- language ----------

   Replies follow the language you write in, rather than a hardcoded "Write
   in English" that made every chat in any other language an argument with
   the system prompt. A character whose own language differs may let a word
   or a short phrase of it through — an oath, an endearment — where it fits
   them, but the reply stays readable. */
export function languageRule(userName, charLabel) {
  return (
    `Write in the language ${userName} writes in. ` +
    `${charLabel} may slip in a word or a short phrase from a native language of their own where it fits who they are, ` +
    `but the reply as a whole stays in ${userName}'s language.`
  );
}

/* ---------- the card's own instructions ----------

   A character card can carry two instructions from its author: a system
   prompt, and post-history instructions meant to sit after the conversation.
   Plenty of cards depend on them — a narrator card, a card with a game in it,
   a character whose rules are the point.

   They are kept and sent, under the card's name, with one boundary: [Style]
   still decides length and layout, because the reply style is something you
   chose and the card's author never saw. The system prompt goes with the
   card, in the cached block; post-history instructions go where their name
   says, at the end, next to the reply-style line.

   {{original}} is SillyTavern's slot for "the frontend's own prompt goes
   here". Nova's own prompt is always present, so the slot is just removed. */
export const cardText = (t) => String(t || "").replace(/\{\{original\}\}/gi, "").trim();

const listNames = (names) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/* Everything one request sends. Modes:

     character   one card              (character), with the cards of any
                 of your characters linked into its Scope cast (ensemble)
     universe    a world and its cast  (universe)

   and `mode: "impersonate"` asks for your next message instead of theirs.
   `memory` and `scene` are the chat's notes (see memory.js); `lorebooks`
   the books in play for this chat (see lore.js). `scope` is the Nova Scope
   note for a chat with Scope on (see scope.js), or nothing. */
export function buildApiMessages({
  character, universe, ensemble = [], persona, username, history, settings,
  extra, memory, scene, mode, direction, lorebooks, scope, vars = {},
  world, phone,
  authorsNote, recalledContext,
}) {
  const userName = persona?.name || username || "You";
  const style = genParams(settings);
  /* the linked cards, sent whole beside the host's (scope.js linkedCards) */
  const linked = !universe && Array.isArray(ensemble) ? ensemble.filter(Boolean) : [];
  const isEnsemble = linked.length > 0;
  /* {{char}} as well as {{user}}, so a style can name either side. With
     an ensemble it is still the host; each card's own text fills {{char}}
     with its own name. */
  const charName = universe ? universe.name : character?.name || "the character";
  /* Any case, since prompts write {{User}} and {{Char}} as often as not.
     The rest of SillyTavern's macros run here too (macros.js): dice, notes,
     and the chat's variables in `vars`, which is changed in place and is
     the caller's to save. Everything is filled in the order it is sent, so
     a block reads what the blocks above it set. */
  const fill = (t, name = charName) => runMacros(t || "", { vars, user: userName, char: name });
  const useCard = settings.cardInstructions !== false;

  /* The framing sentence is style-derived. It used to say "immersive" for
     every preset regardless of which was selected, which is why a Direct chat
     still answered like an immersive one: the opening line of a system prompt
     outweighs a [Style] block sitting below a long character card. */
  const frame = style.frame || "a roleplay";

  /* Example dialogue is the strongest style signal in the whole prompt — a
     model copies a sample far more readily than it follows an instruction,
     so a card written with long flowery samples was overriding Direct on its
     own. Naming what the sample is for keeps it a voice reference instead of
     a template for length and layout. */
  const examples = (c, heading) =>
    c.exampleDialogs
      ? `\n\n[${heading}]\nThese show how ${c.name} speaks: vocabulary, rhythm, attitude. Follow their voice and formatting unless your custom instructions say otherwise.\n\n` +
        fill(c.exampleDialogs, c.name)
      : "";
  const instructions = (c, heading) =>
    useCard && cardText(c.systemPrompt)
      ? `\n\n[${heading}]\n${fill(cardText(c.systemPrompt), c.name)}`
      : "";

  let sys;
  if (universe) {
    sys = `You are running ${frame} set in the world of "${universe.name}" with ${userName}. You play the world, the narration and every listed character. Always stay inside the fiction and never break the fourth wall.`;
    if (universe.story) sys += `\n\n[Story]\n${fill(universe.story)}`;
    if (universe.rules) sys += `\n\n[World rules]\n${fill(universe.rules)}`;
    if (universe.locations?.length)
      sys += `\n\n[Locations]\n` + universe.locations.map((l) => `- ${fill(l.name)}${l.description ? `: ${fill(l.description)}` : ""}`).join("\n");
    if (universe.characters?.length)
      sys += `\n\n[Characters]\n` + universe.characters.map((c) =>
        `- ${fill(c.name, c.name)}${c.description ? `: ${fill(c.description, c.name)}` : ""}${c.personality ? ` (personality: ${fill(c.personality, c.name)})` : ""}${Object.entries(c).filter(([key, value]) => !["id", "name", "avatar", "description", "personality"].includes(key) && typeof value === "string" && value).map(([key, value]) => `\n  [${key}] ${fill(value, c.name)}`).join("")}`
      ).join("\n");
    /* What makes a universe a world rather than a group chat. Static, so the
       cached block holds; what is going on right now rides in the tail (the
       world tracker and [Elsewhere lately], memory.js). */
    sys += `\n\n[How this world runs]\n` +
      `- The world does not wait for ${userName}. Time passes, weather and light change, and every character has goals, plans and a routine of their own, which they pursue on screen and off.\n` +
      `- You are also the world's narrator. When it fits, let the world act first: a sound outside, news arriving, someone walking in with their own reason to be there. Keep it grounded in the current location.\n` +
      `- Characters who are elsewhere stay elsewhere. What they do reaches this scene only in plausible ways: arriving, calling, a message, rumours, consequences.\n` +
      `- When the private tracker or [Elsewhere lately] mentions something happening elsewhere, let it surface when it would naturally reach this place, never all at once and never as a summary.\n` +
      `- Stay consistent with the world's rules and places. Never write ${userName}'s words, actions or thoughts.`;
    sys += `\n\nSeveral characters may appear in the same reply when it makes sense. When more than one speaks, begin each of their spoken blocks with **Name:** on its own line. That is the only place double asterisks are allowed.`;
  } else if (isEnsemble) {
    /* The host's card and every linked card, in full, in one fixed block:
       the same bytes every turn, so the prefix cache holds. Who leads a
       reply is said at the end of the prompt (scope.js scopeNote). */
    const cast = [character, ...linked];
    sys = `You are ${listNames(cast.map((c) => c.name))}, and you voice everyone else in ${frame} with ${userName}. Always stay in character and never break the fourth wall.`;
    for (const c of cast) {
      sys += `\n\n[Character: ${c.name}]\n${fill(c.description, c.name) || c.name}`;
      if (c.personality) sys += `\n\n[${c.name}'s personality]\n${fill(c.personality, c.name)}`;
      sys += examples(c, `${c.name}'s example dialogue`);
      sys += instructions(c, `${c.name}: instructions from the card's author`);
    }
    sys += `\n\nWhen more than one of them speaks or acts, begin each one's part with **Name:** on its own line. That is the only place double asterisks are allowed.`;
  } else {
    sys = `You are ${character.name} in ${frame} with ${userName}. Always stay in character and never break the fourth wall.`;
    /* filled like everything else, since imported cards write {{char}} and
       {{user}} all through their descriptions */
    if (character.description) sys += `\n\n[Character]\n${fill(character.description)}`;
    if (character.personality) sys += `\n\n[Personality]\n${fill(character.personality)}`;
    sys += examples(character, "Example dialogue");
    sys += instructions(character, "Instructions from the card's author");
  }

  if (persona?.description) sys += `\n\n[About ${userName}]\n${persona.description}`;

  /* Lorebooks. Always-on entries here, in the fixed block; keyword entries
     at the end (below). See lore.js for why that split keeps the cache. */
  const lore = settings.loreOn !== false && lorebooks?.length
    ? selectLore(lorebooks, history, {
        depth: settings.loreDepth || DEFAULT_SCAN_DEPTH,
        budget: settings.loreBudget || DEFAULT_LORE_BUDGET,
      })
    : { constant: [], triggered: [] };
  if (lore.constant.length) sys += `\n\n[World info]\n${lore.constant.map((e) => fill(e.content.trim())).join("\n\n")}`;

  /* The long-term memory. After the cards and before [Style]: it changes only
     when the window's start moves, which reprocesses everything after the
     cut anyway, so the cards above it stay cached. */
  const memoryOn = settings.memoryOn !== false;
  const summary = memoryOn ? activeSummary(history, memory) : "";
  if (summary) sys += `\n\n[Story so far]\nWhat happened earlier in this story, before the conversation below:\n${summary}`;

  /* [Style] sits last of the content blocks, so it is the most recent thing
     read before the conversation, and the shape line below closes the prompt.
     Between the opening frame and that line the style now holds both ends of
     the system message instead of being buried in the middle. */
  if (style.prompt) sys += `\n\n[Style]\n${fill(style.prompt)}`;

  /* One closing line. Skipped for Bare along with [Style]: it is a style
     rule, and Bare exists to show what the model does with none. Custom
     prompts bring their own closing rules, so they get only the language. */
  const lang = languageRule(userName, universe || isEnsemble ? "A character" : charName);
  if (!style.bare && !style.custom) {
    sys += `\n\n${style.limit || ""} Stop where ${userName} would answer. ${lang}`.replace(/ +/g, " ");
  } else if (style.custom) {
    sys += `\n\n${lang}`;
  }

  /* Nemotron and Qwen switch thinking by a line in the system prompt, and it
     has to be first. It is a constant, so it does not disturb caching. */
  const directive = thinkDirective(activeModel(settings), thinkingOn(settings));
  if (directive) sys = `${directive}\n\n${sys}`;

  /* The system block is sent whole every time — it is the character, and it
     sits at the front where the provider's prefix cache can hold it. Only the
     conversation is trimmed, and never past what the memory has covered.

     Nothing that changes from turn to turn may go in it. That is why keyword
     lorebook entries are not here: splicing them in rewrote the middle of
     this string whenever a keyword matched, which invalidated the cached
     prefix and reprocessed the whole prompt on the busiest turns. */
  const covered = memoryOn ? memoryCovered(history, memory) : Infinity;
  const kept = trimHistory(history, settings.historyTokens || DEFAULT_HISTORY_TOKENS, covered);
  /* In a multi-character chat the model has to know who said what, and an
     assistant turn carries no name of its own, so one spoken by anyone but
     the main character is labelled.
     System / Narrator messages are formatted cleanly as user turns so external
     APIs (which reject mid-conversation system roles) accept them reliably. */
  const asSent = (m) => {
    if (m.role === "system") return `[Narrator: ${m.content}]`;
    if (m.role === "assistant" && m.speaker && m.speaker !== charName) return `${m.speaker}: ${m.content}`;
    return m.content;
  };
  /* an imported preset's prompt-only regex (tavern.js): what is sent is
     trimmed, what is saved and shown is not */
  const sent = applyPromptRegex(kept, style.regex);
  const msgs = [
    { role: "system", content: sys },
    ...sent.map((m) => {
      const item = {
        role: m.role === "system" ? "user" : m.role,
        content: asSent(m),
      };
      if (m.images && m.images.length) item.images = m.images;
      return item;
    }),
  ];

  /* An imported preset's in-chat blocks above the newest message, `depth`
     messages up. Never a system message mid-chat (see `attach` below): it
     joins the user turn just before that point, or is one of its own. */
  for (const { depth, text } of style.inject || []) {
    const body = fill(text);
    if (!body.trim()) continue;
    const at = Math.max(1, msgs.length - depth);
    const prev = msgs[at - 1];
    if (prev.role === "user") prev.content += `\n\n${body}`;
    else msgs.splice(at, 0, { role: "user", content: body });
  }

  /* In-chat Author's Note: every turn, three messages up from the newest,
     as a user turn reading [Author's note: ...] so external APIs won't
     reject a system message mid-chat. A role, depth or interval stored on
     an older note is ignored. */
  if (authorsNote?.text?.trim()) {
    const at = Math.max(1, msgs.length - 3);
    msgs.splice(at, 0, { role: "user", content: `[Author's note: ${fill(authorsNote.text)}]` });
  }

  if (extra) msgs.push({ role: "user", content: extra });

  /* Notes ride on the newest message, or on a message of their own when the
     newest is not yours. Several free models' chat templates reject or
     silently drop a system message that is not first, so they are never
     system messages. None of it is saved into the chat. */
  const attach = (text) => {
    const last = msgs[msgs.length - 1];
    if (last && last.role === "user") last.content += `\n\n${text}`;
    else msgs.push({ role: "user", content: text });
  };

  /* Keyword lore for this turn, shared by both modes below. */
  const loreNote = lore.triggered.length
    ? `[World info, relevant right now:\n${lore.triggered.map((e) => fill(e.content.trim())).join("\n\n")}]`
    : "";

  /* Recall (rag.js): older messages that share the most words with the
     newest one, from those no longer resent, so nothing is sent twice. */
  let recalledNote = "";
  let recalled = recalledContext;
  if (!recalled && settings?.ragOn && history.length > kept.length) {
    const query = history[history.length - 1]?.content || "";
    const gone = history.slice(0, history.length - kept.length);
    if (query.trim()) {
      const hits = searchRelevantContext(query, gone, { topK: 3, threshold: 0.25 });
      if (hits.length > 0) recalled = hits;
    }
  }

  if (recalled) {
    const formatted = Array.isArray(recalled)
      ? recalled
          .map((m) => {
            if (!m) return "";
            if (typeof m === "string") return m;
            const author = m.speaker || (m.role === "assistant" ? charName : m.role === "user" ? userName : "Narrator");
            return `${author}: ${m.content}`;
          })
          .filter(Boolean)
          .join("\n")
      : String(recalled).trim();

    if (formatted) {
      recalledNote = formatted.startsWith("[Recalled Context")
        ? formatted
        : `[Recalled Context:\n${formatted}]`;
    }
  }

  /* Ambient context: what has been going on out of the scene. `world` is a
     universe chat's visible world log (memory.js visibleLog), the last three
     sent; `phone` is phone.js phoneNote. Both change from turn to turn, so
     they ride at the end, never in the cached block. */
  const ambient = [];
  const elsewhere = universe && Array.isArray(world)
    ? world.slice(-3).map((e) => String(typeof e === "string" ? e : e?.text || "").trim()).filter(Boolean)
    : [];
  if (elsewhere.length) ambient.push(`[Elsewhere lately (off-screen; known here only once it plausibly reaches this place):\n${elsewhere.map((t) => `- ${t}`).join("\n")}]`);
  if (typeof phone === "string" && phone.trim()) ambient.push(phone.trim());

  /* ---------- writing your next message ----------

     The same prompt, so the model knows the scene and how you have been
     writing, with one instruction at the end that turns it around. */
  if (mode === "impersonate") {
    const them = universe ? "any other character or the narration" : isEnsemble ? listNames([character, ...linked].map((c) => c.name)) : charName;
    if (loreNote) attach(loreNote);
    if (recalledNote) attach(recalledNote);
    for (const note of ambient) attach(note);
    attach(
      `[For this one message, write ${userName}'s next turn instead. Write only what ${userName} says and does, as ${userName}, the way ${userName} has been writing so far: similar length, tone and markup. ` +
      `Nothing for ${them}, and no name label. Write in the language ${userName} writes in.` +
      (direction?.trim() ? ` Build it from this idea: ${direction.trim()}` : "") + "]"
    );
    return msgs;
  }

  const tail = [];
  if (loreNote) tail.push(loreNote);
  if (recalledNote) tail.push(recalledNote);
  /* the world's off-screen log and the phone, just before the tracker */
  tail.push(...ambient);

  /* Where the scene stands (the tracker), kept current by memory.js. Not
     wrapped in a bracket of its own: it is made of brackets. Some models
     (Gemma) copy whatever block sits at the end of the last message into
     their reply, so it is fenced off and marked as private, and the reply
     is scrubbed of it anyway by stripTracker in text.js. A universe always
     keeps its world tracker (replyJob.js runNotes). */
  if ((settings.sceneEvery > 0 || universe) && scene?.text?.trim()) {
    tail.push(
      "(Private scene tracker, for continuity only. Stay consistent with it, but never write, repeat, update or summarise it in the reply.)\n" +
      `${scene.text.trim()}\n(End of private tracker.)`
    );
  }

  /* The card's post-history instructions; a linked card's, under its
     own name. */
  if (useCard && !universe) {
    const after = cardText(character?.postHistoryInstructions);
    if (after) tail.push(`[${fill(after)}]`);
    for (const c of linked) {
      const theirs = cardText(c.postHistoryInstructions);
      if (theirs) tail.push(`[${c.name}: ${fill(theirs, c.name)}]`);
    }
  }

  /* A model preset's post-history block, where its page puts it. */
  if (style.post) tail.push(fill(style.post));

  /* Nova Scope: the rest of the cast and how the scene plays (scope.js).
     At the end with the tracker, so the cached system block never changes
     when someone joins. */
  if (scope) tail.push(scope);

  /* ---------- the style, again, at the point of writing ----------

     The system prompt is read once, at the top, and everything after it is
     conversation — including every earlier reply, which a model copies far
     more readily than it follows an instruction. So after a few turns the
     shape of the previous replies (and of the card's greeting) outweighs
     [Style], and switching style mid-chat changes nothing, not even on the
     first reply after the switch.

     One line on the newest message fixes that: it is the last thing read
     before writing, it names the style, and it says outright to ignore the
     shape of earlier replies. The previous turn's message carried it and this
     turn's copy of that message does not, so the cached prefix ends one
     exchange earlier than it otherwise would — the system block and all older
     history still hit. Bare sends none. */
  if (style.reminder) {
    let line = `[Reply style: ${fill(style.reminder)} Follow this even where earlier replies were written differently. Write in ${userName}'s language.]`;
    /* Read from what was actually sent, so a habit in a message that has
       been trimmed out of the window is not reported. */
    const habits = repetitionNotes(kept);
    if (habits.length) line += `\n[Keep it fresh: ${habits.join(" ")}]`;
    tail.push(line);
  }

  if (tail.length) attach(tail.join("\n"));
  return msgs;
}
