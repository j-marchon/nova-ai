/* Card Studio uses the selected writing prompt with the schema of the open form. */
import { DESCRIPTION, PERSONALITY, dialogueText, profileText, strings } from "./characterTemplate.js";
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
      { key: "description", label: "Description", sections: DESCRIPTION, required: true, about: "the character's profile" },
      { key: "personality", label: "Personality", sections: PERSONALITY, required: true, about: "what drives this person" },
      { key: "scenario", label: "Scenario", required: true, about: "the situation and relationship at the start of play" },
      { key: "greetings", label: "Openings", list: GREETING_ITEM, required: true,
        about: "the first message, then any alternate openings, each with a label and scene text" },
      { key: "exampleDialogs", label: "Example dialogue", entries: true, required: true, about: "one sample of the character's speech per entry" },
      { key: "creatorNotes", label: "Creator notes", about: "optional notes for the player" },
      { key: "systemPrompt", label: "System prompt", about: "card-specific instructions only if requested" },
      { key: "postHistoryInstructions", label: "Post-history instructions", about: "instructions after chat history only if requested" },
      { key: "tags", label: "Tags", entries: true, about: "short searchable tags" },
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

export const fieldOf = (schema, key) => schema?.fields.find((f) => f.key === key) || null;
const schemaOf = (s) => (typeof s === "string" ? AI_SCHEMAS[s] : s);
const bundled = import.meta.glob("../prompts/card-studio/*.txt", { eager: true, query: "?raw", import: "default" });
export const STUDIO_PROMPTS = Object.fromEntries(Object.entries(bundled).map(([path, text]) =>
  [path.split("/").pop().slice(0, -4), text.trim()]));
export const DEFAULT_STUDIO_PROMPT = STUDIO_PROMPTS.default;

const clean = (brief) => String(brief || "").replace(/<\/?brief>/gi, "").trim();
const blocks = (...parts) => parts.filter(Boolean).join("\n\n");

function fieldShape(field) {
  if (field.sections) return Object.fromEntries(field.sections.map((f) => [f.key, f.entry ? [f.label] : f.label]));
  if (field.list) return [Object.fromEntries(field.list.map((f) => [f.key, "text"]))];
  return field.entries ? ["text"] : "text";
}

function systemFor(fields, task, { prompt, interview } = {}) {
  const shape = Object.fromEntries(fields.map((f) => [f.key, fieldShape(f)]));
  return blocks(
    prompt?.trim() || DEFAULT_STUDIO_PROMPT,
    task,
    `Output contract. Return one JSON object in this shape:\n${JSON.stringify(shape, null, 2)}`,
    fields.map((f) => `${f.key}: ${f.about}${f.extras ? " Additional string fields are welcome on each item." : ""}`).join("\n"),
    interview
      ? 'If a choice in the brief genuinely needs the author, you may instead return {"questions":["an open question"]}. Ask up to three in one round. Otherwise return the finished work now.'
      : "Return the finished work now. Resolve open details from the brief without asking questions.",
  );
}

export function cardSystem(schema, options) {
  schema = schemaOf(schema);
  return systemFor(schema.fields, `Write a ${schema.label} card for Nova.`, options);
}

export function cardUser(schema, brief, { current = null } = {}) {
  return blocks(
    current && `Revise this ${schemaOf(schema).label} card. Keep established details unless the brief changes them.\n<current_card>\n${JSON.stringify(current, null, 2)}\n</current_card>`,
    `<brief>\n${clean(brief)}\n</brief>`,
  );
}

export function partSystem(schema, field, options) {
  schema = schemaOf(schema);
  field = typeof field === "string" ? fieldOf(schema, field) : field;
  return systemFor([field], `You are rewriting one part of a ${schema.label} card. Keep it consistent with the other fields.`, options);
}

export function partUser(schema, field, note, { current = null } = {}) {
  field = typeof field === "string" ? fieldOf(schemaOf(schema), field) : field;
  const { [field.key]: old, ...rest } = current || {};
  return blocks(
    `The rest of the card:\n${JSON.stringify(rest, null, 2)}`,
    `The current "${field.key}":\n${JSON.stringify(old ?? "", null, 2)}`,
    `<brief>\n${clean(note)}\n</brief>`,
  );
}

function missingSystem(schema, keys, options) {
  return systemFor(keys.map((k) => fieldOf(schema, k)),
    `You are finishing a ${schema.label} card. Fill the missing fields using the brief and the card so far.`, options);
}

function missingUser(card, keys, brief) {
  return blocks(`The card so far:\n${JSON.stringify(card, null, 2)}`,
    `<brief>\n${clean(brief)}\n</brief>`, `Write the missing keys: ${keys.map((k) => JSON.stringify(k)).join(", ")}.`);
}

/* ---------- reading the model's object ---------- */

const ALIASES = {
  greetings: ["alternate_greetings", "alternateGreetings", "openings"],
  creatorNotes: ["creator_notes"],
  systemPrompt: ["system_prompt"],
  postHistoryInstructions: ["post_history_instructions"],
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
  if (field.sections) return profileText(field.sections, v).trim() || undefined;
  if (field.key === "exampleDialogs") return dialogueText(v).trim();
  if (field.entries) return Array.isArray(v) ? strings(v) : undefined;
  if (!field.list) return coerceString(v);
  const rows = Array.isArray(v) ? v : typeof v === "object" || typeof v === "string" ? [v] : [];
  return rows.map((item) => coerceItem(field, item)).filter(Boolean);
}

function cardSource(kind, out) {
  if (kind === "characters" && /^chara_card_v[23]$/.test(out?.spec) && out.data && typeof out.data === "object") return out.data;
  return out;
}

const rawOf = (src, key) => {
  if (src[key] !== undefined) return src[key];
  if (key === "greetings" && typeof src.first_mes === "string") {
    return [src.first_mes, ...(Array.isArray(src.alternate_greetings) ? src.alternate_greetings : [])];
  }
  for (const alias of ALIASES[key] || []) if (src[alias] !== undefined) return src[alias];
  return undefined;
};

const empty = (v) => v == null || v.length === 0;

export function missingFields(kind, card) {
  return AI_SCHEMAS[kind].fields.filter((f) => f.required && empty(card?.[f.key])).map((f) => f.key);
}

/* { card, missing }: only sane types, trimmed, and the required keys that are missing or empty */
export function coerceCard(kind, out) {
  const schema = AI_SCHEMAS[kind];
  out = cardSource(kind, out);
  const src = out && typeof out === "object" && !Array.isArray(out) ? out : {};
  const card = {};
  for (const f of schema.fields) {
    const v = coerceValue(f, rawOf(src, f.key));
    if (v !== undefined && !(f.required && empty(v))) card[f.key] = v;
  }
  return { card, missing: missingFields(kind, card) };
}

/* { value, missing }: one part, from {key: …}, a bare array for a list, or a whole card */
export function coercePart(kind, key, out) {
  const field = fieldOf(AI_SCHEMAS[kind], key);
  out = cardSource(kind, out);
  const raw = Array.isArray(out) && (field.list || field.entries) ? out : out && typeof out === "object" ? rawOf(out, key) : undefined;
  const value = coerceValue(field, raw);
  return { value, missing: value === undefined || (field.required && empty(value)) };
}

/* The form's values for a whole card: every AI field present, empty when the model gave nothing. */
export function fullCard(kind, card) {
  return Object.fromEntries(AI_SCHEMAS[kind].fields.map((f) => [f.key, card?.[f.key] ?? (f.list || f.key === "tags" ? [] : "")]));
}

/* ---------- the write ----------

   `ask(system, user)` is the transport: it resolves to the parsed object
   (with a non-enumerable `truncated` flag) or throws a ModelJsonError, as
   completeJson does. Returns questions, a card with its missing fields, or one rewritten part. */
export async function writeCard({ kind, brief = "", current = null, part = null, prompt, interview = false, clarifications, ask, onPhase, signal }) {
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

  const options = { prompt, interview: interview && !clarifications };
  const context = { current };
  const answers = clarifications && `Interview answers (unanswered choices are yours):\n${JSON.stringify(clarifications)}`;
  const user = field ? partUser(schema, field, brief, context) : cardUser(schema, brief, context);
  const out = await askJson(field ? partSystem(schema, field, options) : cardSystem(schema, options),
    blocks(user, answers), !!(field?.list || field?.entries));
  const questions = strings(out?.questions).slice(0, 3);
  if (options.interview && questions.length && !schema.fields.some((f) => rawOf(out, f.key) !== undefined)) return { questions };
  if (field) {
    const { value, missing } = coercePart(kind, field.key, out);
    if (missing) throw new Error("The model did not return that part. Try again.");
    return { part: field.key, value };
  }

  let { card, missing } = coerceCard(kind, out);
  if (missing.length) {
    /* one targeted follow-up for what is missing, never more */
    onPhase?.("Filling in missing parts…");
    try {
      const more = await askJson(missingSystem(schema, missing, { prompt }), blocks(missingUser({ ...current, ...card }, missing, brief), answers), false);
      const extra = coerceCard(kind, more).card;
      for (const key of missing) if (!empty(extra[key])) card = { ...card, [key]: extra[key] };
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      /* the card in hand is still worth keeping */
    }
    missing = missingFields(kind, card);
  }
  if (!Object.keys(card).length) throw new Error("The model returned no card fields. Try again.");
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
  return { part: null, values: kind === "characters" ? card : fullCard(kind, card) };
}
