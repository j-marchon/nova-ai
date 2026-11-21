/* ---------- Card Studio engine ----------

   Pure pieces of the AI card writer: the card shapes, the detail levels, the
   prompt builders, the reader that coerces a model's object into a card, and
   the write itself (`writeCard`), which is given its transport so it can run
   inside an activity job or a test alike. The UI is components/AiFill.jsx.

   The prompt wording lives in the small *Section functions below so it can be
   rewritten without touching the plumbing. */

import { ModelJsonError, parseModelJson, repairJsonRequest, stripThinking } from "./json.js";

/* ---------- card shapes ----------

   Every field: key, label (UI), required, about (what it holds, for the
   prompt). A list field has `list` (its item's string sub-fields); `extras`
   lets an item carry further string keys the app displays (age, secret…). */
const GREETING_ITEM = [{ key: "label", label: "Label" }, { key: "text", label: "Text", long: true }];

export const AI_SCHEMAS = {
  personas: {
    kind: "personas",
    label: "persona",
    placeholder: "A jaded war correspondent in her forties, back home after fifteen years abroad and hating it. Chain-smokes, deflects with humour, sleeps badly.",
    fields: [
      { key: "name", label: "Name", required: true, about: "the persona's name." },
      { key: "description", label: "Description", long: true, required: true,
        about: "who this person is, in third person: appearance, voice, history, wants, contradictions and concrete habits that matter in a scene. Prefer observed behaviour to adjective piles; include the details the material invites (age, look, relationships, secrets)." },
    ],
  },
  characters: {
    kind: "characters",
    label: "character",
    placeholder: "The night librarian at a university that keeps a floor nobody admits exists. Dry, unbothered, answers questions with better questions. Knows exactly what is down there and will not say.",
    fields: [
      { key: "name", label: "Name", required: true, about: "the character's name." },
      { key: "tagline", label: "Tagline", required: true, about: "one line that captures who they are." },
      { key: "description", label: "Description", long: true, required: true,
        about: "appearance, voice, personality under pressure, history, desires, flaws and concrete habits; include the details the material invites (age, look, relationships, secrets)." },
      { key: "greetings", label: "Openings", list: GREETING_ITEM, required: true,
        about: "distinct situations that can open a chat. Each item has a short \"label\" and the scene \"text\", written in the character's voice with *asterisks* around actions. Never name or describe the user." },
      { key: "exampleDialogs", label: "Example dialogue", long: true, required: true,
        about: "short exchanges that show their voice in different situations, one line per turn, using the literal placeholders {{user}}: and {{char}}: at the start of each line, separated by \\n." },
    ],
  },
  universes: {
    kind: "universes",
    label: "universe",
    placeholder: "A generation ship four hundred years into a two-thousand-year crossing. The crew has forgotten it is a ship. Three factions, one of which maintains the engines as a religion.",
    fields: [
      { key: "name", label: "Name", required: true, about: "the setting's name." },
      { key: "tagline", label: "Tagline", required: true, about: "one line that captures the setting." },
      { key: "story", label: "Story", long: true, required: true, about: "how the world got here, who holds power, what has changed and what is about to happen." },
      { key: "rules", label: "World rules", long: true, required: true, about: "what is possible, what it costs, what is forbidden, and the tone of scenes." },
      { key: "greetings", label: "Openings", list: GREETING_ITEM, required: true,
        about: "distinct opening situations. Each item has a short \"label\" and the scene \"text\", with *asterisks* around narration. Never name or describe the user." },
      { key: "characters", label: "Characters", extras: true, required: true,
        list: [{ key: "name", label: "Name" }, { key: "description", label: "Description", long: true }, { key: "personality", label: "Personality" }],
        about: "the inhabitants. Each item has \"name\", \"description\" (appearance, role, history, wants, relationships, secrets) and \"personality\" (voice and behaviour under pressure). Extra string keys such as \"age\" or \"secret\" are allowed on an item." },
      { key: "locations", label: "Places", extras: true, required: true,
        list: [{ key: "name", label: "Name" }, { key: "description", label: "Description", long: true }],
        about: "named places. Each item has \"name\" and \"description\" (look, who is there, what scenes can happen there). Extra string keys are allowed on an item." },
    ],
  },
};

/* The old "suggested shape" strings, derived, for anything still reading them. */
const skeleton = (fields) => "{" + fields.map((f) => `"${f.key}": ${f.list ? `[${skeleton(f.list)}]` : '"..."'}`).join(", ") + "}";
for (const schema of Object.values(AI_SCHEMAS)) schema.shape = skeleton(schema.fields);

export const fieldOf = (schema, key) => schema?.fields.find((f) => f.key === key) || null;
const schemaOf = (s) => (typeof s === "string" ? AI_SCHEMAS[s] : s);

/* kept for older callers: the studio has no parameters any more */
export function paramLines() { return []; }

/* ---------- detail levels ----------

   `tokens` is the card's output budget before any thinking allowance;
   `planTokens` is added when the plan is written inline (no reasoning
   channel). `effort` is the reasoning effort asked of providers that take
   one. `targets` are rendered into the prompt, per kind and field; the brief
   always overrides them. */
export const DETAIL_LEVELS = {
  low: {
    id: "low", label: "Low", tokens: 3000, planTokens: 800, effort: "low",
    summary: "a compact card that is quick to read and still fully playable",
    targets: {
      personas: { description: "one tight paragraph, roughly 100–180 words" },
      characters: { tagline: "under 12 words", description: "roughly 150–250 words", greetings: "1 opening, roughly 60–120 words", exampleDialogs: "1–2 short exchanges" },
      universes: { tagline: "under 12 words", story: "roughly 120–200 words", rules: "roughly 60–120 words", greetings: "1 opening", characters: "2–3 characters, a few sentences each", locations: "2–3 places, a few sentences each" },
    },
  },
  medium: {
    id: "medium", label: "Medium", tokens: 8000, planTokens: 1500, effort: "medium",
    summary: "a full card with room for texture and specific detail",
    targets: {
      personas: { description: "roughly 250–400 words, in a few paragraphs" },
      characters: { tagline: "under 15 words", description: "roughly 400–700 words, in several paragraphs", greetings: "2–3 openings in clearly different situations, roughly 100–200 words each", exampleDialogs: "3–4 exchanges in different situations" },
      universes: { tagline: "under 15 words", story: "roughly 300–500 words", rules: "roughly 150–300 words", greetings: "2–3 openings in different places or moments", characters: "4–6 characters with full descriptions", locations: "3–5 places" },
    },
  },
  high: {
    id: "high", label: "High", tokens: 16000, planTokens: 2500, effort: "high",
    summary: "a rich, deep card: layered history, relationships and many hooks for scenes",
    targets: {
      personas: { description: "roughly 500–800 words, in several paragraphs" },
      characters: { tagline: "under 15 words", description: "roughly 800–1200 words, in several paragraphs", greetings: "4–5 openings in clearly different situations, roughly 150–250 words each", exampleDialogs: "5–6 exchanges in different situations and moods" },
      universes: { tagline: "under 15 words", story: "roughly 600–1000 words", rules: "roughly 300–500 words", greetings: "4–5 openings in different places or moments", characters: "7–10 characters with full descriptions", locations: "6–8 places" },
    },
  },
};
export const DETAIL_IDS = ["low", "medium", "high"];
export const detailOf = (id) => DETAIL_LEVELS[id] || DETAIL_LEVELS.medium;

/* What the transport is asked for at this level. */
export function requestOptions(detail, thinking) {
  const level = detailOf(detail);
  return { maxTokens: level.tokens + (thinking ? 0 : level.planTokens), effort: level.effort };
}

/* ---------- prompt sections ---------- */

const keyList = (fields) => fields.map((f) => `"${f.key}"`).join(", ");

function fieldContract(f) {
  const need = f.required ? "required" : "optional";
  if (f.list) {
    const item = "{" + f.list.map((s) => `"${s.key}": string`).join(", ") + "}";
    return `- "${f.key}": array of objects (${need}, at least one item), each ${item}${f.extras ? ", plus optional extra string keys" : ""}. It holds ${f.about}`;
  }
  return `- "${f.key}": string (${need}, non-empty). It holds ${f.about}`;
}

const JSON_RULES =
  "JSON rules: double quotes around every key and every string; inside a string escape a double quote as \\\" and a backslash as \\\\, " +
  "and write a line break as \\n (never a raw line break inside a string); no trailing commas, no comments, no code fences, no null values.";

/* How each kind of card is used once it is saved. A model writes a better
   card when it knows who reads it and for what. */
const USE = {
  personas:
    "A persona is the person the user plays. During a chat its description is given to the AI model that plays everyone else, so that model knows who it is talking to: what they look like, how they come across, what they have been through.",
  characters:
    "During a chat, the description and example dialogue are handed to another AI model as everything it knows about this character, and it plays them from that alone. An opening is the first message the user sees when a chat starts. " +
    "So the description has to give a performer what they need: how this person looks, talks, wants, hides and behaves when pushed, in specifics. The example dialogue has to sound like this character and nobody else.",
  universes:
    "During a chat, the story, rules, places and characters are handed to another AI model as everything it knows about this world, and it plays the world, its narration and every character in it from that alone. An opening is the first message the user sees when a chat starts. " +
    "So the card has to give a narrator what they need: what is going on, what can and cannot happen, where things are, and who lives there with their own aims.",
};

function jobSection(schema) {
  return `You are writing a ${schema.label} card for Nova, a roleplay chat app. The user describes what they want in a brief, and you turn that brief into the finished card. ` +
    "The app loads your answer straight into the card's fields, with no editing in between, so what you return is what gets used.\n\n" +
    `How the card is used: ${USE[schema.kind]}`;
}

function contractSection(schema, fields = schema.fields) {
  return `Output contract. Reply with exactly one JSON object with exactly these keys: ${keyList(fields)}. No other keys at the top level. Types and contents:\n` +
    fields.map(fieldContract).join("\n") + "\n" + JSON_RULES;
}

function briefSection() {
  return "The brief decides. Read it closely before anything else, and again if it is long. " +
    "Whatever it states is fixed: names, ages, looks, history, relationships, personality, tone, setting, how many of something, how long, which language, what to avoid. " +
    "All of it goes into the card as stated. Do not swap a stated detail for a more common one, tone anything down, merge things the brief keeps apart, or leave something out because it is awkward to place. " +
    "If the brief describes someone or something unusual, write exactly that, not the nearest familiar type.\n\n" +
    "Where the brief says nothing, the choice is yours, and it should be a specific one that fits what the brief does say: a particular job, city, habit, grudge or way of speaking, never a placeholder. " +
    "A short brief is an invitation to invent. A long brief is a specification to follow.\n\n" +
    "A count or a length given in the brief overrides the detail targets below. If the brief asks for something no field is meant for, work it into the field where it fits best.";
}

function planSection(thinking, scope = "card") {
  const steps =
    "1. Go through the brief and list every requirement it states, one per line, in its own words. Include the small ones.\n" +
    `2. List what the brief leaves open that the ${scope} needs, and decide each one.\n` +
    `3. Decide what goes in each field of the ${scope}, and note which requirements from step 1 it carries. Every requirement must land somewhere.\n` +
    `4. Write the ${scope}.\n` +
    "5. Check what you wrote against the list from step 1, line by line, and fix anything missing, changed or contradicted before you answer.";
  const why = `Work it out before you write. A ${scope} written straight off drifts from the brief and falls back on stock traits, so plan first.`;
  return thinking
    ? `${why} Do this in your reasoning, before any output:\n${steps}\n` +
      "If you cannot reason privately before answering, put steps 1 to 3 inside <plan>…</plan> at the start of your reply, in plain prose with no curly braces, and write the JSON right after it. The app removes the plan."
    : `${why} Start your reply with a <plan>…</plan> block that does steps 1 to 3 in plain prose (no curly braces, no JSON), then write the JSON object right after it:\n${steps}\n` +
      "The app removes the plan. Nothing else may come before or after the JSON.";
}

function detailSection(schema, detail, fields = schema.fields) {
  const level = detailOf(detail);
  const targets = level.targets[schema.kind] || {};
  const lines = fields.filter((f) => targets[f.key]).map((f) => `- ${f.key}: ${targets[f.key]}`);
  return `Detail level: ${level.label}, ${level.summary}.` +
    (lines.length ? ` Targets, used where the brief does not say:\n${lines.join("\n")}` : "");
}

/* What makes the writing good, limited to the fields being written. */
function styleSection(schema, fields = schema.fields) {
  const has = (key) => fields.some((f) => f.key === key);
  const lines = [
    "Show people through what they do, say and notice. \"Checks the exits before she sits down\" gives a performer more than \"cautious\".",
    "Give people contradictions, limits and wants of their own. Someone with only strengths, or a single mood, leaves nothing to play.",
  ];
  if (has("greetings")) {
    lines.push("An opening starts in the middle of a situation, in a particular place, gives the user something to respond to, and stops where a reply comes naturally. " +
      "It never speaks, acts, thinks or decides for the user and never names or describes them; refer to the user only as {{user}}, if at all.");
  }
  if (has("exampleDialogs")) lines.push("Example dialogue carries the voice: this character's rhythm, vocabulary and evasions, different from how anyone else would say it.");
  if (has("characters")) lines.push("The inhabitants of a world want different things, and some of those wants collide. Give each a reason to act when the user is not looking.");
  if (has("rules")) lines.push("World rules say what things cost and what is forbidden, not only what is possible.");
  lines.push(
    "Keep every name, fact, date and the tone the same across all fields.",
    "Write in English unless the brief asks for another language.",
    "Nothing in the card mentions cards, prompts, AI or these instructions.",
  );
  return "Writing it well:\n" + lines.map((l) => `- ${l}`).join("\n");
}

const clean = (brief) => String(brief || "").replace(/<\/?brief>/gi, "").trim();
const blocks = (...parts) => parts.filter(Boolean).join("\n\n");

function reminder(fields, thinking, label) {
  return `Reply with ${thinking ? "" : "your <plan> block, then "}the one JSON object for this ${label} with exactly the keys ${keyList(fields)}, and nothing else.`;
}

/* ---------- prompts: the whole card ---------- */

export function cardSystem(schema, { detail = "medium", thinking = true } = {}) {
  schema = schemaOf(schema);
  return blocks(jobSection(schema), briefSection(), planSection(thinking), styleSection(schema), detailSection(schema, detail), contractSection(schema));
}

/* `current` is what the form already holds: the brief then says what to change. */
export function cardUser(schema, brief, { current = null, thinking = true } = {}) {
  schema = schemaOf(schema);
  const b = clean(brief);
  if (current) {
    return blocks(
      `The user already has this ${schema.label}:\n<current_card>\n${JSON.stringify(current, null, 2)}\n</current_card>`,
      `Rewrite the whole card. The brief says what to change; keep every name, fact and detail it does not change, and make the writing fuller and more specific.`,
      `<brief>\n${b || "(No changes requested: keep who they are and everything established, and make the card stronger.)"}\n</brief>`,
      reminder(schema.fields, thinking, schema.label),
    );
  }
  return blocks(`<brief>\n${b}\n</brief>`, reminder(schema.fields, thinking, schema.label));
}

/* ---------- prompts: one part ---------- */

export function partSystem(schema, field, { detail = "medium", thinking = true } = {}) {
  schema = schemaOf(schema);
  field = typeof field === "string" ? fieldOf(schema, field) : field;
  return blocks(
    `You are rewriting one part, "${field.key}", of a ${schema.label} card for Nova, a roleplay chat app. The app puts your answer in place of the old part with no editing in between. ` +
      "The new part must fit the rest of the card exactly: same names, facts, tone and setting.\n\n" +
      `How the card is used: ${USE[schema.kind]}`,
    "The user's note (in the brief) decides. Everything it asks for goes into the new part as stated, with nothing toned down or left out. Where the note says nothing, keep the facts of the old part and of the rest of the card.",
    planSection(thinking, "part"),
    styleSection(schema, [field]),
    detailSection(schema, detail, [field]),
    contractSection(schema, [field]),
  );
}

export function partUser(schema, field, note, { current = null, thinking = true } = {}) {
  schema = schemaOf(schema);
  field = typeof field === "string" ? fieldOf(schema, field) : field;
  const { [field.key]: old, ...rest } = current || {};
  const n = clean(note);
  return blocks(
    `The rest of the card:\n${JSON.stringify(rest, null, 2)}`,
    `The current "${field.key}":\n${JSON.stringify(old ?? (field.list ? [] : ""), null, 2)}`,
    `<brief>\n${n || "(No note: make it stronger and more specific, keeping its facts.)"}\n</brief>`,
    reminder([field], thinking, `"${field.key}" part`),
  );
}

/* ---------- prompts: the one follow-up for missing fields ---------- */

export function missingSystem(schema, keys, { detail = "medium" } = {}) {
  schema = schemaOf(schema);
  const fields = keys.map((k) => fieldOf(schema, k)).filter(Boolean);
  return blocks(
    `You are finishing a ${schema.label} card for Nova, a roleplay chat app. Some required fields are missing. Write only those, consistent with the rest of the card and with the brief.`,
    briefSection(),
    styleSection(schema, fields),
    detailSection(schema, detail, fields),
    contractSection(schema, fields),
    "Reply with the JSON object only.",
  );
}

export function missingUser(schema, card, keys, brief) {
  schema = schemaOf(schema);
  return blocks(
    `The card so far:\n<card>\n${JSON.stringify(card, null, 2)}\n</card>`,
    `<brief>\n${clean(brief) || "(none)"}\n</brief>`,
    `Write the missing keys: ${keys.map((k) => `"${k}"`).join(", ")}. Reply with one JSON object holding only those keys.`,
  );
}

/* ---------- reading the model's object ---------- */

const ALIASES = {
  greetings: ["alternate_greetings", "alternateGreetings", "openings"],
  exampleDialogs: ["example_dialogs", "exampleDialogues", "mes_example", "examples"],
  locations: ["places"],
};
const SUB_ALIASES = { text: ["content", "message", "greeting"], label: ["title", "name"] };

const textOf = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : null);

function coerceString(v) {
  const t = textOf(v);
  if (t != null) return t;
  /* a list of lines (example dialogue sent as an array) is joined */
  if (Array.isArray(v) && v.every((x) => textOf(x) != null)) return v.map(textOf).join("\n").trim();
  return undefined;
}

function coerceItem(field, item) {
  const subs = field.list.map((s) => s.key);
  if (textOf(item) != null) {
    const primary = subs.includes("text") ? "text" : subs[0];
    return textOf(item) ? Object.fromEntries(subs.map((s) => [s, s === primary ? textOf(item) : ""])) : null;
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const out = {};
  for (const sub of subs) {
    let v = textOf(item[sub]);
    if (v == null && !field.extras) for (const alias of SUB_ALIASES[sub] || []) { if (textOf(item[alias]) != null) { v = textOf(item[alias]); break; } }
    out[sub] = v ?? "";
  }
  if (field.extras) {
    for (const [k, v] of Object.entries(item)) if (!(k in out) && textOf(v) != null) out[k] = textOf(v);
  }
  return Object.values(out).some((v) => v) ? out : null;
}

function coerceValue(field, v) {
  if (v === undefined || v === null) return undefined;
  if (!field.list) return coerceString(v);
  const rows = Array.isArray(v) ? v : typeof v === "object" || typeof v === "string" ? [v] : [];
  return rows.map((item) => coerceItem(field, item)).filter(Boolean);
}

const rawOf = (src, key) => {
  if (src[key] !== undefined) return src[key];
  for (const alias of ALIASES[key] || []) if (src[alias] !== undefined) return src[alias];
  return undefined;
};

const empty = (field, v) => (field.list ? !Array.isArray(v) || !v.length : !v);

export function missingFields(kind, card) {
  return AI_SCHEMAS[kind].fields.filter((f) => f.required && empty(f, card?.[f.key])).map((f) => f.key);
}

/* { card, missing }: only sane types, trimmed, and the required keys that are missing or empty */
export function coerceCard(kind, out) {
  const schema = AI_SCHEMAS[kind];
  const src = out && typeof out === "object" && !Array.isArray(out) ? out : {};
  const card = {};
  for (const f of schema.fields) {
    const v = coerceValue(f, rawOf(src, f.key));
    if (v !== undefined) card[f.key] = v;
  }
  return { card, missing: missingFields(kind, card) };
}

/* { value, missing }: one part, from {key: …}, a bare array for a list, or a whole card */
export function coercePart(kind, key, out) {
  const field = fieldOf(AI_SCHEMAS[kind], key);
  const raw = Array.isArray(out) && field.list ? out : out && typeof out === "object" ? rawOf(out, key) : undefined;
  const value = coerceValue(field, raw);
  return { value, missing: value === undefined || empty(field, value) };
}

/* The form's values for a whole card: every AI field present, empty when the model gave nothing. */
export function fullCard(kind, card) {
  return Object.fromEntries(AI_SCHEMAS[kind].fields.map((f) => [f.key, card?.[f.key] ?? (f.list ? [] : "")]));
}

/* ---------- the write ----------

   `ask(system, user)` is the transport: it resolves to the parsed object
   (with a non-enumerable `truncated` flag) or throws a ModelJsonError, as
   completeJson does. Resolves to { card, missing } for a whole card, or
   { part, value } for one part. */
export async function writeCard({ kind, brief = "", current = null, part = null, detail = "medium", thinking = true, ask, onPhase, signal }) {
  const schema = AI_SCHEMAS[kind];
  const field = part ? fieldOf(schema, part) : null;
  if (part && !field) throw new Error("Unknown part.");

  const askJson = async (system, user, list) => {
    const call = async (sys, prompt) => {
      try {
        return await ask(sys, prompt);
      } catch (e) {
        if (!(e instanceof ModelJsonError) || !list) throw e;
        let parsed;
        try { parsed = parseModelJson(e.raw, { root: "array" }); } catch { throw e; }
        Object.defineProperty(parsed.value, "truncated", { value: parsed.truncated || !!e.truncated });
        return parsed.value;
      }
    };
    let out, raw, truncated = false;
    try {
      out = await call(system, user);
      truncated = !!out?.truncated;
      raw = JSON.stringify(out);
    } catch (e) {
      if (!(e instanceof ModelJsonError)) throw e;
      raw = e.raw;
      truncated = !!e.truncated;
    }
    if (!out || truncated) {
      onPhase?.("Fixing format…");
      const repair = truncated
        ? { system, user: `${user}\n\nContinue from where you stopped. Return the entire completed JSON, including the existing content, without duplicating it:\n${stripThinking(raw)}` }
        : repairJsonRequest(raw);
      out = await call(repair.system, repair.user);
      if (out?.truncated) throw new Error("The model's reply is still cut off. Try again.");
    }
    signal?.throwIfAborted?.();
    return out;
  };

  if (field) {
    const out = await askJson(partSystem(schema, field, { detail, thinking }), partUser(schema, field, brief, { current, thinking }), !!field.list);
    const { value, missing } = coercePart(kind, field.key, out);
    if (missing) throw new Error("The model did not return that part. Try again.");
    return { part: field.key, value };
  }

  const out = await askJson(cardSystem(schema, { detail, thinking }), cardUser(schema, brief, { current, thinking }), false);
  let { card, missing } = coerceCard(kind, out);
  if (missing.length) {
    /* one targeted follow-up for what is missing, never more */
    onPhase?.("Filling in missing parts…");
    try {
      const more = await askJson(missingSystem(schema, missing, { detail }), missingUser(schema, card, missing, brief), false);
      const extra = coerceCard(kind, more).card;
      for (const key of missing) if (!empty(fieldOf(schema, key), extra[key])) card = { ...card, [key]: extra[key] };
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      /* the card in hand is still worth keeping */
    }
    missing = missingFields(kind, card);
  }
  return { card, missing };
}

/* ---------- jobs ---------- */

/* A studio job belongs to one kind and one item: owner.itemId is the card
   being rewritten, or null for a new one. */
export const cardJobOf = (j, kind, itemId) => j.owner?.cardKind === kind && (j.owner.itemId || null) === (itemId || null);

/* A finished job's result as form values: { part, values }. Results from
   writeCard are tagged; anything else (an older job) is read as a card. */
export function resultFill(kind, result) {
  if (result?.studio && result.part) return { part: result.part, values: { [result.part]: result.value } };
  const card = result?.studio ? result.card : coerceCard(kind, result).card;
  return { part: null, values: fullCard(kind, card) };
}
