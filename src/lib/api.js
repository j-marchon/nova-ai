import { providerFetch, checkProviderUrl, ProviderAddressError } from "./providerTransport.js";
import { NON_CHAT } from "./models.js";
import { ModelJsonError, parseModelJson, repairJsonRequest } from "./json.js";
import { PROVIDERS, activeProvider, isLocalProvider, presetOf } from "./providers.js";
import { findBridgeOnce, pageHost } from "./bridgeFind.js";
import { genParams, thinkingOn } from "./styles.js";
import { makeThinkFilter, thinkDirective } from "./thinking.js";
import { activityModelLabel, startActivity } from "./activity.js";

/* A supplied handle belongs to its caller, which may still need to save the result. */
export async function withRequestActivity({ activity, signal, ...meta }, request) {
  const borrowed = typeof activity?.progress === "function";
  const handle = borrowed ? activity : startActivity({ kind: "Model request", ...meta, ...activity });
  const controller = signal && signal !== handle.signal ? new AbortController() : null;
  const abort = () => controller.abort();
  if (controller) {
    signal.addEventListener("abort", abort, { once: true });
    handle.signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted || handle.signal.aborted) abort();
  }
  const merged = controller?.signal || handle.signal;
  try {
    if (merged.aborted) throw abortError();
    const result = await request(handle, merged);
    if (merged.aborted) throw abortError();
    if (!borrowed) handle.done();
    return result;
  } catch (err) {
    const error = merged.aborted ? abortError() : err;
    if (!borrowed) handle.fail(error);
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    handle.signal.removeEventListener("abort", abort);
  }
}

function modelActivityRequest(opts, request, maxTokens, model = activeModel(opts.settings)) {
  return withRequestActivity({ activity: opts.activity, signal: opts.signal, model: activityModelLabel(opts.settings, model) }, (handle, signal) => {
    let chars = 0;
    let phase;
    const setPhase = (text) => { if (phase !== text) { phase = text; handle.phase(text); } };
    const expected = opts.expectedTokens > 0 ? opts.expectedTokens : maxTokens * 0.6;
    const writing = (value) => {
      if (!value) return;
      chars = typeof value === "number" ? value : chars + value.length;
      setPhase("Writing");
      handle.progress(Math.min(95, chars / 3.5 / expected * 100));
    };
    return request({
      ...opts, signal,
      onToken: (text) => { writing(text); opts.onToken?.(text); },
      onProgress: (value) => { writing(value); opts.onProgress?.(value); },
      onReasoning: (text) => { if (text) setPhase("Thinking"); opts.onReasoning?.(text); },
    });
  });
}

/* ---------- where replies come from ----------

   The saved provider marked active in settings (see lib/providers.js).
   Everything that has to know which one is in play asks here rather than
   reading the fields.

   `src` is the provider's preset id ("openrouter", "google", "groq", …),
   except that a custom provider is "local" when it is someone's own machine
   and "custom" otherwise. OpenRouter's routing extras, Google's thinking
   switch and the local server's sampler names all key off it. */

export const GOOGLE_BASE = "https://generativelanguage.googleapis.com/v1beta";

/* Google's alias for its newest Flash, so a fresh setup answers without
   anyone having to know this month's version number. */
export const DEFAULT_GOOGLE_MODEL = "gemini-flash-latest";

/* No provider saved at all reads as an OpenRouter with no key, so every
   caller gets the same "add a key" path. */
const NO_PROVIDER = { id: "", preset: "openrouter", name: "OpenRouter", base: "https://openrouter.ai/api/v1", protocol: "openai", key: "", model: "" };

export function providerOf(settings) {
  return activeProvider(settings) || NO_PROVIDER;
}

export function sourceOf(settings) {
  const p = providerOf(settings);
  if (p.preset === "custom") return isLocalProvider(p) ? "local" : "custom";
  /* nova-bridge is a named local preset, not a generic custom server.
     It speaks plain OpenAI format -- no KoboldCpp/DRY params -- so it
     falls through to the standard "other provider" path in streamChat. */
  if (p.preset === "nova-bridge") return "nova-bridge";
  return p.preset;
}

export function activeModel(settings) {
  const p = providerOf(settings);
  return p.model || (p.preset === "custom" ? p.models?.[0] || "local" : "");
}

/* A custom address may not need a key at all; every listed service does.
   nova-bridge needs no key either: it signs in to the subscriptions itself. */
export function hasKey(settings) {
  const p = activeProvider(settings);
  if (!p) return false;
  if (p.preset === "custom" || p.preset === "nova-bridge") return !!p.base;
  return !!p.key;
}

export function endpointFor(settings) {
  const p = providerOf(settings);
  const pre = presetOf(p.preset);
  return {
    src: sourceOf(settings),
    credentialBase: p.pairedBase || "",
    base: String(p.base || pre.base || "").trim().replace(/\/+$/, ""),
    key: (p.key || "").trim(),
    protocol: p.protocol || "openai",
    name: p.name || pre.name,
    preset: pre,
    provider: p,
  };
}

/* ---------- services that refuse web pages ----------

   A service marked `cors: false` sends no CORS headers, so the WebView blocks
   every request to it and it fails exactly like a dropped connection. In the
   Android app those requests go native, where the browser's cross-origin
   rules do not apply: through Nova's own NovaHttp plugin, which streams the
   reply and can be stopped, or, in a build without it, through Capacitor's
   native HTTP, which hands the body back whole. The SSE parsing reads either
   the same way. Everything else, and every request in a plain browser, is an
   ordinary fetch. */
const NO_CORS_HOSTS = new Set(
  PROVIDERS.filter((p) => p.cors === false).map((p) => new URL(p.base).hostname),
);

export function needsNative(url) {
  let host = "";
  try { host = new URL(url).hostname; } catch { return false; }
  return NO_CORS_HOSTS.has(host);
}

function nativePlugins() {
  const cap = globalThis.window?.Capacitor;
  return cap?.isNativePlatform?.() ? cap.Plugins || null : null;
}

const abortError = () => new DOMException("Aborted", "AbortError");
const NULL_BODY = new Set([101, 204, 205, 304]);
let streamIds = 0;

/* A real streamed Response from NovaHttpPlugin. The plugin resolves once the
   status and headers are in, then sends the body as "chunk" events (whole
   lines, newlines kept) and finishes with "end" or "error". Listeners go in
   before the request starts so no early chunk is missed; Stop disconnects
   the native connection. */
async function nativeStream(plugin, url, init) {
  const { signal } = init;
  if (signal?.aborted) throw abortError();
  const id = `${Date.now().toString(36)}-${++streamIds}`;
  const encoder = new TextEncoder();
  const cancel = () => Promise.resolve(plugin.cancel({ id })).catch(() => {});
  let controller;
  let finished = false;
  let rejectHead;
  const headAborted = new Promise((_, reject) => { rejectHead = reject; });
  headAborted.catch(() => {});

  const finish = (last) => {
    if (finished) return;
    finished = true;
    signal?.removeEventListener("abort", onAbort);
    for (const l of listeners) Promise.resolve(l).then((h) => h?.remove?.()).catch(() => {});
    try { last?.(); } catch {}
  };
  const onAbort = () => {
    cancel();
    rejectHead(abortError());
    finish(() => controller.error(abortError()));
  };

  const body = new ReadableStream({
    start(c) { controller = c; },
    cancel() { if (!finished) { cancel(); finish(); } },
  });
  const listeners = [
    plugin.addListener("chunk", (e) => { if (e?.id === id && !finished) controller.enqueue(encoder.encode(e.text ?? "")); }),
    plugin.addListener("end", (e) => { if (e?.id === id) finish(() => controller.close()); }),
    plugin.addListener("error", (e) => {
      if (e?.id === id) finish(() => controller.error(new TypeError(e.message || "Network request failed")));
    }),
  ];
  await Promise.all(listeners);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) { onAbort(); throw abortError(); }

  let head;
  try {
    head = await Promise.race([
      plugin.stream({ id, url, method: init.method || "GET", headers: Object.fromEntries(new Headers(init.headers || {})), body: init.body ?? null }),
      headAborted,
    ]);
  } catch (e) {
    finish();
    if (e?.name === "AbortError" || signal?.aborted) throw abortError();
    /* shaped like fetch's own failure, so callers word it the same way */
    throw new TypeError(e?.message || "Network request failed");
  }
  const status = Number(head?.status) || 0;
  return new Response(NULL_BODY.has(status) ? null : body, { status, headers: head?.headers || {} });
}

/* fetch cannot tell how much of a request body has gone; an upload that
   wants to show it (Sync's Send) goes by XMLHttpRequest instead, shaped like
   fetch: a Response back, a TypeError when the network fails, an AbortError
   when stopped, and no redirects followed. */
function xhrFetch(url, { method = "GET", headers = {}, body = null, signal, onUploadProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.responseType = "blob";
    for (const [k, v] of new Headers(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onUploadProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.responseURL && xhr.responseURL !== url) return reject(new TypeError("The server redirected the request."));
      const h = new Headers();
      for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
        const i = line.indexOf(":");
        if (i > 0) try { h.append(line.slice(0, i).trim(), line.slice(i + 1).trim()); } catch {}
      }
      resolve(new Response(NULL_BODY.has(xhr.status) ? null : xhr.response, { status: xhr.status, headers: h }));
    };
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => reject(abortError());
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

export async function send(url, init = {}) {
  checkProviderUrl(url);
  const plugins = needsNative(url) && nativePlugins();
  if (!plugins && init.onUploadProgress && typeof XMLHttpRequest === "function") return xhrFetch(url, init);
  if (!plugins) return fetch(url, { ...init, redirect: "error" });
  if (plugins.NovaHttp && (init.body == null || typeof init.body === "string")) {
    return nativeStream(plugins.NovaHttp, url, init);
  }
  const http = plugins.CapacitorHttp;
  if (!http) return fetch(url, { ...init, redirect: "error" });

  const { signal } = init;
  if (signal?.aborted) throw abortError();
  /* Capacitor's JSON body handling for string data differs between versions,
     so a JSON string still goes over as the object; anything else as is. */
  let data = init.body ?? undefined;
  if (typeof data === "string" && /json/i.test(new Headers(init.headers || {}).get("content-type") || "")) {
    try { data = JSON.parse(data); } catch {}
  }
  const request = http.request({
    url,
    method: init.method || "GET",
    headers: init.headers || {},
    data,
    responseType: "text",
    disableRedirects: true,
  });
  /* native HTTP cannot be cancelled; a stopped reply just stops waiting */
  const aborted = new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  const r = await Promise.race([request, aborted]);
  const body = typeof r.data === "string" ? r.data : JSON.stringify(r.data ?? "");
  return new Response(body, { status: r.status, headers: r.headers || {} });
}

/* A request to the active provider. Nova Bridge moves when the router gives
   the computer a new address; a request that cannot reach it looks for it
   once and goes there instead. The app hears of the new address through a
   "nova-bridge-moved" event and saves it. */
export async function sendTo(ep, settings, path, init = {}) {
  if (ep.src === "nova-bridge" && ep.credentialBase && ep.credentialBase !== ep.base) throw new Error("Request device access again for the new Bridge address.");
  try {
    return await send(`${ep.base}${path}`, init);
  } catch (e) {
    if (e instanceof ProviderAddressError || e.name === "AbortError" || ep.src !== "nova-bridge") throw e;
    const hit = await findBridgeOnce({ saved: ep.base, lan: settings?.bridgeLan, pageHost: pageHost(), signal: init.signal });
    if (!hit || init.signal?.aborted) throw e;
    if (new Headers(init.headers || {}).has("Authorization") && hit.base !== ep.base) throw new Error("Nova Bridge did not accept this device. It may have been removed in the Bridge window, or the Bridge is at a new address. Request access again in Settings → Nova Bridge.");
    globalThis.window?.dispatchEvent?.(new CustomEvent("nova-bridge-moved", { detail: hit }));
    ep.base = hit.base;
    return send(`${hit.base}${path}`, init);
  }
}

/* What the Nova Bridge's subscriptions have left, from its /usage. Same
   credential and address rules as every other Bridge request: the device key
   goes only to the saved, paired address (sendTo refuses a moved one). */
export async function fetchBridgeUsage(settings, { signal } = {}) {
  const ep = endpointFor(settings);
  if (ep.src !== "nova-bridge") throw new Error("Nova Bridge is not the provider in use.");
  const headers = ep.key ? { Authorization: `Bearer ${ep.key}` } : {};
  let res;
  try {
    res = await sendTo(ep, settings, "/usage", { headers, signal });
  } catch (e) {
    if (e.name === "AbortError" || !(e instanceof TypeError)) throw e;
    throw new Error(unreachable(ep));
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new Error("The Bridge did not accept this device. Request access again in Settings → Nova Bridge.");
  if (res.status === 404) throw new Error("This Bridge does not report usage. Update Nova Bridge.");
  if (!res.ok) throw new Error(unwrapError(data)?.error?.message || `The Bridge answered with error ${res.status}.`);
  return { providers: data?.providers && typeof data.providers === "object" ? data.providers : {} };
}

/* Gemini always thinks a little. The newer models cannot turn it off, only
   down, and "low" is the lowest setting every version accepts — the nearest
   thing to off. On, the model decides how much, and its thoughts are asked
   for so they show in the thinking panel like any other model's. Google
   rejects a request carrying both fields, and Gemma has no switch at all. */
export function googleThinking(model, on) {
  if (!/gemini/i.test(model)) return {};
  return on
    ? { extra_body: { google: { thinking_config: { include_thoughts: true } } } }
    : { reasoning_effort: "low" };
}

/* Gemini counts its thinking against max_tokens, so a budget sized for the
   reply alone gets eaten and comes back empty. This is room on top. */
export const googleThinkingRoom = (on) => (on ? 6000 : 1500);

/* Google's errors come back as a one-element array on this endpoint, and as
   a plain object everywhere else. */
export const unwrapError = (payload) => (Array.isArray(payload) ? payload[0] : payload);

/* Google words its errors for developers. Its 429 is always your own quota,
   never a busy provider, and a bad key is a 400 rather than a 401. */
export function googleError(res, payload, model) {
  const status = res?.status || 0;
  const upstream = unwrapError(payload)?.error?.message || "";
  const wait = upstream.match(/retry in ([\d.]+)s/i)?.[1];
  let msg = upstream || `Error ${status}`;

  if (/api key/i.test(upstream) || status === 401) {
    msg = "Google rejected the key. Copy it again from AI Studio into Settings.";
  } else if (status === 403) {
    msg = `Google refused this request: ${upstream || "the key is not allowed to use the Gemini API."}`;
  } else if (status === 404) {
    msg = `Google has no model called ${model}. Pick another one in the model list.`;
  } else if (status === 429) {
    msg = /per ?day/i.test(upstream)
      ? `You have used today's free requests for ${model}. Google resets them at midnight Pacific time. Pick another model, or add billing to the key's project.`
      : `You are sending faster than Google allows for ${model} on your plan.` +
        (wait ? ` Try again in about ${Math.ceil(Number(wait))}s.` : " Wait a minute and try again.");
  } else if (status === 500 || status === 503) {
    msg = "Google's servers are overloaded right now. Try again in a moment.";
  }

  const e = new Error(msg);
  e.status = status;
  e.rateLimited = status === 429;
  e.fromProvider = false;
  e.model = model;
  e.resetAt = null;
  e.retryAfter = wait ? Number(wait) : null;
  return e;
}

/* Every model on the key that can hold a conversation. The OpenAI-style
   /models on Google lists bare ids only, so this asks the native endpoint,
   which also has names, context sizes and descriptions. */
export const GOOGLE_NON_CHAT = /(audio|live|veo|imagen|robotics|computer-use|aqa)/i;

export async function fetchGoogleModels(key) {
  let res;
  try {
    res = await providerFetch(`${GOOGLE_BASE}/models?pageSize=1000`, { headers: { "x-goog-api-key": key } });
  } catch {
    throw new Error("Could not reach Google. Check your connection.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const m = data?.error?.message || "";
    throw new Error(/api key/i.test(m) ? "Google rejected that key." : m || "Could not load Google's models.");
  }
  const gemini = (m) => (/gemini/i.test(m.id) ? 0 : 1);
  return (data?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .filter((m) => !NON_CHAT.test(m.name) && !GOOGLE_NON_CHAT.test(m.name))
    .map((m) => ({
      id: m.name.replace(/^models\//, ""),
      name: m.displayName || googleLabel(m.name),
      ctx: m.inputTokenLimit,
      description: m.description || "",
    }))
    /* Gemini ahead of Gemma, and newest version first within each */
    .sort((a, b) => gemini(a) - gemini(b) || b.name.localeCompare(a.name, undefined, { numeric: true }));
}

/* "gemini-flash-latest" -> "Gemini Flash Latest", for ids with no display
   name to hand. */
export const googleLabel = (id) =>
  String(id || "").replace(/^models\//, "").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/* ---------- OpenRouter ---------- */

/* Stand-in for a Headers object on the mid-stream error path, where there is
   no HTTP response to read headers from. */
export const emptyHeaders = { get: () => null };

/* Turn a failed response into a message that says what actually went wrong.

   The 429 case is the reason this exists. OpenRouter distinguishes its own
   platform caps from an upstream provider being at capacity, and the two need
   completely different responses from the user — wait a day versus pick a
   different model — but the previous code replaced both with one sentence
   about waiting a moment. */
export function apiError(res, payload, { isLocal, isGoogle, strict, model, other } = {}) {
  if (isGoogle) return googleError(res, payload, model);
  if (other) return providerError(res, payload, { name: other, model });
  const status = res?.status || 0;
  const h = res?.headers || emptyHeaders;
  const err = payload?.error || {};
  const meta = err.metadata || {};
  const upstream = err.message || "";

  const limit = h.get?.("X-RateLimit-Limit");
  const remaining = h.get?.("X-RateLimit-Remaining");
  const reset = h.get?.("X-RateLimit-Reset");
  const retryAfter = h.get?.("Retry-After");

  let msg = upstream || `Error ${status}`;

  if (status === 401) {
    msg = isLocal
      ? "Your server rejected the key. Clear the key field, or match KoboldCpp's --password."
      : "Invalid API key. Check it in Settings.";
  } else if (status === 402) {
    msg = "This model needs OpenRouter credits. Pick a free model, or top up your account. A negative balance blocks free models too, even by a cent.";
  } else if (status === 403) {
    msg = upstream
      ? `The provider refused this request: ${upstream}`
      : "The provider refused this request — usually its own content filter. Try a less filtered model.";
  } else if (status === 404) {
    msg = isLocal
      ? "Server reached, but no model answered. Check the address ends in /v1."
      : strict
      ? `No provider for ${short(model)} supports every fine-tuned value. Set Top K, Min P or repetition penalty back to off, or turn off "Only providers that support every value".`
      : "This model is no longer available on OpenRouter. Pick another one.";
  } else if (status === 429) {
    /* provider_code present means the upstream provider rejected it, not us */
    const fromProvider = !!meta.provider_code || !limit;
    const wait = retryAfter ? ` Try again in about ${Math.ceil(Number(retryAfter))}s.` : "";
    if (fromProvider) {
      msg =
        `Every provider for ${short(model)} is busy right now — this is their capacity, not your quota. ` +
        `Free endpoints for popular models sit saturated for hours at a time.${wait} Pick another model, or try again later.`;
    } else {
      const left = remaining === "0" || remaining === 0;
      msg =
        `You have hit OpenRouter's own limit for free models` +
        (limit ? ` (${limit} per window, ${remaining} left)` : "") + `.` +
        (left ? " Free models are capped at 20 requests a minute, and 1000 a day once you have bought $10 of credit." : "") +
        wait;
    }
  } else if (status === 502 || status === 503) {
    msg = "No provider could serve this model right now. Try another model, or again in a minute.";
  }

  const e = new Error(msg);
  e.status = status;
  e.rateLimited = status === 429;
  e.fromProvider = status === 429 && (!!meta.provider_code || !limit);
  e.model = model;
  e.resetAt = reset ? Number(reset) : null;
  e.retryAfter = retryAfter ? Number(retryAfter) : null;
  return e;
}

/* Every service that is not OpenRouter, Google or a local server. They share
   no error vocabulary beyond the HTTP status, so the message names the
   service and passes on whatever it said. Anthropic's errors use the same
   { error: { message } } shape, so they land here too. */
export function providerError(res, payload, { name, model }) {
  const status = res?.status || 0;
  const h = res?.headers || emptyHeaders;
  const body = unwrapError(payload);
  const upstream = body?.error?.message || (typeof body?.error === "string" ? body.error : "") || body?.message || body?.detail || "";
  const retryAfter = h.get?.("Retry-After");
  let msg = upstream ? `${name}: ${upstream}` : `${name} answered with error ${status}.`;

  if (status === 401) {
    msg = `${name} rejected the key. Check it in Settings → Model.`;
  } else if (status === 402) {
    msg = `${name} says the account is out of credit, or this model is not on your plan.`;
  } else if (status === 403) {
    msg = upstream ? `${name} refused this request: ${upstream}` : `${name} refused this request. The key may not be allowed to use ${short(model)}.`;
  } else if (status === 404) {
    msg = `${name} has no model called ${model}. Pick another one in the model list.`;
  } else if (status === 429) {
    msg = `${name} is limiting how fast you can send.` +
      (retryAfter ? ` Try again in about ${Math.ceil(Number(retryAfter))}s.` : " Wait a moment and try again.") +
      (upstream ? ` (${upstream})` : "");
  } else if (status >= 500) {
    msg = `${name} is having trouble right now. Try again in a moment.` + (upstream ? ` (${upstream})` : "");
  }

  const e = new Error(msg);
  e.status = status;
  e.rateLimited = status === 429;
  e.fromProvider = false;
  e.model = model;
  e.resetAt = null;
  e.retryAfter = retryAfter ? Number(retryAfter) : null;
  return e;
}

/* What a failed fetch (no response at all) means, per source. From a
   browser, a service that does not allow web pages to call it fails exactly
   like a dropped connection, so that is said too. */
export function unreachable(ep) {
  if (ep.src === "nova-bridge") return "Could not find Nova Bridge. Is the computer on, with Nova (or the Nova Bridge window) open? Check that the address here matches the one shown in the Bridge window.";
  if (ep.src === "local") return "Could not reach your server. Is it running, and can this device reach its address?";
  if (ep.src === "google") return "Could not reach Google. Check your connection.";
  if (ep.src === "openrouter") return "Network error. Check your connection.";
  return `Could not reach ${ep.name}. Check your connection and the address; some services also block requests made from a browser.`;
}

export const noModel = (ep) => `No model picked for ${ep.name} yet. Choose one in Settings → Model.`;

export const short = (id) => (id || "the model").split("/").pop().replace(":free", "");

/* Whether a reply came from a different model than the one asked for — the
   fallback chain, or the auto-router. Providers report ids with and without
   the :free suffix and sometimes with a dated one, so compare base ids and let
   either extend the other. */
export function servedElsewhere(asked, served) {
  if (!asked || !served) return false;
  const base = (id) => id.toLowerCase().replace(/:.*$/, "");
  const a = base(asked);
  const b = base(served);
  return !(a === b || b.startsWith(`${a}-`) || a.startsWith(`${b}-`));
}

/* What the account is allowed to do, and what it has spent.

   /key answers "did my $10 register?" — the only way to know whether free
   models are capped at 50 a day or 1000 — and also carries the rolling spend
   figures for this key. /credits carries the account-wide totals, from which
   the balance is total_credits minus total_usage.

   Both are asked for together and neither is allowed to sink the other: a key
   without permission to read /credits still gets its spend figures back. */
export async function fetchKeyStatus(apiKey) {
  const res = await providerFetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(res.status === 401 ? "That key was rejected." : "Could not read the key.");
  const d = (await res.json())?.data || {};
  return {
    freeTier: !!d.is_free_tier,
    usage: Number(d.usage || 0),
    daily: d.usage_daily == null ? null : Number(d.usage_daily),
    weekly: d.usage_weekly == null ? null : Number(d.usage_weekly),
    monthly: d.usage_monthly == null ? null : Number(d.usage_monthly),
    limit: d.limit == null ? null : Number(d.limit),
    remaining: d.limit_remaining == null ? null : Number(d.limit_remaining),
    dailyRequests: d.is_free_tier ? 50 : 1000,
  };
}

export async function fetchCredits(apiKey) {
  const res = await providerFetch("https://openrouter.ai/api/v1/credits", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const d = (await res.json())?.data || {};
  const bought = Number(d.total_credits || 0);
  const spent = Number(d.total_usage || 0);
  return { bought, spent, balance: bought - spent };
}

/* Everything the account panel shows, in one call. */
export async function fetchAccount(apiKey) {
  const [key, credits] = await Promise.all([
    fetchKeyStatus(apiKey),
    fetchCredits(apiKey).catch(() => null),
  ]);
  return { key, credits };
}

export const money = (n) =>
  n == null ? "—" : n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;

/* Per-million-token price, which is how every model page and community post
   quotes it. The API gives per-token, which is unreadable at these scales. */
export function priceLabel(pricing) {
  if (!pricing) return null;
  const i = pricing.prompt * 1e6;
  const o = pricing.completion * 1e6;
  if (!i && !o) return "Free";
  const f = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));
  return `$${f(i)} in / $${f(o)} out per 1M`;
}

/* The text-generation samplers (DRY, Top A, Mirostat, CFG, dynamic
   temperature) a reply carries when set. Only where they are understood:
   OpenRouter, local servers, custom addresses and the hosts marked "full";
   every other API either ignores them or answers with an error. A value at
   its "off" setting is never sent. */
export function attachAdvancedSamplers(body, style, ep) {
  if (ep.protocol === "anthropic") return;
  if (!["openrouter", "local", "custom"].includes(ep.src) && ep.preset?.samplers !== "full") return;
  const p = style?.tuned || style;
  if (!p) return;

  if (p.dry_multiplier > 0) {
    body.dry_multiplier = p.dry_multiplier;
    if (p.dry_base != null) body.dry_base = p.dry_base;
    if (p.dry_allowed_length != null) body.dry_allowed_length = p.dry_allowed_length;
    if (Array.isArray(p.dry_sequence_breakers) && p.dry_sequence_breakers.length) body.dry_sequence_breakers = p.dry_sequence_breakers;
  }
  if (p.top_a > 0) body.top_a = p.top_a;
  if (p.mirostat_mode > 0) {
    body.mirostat_mode = Math.round(p.mirostat_mode);
    if (p.mirostat_tau != null) body.mirostat_tau = p.mirostat_tau;
    if (p.mirostat_eta != null) body.mirostat_eta = p.mirostat_eta;
  }
  if (p.cfg_scale > 1) body.cfg_scale = p.cfg_scale;
  if (p.dynatemp_min > 0 || p.dynatemp_max > 0) {
    body.dynatemp_min = p.dynatemp_min;
    body.dynatemp_max = p.dynatemp_max;
    body.dynatemp_exponent = p.dynatemp_exponent;
  }
  /* under every name SillyTavern sends them by, since backends differ
     (typical_p / typical, nsigma / top_n_sigma) */
  if (p.xtc_probability > 0) {
    body.xtc_threshold = p.xtc_threshold;
    body.xtc_probability = p.xtc_probability;
  }
  if (p.typical_p < 1) body.typical_p = body.typical = p.typical_p;
  if (p.tfs < 1) body.tfs = p.tfs;
  if (p.smoothing_factor > 0) {
    body.smoothing_factor = p.smoothing_factor;
    body.smoothing_curve = p.smoothing_curve;
  }
  if (p.nsigma > 0) body.nsigma = body.top_n_sigma = p.nsigma;
}

/* ---------- the sampler on the wire ----------

   The sampler fields of a chat request in OpenAI's format, for the style
   settings genParams gives and the service they go to. streamChat sends
   exactly this, and the style picker shows it, so what the panel says is
   what was sent. The cap is the reply's own; streamChat adds room for
   thinking on top. */
export function samplerBody(style, ep) {
  const { src } = ep;
  const isLocal = src === "local";
  const isGoogle = src === "google";
  const isOR = src === "openrouter";
  const body = { temperature: style.temperature, max_tokens: style.max_tokens };

  /* Light repetition penalties, the closest OpenRouter gets to the DRY
     sampler a local server runs (below). Frequency grows with each reuse of a
     token, which is what wears down a pet phrase; presence is a flat nudge
     toward new words. Both kept low: past about 0.5 they start breaking names
     and punctuation. A provider that does not support them ignores them.
     Not for Bare, which exists to show the model untouched.

     min_p drops any word less than 5% as likely as the top choice. That cuts
     the incoherent tail, which is what makes a higher temperature safe, and
     it leaves the plausible alternatives — where variety comes from — alone.
     Like the penalties, a provider without it simply ignores it. */
  if (isOR && !style.bare && !style.tuned) {
    body.frequency_penalty = 0.3;
    body.presence_penalty = 0.2;
    body.min_p = 0.05;
  }

  /* Fine tuning on: the style's whole sampler, exactly as set, in place of
     the defaults above (and of the local ones below). Google's endpoint
     rejects fields it does not know, so it gets only Top P on top of the
     temperature and cap every source takes. The strict first-party APIs
     (OpenAI, Mistral, Groq…) take the two penalties as well, and only
     OpenRouter, local servers and the vLLM-style hosts take the rest. */
  const tuned = style.tuned;
  if (tuned) {
    body.top_p = tuned.top_p;
    if (!isGoogle) {
      body.frequency_penalty = tuned.frequency_penalty;
      body.presence_penalty = tuned.presence_penalty;
    }
    if (isOR || isLocal || ep.preset?.samplers === "full") {
      if (tuned.top_k > 0) body.top_k = Math.round(tuned.top_k);
      body.min_p = tuned.min_p;
      body.repetition_penalty = tuned.repetition_penalty;
    }
  }

  if (isLocal) {
    if (tuned) {
      /* KoboldCpp's name for repetition penalty. No DRY: fine tuning sends
         only what the panel shows. */
      body.rep_pen = tuned.repetition_penalty;
      body.rep_pen_range = 2048;
    } else {
      /* KoboldCpp's own names for the same knobs */
      body.rep_pen = 1.05;
      body.rep_pen_range = 2048;
      body.min_p = 0.05;
      /* DRY — the proper fix for roleplay repetition, local only */
      body.dry_multiplier = 0.8;
      body.dry_base = 1.75;
      body.dry_allowed_length = 2;
    }
  }
  attachAdvancedSamplers(body, style, ep);
  return body;
}

/* ---------- pictures in a message ----------

   A message with pictures attached goes out as OpenAI content parts. A model
   not known to see gets a line naming each picture instead, so the turn still
   makes sense to it and the request is not refused. */
const VISION = /claude|gpt-4o|gpt-4\.1|gpt-4\.5|gpt-4-turbo|gpt-4-vision|gpt-5|\bo[134]\b|gemini|gemma-?[34]|llama-4|grok-(2-vision|4)|vision|-vl\b|-vl-|pixtral|llava|internvl|minicpm-v|glm-4(\.\d)?v|cogvlm|omni/i;
export const supportsVision = (model) => !model || VISION.test(String(model));

const imageNote = (img) => `[Attached image: ${typeof img === "string" ? "image" : img.name || "image"}]`;

export function formatOpenAIMessages(messages = [], model) {
  const sees = supportsVision(model);
  return messages.map((m) => {
    if (!m?.images?.length) return m;
    const { images, ...rest } = m;
    if (!sees) return { ...rest, content: [m.content, ...images.map(imageNote)].filter(Boolean).join("\n") };
    return {
      ...rest,
      content: [
        { type: "text", text: m.content || "" },
        ...images.map((img) => ({ type: "image_url", image_url: { url: typeof img === "string" ? img : img.url } })),
      ],
    };
  });
}

/* The sampler a reply in the current settings is sent with, in either
   format, for showing next to the styles. */
export function sentSampler(settings) {
  const style = genParams(settings);
  const ep = endpointFor(settings);
  if (ep.protocol === "anthropic") {
    const tuned = style.tuned;
    return {
      style,
      ep,
      sent: {
        ...anthropicSampling(activeModel(settings) || "", { temperature: style.temperature, topP: tuned ? tuned.top_p : null, topK: tuned ? tuned.top_k : 0 }),
        max_tokens: style.max_tokens,
      },
    };
  }
  return { style, ep, sent: samplerBody(style, ep) };
}

export function streamChat(opts) {
  const ep = endpointFor(opts.settings);
  const thinking = thinkingOn(opts.settings);
  const maxTokens = genParams(opts.settings).max_tokens;
  const room = ep.protocol === "anthropic"
    ? (CLAUDE_ADAPTIVE.test(activeModel(opts.settings)) ? thinking ? 6000 : 2000 : 0)
    : ep.src === "google" ? googleThinkingRoom(thinking) : thinking ? 1200 : 0;
  const cap = maxTokens + room;
  return modelActivityRequest(opts, streamChatRequest, cap);
}

async function streamChatRequest({ settings, messages, onToken, onReasoning, signal, sessionId }) {
  const ep = endpointFor(settings);
  if (!activeModel(settings)) throw new Error(noModel(ep));
  if (ep.protocol === "anthropic") return streamAnthropic({ settings, ep, messages, onToken, onReasoning, signal });
  const style = genParams(settings);
  const thinking = thinkingOn(settings);
  const { src, base, key } = ep;
  const isLocal = src === "local";
  const isGoogle = src === "google";
  /* the routing and sampler extras below are OpenRouter's own fields */
  const isOR = src === "openrouter";
  /* any other service: errors are worded with its name */
  const other = !isOR && !isGoogle && !isLocal ? ep.name : null;

  const body = {
    model: activeModel(settings),
    messages: formatOpenAIMessages(messages, activeModel(settings)),
    stream: true,
  };
  /* The sampler, then the cap: when thinking is allowed it has to have its
     own room, or it eats the reply's budget and the visible answer is empty
     or truncated. */
  Object.assign(body, samplerBody(style, ep));
  body.max_tokens = style.max_tokens + (isGoogle ? googleThinkingRoom(thinking) : thinking ? 1200 : 0);
  const tuned = style.tuned;

  /* OpenRouter's switch for models that expose one. Sent on the request as
     well as via the system directive, because between them they cover every
     model: some read only one, some only the other. Sent to every model,
     because a list of the ones that think was always a release behind (MiMo,
     newer GLMs); OpenRouter drops the field for a model with no switch. */
  if (isOR) body.reasoning = thinking ? {} : { enabled: false };

  /* ---------- provider routing ----------

     This one is a real latency lever, unlike the sampler above.

     Left alone, OpenRouter orders providers for a model by price and balances
     load across them, which on a free model means it will happily hand a
     request to a saturated endpoint to save money that is already zero. Asking
     for throughput order sends it to whichever provider is actually serving
     fastest right now.

     Free models only, deliberately. On a paid model the price ordering is
     doing something you want, and sorting by throughput can quietly route to a
     more expensive provider — a surprise on the bill is worse than a second of
     latency. allow_fallbacks keeps a saturated first choice from turning into
     an outright failure. */
  if (isOR && /:free$/.test(body.model || "")) {
    body.provider = { sort: "throughput", allow_fallbacks: true };
  }

  /* ---------- sticky routing ----------

     The system block is the same bytes on every turn of a chat, and it is the
     expensive part of the prompt — the character, the persona, the style. A
     provider that has already processed it holds it in a KV cache and can skip
     straight to the new message, which is prefill time you do not pay twice.

     The catch is that the cache lives on one specific endpoint, and without a
     hint OpenRouter is free to send turn 2 somewhere else, where the prefix is
     cold again. `session_id` is a ten-minute best-effort pin back to whichever
     endpoint answered last, so the cache is there when the next turn arrives.

     The chat id is exactly the right key: it is stable for the life of the
     conversation and different for every other one, so two chats open side by
     side do not fight over the same pin.

     This does nothing for the first message of a chat. There is no cache to
     return to yet, and nothing here changes that. */
  if (isOR && sessionId && settings.stickySession !== false) {
    body.session_id = String(sessionId);
  }

  /* ---------- bounding the queue ----------

     Distinct from the throughput sort above, and it is the one that addresses
     waiting before anything happens at all rather than slow streaming once it
     does.

     A provider that is oversubscribed does not refuse the request, it accepts
     it and parks it. Nothing arrives, no error is raised, and the app can only
     show a spinner. `preferred_max_latency` reads OpenRouter's own rolling
     five-minute percentiles and promotes the endpoints currently answering
     inside the threshold to the front of the candidate list.

     Deliberately soft, which is why it is safe to send on paid models too
     where `sort: throughput` is not: providers that miss the threshold are
     demoted, not removed, so when every endpoint is congested the request
     still runs on the best available one instead of failing. It does not
     override price ordering, it reorders within it.

     2.5s at p90 is a starting point, not a tuned number. Raise it if replies
     start failing over to the fallback chain more than they used to. */
  if (isOR && settings.latencyRouting !== false) {
    body.provider = { ...(body.provider || {}), preferred_max_latency: { p90: 2.5 } };
  }

  /* Fine tuning's strict switch. Without it a provider that does not support
     a value (Top K, Min P and repetition penalty are the usual ones) drops it
     silently and the reply comes back as if it had never been set. This tells
     OpenRouter to route only to providers that honour every value sent; when
     none do, the request fails with a 404 rather than quietly ignoring them. */
  const strict = isOR && !!tuned?.strict;
  if (strict) body.provider = { ...(body.provider || {}), require_parameters: true };

  /* Google's switch for thinking, and usage on the last frame so the ledger
     still counts tokens. It has no price to report. */
  if (isGoogle) {
    Object.assign(body, googleThinking(body.model, thinking));
    body.stream_options = { include_usage: true };
  }
  /* the same token counts from the services known to accept the field */
  if (ep.preset.usage) body.stream_options = { include_usage: true };

  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  /* OpenRouter only: Google's CORS check refuses a header it does not know */
  if (isOR) headers["X-Title"] = "Nova";

  /* The clock starts here, before the request leaves.

     It used to start after the fetch had already resolved, which meant every
     number the app has ever reported excluded the wait for response headers —
     and on a congested endpoint that wait *is* the queue. A reply that took
     eighteen seconds to begin could be logged as two. The measurement was
     quietly hiding the thing it was there to measure. */
  const t0 = Date.now();
  let ttfb = null;

  let res;
  try {
    res = await sendTo(ep, settings, "/chat/completions", {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    if (e instanceof ProviderAddressError) throw e;
    throw new Error(unreachable(ep));
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}
    throw apiError(res, payload, { isLocal, isGoogle, strict, model: body.model, other });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const think = makeThinkFilter();
  let buffer = "";
  let finishReason = null;
  let sawThinking = false;
  let streamError = null;
  /* the model that actually answered, which is not necessarily the one asked
     for once the fallback chain is in play */
  let servedBy = null;
  /* OpenRouter puts token counts and the real charge on the final frame of
     every response. It used to need an opt-in parameter; that is deprecated
     and it now arrives automatically, so this costs nothing to read. */
  let usage = null;
  /* Two numbers, not one, because "it takes forever to start" has two causes
     that want opposite fixes and the single number could not tell them apart.

       ttfb  time until the very first frame of anything arrives, thinking
             included. This is network + queue + prefill. Routing settings move
             it; the prompt and the model do not.

       ttft  time until the first word the user can actually read. On a
             reasoning model the gap between the two is the thinking phase.

     So ttfb high with a small gap means you sat in a queue — that is a routing
     problem. ttfb low with a large gap means the model is thinking — that is a
     model or a thinking-toggle problem. Before this split both looked
     identical from the outside, which is how you end up tuning the wrong one
     for a week. */
  let ttft = null;

  /* Thinking, however it arrives — its own field, or tags inside content. */
  const emitThinking = (s) => {
    if (!s) return;
    sawThinking = true;
    onReasoning?.(s);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const frame = JSON.parse(payload);
        /* Any frame at all ends the waiting phase — a thinking token counts,
           since by then the provider has accepted the work and started. */
        if (ttfb === null) ttfb = Date.now() - t0;
        if (frame?.model) servedBy = frame.model;
        if (frame?.usage) usage = frame.usage;

        /* A rate limit hit *after* the stream opened cannot come back as an
           HTTP 429 — the 200 was already sent — so OpenRouter puts it on the
           frame instead, with finish_reason "error". This was being ignored
           entirely, which is why an exhausted endpoint surfaced as "the model
           returned an empty reply" rather than as the rate limit it was. */
        const err = frame?.error || frame?.choices?.[0]?.error;
        if (err) {
          streamError = err;
          continue;
        }

        const choice = frame?.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const d = choice.delta || {};
        /* providers disagree on the field name for the same thing */
        emitThinking(d.reasoning || d.reasoning_content || null);

        if (d.content) {
          if (ttft === null) ttft = Date.now() - t0;
          const out = think.push(d.content);
          emitThinking(out.reasoning);
          if (out.text) onToken(out.text);
        }
      } catch {}
    }
  }

  /* Raised after the loop so any text that did arrive before the failure is
     still handed back to the caller and saved. */
  if (streamError) {
    throw apiError({ status: streamError.code || 429, headers: emptyHeaders },
      { error: streamError }, { isLocal, isGoogle, strict, model: body.model, other });
  }

  const tail = think.flush();
  emitThinking(tail.reasoning);
  if (tail.text) onToken(tail.text);

  return {
    finishReason,
    sawThinking,
    servedBy,
    ttft,
    ttfb,
    /* only OpenRouter reports a price */
    cost: usage && usage.cost != null ? Number(usage.cost) : null,
    tokensIn: usage ? Number(usage.prompt_tokens || 0) : null,
    tokensOut: usage ? Number(usage.completion_tokens || 0) : null,
  };
}

/* ---------- one-shot JSON call, for the card helper ----------
   Same endpoint as the chat, but unstreamed and asked for strict JSON. Models
   like to wrap JSON in ```json fences or add a sentence of preamble no matter
   how firmly you ask them not to, so the response is scrubbed before parsing
   rather than trusted. */
/* The card writer is picked per provider (settings.writerModels, keyed by
   the provider's id), so switching providers never sends an id the new one
   does not have. Settings from before that map existed still read the old
   single writerModel; normalizeData moves it to the OpenRouter slot. */
export function writerModelOf(settings) {
  const p = providerOf(settings);
  const map = settings?.writerModels;
  if (map && typeof map === "object") return (typeof map[p.id] === "string" && map[p.id]) || activeModel(settings);
  return settings?.writerModel || activeModel(settings);
}

/* the settings patch that picks `id` as the writer for the active provider */
export function writerModelPatch(settings, id) {
  return { writerModels: { ...(settings?.writerModels || {}), [providerOf(settings).id]: id } };
}

/* Thinking room on top of the card's own budget, by requested effort. Only
   used when the caller supplies an output budget. */
const JSON_THINK_ROOM = { low: 2000, medium: 4000, high: 8000 };
const JSON_EFFORTS = new Set(["low", "medium", "high"]);

/* The card writer's output budget. `bodyMax` is what goes on the wire as
   max_tokens (or maxTokens for anthropicRequest, which adds its own room for
   adaptive Claude models); `cap` is the whole allowance, for progress. */
function jsonBudget(settings, opts = {}) {
  const ep = endpointFor(settings);
  const model = writerModelOf(settings);
  const think = settings.writerThinking !== false;
  const thinking = (ep.src === "google" || ep.src === "openrouter") && think;
  const adaptive = ep.protocol === "anthropic" && CLAUDE_ADAPTIVE.test(model);
  const effort = JSON_EFFORTS.has(opts.effort) ? opts.effort : null;
  if (!(opts.maxTokens > 0)) {
    const base = Math.max(16000, completionOutputBudget(settings, 8000));
    if (ep.protocol === "anthropic") return { bodyMax: base, cap: base + (adaptive ? think ? 6000 : 2000 : 0), effort: null };
    const room = ep.src === "google" ? googleThinkingRoom(thinking) : thinking ? 4000 : 0;
    return { bodyMax: base + room, cap: base + room, effort: null };
  }
  const base = Math.round(opts.maxTokens);
  const wanted = JSON_THINK_ROOM[effort || "medium"];
  if (ep.protocol === "anthropic") {
    /* anthropicRequest adds 6000 when an adaptive model thinks; more effort gets the difference */
    const bodyMax = base + (adaptive && think ? Math.max(0, wanted - 6000) : 0);
    return { bodyMax, cap: bodyMax + (adaptive ? think ? 6000 : 2000 : 0), effort };
  }
  /* a provider that reasons when asked for an effort spends it out of max_tokens too */
  const reasons = thinking || (think && effort && (ep.src === "nova-bridge" || EFFORT_MODELS.test(model)));
  const room = ep.src === "google" ? googleThinkingRoom(thinking) : reasons ? wanted : 0;
  const bodyMax = completionOutputBudget(settings, base) + room;
  return { bodyMax, cap: bodyMax, effort };
}

/* `maxTokens` and `effort` ("low" | "medium" | "high") are optional.
   Effort reaches only providers whose
   switch is known here: OpenRouter's reasoning.effort, and reasoning_effort
   for Nova Bridge and OpenAI-format reasoning ids. Gemini keeps its thinking
   flag (it rejects both at once) and Claude decides for itself; for those,
   only the budget changes. */
export function completeJson(opts) {
  const model = writerModelOf(opts.settings);
  return modelActivityRequest(opts, completeJsonRequest, jsonBudget(opts.settings, opts).cap, model);
}

async function completeJsonRequest({ settings, system, user, signal, onReasoning, onProgress, maxTokens, effort }) {
  const budget = jsonBudget(settings, { maxTokens, effort });
  const ep = endpointFor(settings);
  const model = writerModelOf(settings);
  if (!model) throw new Error(noModel(ep));
  const { src, base, key } = ep;
  const isLocal = src === "local";
  const isGoogle = src === "google";
  const isOR = src === "openrouter";
  const other = !isOR && !isGoogle && !isLocal ? ep.name : null;
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (isOR) headers["X-Title"] = "Nova";

  /* The card writer has its own model setting, falling back to the chat's
     when it is unset. Writing a card is a different job from playing a scene
     — one structured JSON reply where obeying the shape matters more than
     voice — and it is a single request, so a stricter or larger model here
     costs almost nothing over an evening. */

  /* ---------- why this thinks now, when the chat does not ----------

     The chat turns thinking off by default, and that is right: in a scene you
     are waiting on the reply and thinking is time spent before the first word
     appears.

     A card is the opposite. It is one request, it is not a conversation, and
     the work is structural — deciding what a person wants and how that
     conflicts with what they have, then writing it consistently across four
     fields. That is exactly what a reasoning pass is for, and there is nobody
     waiting mid-sentence for it.

     It also stops being dead time: the thinking is streamed to the sheet, so
     the wait shows the character being worked out rather than a spinner. */
  const thinking = (isGoogle || isOR) && settings.writerThinking !== false;
  const directive = thinkDirective(model, thinking);
  const sys = directive ? `${directive}\n\n${system}` : system;

  /* Anthropic's format: the same request, its own wire shape. Claude decides
     for itself how much to think, so the switch above only applies to the
     models that have one. */
  if (ep.protocol === "anthropic") {
    let text = "";
    const out = await anthropicRequest({
      ep, model, system: sys, messages: [{ role: "user", content: user }],
      maxTokens: budget.bodyMax, temperature: 0.8, thinking: settings.writerThinking !== false, signal,
      onText: (t) => { text += t; onProgress?.(text.length); },
      onThinking: (t) => onReasoning?.(t),
    });
    return parseJsonReply(text, out?.finishReason);
  }

  let res;
  try {
    res = await sendTo(ep, settings, "/chat/completions", {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.8,
        /* 2000 was the real ceiling on how much the writer would produce, and
           it was not a deliberate one — it was sized for the old three-field
           card. A detailed character with several openings and example
           dialogue does not fit in it, so the model would either truncate
           mid-JSON (surfacing as "malformed") or, more often, quietly write
           short to stay inside the budget. Writing short to fit is invisible:
           the JSON parses, the card looks fine, and you conclude the model is
           just terse.

           Thinking gets its own allowance on top rather than eating the
           card's, which was the other half of the same bug. */
        max_tokens: budget.bodyMax,
        stream: true,
        ...(isOR ? { reasoning: thinking ? budget.effort ? { effort: budget.effort } : {} : { enabled: false } } : {}),
        /* the bridge and OpenAI-format reasoning ids take an effort level; off is the lowest */
        ...(budget.effort && !isOR && !isGoogle && (src === "nova-bridge" || EFFORT_MODELS.test(model))
          ? { reasoning_effort: settings.writerThinking !== false ? budget.effort : "low" } : {}),
        ...(isGoogle ? googleThinking(model, thinking) : {}),
      }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    if (e instanceof ProviderAddressError) throw e;
    throw new Error(unreachable(ep));
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}
    throw apiError(res, payload, { isLocal, isGoogle, model, other });
  }

  /* Streamed purely so the thinking can be shown while it happens. The JSON
     itself is still assembled whole and parsed once at the end — a partial
     object is not worth trying to render. */
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let streamError = null;
  let finishReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const frame = JSON.parse(payload);
        const err = frame?.error || frame?.choices?.[0]?.error;
        if (err) { streamError = err; continue; }
        finishReason = frame?.choices?.[0]?.finish_reason ?? finishReason;
        const d = frame?.choices?.[0]?.delta || {};
        const r = d.reasoning || d.reasoning_content;
        if (r) onReasoning?.(r);
        if (d.content) { text += d.content; onProgress?.(text.length); }
      } catch {}
    }
  }

  if (streamError) {
    throw apiError({ status: streamError.code || 429, headers: emptyHeaders },
      { error: streamError }, { isLocal, isGoogle, model, other });
  }

  return parseJsonReply(text, finishReason);
}

/* The card writer's reply, read through the shared model-JSON reader (src/lib/json.js). The result is the parsed
   object; when the reply was cut off at the token cap, a non-enumerable `truncated` flag says so. A failure is
   a ModelJsonError (`raw`, `reason`) with `truncated` set when the model stopped on length. */
export { repairJsonRequest };
function parseJsonReply(text, finishReason = null) {
  const cut = finishReason === "length";
  try {
    const { value, truncated } = parseModelJson(text, { root: "object" });
    Object.defineProperty(value, "truncated", { value: truncated || cut, enumerable: false, configurable: true });
    return value;
  } catch (e) {
    if (e instanceof ModelJsonError) e.truncated = cut;
    throw e;
  }
}

/* ---------- model lists ----------

   Every provider is asked for its own list. Only what the service itself
   reports is kept: a name, the context size where it gives one, and a price
   only in OpenRouter's per-token shape, which is the one format that can be
   read without guessing. Anything else shows no price rather than a wrong
   one. */

/* OpenRouter's per-token prices, as numbers, or null. Its routers report -1
   for "depends", which is no price at all. */
function readPricing(pr) {
  if (!pr || typeof pr !== "object") return null;
  const i = Number(pr.prompt);
  const o = Number(pr.completion);
  if (!Number.isFinite(i) || !Number.isFinite(o) || i < 0 || o < 0) return null;
  return { prompt: i, completion: o };
}

export async function fetchOpenAIModels(base, key) {
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const res = await send(`${base.replace(/\/+$/, "")}/models`, { headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(res.status === 401 || res.status === 403 ? "The key was rejected." : unwrapError(data)?.error?.message || `The model list answered with error ${res.status}.`);
    e.status = res.status;
    throw e;
  }
  const rows = Array.isArray(data) ? data : data?.data || data?.models || [];
  return rows
    .filter((m) => m && (m.id || m.name))
    .map((m) => {
      const id = String(m.id || m.name);
      const pricing = readPricing(m.pricing);
      return {
        id,
        name: String(m.name || id).replace(/\s*\(free\)\s*$/i, ""),
        ctx: m.context_length || m.context_window || m.max_model_len || m.max_context_length || null,
        modality: m.architecture?.output_modalities || null,
        input: m.architecture?.input_modalities || null,
        pricing,
        free: id.endsWith(":free") || (!!pricing && pricing.prompt === 0 && pricing.completion === 0),
      };
    });
}

export function prettyCtx(n) {
  if (!n) return null;
  if (n >= 1000000) return `${Math.round(n / 1000000)}M context`;
  if (n >= 1000) return `${Math.round(n / 1000)}K context`;
  return `${n} context`;
}

/* Everything that reads text and writes only text — which is what a chat
   needs. Embedding, reranking and moderation endpoints are caught by id, and
   image or audio generators by their output where the service says. */
export function textModels(list) {
  return list.filter((m) =>
    !NON_CHAT.test(m.id) &&
    (!m.modality || (m.modality.includes("text") && m.modality.every((x) => x === "text"))) &&
    (!m.input || m.input.includes("text"))
  );
}

/* The live OpenRouter catalogue, fetched once per app session and reused,
   so reopening the picker is instant. Ten minutes is plenty for prices that
   change weekly. It needs no key. */
export let CATALOGUE = null;

export function loadCatalogue() {
  if (CATALOGUE && Date.now() - CATALOGUE.at < 10 * 60 * 1000) return CATALOGUE.promise;
  const promise = fetchOpenAIModels("https://openrouter.ai/api/v1").then(textModels);
  CATALOGUE = { at: Date.now(), promise };
  promise.catch(() => { CATALOGUE = null; });
  return promise;
}

async function fetchAnthropicModels(base, key, custom) {
  const out = [];
  let after = "";
  for (let page = 0; page < 10; page++) {
    const res = await providerFetch(`${base}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`, { headers: anthropicHeaders(key, custom) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = new Error(res.status === 401 || res.status === 403 ? "The key was rejected." : data?.error?.message || `The model list answered with error ${res.status}.`);
      e.status = res.status;
      throw e;
    }
    for (const m of data?.data || []) {
      out.push({ id: m.id, name: m.display_name || m.id, ctx: m.max_input_tokens || null, pricing: null, free: false });
    }
    if (!data?.has_more || !data?.last_id) break;
    after = data.last_id;
  }
  return out;
}

/* Whether any provider has ever answered with its model list: the setup
   marker (Settings, its Model tab) stays until one has. */
export const SEEN_KEY = "nova-models-seen";
export const modelsSeen = () => { try { return localStorage.getItem(SEEN_KEY) === "1"; } catch { return false; } };
function markModelsSeen() {
  if (modelsSeen()) return;
  try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* private mode */ }
  window.dispatchEvent(new Event(SEEN_KEY));
}

/* Per provider, keyed on everything that changes the answer, so a new key or
   address asks again. */
const MODEL_LISTS = new Map();

/* One provider's chat models, for the picker and for "Test connection".
   Custom providers add the ids typed in by hand, first, for servers whose
   own list is missing or incomplete. */
export function fetchProviderModels(provider, { fresh = false } = {}) {
  if (provider.preset === "nova-bridge" && provider.pairedBase && provider.pairedBase !== provider.base) return Promise.reject(new Error("Request device access again for the new Bridge address."));
  const pre = presetOf(provider.preset);
  const base = String(provider.base || pre.base || "").trim().replace(/\/+$/, "");
  const key = (provider.key || "").trim();
  const cacheKey = `${provider.id}|${base}|${key}|${provider.protocol}`;
  const hit = MODEL_LISTS.get(cacheKey);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.promise;

  const name = provider.name || pre.name;
  const load = async () => {
    let list;
    try {
      if (provider.preset === "openrouter") list = await loadCatalogue();
      else if (provider.preset === "google") list = (await fetchGoogleModels(key)).map((m) => ({ id: m.id, name: m.name, ctx: m.ctx, pricing: null, free: false }));
      else if (provider.protocol === "anthropic") list = await fetchAnthropicModels(base, key, provider.preset === "custom");
      else list = textModels(await fetchOpenAIModels(base, key));
    } catch (e) {
      if (e instanceof ProviderAddressError) throw e;
      if (e.status === 401 || e.status === 403) throw new Error(`${name} rejected the key.`);
      if (e.status) throw new Error(`${name}: ${e.message}`);
      throw new Error(unreachable({ src: provider.preset === "custom" && isLocalProvider(provider) ? "local" : provider.preset, name }));
    }
    const typed = (provider.models || []).filter((id) => !list.some((m) => m.id === id));
    return [...typed.map((id) => ({ id, name: id, ctx: null, pricing: null, free: false })), ...list];
  };
  const promise = load();
  promise.then((l) => { if (l.length) markModelsSeen(); }, () => {});
  MODEL_LISTS.set(cacheKey, { at: Date.now(), promise });
  promise.catch(() => MODEL_LISTS.delete(cacheKey));
  return promise;
}

/* ---------- one-shot text, for the memory and scene notes ----------

   The chat's own source and model, thinking off, low temperature by
   default: bookkeeping, where getting the facts right matters. Returns the
   text and whatever usage the provider reported, so the ledger can count it.

   `stream: true` (the chat side jobs) reads the reply as it arrives. Nothing
   is faster end to end, but `onProgress` hears every chunk, so a caller can
   treat its timeout as "silent for too long" rather than "took too long".
   A server that ignores the flag and sends one JSON body is read the old
   way. */

/* OpenAI-format reasoning models that take an effort level; anything else
   could reject the field, so it is sent only to these ids. */
const EFFORT_MODELS = /(^|\/)(o[1-9](-|$)|gpt-5|gpt-oss)/i;
const stripThink = (s) => String(s || "").replace(/<(think|thinking|thought)>[\s\S]*?<\/\1>/gi, "").trim();

export function completionOutputBudget(settings, maxTokens, effort = "inherit") {
  const ep = endpointFor(settings);
  return maxTokens + ((ep.src === "google" || (ep.src === "nova-bridge" && /gemini/i.test(activeModel(settings)))) ? googleThinkingRoom(effort !== "low") : 0);
}

export function completeText(opts) {
  const ep = endpointFor(opts.settings);
  const model = activeModel(opts.settings);
  const maxTokens = opts.maxTokens ?? 900;
  const cap = ep.protocol === "anthropic" ? maxTokens + (CLAUDE_ADAPTIVE.test(model) ? 2000 : 0) : completionOutputBudget(opts.settings, maxTokens, opts.reasoningEffort ?? "low");
  return modelActivityRequest(opts, completeTextRequest, cap);
}

async function completeTextRequest({ settings, system, user, maxTokens = 900, signal, temperature = 0.3, stream = false, onProgress, onResponse, onReasoning, reasoningEffort = "low" }) {
  const ep = endpointFor(settings);
  if (!activeModel(settings)) throw new Error(noModel(ep));
  const { src, key } = ep;
  const isLocal = src === "local";
  const isGoogle = src === "google";
  const isOR = src === "openrouter";
  const other = !isOR && !isGoogle && !isLocal ? ep.name : null;
  const headers = { "Content-Type": "application/json" };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (isOR) headers["X-Title"] = "Nova";

  const model = activeModel(settings);
  const directive = thinkDirective(model, reasoningEffort === "inherit" || reasoningEffort === "medium" || reasoningEffort === "high");
  const sys = directive ? `${directive}\n\n${system}` : system;
  if (ep.protocol === "anthropic") {
    let text = "";
    const res = await anthropicRequest({
      ep, model, system: sys,
      messages: [{ role: "user", content: user }],
      maxTokens, temperature, thinking: false, signal, cacheSystem: true,
      onText: (t) => { text += t; onProgress?.(t); },
      onThinking: onReasoning,
    });
    return { text: text.trim(), servedBy: res.servedBy, cost: null, tokensIn: res.tokensIn, tokensOut: res.tokensOut, finishReason: res.finishReason || null };
  }
  /* Claude through OpenRouter caches only what is marked; the system prompt is the long, repeated part */
  const cacheable = isOR && /(^|\/)(anthropic|claude)/i.test(model);
  const body = {
    model,
    messages: [
      { role: "system", content: cacheable ? [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }] : sys },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: completionOutputBudget(settings, maxTokens, reasoningEffort),
    stream: !!stream,
    ...(stream && (isGoogle || ep.preset?.usage) ? { stream_options: { include_usage: true } } : {}),
    /* the bridge otherwise reasons at "medium" with no cap, which turns bookkeeping into minutes */
    ...(ep.src === "nova-bridge" && reasoningEffort !== "inherit" ? { reasoning_effort: reasoningEffort } : {}),
    ...(isOR && reasoningEffort !== "inherit" ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(isGoogle && /gemini/i.test(model) && reasoningEffort !== "inherit" ? { reasoning_effort: reasoningEffort } : {}),
    /* any other OpenAI-format reasoning model thinks at its own default (often "medium") unless told */
    ...(!isOR && !isGoogle && ep.src !== "nova-bridge" && reasoningEffort !== "inherit" && EFFORT_MODELS.test(model) ? { reasoning_effort: reasoningEffort } : {}),
  };
  /* the same routing the chat uses, so a busy free endpoint is avoided */
  if (isOR && /:free$/.test(model)) body.provider = { sort: "throughput", allow_fallbacks: true };

  let res;
  try {
    res = await sendTo(ep, settings, "/chat/completions", { method: "POST", signal, headers, body: JSON.stringify(body) });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    if (e instanceof ProviderAddressError) throw e;
    throw new Error(unreachable(ep));
  }
  onResponse?.();
  /* some local servers stream without saying so; only a JSON body is read whole */
  const sse = stream && res.ok && !!res.body?.getReader && !/json/i.test(res.headers?.get?.("content-type") || "");
  if (!sse) {
    const raw = await res.text().catch(() => "");
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}
    if (!res.ok || payload?.error) throw apiError(res.ok ? { status: payload.error.code || 500, headers: emptyHeaders } : res, payload, { isLocal, isGoogle, model, other });
    const msg = payload?.choices?.[0]?.message || {};
    const usage = payload?.usage || null;
    if (msg.reasoning || msg.reasoning_content) onReasoning?.(msg.reasoning || msg.reasoning_content);
    if (msg.content) onProgress?.(stripThink(msg.content));
    return {
      text: stripThink(msg.content),
      finishReason: payload?.choices?.[0]?.finish_reason || null,
      servedBy: payload?.model || null,
      cost: usage && usage.cost != null ? Number(usage.cost) : null,
      tokensIn: usage ? Number(usage.prompt_tokens || 0) : null,
      tokensOut: usage ? Number(usage.completion_tokens || 0) : null,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", text = "", servedBy = null, usage = null, streamError = null, finishReason = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const ln of lines) {
      const t = ln.trim();
      if (!t.startsWith("data:")) continue;
      const data = t.slice(5).trim();
      if (data === "[DONE]") continue;
      let frame;
      try { frame = JSON.parse(data); } catch { continue; }
      if (frame?.model) servedBy = frame.model;
      if (frame?.usage) usage = frame.usage;
      const err = frame?.error || frame?.choices?.[0]?.error;
      if (err) { streamError = err; continue; }
      if (frame?.choices?.[0]?.finish_reason) finishReason = frame.choices[0].finish_reason;
      const d = frame?.choices?.[0]?.delta || {};
      const piece = d.content || "";
      if (d.reasoning || d.reasoning_content) onReasoning?.(d.reasoning || d.reasoning_content);
      /* thinking is a sign of life too; it just is not kept */
      if (piece || d.reasoning || d.reasoning_content) onProgress?.(piece);
      if (piece) text += piece;
    }
  }
  if (streamError) throw apiError({ status: streamError.code || 429, headers: emptyHeaders }, { error: streamError }, { isLocal, isGoogle, model, other });
  return {
    text: stripThink(text),
    finishReason,
    servedBy,
    cost: usage && usage.cost != null ? Number(usage.cost) : null,
    tokensIn: usage ? Number(usage.prompt_tokens || 0) : null,
    tokensOut: usage ? Number(usage.completion_tokens || 0) : null,
  };
}

/* ---------- Anthropic's format ----------

   For Anthropic itself and for any Anthropic-compatible address (relays,
   proxies). Same job as the OpenAI-format path above, in Anthropic's wire
   shape: the system prompt is its own field, the conversation must start on
   a user turn and alternate, and the stream arrives as typed events rather
   than choice deltas. */

const ANTHROPIC_VERSION = "2023-06-01";

/* The browser header is what lets a web page call Anthropic directly; the key
   is the user's own, typed into their own device. A custom relay also gets
   it as a bearer token, which is how most proxies expect it. */
export function anthropicHeaders(key, custom = false) {
  const h = {
    "Content-Type": "application/json",
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (key) {
    h["x-api-key"] = key;
    if (custom) h.Authorization = `Bearer ${key}`;
  }
  return h;
}

/* Claude models from 4.6 on decide for themselves how much to think and take
   an effort level; the newest refuse temperature and top_p outright. Ids
   that are not Claude's (a relay in front of something else) get neither
   rule and are sent the plain sampler. */
const CLAUDE_ADAPTIVE = /^claude-(fable|mythos|opus-(5|4-[6-9])|sonnet-(5|4-6)|haiku-5)/;
const CLAUDE_NO_SAMPLING = /^claude-(fable|mythos|opus-(5|4-[78])|sonnet-5|haiku-5)/;

/* OpenAI-shaped messages to Anthropic's: system turns lifted out, same-role
   neighbours merged, and a user turn put first and last where the
   conversation lacks one — a chat usually opens on the character's greeting,
   and a trailing assistant turn would be read as a prefill, which current
   Claude models refuse. */
export function toAnthropicMessages(messages, model) {
  const system = [];
  const out = [];
  const visionSupported = !model || supportsVision(model);

  for (const m of messages) {
    if (!m) continue;
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content.trim() : "";
      if (text) system.push(text);
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    let content;

    if (Array.isArray(m.content)) {
      content = m.content;
    } else if (m.images && m.images.length > 0) {
      if (!visionSupported) {
        const fallbacks = m.images.map((img) => "[Attached image: " + (typeof img === "string" ? "image" : img.name || "image") + "]");
        content = m.content ? m.content + "\n" + fallbacks.join("\n") : fallbacks.join("\n");
      } else {
        content = [
          { type: "text", text: m.content || "" },
          ...m.images.map((img) => {
            const match = (img.url || img).match(/^data:([^;]+);base64,(.+)$/);
            return match
              ? { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } }
              : { type: "text", text: "[Image attached]" };
          }),
        ];
      }
    } else {
      content = typeof m.content === "string" ? m.content.trim() : (m.content || "");
    }

    if (!content || (typeof content === "string" && !content.trim()) || (Array.isArray(content) && !content.length)) {
      continue;
    }

    const last = out[out.length - 1];
    if (last && last.role === role) {
      if (Array.isArray(last.content) || Array.isArray(content)) {
        const toParts = (c) => Array.isArray(c) ? c : [{ type: "text", text: String(c || "") }];
        last.content = [...toParts(last.content), ...toParts(content)];
      } else {
        last.content += "\n\n" + content;
      }
    } else {
      out.push({ role, content });
    }
  }
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", content: "(The scene begins.)" });
  if (out[out.length - 1].role !== "user") out.push({ role: "user", content: "(Continue.)" });
  return { system: system.join("\n\n"), messages: out };
}

const ANTHROPIC_STOP = { end_turn: "stop", stop_sequence: "stop", max_tokens: "length", refusal: "content_filter" };

/* The sampler fields Anthropic takes: none at all on the newest models,
   and a temperature no higher than 1 on the rest. */
function anthropicSampling(model, { temperature, topP, topK }) {
  const out = {};
  if (CLAUDE_NO_SAMPLING.test(model)) return out;
  if (temperature != null) out.temperature = Math.min(1, temperature);
  if (topP != null) out.top_p = topP;
  if (topK > 0) out.top_k = Math.round(topK);
  return out;
}

/* One streamed request in Anthropic's format. Text and thinking are handed
   out as they arrive; the result has the same shape streamChat returns. */
export async function anthropicRequest({ ep, model, system = "", messages, maxTokens, temperature, topP, topK, thinking, signal, onText, onThinking, cacheSystem = false }) {
  const conv = toAnthropicMessages(messages, model);
  const sys = [system, conv.system].filter(Boolean).join("\n\n");
  const adaptive = CLAUDE_ADAPTIVE.test(model);
  const body = {
    model,
    /* thinking on these models counts against the cap, so it gets room */
    max_tokens: maxTokens + (adaptive ? (thinking ? 6000 : 2000) : 0),
    messages: conv.messages,
    stream: true,
  };
  /* a long system prompt sent again and again is marked for the prompt cache */
  if (sys) body.system = cacheSystem ? [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }] : sys;
  Object.assign(body, anthropicSampling(model, { temperature, topP, topK }));
  /* On: think as much as it likes, with a readable summary for the thinking
     panel. Off: the lowest effort, which is as close to off as the newest
     models allow, and fast. */
  if (adaptive) {
    if (thinking) body.thinking = { type: "adaptive", display: "summarized" };
    else body.output_config = { effort: "low" };
  }

  const custom = ep.preset.id === "custom";
  const t0 = Date.now();
  let ttfb = null;
  let ttft = null;
  let res;
  try {
    res = await providerFetch(`${ep.base}/messages`, { method: "POST", signal, headers: anthropicHeaders(ep.key, custom), body: JSON.stringify(body) });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    if (e instanceof ProviderAddressError) throw e;
    throw new Error(unreachable(ep));
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}
    throw providerError(res, payload, { name: ep.name, model });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finishReason = null;
  let sawThinking = false;
  let servedBy = null;
  let tokensIn = null;
  let tokensOut = null;
  let streamError = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      let ev;
      try { ev = JSON.parse(t.slice(5).trim()); } catch { continue; }
      if (ttfb === null) ttfb = Date.now() - t0;
      if (ev.type === "message_start") {
        servedBy = ev.message?.model || null;
        const u = ev.message?.usage || {};
        tokensIn = Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
      } else if (ev.type === "content_block_delta") {
        const d = ev.delta || {};
        if (d.type === "text_delta" && d.text) {
          if (ttft === null) ttft = Date.now() - t0;
          onText?.(d.text);
        } else if (d.type === "thinking_delta" && d.thinking) {
          sawThinking = true;
          onThinking?.(d.thinking);
        }
      } else if (ev.type === "message_delta") {
        if (ev.delta?.stop_reason) finishReason = ANTHROPIC_STOP[ev.delta.stop_reason] || ev.delta.stop_reason;
        if (ev.usage?.output_tokens != null) tokensOut = Number(ev.usage.output_tokens);
      } else if (ev.type === "error") {
        streamError = ev.error || { message: "The stream ended with an error." };
      }
    }
  }

  if (streamError) {
    const status = streamError.type === "overloaded_error" ? 529 : streamError.type === "rate_limit_error" ? 429 : 500;
    throw providerError({ status, headers: emptyHeaders }, { error: streamError }, { name: ep.name, model });
  }

  return { finishReason, sawThinking, servedBy, ttft, ttfb, cost: null, tokensIn, tokensOut };
}

/* The chat's reply in Anthropic's format, from the same style settings the
   OpenAI-format path reads. */
function streamAnthropic({ settings, ep, messages, onToken, onReasoning, signal }) {
  const style = genParams(settings);
  const tuned = style.tuned;
  return anthropicRequest({
    ep,
    model: activeModel(settings),
    messages,
    maxTokens: style.max_tokens,
    temperature: style.temperature,
    topP: tuned ? tuned.top_p : null,
    topK: tuned ? tuned.top_k : 0,
    thinking: thinkingOn(settings),
    signal,
    onText: onToken,
    onThinking: onReasoning,
  });
}
