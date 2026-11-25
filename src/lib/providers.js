import { localHost } from "./providerTransport.js";

import { uid } from "./util.js";

/* ---------- providers ----------

   Every service Nova can talk to, as data. A saved provider in settings is
   one of these plus the user's key, their model, their favourites; the
   registry entry carries everything that is the same for everyone — where it
   lives, what its keys look like, where to get one, and which request fields
   it will accept.

   Nearly all of them speak OpenAI's /chat/completions format, so adding one
   here is the whole job. Anthropic's own format is the one other protocol,
   and it is handled separately in api.js.

   `samplers` is how much of the fine-tuning panel a service accepts:
     "full"   top_k, min_p and repetition_penalty as well (vLLM-style hosts)
     "basic"  temperature, top_p and the two penalties only; the strict
              first-party APIs reject anything they do not know
   `usage` asks for token counts on the last stream frame, for services
   known to accept stream_options.
   `cors: false` marks a service that refuses requests made from a web page.
   In the Android app those go through native HTTP instead (see api.js). */
export const PROVIDERS = [
  {
    id: "openrouter",
    name: "OpenRouter",
    tag: "Recommended",
    base: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-v1-...",
    keyPrefix: "sk-or-",
    keyUrl: "https://openrouter.ai/settings/keys",
    blurb: "Hundreds of models on one key, including free ones",
    samplers: "full",
  },
  {
    id: "google",
    name: "Google AI Studio",
    tag: "Free & fast",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyPlaceholder: "AIza...",
    keyPrefix: "AIza",
    keyUrl: "https://aistudio.google.com/apikey",
    blurb: "Gemini and Gemma, with a free daily allowance",
  },
  {
    id: "groq",
    name: "Groq",
    tag: "Free & fast",
    base: "https://api.groq.com/openai/v1",
    keyPlaceholder: "gsk_...",
    keyPrefix: "gsk_",
    keyUrl: "https://console.groq.com/keys",
    blurb: "Very fast open models, free tier",
    samplers: "basic",
    usage: true,
  },
  {
    id: "cerebras",
    name: "Cerebras",
    tag: "Free & fast",
    base: "https://api.cerebras.ai/v1",
    keyPlaceholder: "csk-...",
    keyPrefix: "csk-",
    keyUrl: "https://cloud.cerebras.ai/",
    blurb: "Very fast open models, free tier",
    samplers: "basic",
  },
  {
    id: "mistral",
    name: "Mistral",
    tag: "Free & fast",
    base: "https://api.mistral.ai/v1",
    keyPlaceholder: "Mistral API key",
    keyUrl: "https://console.mistral.ai/api-keys",
    blurb: "Mistral's own models, free experiment plan",
    samplers: "basic",
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    tag: "Free & fast",
    base: "https://integrate.api.nvidia.com/v1",
    keyPlaceholder: "nvapi-...",
    keyPrefix: "nvapi-",
    keyUrl: "https://build.nvidia.com/settings/api-keys",
    blurb: "Nemotron and other open models from build.nvidia.com",
    samplers: "basic",
    usage: true,
    cors: false,
  },
  {
    id: "featherless",
    name: "Featherless",
    tag: "Roleplay subscriptions",
    base: "https://api.featherless.ai/v1",
    keyPlaceholder: "Featherless API key",
    keyUrl: "https://featherless.ai/account/api-keys",
    blurb: "Flat monthly price, thousands of roleplay finetunes",
    samplers: "full",
  },
  {
    id: "arliai",
    name: "ArliAI",
    tag: "Roleplay subscriptions",
    base: "https://api.arliai.com/v1",
    keyPlaceholder: "ArliAI API key",
    keyUrl: "https://www.arliai.com/account",
    blurb: "Flat monthly price, roleplay-tuned models",
    samplers: "full",
  },
  {
    id: "nanogpt",
    name: "NanoGPT",
    tag: "Roleplay subscriptions",
    base: "https://nano-gpt.com/api/v1",
    keyPlaceholder: "sk-nano-...",
    keyPrefix: "sk-nano-",
    keyUrl: "https://nano-gpt.com/api",
    blurb: "Pay per use or subscription, most open models",
    samplers: "full",
    usage: true,
  },
  {
    id: "chutes",
    name: "Chutes",
    tag: "Roleplay subscriptions",
    base: "https://llm.chutes.ai/v1",
    keyPlaceholder: "cpk_...",
    keyPrefix: "cpk_",
    keyUrl: "https://chutes.ai/app/api",
    blurb: "Cheap open models, subscription or pay per use",
    samplers: "full",
    usage: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    tag: "Model makers",
    base: "https://api.deepseek.com/v1",
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.deepseek.com/api_keys",
    blurb: "DeepSeek's own API, off-peak discounts",
    samplers: "basic",
    usage: true,
  },
  {
    id: "xai",
    name: "xAI",
    tag: "Model makers",
    base: "https://api.x.ai/v1",
    keyPlaceholder: "xai-...",
    keyPrefix: "xai-",
    keyUrl: "https://console.x.ai/",
    blurb: "Grok models",
    samplers: "basic",
    usage: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    tag: "Model makers",
    base: "https://api.openai.com/v1",
    keyPlaceholder: "sk-proj-...",
    keyPrefix: "sk-proj-",
    keyUrl: "https://platform.openai.com/api-keys",
    blurb: "GPT models",
    samplers: "basic",
    usage: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    tag: "Model makers",
    base: "https://api.anthropic.com/v1",
    protocol: "anthropic",
    keyPlaceholder: "sk-ant-...",
    keyPrefix: "sk-ant-",
    keyUrl: "https://platform.claude.com/settings/keys",
    blurb: "Claude models",
  },
  /* Nova Bridge -- bridge.mjs, a local OpenRouter-style gateway that signs in
     to Antigravity, the Gemini app (gemini.google.com), Claude (through
     Claude Code on that computer) and ChatGPT subscriptions and
     serves them as one OpenAI-compatible stream. The key is only needed when
     the bridge was started with NOVA_BRIDGE_KEY and Nova runs on another
     device. */
  {
    id: "nova-bridge",
    name: "Nova Bridge",
    tag: "Recommended",
    base: "http://localhost:5005/v1",
    keyPlaceholder: "Optional",
    blurb: "Your Gemini (Antigravity or the Gemini app), Claude or ChatGPT subscription, like OpenRouter, at no API cost. Runs on your computer; found by itself on your Wi-Fi.",
    samplers: "basic",
    usage: true,
    /* the bridge picks the first model a connected subscription offers */
    defaultModel: "auto",
  },
];

/* Custom: anything else, by address. Not in the dropdown's groups. */
export const CUSTOM = {
  id: "custom",
  name: "Custom",
  blurb: "A relay, your own server, or any OpenAI- or Anthropic-compatible address",
  keyPlaceholder: "Optional",
  samplers: "basic",
};

export const TAG_ORDER = ["Recommended", "Free & fast", "Roleplay subscriptions", "Model makers", "Local"];

/* One tap fills in the usual address for a server on this machine. Another
   device on the network needs the computer's address in place of localhost. */
export const LOCAL_PRESETS = [
  { name: "KoboldCpp", base: "http://localhost:5001/v1" },
  { name: "Ollama", base: "http://localhost:11434/v1" },
  { name: "LM Studio", base: "http://localhost:1234/v1" },
  { name: "llama.cpp", base: "http://localhost:8080/v1" },
];

export const presetOf = (id) => PROVIDERS.find((p) => p.id === id) || CUSTOM;

/* A private address is someone's own machine: KoboldCpp, llama.cpp and the
   like, which take their own sampler names (rep_pen, DRY) and run whatever
   model is loaded. Tailscale names count — that is how a phone reaches one. */
export function isPrivateBase(base) {
  try { return localHost(new URL(base).hostname); } catch { return false; }
}

/* Which listed service a pasted key belongs to, from its prefix. Longest
   prefix first, so "sk-or-" wins over a shorter one. Keys with no
   distinctive prefix (plain "sk-") match nothing. */
export function presetForKey(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  return [...PROVIDERS]
    .filter((p) => p.keyPrefix)
    .sort((a, b) => b.keyPrefix.length - a.keyPrefix.length)
    .find((p) => k.startsWith(p.keyPrefix)) || null;
}

/* Which listed service an address belongs to, so pasting OpenRouter's URL
   into Custom offers the real OpenRouter entry instead. */
export function presetForUrl(url) {
  let host = "";
  try { host = new URL(String(url || "").trim()).hostname; } catch { return null; }
  return PROVIDERS.find((p) => new URL(p.base).hostname === host) || null;
}

/* A fresh saved provider. The first of a named service keeps the service's
   own id (saved data points at it); a second, third and so on, and every
   custom one, get a new id. `existing` is the saved list, which is what says
   so, and numbers the name: "Groq", "Groq 2". */
export function newProvider(presetId, extra = {}, existing = []) {
  const pre = presetOf(presetId);
  const custom = pre === CUSTOM;
  const same = existing.filter((p) => p.preset === pre.id).length;
  const fresh = custom || existing.some((p) => p.id === pre.id);
  return {
    id: fresh ? `${pre.id}-${uid()}` : pre.id,
    preset: pre.id,
    name: custom ? "Custom" : same ? `${pre.name} ${same + 1}` : pre.name,
    base: custom ? "" : pre.base,
    protocol: pre.protocol || "openai",
    key: "",
    /* custom only: model ids typed in by hand, for servers with no /models */
    models: [],
    model: pre.defaultModel || "",
    favorites: [],
    /* "default" | "price-asc" | "price-desc" */
    sort: "default",
    freeOnly: false,
    ...extra,
  };
}

/* normalizeData adds Nova Bridge in front of these, on every load */
export const DEFAULT_PROVIDERS = [newProvider("openrouter")];

/* The provider in use, or null when every one has been removed. */
export function activeProvider(settings) {
  const list = settings?.providers || [];
  return list.find((p) => p.id === settings?.activeProvider) || list[0] || null;
}

/* The settings patch that changes one saved provider. */
export function patchProvider(settings, id, patch) {
  return { providers: (settings.providers || []).map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

/* Is this provider someone's own machine. Saved on the entry when known
   (migrated servers, local presets), worked out from the address otherwise. */
export const isLocalProvider = (p) => !!p && p.preset === "custom" && (p.local ?? isPrivateBase(p.base));

/* ---------- from the three-source settings ----------

   Before providers, settings held one OpenRouter key (`apiKey`, shared with a
   local server), `baseUrl` for that server, and `source: "google"` with its
   own key and model. Each becomes a saved provider, and whichever was in use
   stays in use. */
export function providersFromLegacy(s = {}) {
  const apiKey = s.apiKey || "";
  const list = [];

  const or = newProvider("openrouter", {
    /* the one key field served both; a key that is plainly not
       OpenRouter's belonged to the server */
    key: s.baseUrl && apiKey && !apiKey.startsWith("sk-or-") ? "" : apiKey,
    model: s.model || "",
    favorites: Array.isArray(s.favoriteModels) ? s.favoriteModels : s.model ? [s.model] : [],
  });
  list.push(or);

  if (s.googleKey || s.source === "google") {
    list.push(newProvider("google", { key: s.googleKey || "", model: s.googleModel || "" }));
  }

  let server = null;
  if (s.baseUrl) {
    server = newProvider("custom", {
      name: "Your server",
      base: s.baseUrl,
      key: apiKey.startsWith("sk-or-") ? "" : apiKey,
      model: "",
      local: true,
    });
    list.push(server);
  }

  const active = s.source === "google" ? "google" : server ? server.id : "openrouter";
  return { providers: list, activeProvider: active };
}

/* ---------- Nova Bridge addresses ----------

   The bridge runs on the computer. On that computer it is at localhost; on
   a phone, localhost is the phone itself, so it needs the computer's LAN
   address. Anything typed is filled out to a full address: "192.168.1.5"
   becomes http://192.168.1.5:5005/v1. A named host (a tunnel) keeps its
   own port. */
export const BRIDGE_LOCAL = "http://localhost:5005/v1";

export function bridgeUrl(input) {
  let s = String(input || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    const u = new URL(s);
    const h = u.hostname;
    const named = h.includes(".") && !/^(\d+\.){3}\d+$/.test(h) && !/\.(local|lan|home|ts\.net)$/i.test(h);
    if (!u.port && !named) u.port = "5005";
    let p = u.pathname.replace(/\/+$/, "");
    if (!p.endsWith("/v1")) p += "/v1";
    return `${u.protocol}//${u.host}${p}`;
  } catch {
    return "";
  }
}

export function isLoopbackBase(base) {
  try {
    const h = new URL(base).hostname;
    return h === "localhost" || h === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
}

/* Where the bridge might be, most likely first: the saved address, then the
   computer that served this page (a phone opening the dev server at the
   computer's address), then the LAN address last seen, then localhost. */
export function bridgeCandidates({ saved, lan, pageHost } = {}) {
  const page = pageHost && !isLoopbackBase(`http://${pageHost}`) ? bridgeUrl(pageHost) : "";
  return [...new Set([saved, page, lan && bridgeUrl(lan), BRIDGE_LOCAL].filter(Boolean))];
}
