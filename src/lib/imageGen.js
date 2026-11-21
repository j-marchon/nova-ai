import { version } from "../../package.json";
import { providerFetch } from "./providerTransport.js";
/* ============================================================
   Image Generation Subsystem
   Multi-backend client: AI Horde, OpenAI, SD WebUI, ComfyUI
   ============================================================ */

import { withRequestActivity } from "./api.js";

function waitForPoll(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export const DEFAULT_NEGATIVE_PROMPT =
  "blurry, low quality, distorted, extra limbs, bad anatomy, deformed, watermark, signature";

export const ASPECT_RATIOS = [
  { id: "portrait", label: "Portrait 2:3", width: 512, height: 768, openAiSize: "1024x1792" },
  { id: "square", label: "Square 1:1", width: 512, height: 512, openAiSize: "1024x1024" },
  { id: "landscape", label: "Landscape 16:9", width: 768, height: 432, openAiSize: "1792x1024" },
];

export const IMAGE_PROVIDERS = [
  { id: "ai_horde", label: "AI Horde", needsKey: false, defaultEndpoint: "https://aihorde.net/api/v2" },
  { id: "openai", label: "OpenAI", needsKey: true, defaultEndpoint: "https://api.openai.com/v1" },
  { id: "sd_webui", label: "SD WebUI", needsKey: false, defaultEndpoint: "http://127.0.0.1:7860" },
  { id: "comfyui", label: "ComfyUI", needsKey: false, defaultEndpoint: "http://127.0.0.1:8188" },
];

/* ---------- where pictures come from ----------

   `settings.imageGen.provider` is either one of the services above, or
   "saved:<id>": a provider already set up in the Providers tab whose key
   and address are reused, so nothing is typed twice. Nova Bridge makes
   pictures with a connected ChatGPT subscription; an OpenAI key makes them
   with its Images API. Both speak the OpenAI images format. */
export const SAVED_IMAGE_PRESETS = ["nova-bridge", "openai"];
export const savedImageProviders = (settings) =>
  (settings?.providers || []).filter((p) => SAVED_IMAGE_PRESETS.includes(p.preset));

/* the choices a picker shows: saved providers first, then the services */
export function imageChoices(settings) {
  const saved = savedImageProviders(settings).map((p) => ({
    id: `saved:${p.id}`,
    label: p.name || (p.preset === "nova-bridge" ? "Nova Bridge" : "OpenAI"),
    sub: p.preset === "nova-bridge" ? "ChatGPT subscription through the Bridge" : "OpenAI Images API",
  }));
  return [
    ...saved,
    { id: "ai_horde", label: "AI Horde", sub: "Free, community run; can be slow" },
    { id: "sd_webui", label: "SD WebUI", sub: "AUTOMATIC1111 / SD.Next on your computer" },
    { id: "comfyui", label: "ComfyUI", sub: "ComfyUI on your computer" },
  ];
}

/* The request settings for the chosen source: { provider, apiKey,
   endpoint, model }, or null when it cannot work (a saved provider that
   was removed, an OpenAI choice with no key). */
export function resolveImageBackend(settings, cfg = settings?.imageGen || {}) {
  const id = cfg.provider || "ai_horde";
  const model = cfg.model?.trim() || undefined;
  if (id.startsWith("saved:")) {
    const p = (settings?.providers || []).find((x) => x.id === id.slice(6));
    if (!p || !SAVED_IMAGE_PRESETS.includes(p.preset)) return null;
    const bridge = p.preset === "nova-bridge";
    if (bridge && p.pairedBase && p.base !== p.pairedBase) return null;
    if (!bridge && !p.key) return null;
    return { provider: "openai", apiKey: p.key || "", endpoint: p.base, model, bridge };
  }
  if (id === "openai" || id === "dall-e") {
    /* older settings: a typed key, or the first saved OpenAI one */
    const key = cfg.apiKey?.trim() || savedImageProviders(settings).find((p) => p.preset === "openai")?.key || "";
    return key ? { provider: "openai", apiKey: key, endpoint: cfg.endpoint?.trim() || undefined, model } : null;
  }
  if (!IMAGE_PROVIDERS.some((p) => p.id === id)) return null;
  return { provider: id, apiKey: cfg.apiKey?.trim() || "", endpoint: cfg.endpoint?.trim() || undefined, model };
}

export function resolveDimensions(aspectRatioId = "portrait") {
  const match = ASPECT_RATIOS.find((r) => r.id === aspectRatioId) || ASPECT_RATIOS[0];
  return { width: match.width, height: match.height, openAiSize: match.openAiSize };
}

/* ---------- Prompt Builder ---------- */

/**
 * Automatically extracts character appearance, location, atmosphere, and scene
 * description to construct an evocative prompt for image generation backends.
 */
export function buildSceneVisualPrompt({ character, scene, messageText, universe } = {}) {
  const parts = [];

  // 1. Character visual extraction
  if (character) {
    const charParts = [];
    const desc = String(character.description || "");

    // Check for explicit Appearance(...) or Appearance: ...
    const appMatch =
      desc.match(/(?:appearance|visuals?|looks?|physical(?:\s+appearance)?)\s*[:=]\s*([^\n]+)/i) ||
      desc.match(/Appearance\s*\(([^)]+)\)/i);

    if (appMatch && appMatch[1]?.trim()) {
      charParts.push(appMatch[1].trim());
    } else {
      // Extract specific attributes if structured
      const hair = desc.match(/hair\s*[:=]\s*([^\n,;]+)/i);
      const eyes = desc.match(/eyes?\s*[:=]\s*([^\n,;]+)/i);
      const outfit = desc.match(/(?:clothes|clothing|outfit|attire|dress)\s*[:=]\s*([^\n]+)/i);

      if (hair && hair[1]?.trim()) charParts.push(`${hair[1].trim()} hair`);
      if (eyes && eyes[1]?.trim()) charParts.push(`${eyes[1].trim()} eyes`);
      if (outfit && outfit[1]?.trim()) charParts.push(outfit[1].trim());

      // If no structured matches, extract descriptive sentences
      if (charParts.length === 0 && desc.trim()) {
        const sentences = desc
          .split(/[.\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const visualSentence = sentences.find((s) =>
          /hair|eyes|tall|short|wearing|dressed|skin|horns|wings|ears|slender|muscular|cloak|dress|suit/i.test(s)
        );
        if (visualSentence) {
          charParts.push(visualSentence);
        } else if (sentences[0]) {
          charParts.push(sentences[0]);
        }
      }
    }

    if (charParts.length > 0) {
      parts.push(charParts.join(", "));
    }
  }

  // 2. Scene details extraction
  if (scene) {
    const sceneText = typeof scene === "string" ? scene : scene.text || "";
    if (sceneText) {
      // Parse Nova scene tracker: [day, date | time | location | weather, temp]
      const trackerHeader = sceneText.match(/\[([^\]|]+)\s*\|\s*([^\]|]+)\s*\|\s*([^\]|]+)\s*\|\s*([^\]|]+)\]/);
      if (trackerHeader) {
        const time = trackerHeader[2].trim();
        const loc = trackerHeader[3].trim();
        const weather = trackerHeader[4].trim();
        if (loc) parts.push(`location: ${loc}`);
        if (time || weather) {
          parts.push([time, weather].filter(Boolean).join(", "));
        }
      } else {
        const locMatch = sceneText.match(/(?:location|place|setting)\s*[:=]\s*([^\n]+)/i);
        if (locMatch && locMatch[1]?.trim()) {
          parts.push(`location: ${locMatch[1].trim()}`);
        }
      }

      // Check for character-specific tracker row: [CharacterName: current appearance, clothing, state.]
      if (character?.name) {
        const charStateRegex = new RegExp(`\\[${character.name}\\s*:\\s*([^\\]]+)\\]`, "i");
        const charStateMatch = sceneText.match(charStateRegex);
        if (charStateMatch && charStateMatch[1]?.trim()) {
          parts.push(charStateMatch[1].trim());
        }
      }
    } else if (typeof scene === "object") {
      if (scene.location) parts.push(`location: ${scene.location}`);
      if (scene.time || scene.weather) {
        parts.push([scene.time, scene.weather].filter(Boolean).join(", "));
      }
    }
  }

  // 3. Universe context
  if (universe) {
    if (universe.name && !parts.some((p) => p.includes(universe.name))) {
      parts.push(`world of ${universe.name}`);
    }
    if (universe.description) {
      const firstSentence = universe.description.split(/[.\n]/)[0]?.trim();
      if (firstSentence && firstSentence.length < 80) {
        parts.push(firstSentence);
      }
    }
  }

  // 4. Message text actions & narration
  if (messageText) {
    const asterisks = [...messageText.matchAll(/\*([^*]+)\*/g)].map((m) => m[1].trim());
    if (asterisks.length > 0) {
      const visualAction = asterisks.sort((a, b) => b.length - a.length)[0];
      if (visualAction && visualAction.length > 5) {
        parts.push(visualAction.slice(0, 150));
      }
    } else {
      const narration = messageText.replace(/"[^"]*"/g, "").trim();
      if (narration.length > 10) {
        const clean = narration.split(/[.\n]/)[0]?.trim();
        if (clean) parts.push(clean.slice(0, 120));
      }
    }
  }

  // 5. Cinematic aesthetic enhancers
  parts.push("masterpiece, highly detailed, atmospheric lighting, cinematic composition");

  // Clean, deduplicate and join
  const joined = parts
    .filter(Boolean)
    .join(", ")
    .replace(/\s*,\s*,+/g, ", ")
    .trim();

  return joined;
}

/* ---------- AI Horde Client ---------- */

export async function generateImageAIHorde({
  prompt,
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  apiKey = "0000000000",
  endpoint = "https://aihorde.net/api/v2",
  width = 512,
  height = 512,
  steps = 25,
  sampler = "k_euler_a",
  model = "stable_diffusion",
  timeout = 90000,
  pollInterval = typeof globalThis !== "undefined" && globalThis.IS_REACT_ACT_ENVIRONMENT ? 1 : 1500,
  signal,
  onProgress,
} = {}) {
  const base = (endpoint || "https://aihorde.net/api/v2").replace(/\/+$/, "");
  const effectiveKey = apiKey?.trim() || "0000000000";

  const res = await providerFetch(`${base}/generate/async`, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      apikey: effectiveKey,
      "Client-Agent": `nova:${version}:github.com/nova-rp`,
    },
    body: JSON.stringify({
      prompt: negativePrompt ? `${prompt} ### ${negativePrompt}` : prompt,
      params: {
        steps: steps || 25,
        width: width || 512,
        height: height || 512,
        sampler_name: sampler || "k_euler_a",
        cfg_scale: 7,
        n: 1,
      },
      models: model ? [model] : ["stable_diffusion"],
      nsfw: true,
      censor_nsfw: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI Horde request failed (${res.status}): ${errText || res.statusText}`);
  }

  const initData = await res.json();
  const id = initData.id;
  if (!id) {
    throw new Error("AI Horde did not return a generation ID");
  }

  // Poll check endpoint until ready or timeout
  const startTime = Date.now();
  let initialWait = initData.wait_time > 0 ? initData.wait_time : null;
  while (Date.now() - startTime < timeout) {
    await waitForPoll(pollInterval, signal);
    const checkRes = await providerFetch(`${base}/generate/check/${id}`, {
      signal,
      headers: { "Client-Agent": `nova:${version}:github.com/nova-rp` },
    });
    if (!checkRes.ok) continue;
    const checkData = await checkRes.json();
    if (initialWait === null && checkData.wait_time > 0) initialWait = checkData.wait_time;
    if (initialWait && Number.isFinite(checkData.wait_time)) onProgress?.(Math.max(0, Math.min(0.95, 1 - checkData.wait_time / initialWait)));
    if (checkData.done) break;
    if (checkData.faulted) {
      throw new Error("AI Horde generation job faulted");
    }
  }

  const statusRes = await providerFetch(`${base}/generate/status/${id}`, {
    signal,
    headers: {
      apikey: effectiveKey,
      "Client-Agent": `nova:${version}:github.com/nova-rp`,
    },
  });

  if (!statusRes.ok) {
    throw new Error(`Failed to retrieve AI Horde generation status (${statusRes.status})`);
  }

  const statusData = await statusRes.json();
  const gen = statusData.generations?.[0];
  if (!gen?.img) {
    throw new Error("AI Horde did not produce an image");
  }

  const img = gen.img;
  onProgress?.(1);
  if (img.startsWith("http://") || img.startsWith("https://") || img.startsWith("data:")) {
    return img;
  }
  return `data:image/webp;base64,${img}`;
}

/* ---------- OpenAI DALL-E Client ---------- */

export async function generateImageOpenAI({
  prompt,
  apiKey,
  endpoint,
  model = "dall-e-3",
  width,
  height,
  signal,
  onProgress,
  bridge = false,
} = {}) {
  if (!apiKey?.trim() && !bridge) {
    throw new Error("OpenAI API key is required for image generation");
  }

  let url = (endpoint || "https://api.openai.com/v1").replace(/\/+$/, "");
  if (!url.endsWith("/images/generations")) {
    url = `${url}/images/generations`;
  }

  let size = "1024x1024";
  if (width && height) {
    if (width === height) size = "1024x1024";
    else if (width > height) size = "1792x1024";
    else size = "1024x1792";
  }

  const res = await providerFetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
    },
    body: JSON.stringify({
      /* the Bridge picks a ChatGPT model itself unless one is named */
      model: model || (bridge ? undefined : "dall-e-3"),
      prompt,
      n: 1,
      size,
      response_format: "b64_json",
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    let msg = errText;
    try { msg = JSON.parse(errText)?.error?.message || errText; } catch { /* plain text */ }
    if (bridge) throw new Error(`Nova Bridge could not make the picture (${res.status}): ${msg || res.statusText}`);
    throw new Error(`OpenAI image generation failed (${res.status}): ${msg || res.statusText}`);
  }

  const data = await res.json();
  const item = data.data?.[0];
  if (item?.b64_json) {
    onProgress?.(1);
    return `data:image/png;base64,${item.b64_json}`;
  }
  if (item?.url) {
    onProgress?.(1);
    return item.url;
  }
  throw new Error("OpenAI did not return image data");
}

/* ---------- SD WebUI (AUTOMATIC1111 / SD.Next) Client ---------- */

export async function generateImageSDWebUI({
  prompt,
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  endpoint = "http://127.0.0.1:7860",
  apiKey = "",
  width = 512,
  height = 512,
  steps = 20,
  sampler = "Euler a",
  cfgScale = 7,
  signal,
  onProgress,
} = {}) {
  let url = (endpoint || "http://127.0.0.1:7860").replace(/\/+$/, "");
  if (!url.endsWith("/sdapi/v1/txt2img")) {
    url = `${url}/sdapi/v1/txt2img`;
  }

  const headers = { "Content-Type": "application/json" };
  if (apiKey?.trim()) {
    headers["Authorization"] = apiKey.trim().startsWith("Bearer ") ? apiKey.trim() : `Bearer ${apiKey.trim()}`;
  }

  const res = await providerFetch(url, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify({
      prompt,
      negative_prompt: negativePrompt || "",
      steps: steps || 20,
      sampler_name: sampler || "Euler a",
      width: width || 512,
      height: height || 512,
      cfg_scale: cfgScale || 7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`SD WebUI generation failed (${res.status}): ${errText || res.statusText}`);
  }

  const data = await res.json();
  const img = data.images?.[0];
  if (!img) {
    throw new Error("SD WebUI did not return any image");
  }

  onProgress?.(1);
  if (img.startsWith("data:")) return img;
  return `data:image/png;base64,${img}`;
}

/* ---------- ComfyUI Client ---------- */

export async function generateImageComfyUI({
  prompt,
  negativePrompt = DEFAULT_NEGATIVE_PROMPT,
  endpoint = "http://127.0.0.1:8188",
  model = "v1-5-pruned-emaonly.safetensors",
  width = 512,
  height = 512,
  steps = 20,
  sampler = "euler",
  timeout = 90000,
  pollInterval = typeof globalThis !== "undefined" && globalThis.IS_REACT_ACT_ENVIRONMENT ? 1 : 1000,
  signal,
  onProgress,
} = {}) {
  const base = (endpoint || "http://127.0.0.1:8188").replace(/\/+$/, "");

  const workflow = {
    "3": {
      inputs: {
        seed: Math.floor(Math.random() * 1000000000),
        steps: steps || 20,
        cfg: 7,
        sampler_name: sampler || "euler",
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
      class_type: "KSampler",
    },
    "4": {
      inputs: {
        ckpt_name: model || "v1-5-pruned-emaonly.safetensors",
      },
      class_type: "CheckpointLoaderSimple",
    },
    "5": {
      inputs: {
        width: width || 512,
        height: height || 512,
        batch_size: 1,
      },
      class_type: "EmptyLatentImage",
    },
    "6": {
      inputs: {
        text: prompt,
        clip: ["4", 1],
      },
      class_type: "CLIPTextEncode",
    },
    "7": {
      inputs: {
        text: negativePrompt || "",
        clip: ["4", 1],
      },
      class_type: "CLIPTextEncode",
    },
    "8": {
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
      class_type: "VAEDecode",
    },
    "9": {
      inputs: {
        filename_prefix: "Nova",
        images: ["8", 0],
      },
      class_type: "SaveImage",
    },
  };

  const res = await providerFetch(`${base}/prompt`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`ComfyUI prompt submission failed (${res.status}): ${errText || res.statusText}`);
  }

  const promptRes = await res.json();
  const promptId = promptRes.prompt_id;
  if (!promptId) {
    throw new Error("ComfyUI did not return a prompt_id");
  }

  const startTime = Date.now();
  let historyData = null;
  onProgress?.(0);
  while (Date.now() - startTime < timeout) {
    await waitForPoll(pollInterval, signal);
    const histRes = await providerFetch(`${base}/history/${promptId}`, { signal });
    if (!histRes.ok) continue;
    const hist = await histRes.json();
    if (hist[promptId]?.outputs) {
      historyData = hist[promptId];
      break;
    }
  }

  if (!historyData) {
    throw new Error("ComfyUI generation timed out or failed to complete");
  }

  const outputs = historyData.outputs || {};
  let imageInfo = null;
  for (const nodeId of Object.keys(outputs)) {
    if (outputs[nodeId]?.images?.length) {
      imageInfo = outputs[nodeId].images[0];
      break;
    }
  }

  if (!imageInfo) {
    throw new Error("ComfyUI completed without outputting an image");
  }

  const viewUrl = `${base}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(imageInfo.subfolder || "")}&type=${encodeURIComponent(imageInfo.type || "output")}`;
  onProgress?.(1);
  return viewUrl;
}

/* ---------- Main Dispatcher ---------- */

export function generateImage(options = {}) {
  return withRequestActivity({ activity: options.activity, signal: options.signal, model: options.model || "" }, (handle, signal) => {
    handle.phase("Generating image");
    return generateImageRequest({ ...options, signal, onProgress: (progress) => {
      handle.progress(Math.min(95, progress * 100));
      options.onProgress?.(progress);
    } });
  });
}

async function generateImageRequest(options) {
  const { provider = "ai_horde" } = options;

  switch (provider) {
    case "ai_horde":
    case "horde":
      return generateImageAIHorde(options);
    case "openai":
    case "dall-e":
      return generateImageOpenAI(options);
    case "sd_webui":
    case "automatic1111":
      return generateImageSDWebUI(options);
    case "comfyui":
      return generateImageComfyUI(options);
    default:
      throw new Error(`Unsupported image generation provider: ${provider}`);
  }
}
