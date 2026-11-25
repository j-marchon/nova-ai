/* ---------- reply styles ----------

   Nova ships no prompt of its own. "No prompt" sends the card, the chat and
   Nova's scene machinery and nothing else; "Your prompts" adds one you wrote
   or imported (a SillyTavern preset included). */

import { activeModel } from "./api.js";
import { readTavernPreset } from "./tavern.js";

export const STYLE_PRESETS = [
  { id: "neutral", name: "No prompt", desc: "Only your card and the conversation", bare: true, frame: "a roleplay", limit: "", body: "", temperature: 1, maxTokens: 1000 },
  { id: "custom", name: "Your prompts", desc: "Write or import your own instructions", custom: true, temperature: 1, maxTokens: 1000 },
];

export const DEFAULT_STYLE = "neutral";

export function activePreset(settings) {
  return STYLE_PRESETS.find((p) => p.id === settings?.stylePreset) || STYLE_PRESETS[0];
}

/* ---------- fine tuning ----------

   Per style, and off by default. Off, a style samples exactly as it always
   has — its own temperature and cap, plus the light penalties and min_p that
   streamChat adds. On, the values below replace all of that, and nothing
   else is added behind them: what the panel shows is what is sent.

   That last part is the point. A preset from the community comes with its
   own numbers ("penalties at zero, let it cook"), and a hidden 0.3 frequency
   penalty underneath would make it impossible to tell whether the preset or
   the app is responsible for what comes out.

   Top K at 0 means off and is not sent. Penalties at their neutral value
   (0, or 1 for repetition) are sent anyway, so a provider's own default
   cannot sneak back in. */
export const MAX_REPLY_TOKENS = 128000;
export const STYLE_TUNING = [
  { key: "temperature", label: "Temperature", min: 0, max: 2, step: 0.01 },
  { key: "top_p", label: "Top P", min: 0, max: 1, step: 0.01 },
  { key: "top_k", label: "Top K", min: 0, max: 200, step: 1, hint: "0 = off" },
  { key: "min_p", label: "Min P", min: 0, max: 1, step: 0.01, hint: "0 = off" },
  { key: "frequency_penalty", label: "Frequency penalty", min: -2, max: 2, step: 0.01, hint: "0 = off" },
  { key: "presence_penalty", label: "Presence penalty", min: -2, max: 2, step: 0.01, hint: "0 = off" },
  { key: "repetition_penalty", label: "Repetition penalty", min: 0.5, max: 2, step: 0.01, hint: "1 = off" },
  { key: "max_tokens", label: "Max reply length", min: 100, max: MAX_REPLY_TOKENS, step: 50, hint: "tokens" },
];

/* ---------- how long a reply may be ----------

   The slider and every import stop at the largest reply any model here
   writes; what is sent is held to the selected model's own limit. The table
   is the published output limits by family, most specific first. */
const OUTPUT_LIMITS = [
  [/gemini-(2\.5|[3-9])/i, 65536],
  [/gemini/i, 8192],
  [/claude-(opus|sonnet|haiku)-(4|5)|(^|\/)claude-(opus|sonnet|haiku)-(4|5)|opus-4|sonnet-4|haiku-4|opus-5|sonnet-5|haiku-5|fable/i, 64000],
  [/claude-3-7|sonnet-3\.7/i, 64000],
  [/claude/i, 8192],
  [/gpt-5|o[1-9](-|$)|gpt-oss/i, 128000],
  [/gpt-4\.1/i, 32768],
  [/gpt-4o|gpt-4-turbo|gpt-4/i, 16384],
  [/deepseek.*(reason|r1)/i, 64000],
  [/deepseek/i, 8192],
  [/grok/i, 32768],
  [/qwen|glm|kimi|minimax|mimo|mistral|llama|gemma|nemotron/i, 32768],
];
export function outputLimit(model) {
  const id = String(model || "");
  for (const [re, n] of OUTPUT_LIMITS) if (re.test(id)) return n;
  return 32768;
}

/* The text-generation samplers, sent only where they are understood (see
   attachAdvancedSamplers in api.js). Off at their default. */
export const ADVANCED_TUNING = [
  { key: "dry_multiplier", label: "DRY Multiplier", min: 0, max: 2, step: 0.01, hint: "0 = off" },
  { key: "dry_base", label: "DRY Base", min: 1, max: 3, step: 0.01 },
  { key: "dry_allowed_length", label: "DRY Allowed Length", min: 1, max: 20, step: 1 },
  { key: "top_a", label: "Top A", min: 0, max: 1, step: 0.01, hint: "0 = off" },
  { key: "mirostat_mode", label: "Mirostat Mode", min: 0, max: 2, step: 1, hint: "0 = off, 1 = v1, 2 = v2" },
  { key: "mirostat_tau", label: "Mirostat Tau", min: 0, max: 10, step: 0.1, hint: "target entropy" },
  { key: "mirostat_eta", label: "Mirostat Eta", min: 0, max: 1, step: 0.01, hint: "learning rate" },
  { key: "cfg_scale", label: "CFG Scale", min: 1, max: 5, step: 0.1, hint: "1 = off" },
  { key: "dynatemp_min", label: "Dynamic Temp Min", min: 0, max: 2, step: 0.01, hint: "0 = off" },
  { key: "dynatemp_max", label: "Dynamic Temp Max", min: 0, max: 2, step: 0.01, hint: "0 = off" },
  { key: "dynatemp_exponent", label: "Dynamic Temp Exponent", min: 0.1, max: 5, step: 0.1 },
  { key: "xtc_threshold", label: "XTC threshold", min: 0, max: 0.5, step: 0.01 },
  { key: "xtc_probability", label: "XTC probability", min: 0, max: 1, step: 0.01, hint: "0 = off" },
  { key: "typical_p", label: "Typical P", min: 0, max: 1, step: 0.01, hint: "1 = off" },
  { key: "tfs", label: "Tail free sampling", min: 0, max: 1, step: 0.01, hint: "1 = off" },
  { key: "smoothing_factor", label: "Smoothing factor", min: 0, max: 10, step: 0.01, hint: "0 = off" },
  { key: "smoothing_curve", label: "Smoothing curve", min: 1, max: 10, step: 0.01 },
  { key: "nsigma", label: "Top n sigma", min: 0, max: 5, step: 0.01, hint: "0 = off" },
];

export const DEFAULT_ADVANCED_SAMPLERS = {
  dry_multiplier: 0,
  dry_base: 1.75,
  dry_allowed_length: 2,
  dry_sequence_breakers: ['\n', ':', '"', '*'],
  top_a: 0,
  mirostat_mode: 0,
  mirostat_tau: 5.0,
  mirostat_eta: 0.1,
  cfg_scale: 1.0,
  dynatemp_min: 0,
  dynatemp_max: 0,
  dynatemp_exponent: 1.0,
  xtc_threshold: 0.1,
  xtc_probability: 0,
  typical_p: 1,
  tfs: 1,
  smoothing_factor: 0,
  smoothing_curve: 1,
  nsigma: 0,
};

/* the samplers above that are read and bounded the same plain way */
const PLAIN_SAMPLERS = ["xtc_threshold", "xtc_probability", "typical_p", "tfs", "smoothing_factor", "smoothing_curve", "nsigma"];

export function normalizeAdvancedSamplers(src = {}) {
  const num = (v, min, max, def) => {
    if (v === "" || v == null) return def;
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };

  const dry_multiplier = num(src.dry_multiplier, 0, 2.0, 0);
  const dry_base = num(src.dry_base, 1.0, 3.0, 1.75);
  const dry_allowed_length = Math.max(1, Math.round(num(src.dry_allowed_length, 1, 20, 2)));
  const dry_sequence_breakers = Array.isArray(src.dry_sequence_breakers) && src.dry_sequence_breakers.length
    ? src.dry_sequence_breakers.map(String)
    : ['\n', ':', '"', '*'];
  const top_a = num(src.top_a, 0, 1.0, 0);
  const mMode = Math.round(Number(src.mirostat_mode));
  const mirostat_mode = [0, 1, 2].includes(mMode) ? mMode : 0;
  const mirostat_tau = num(src.mirostat_tau, 0, 10.0, 5.0);
  const mirostat_eta = num(src.mirostat_eta, 0, 1.0, 0.1);
  const cfg_scale = num(src.cfg_scale, 1.0, 5.0, 1.0);
  const dynatemp_min = num(src.dynatemp_min, 0, 2.0, 0);
  const dynatemp_max = num(src.dynatemp_max, 0, 2.0, 0);
  const dynatemp_exponent = num(src.dynatemp_exponent, 0.1, 5.0, 1.0);

  return {
    dry_multiplier,
    dry_base,
    dry_allowed_length,
    dry_sequence_breakers,
    top_a,
    mirostat_mode,
    mirostat_tau,
    mirostat_eta,
    cfg_scale,
    dynatemp_min,
    dynatemp_max,
    dynatemp_exponent,
    ...Object.fromEntries(PLAIN_SAMPLERS.map((k) => {
      const f = ADVANCED_TUNING.find((x) => x.key === k);
      return [k, num(src[k], f.min, f.max, DEFAULT_ADVANCED_SAMPLERS[k])];
    })),
  };
}


/* What a style sends with fine tuning off, written in fine-tuning terms, so
   switching it on starts from where the style already was. An imported
   prompt brings its whole sampler. */
export function styleDefaults(preset) {
  const base = {
    temperature: preset.temperature,
    top_p: 1,
    top_k: 0,
    min_p: preset.bare ? 0 : 0.05,
    frequency_penalty: preset.bare ? 0 : 0.3,
    presence_penalty: preset.bare ? 0 : 0.2,
    repetition_penalty: 1,
    max_tokens: preset.maxTokens,
    ...DEFAULT_ADVANCED_SAMPLERS,
  };
  if (preset.sampler) return { ...base, ...preset.sampler };
  return base;
}

/* Tuning is saved per model, and within a model per style:

     settings.modelTuning = { [model id]: { [style id]: { on, temperature, … } } }

   One sampler does not suit every model, so switching models switches to
   that model's own values, and a model never tuned starts from the style's
   defaults. */
export const tuningKey = (settings) => activeModel(settings) || "";

export function savedTuning(settings, presetId) {
  return settings?.modelTuning?.[tuningKey(settings)]?.[presetId] || null;
}

/* settings with one style's tuning for the current model replaced */
export function withTuning(settings, presetId, tune) {
  const all = settings.modelTuning || {};
  const key = tuningKey(settings);
  return { ...settings, modelTuning: { ...all, [key]: { ...(all[key] || {}), [presetId]: tune } } };
}

/* Thinking on or off, remembered per model like the tuning above. A model
   never switched starts from the old app-wide switch. */
export const thinkingOn = (settings) => !!(settings?.modelThinking?.[tuningKey(settings)] ?? settings?.thinking);

export const withThinking = (settings, on) =>
  ({ ...settings, modelThinking: { ...(settings.modelThinking || {}), [tuningKey(settings)]: on } });

/* A style's saved tuning over its defaults, with anything unreadable or out
   of range put back in bounds. */
export function styleTuning(settings, preset) {
  const saved = savedTuning(settings, preset.id) || {};
  /* strict: OpenRouter only, route to providers that honour every value */
  const out = { on: !!saved.on, strict: !!saved.strict };
  const def = styleDefaults(preset);
  const cap = outputLimit(activeModel(settings));
  for (const f of [...STYLE_TUNING, ...ADVANCED_TUNING]) {
    const v = Number(saved[f.key]);
    const max = f.key === "max_tokens" ? cap : f.max;
    out[f.key] = Number.isFinite(v) && saved[f.key] !== "" && saved[f.key] != null
      ? Math.min(max, Math.max(f.min, f.step >= 1 ? Math.round(v) : v))
      : (def[f.key] ?? f.default ?? 0);
  }
  if (out.max_tokens > cap) out.max_tokens = cap;
  if (Array.isArray(saved.dry_sequence_breakers) && saved.dry_sequence_breakers.length) {
    out.dry_sequence_breakers = saved.dry_sequence_breakers.map(String);
  } else {
    out.dry_sequence_breakers = def.dry_sequence_breakers || ['\n', ':', '"', '*'];
  }
  return out;
}

/* ---------- your prompts ----------

   Written or imported, kept in settings.customStyles, so they are saved on
   the device with everything else and travel with a backup. */
export function customStyleList(settings) {
  return Array.isArray(settings?.customStyles) ? settings.customStyles : [];
}

/* The selected custom prompt, or null when it has no text to send. */
export function activeCustomStyle(settings) {
  const list = customStyleList(settings);
  const c = list.find((x) => x.id === settings?.customStyleId) || list[0];
  return c && c.text?.trim() ? c : null;
}

/* The active style with Custom's sampler filled in from the picked prompt,
   which may carry its own temperature and cap. Fine tuning starts from, and
   resets to, these. */
export function samplerPreset(settings) {
  const p = activePreset(settings);
  if (!p.custom) return p;
  const c = activeCustomStyle(settings);
  return {
    ...p,
    temperature: c?.sampler?.temperature ?? c?.temperature ?? p.temperature,
    maxTokens: c?.sampler?.max_tokens ?? c?.maxTokens ?? p.maxTokens,
    sampler: c?.sampler,
  };
}

/* The name a chat shows for its style: the custom prompt's own name. */
export function styleLabel(settings) {
  const p = activePreset(settings);
  if (!p.custom) return p.name;
  return activeCustomStyle(settings)?.name || p.name;
}

/* ---------- generation settings in an import ----------

   Community presets carry their sampler as JSON: at the top level of a
   SillyTavern preset, in a block of its own ({ "sampler": {…} }), or as a
   JSON object sitting on top of a plain-text prompt. Every name below is
   read, in fine-tuning terms, and anything out of range is put back in
   bounds. Before this only the temperature and the cap were kept, and Top P,
   Top K, Min P and the penalties were silently dropped. */
const SAMPLER_NAMES = {
  temperature: ["temperature", "temp"],
  top_p: ["top_p", "topP", "top-p"],
  top_k: ["top_k", "topK", "top-k"],
  min_p: ["min_p", "minP", "min-p"],
  frequency_penalty: ["frequency_penalty", "frequencyPenalty", "freq_pen", "freq_penalty"],
  presence_penalty: ["presence_penalty", "presencePenalty", "presence_pen", "pres_pen"],
  repetition_penalty: ["repetition_penalty", "repetitionPenalty", "rep_pen", "repeat_penalty"],
  max_tokens: ["max_tokens", "maxTokens", "openai_max_tokens", "max_new_tokens", "max_output_tokens", "maxOutputTokens", "genamt"],
  dry_multiplier: ["dry_multiplier", "dryMultiplier", "dry_mult"],
  dry_base: ["dry_base", "dryBase"],
  dry_allowed_length: ["dry_allowed_length", "dryAllowedLength", "dry_length"],
  dry_sequence_breakers: ["dry_sequence_breakers", "drySequenceBreakers", "dry_breakers"],
  top_a: ["top_a", "topA", "top-a"],
  mirostat_mode: ["mirostat_mode", "mirostatMode", "mirostat"],
  mirostat_tau: ["mirostat_tau", "mirostatTau", "tau"],
  mirostat_eta: ["mirostat_eta", "mirostatEta", "eta"],
  cfg_scale: ["cfg_scale", "cfgScale", "cfg", "guidance_scale"],
  dynatemp_min: ["dynatemp_min", "dynatempMin", "dynamic_temperature_min", "dynamicTempMin"],
  dynatemp_max: ["dynatemp_max", "dynatempMax", "dynamic_temperature_max", "dynamicTempMax"],
  dynatemp_exponent: ["dynatemp_exponent", "dynatempExponent", "dynamic_temperature_exponent", "dynamicTempExponent"],
  typical_p: ["typical_p", "typical"],
  nsigma: ["nsigma", "top_n_sigma", "top_nsigma"],
};
const SAMPLER_BLOCKS = ["sampler", "samplers", "settings", "generation_settings", "gen_settings", "generation_config", "generationConfig", "parameters", "params"];

/* The sampler values found in one object, or null. A nested block wins over
   the same name at the top level, since it is the more deliberate of the two. */
export function readSampler(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const sources = [o, ...SAMPLER_BLOCKS.map((k) => o[k]).filter((v) => v && typeof v === "object" && !Array.isArray(v))];
  const out = {};
  for (const f of [...STYLE_TUNING, ...ADVANCED_TUNING]) {
    for (const src of sources) {
      for (const name of (SAMPLER_NAMES[f.key] || [f.key])) {
        const raw = src[name];
        if (raw === "" || raw == null || typeof raw === "boolean") continue;
        const v = Number(raw);
        if (Number.isFinite(v)) out[f.key] = Math.min(f.max, Math.max(f.min, f.step >= 1 ? Math.round(v) : v));
      }
    }
  }
  for (const src of sources) {
    for (const name of (SAMPLER_NAMES.dry_sequence_breakers || [])) {
      const raw = src[name];
      if (Array.isArray(raw) && raw.length) {
        out.dry_sequence_breakers = raw.map(String);
      } else if (typeof raw === "string" && raw.trim()) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) out.dry_sequence_breakers = parsed.map(String);
        } catch {
          out.dry_sequence_breakers = raw.split(",").map((s) => s.trim()).filter(Boolean);
        }
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

/* A found sampler made whole. Anything the preset does not name is off, so
   the app's own light penalties do not sit underneath numbers somebody chose
   on purpose. */
export function fullSampler(found) {
  const custom = STYLE_PRESETS.find((p) => p.custom);
  return {
    temperature: custom.temperature,
    top_p: 1,
    top_k: 0,
    min_p: 0,
    frequency_penalty: 0,
    presence_penalty: 0,
    repetition_penalty: 1,
    max_tokens: custom.maxTokens,
    ...found,
  };
}

/* A JSON object (bare, or in a ```json fence) at the very top of a text,
   and the text after it. null when the text does not open with one. */
export function splitLeadingJson(text) {
  const fence = /^```(?:json)?[ \t]*\n([\s\S]*?)\n```[ \t]*(?:\n|$)/i.exec(text);
  if (fence) {
    try {
      const json = JSON.parse(fence[1]);
      if (json && typeof json === "object" && !Array.isArray(json)) return { json, rest: text.slice(fence[0].length).trim() };
    } catch { /* not JSON after all */ }
    return null;
  }
  if (text[0] !== "{") return null;
  /* the closing brace of the first object, strings skipped */
  let depth = 0;
  let str = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (str) {
      if (ch === "\\") i++;
      else if (ch === '"') str = false;
    } else if (ch === '"') str = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const json = JSON.parse(text.slice(0, i + 1));
        return { json, rest: text.slice(i + 1).trim() };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/* Reads an import, either pasted or from a file, into a list of prompts.

   JSON is tried first and falls back to plain text, so a .txt that happens to
   start with a brace still imports. Shapes understood:
     - Nova's own: { name, prompt | text | content, temperature?, maxTokens?,
       sampler? }, or an array of them, or { styles: [...] }
     - a SillyTavern chat-completion preset: the enabled entries of prompts[],
       in prompt_order when it has one, each in its place (`text`, `post`,
       `inject`), its prompt-only and display regex scripts (`regex`,
       `display`) and its whole
       sampler; see tavern.js
     - a SillyTavern system prompt: { name, content }
     - a JSON string
     - a JSON object of generation settings on top of a plain-text prompt
   Anything else is taken as the prompt text itself.

   Each prompt keeps its generation settings as `sampler` (see readSampler),
   which is what it sends while fine tuning is off and what fine tuning
   starts from.

   allowEmpty: a JSON holding only generation settings comes back as one
   entry with no text, for applying to a prompt already being edited. */
export function parseStyleImport(raw, fallbackName = "Imported prompt", { allowEmpty = false } = {}) {
  let text = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("There is no text to import.");

  let json;
  /* settings on top of the prompt; the text under them becomes the prompt */
  let header = null;
  if (/^[\[{"]/.test(text)) {
    try { json = JSON.parse(text); } catch { json = undefined; }
  }
  if (json === undefined) {
    const lead = splitLeadingJson(text);
    if (lead && lead.rest) {
      header = lead.json;
      text = lead.rest;
    }
  }
  /* A sampler beyond the temperature and cap is kept whole. One that names
     only those two keeps the old shape, so the style's light defaults stay
     underneath as they always have. */
  const finish = (x) => {
    const r = { name: x.name, text: x.text };
    for (const k of ["post", "inject", "regex", "display", "saved", "layout"]) if (x[k]?.length) r[k] = x[k];
    for (const k of ["modes", "formats"]) if (x[k] && Object.keys(x[k]).length) r[k] = x[k];
    if (x.sampler && Object.keys(x.sampler).some((k) => k !== "temperature" && k !== "max_tokens")) {
      r.sampler = fullSampler(x.sampler);
      return r;
    }
    const temperature = x.sampler?.temperature ?? x.temperature;
    const maxTokens = x.sampler?.max_tokens ?? x.maxTokens;
    /* kept only when sensible, so a stray field cannot wreck the sampler */
    if (temperature != null && temperature >= 0 && temperature <= 2) r.temperature = temperature;
    if (maxTokens != null && maxTokens >= 50 && maxTokens <= MAX_REPLY_TOKENS) r.maxTokens = Math.round(maxTokens);
    return r;
  };

  if (json === undefined) {
    const name = String(header?.name || header?.title || "").trim() || fallbackName;
    return [finish({ name, text, sampler: readSampler(header) })];
  }

  const num = (v) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : undefined);
  const one = (o, i) => {
    if (typeof o === "string") return { name: fallbackName, text: o.trim() };
    if (!o || typeof o !== "object") return null;
    const name = String(o.name || o.title || "").trim() || (i ? `${fallbackName} ${i + 1}` : fallbackName);
    const temperature = num(o.temperature);
    const maxTokens = num(o.maxTokens ?? o.max_tokens ?? o.openai_max_tokens ?? o.genamt);
    const sampler = readSampler(o);

    /* SillyTavern preset: each block where it belongs, see tavern.js */
    if (Array.isArray(o.prompts)) {
      const st = readTavernPreset(o);
      const extras = {
        ...(st.post ? { post: st.post } : {}),
        ...(st.inject.length ? { inject: st.inject } : {}),
        ...(st.regex.length ? { regex: st.regex } : {}),
        ...(st.display.length ? { display: st.display } : {}),
        ...(st.saved.length ? { saved: st.saved } : {}),
        ...(st.layout ? { layout: st.layout } : {}),
        ...(st.modes ? { modes: st.modes } : {}),
        ...(st.formats ? { formats: st.formats } : {}),
      };
      return st.text ? { name, text: st.text, temperature, maxTokens, sampler, ...extras } : { name, text: "", sampler };
    }

    const body = [o.prompt, o.text, o.content, o.system_prompt, o.main_prompt, o.story_string]
      .find((v) => typeof v === "string" && v.trim());
    return { name, text: body ? body.trim() : "", temperature, maxTokens, sampler };
  };

  const items = Array.isArray(json) ? json : Array.isArray(json?.styles) ? json.styles : [json];
  const all = items.map(one).filter(Boolean);
  let out = all.filter((x) => x.text);
  if (!out.length && allowEmpty) out = all.filter((x) => x.sampler).slice(0, 1);
  if (!out.length) throw new Error("That JSON has no prompt in it. Expected a \"prompt\", \"text\" or \"content\" field, or a SillyTavern preset.");
  return out.map(finish);
}

/* The [Style] text for a built-in style. "No prompt" sends nothing. */
export function stylePrompt(preset) {
  return preset.bare ? "" : (preset.body || "").trim();
}

/* ---------- generation parameters ---------- */

/* Everything a request takes from the selected style. Temperature and the
   cap come from the style, unless that style's fine tuning is on — then
   `tuned` carries the whole sampler and replaces the style's own. */
export function genParams(settings) {
  const p = genParamsOf(settings);
  const cap = outputLimit(activeModel(settings));
  if (p.max_tokens > cap) return { ...p, max_tokens: cap, ...(p.tuned ? { tuned: { ...p.tuned, max_tokens: cap } } : {}) };
  return p;
}

function genParamsOf(settings) {
  const preset = activePreset(settings);
  if (preset.custom) {
    const c = activeCustomStyle(settings);
    /* An empty prompt sends nothing useful, so it writes as the default
       until text is added. The picker says so; it is never silent. */
    if (!c) return genParamsOf({ ...settings, stylePreset: DEFAULT_STYLE });
    const sp = samplerPreset(settings);
    const tune = styleTuning(settings, sp);
    /* A prompt that brought its own sampler sends it as it is, fine tuning
       off or not, so the app's own light penalties stay out from under
       numbers somebody chose. */
    const rawTuned = tune.on ? tune : sp.sampler ? { ...styleDefaults(sp), on: false, strict: false } : null;
    const advanced = normalizeAdvancedSamplers(tune.on ? tune : sp.sampler || {});
    const tuned = rawTuned ? { ...rawTuned, ...advanced } : null;
    return {
      tuned,
      /* the post-history block, sent at the end of the prompt */
      post: c.post?.trim() || "",
      /* an imported SillyTavern preset's deeper in-chat blocks and its
         prompt-only regex scripts (tavern.js) */
      inject: Array.isArray(c.inject) ? c.inject : [],
      regex: Array.isArray(c.regex) ? c.regex : [],
      /* and its display scripts, run on the bubbles (html.js) */
      display: Array.isArray(c.display) ? c.display : [],
      /* scripts that rewrite a reply as it is saved, the preset's own order
         of card sections, what it says for Impersonate and Continue */
      saved: Array.isArray(c.saved) ? c.saved : [],
      layout: Array.isArray(c.layout) ? c.layout : null,
      modes: c.modes || null,
      formats: c.formats || null,
      prompt: c.text.trim(),
      frame: "a roleplay",
      limit: "",
      bare: false,
      custom: true,
      /* still one line on the newest message, for the reason in
         buildApiMessages, but it points at the prompt rather than
         restating a shape of its own */
      reminder: `${c.name}: follow the instructions under [Style] in the system prompt.`,
      temperature: tuned ? tuned.temperature : c.temperature ?? preset.temperature,
      max_tokens: tuned ? tuned.max_tokens : c.maxTokens ?? preset.maxTokens,
      ...advanced,
    };
  }
  const tune = styleTuning(settings, preset);
  const advanced = normalizeAdvancedSamplers(tune.on ? tune : {});
  const tuned = tune.on ? { ...tune, ...advanced } : null;
  return {
    tuned,
    prompt: stylePrompt(preset),
    frame: preset.frame,
    limit: preset.limit,
    bare: !!preset.bare,
    reminder: preset.reminder || "",
    temperature: tune.on ? tune.temperature : preset.temperature,
    max_tokens: tune.on ? tune.max_tokens : preset.maxTokens,
    ...advanced,
  };
}
