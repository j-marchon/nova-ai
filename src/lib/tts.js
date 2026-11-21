import { providerFetch } from "./providerTransport.js";
import { hideNotes, stripTracker } from "./text.js";

/* ---------- speech synthesis engine ----------
   Provides a clean abstraction over Web Speech API (window.speechSynthesis)
   with custom audio endpoint support and text filtering for roleplay text. */

let currentUtterance = null;
let currentAudio = null;

/* Clean roleplay text before sending to speech synthesis.
   Strips thoughts (<think>...</think>), hidden notes (<!-- ... -->),
   leaked scene trackers, and handles dialogue-only mode. */
export function cleanTextForSpeech(text, { dialogueOnly = false } = {}) {
  if (!text) return "";
  let clean = String(text);

  // 1. Strip think/reasoning tags (closed or open-ended at tail)
  clean = clean.replace(/<\s*(think|thinking|thought|reason|reasoning)\b[^>]*>[\s\S]*?(?:<\/\s*\1\s*>|$)/gi, "");

  // 2. Strip hidden notes <!-- ... -->
  clean = hideNotes(clean);

  // 3. Strip leaked scene trackers
  clean = stripTracker(clean);
  // Also strip any remaining bracketed tracker lines like [ Scene Tracker: ... ]
  clean = clean.replace(/\[\s*(?:private\s+)?(?:scene\s+)?tracker\b[\s\S]*?\]/gi, "");
  clean = clean.replace(/\[[^\]]*\|[^\]]*\|[^\]]*\|[^\]]*\]/g, "");

  // 4. Dialogue only mode: extract speech
  if (dialogueOnly) {
    // Look for quotes: "...", “...”, «...»
    const quoteMatches = clean.match(/["“«]([^"”»]+)["”»]/g);
    if (quoteMatches && quoteMatches.length > 0) {
      const extracted = quoteMatches
        .map((q) => {
          let s = q.replace(/^["“«\s]+|["”»\s]+$/g, "").trim();
          // Strip trailing dialogue commas (e.g. "Hello there," -> Hello there)
          s = s.replace(/,\s*$/, "").trim();
          return s;
        })
        .filter(Boolean);
      clean = extracted.join(" ");
    } else {
      // In Nova roleplay without quotes, speech is plain text and narration is inside *single asterisks*
      // Strip *action* spans to leave dialogue
      clean = clean.replace(/\*[^*]*\*/g, "").trim();
    }
  }

  // 5. Strip markdown asterisks (*action* -> action, **bold** -> bold) so TTS doesn't say "asterisk"
  clean = clean.replace(/\*+/g, "");

  // 6. Clean up extra spaces, linebreaks, and markdown header/list markers
  clean = clean
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  return clean;
}

/* ---------- where the voice comes from ----------

   `voice.source`: "system" (the device's voices), "saved:<id>" (a provider
   from the Providers tab whose key is reused; OpenAI's speech API), or
   "custom" (any OpenAI-compatible /audio/speech address). Older settings
   with only an endpoint count as custom. Nova Bridge is not offered: a
   ChatGPT, Claude or Gemini sign-in has no speech API to reach. */
export const OPENAI_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];
export const SPEECH_PRESETS = ["openai"];

export const sourceOfVoice = (vs) => vs?.source || (vs?.endpoint ? "custom" : "system");

export function speechChoices(providers = []) {
  return [
    { id: "system", label: "This device", sub: "The voices your phone or browser has; free, offline" },
    ...providers.filter((p) => SPEECH_PRESETS.includes(p.preset)).map((p) => ({ id: `saved:${p.id}`, label: p.name || "OpenAI", sub: "OpenAI speech, with this provider's key" })),
    { id: "custom", label: "Custom address", sub: "Any OpenAI-compatible /audio/speech URL" },
  ];
}

/* What speak() needs for these settings: the endpoint, key and model, or
   none of them for the device's own voices. */
export function speechOptions(vs = {}, providers = []) {
  const base = { voiceName: vs.voice, rate: vs.rate ?? 1.0, pitch: vs.pitch ?? 1.0, dialogueOnly: vs.dialogueOnly ?? false };
  const source = sourceOfVoice(vs);
  if (source.startsWith("saved:")) {
    const p = providers.find((x) => x.id === source.slice(6));
    if (!p?.key) return { ...base, unavailable: true };
    return { ...base, voiceName: vs.voice || "alloy", endpoint: `${String(p.base || "https://api.openai.com/v1").replace(/\/+$/, "")}/audio/speech`, apiKey: p.key, model: vs.model || "gpt-4o-mini-tts" };
  }
  if (source === "custom" && vs.endpoint) return { ...base, endpoint: vs.endpoint, apiKey: vs.apiKey || "", model: vs.model || "tts-1" };
  return base;
}

/* Whether anything can read aloud here: a speech endpoint, or the system's
   own voices (absent in many Android WebViews). */
export function canSpeak(vs, providers = []) {
  const o = speechOptions(vs || {}, providers);
  if (o.unavailable) return false;
  if (o.endpoint) return true;
  return typeof window !== "undefined" && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance !== "undefined";
}

/* Returns the list of speech synthesis voices available in the browser. */
export function getVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices() || [];
}

/* Checks if speech synthesis is currently active */
export function isSpeaking() {
  const synthSpeaking = typeof window !== "undefined" && Boolean(window.speechSynthesis?.speaking);
  const audioPlaying = Boolean(currentAudio && !currentAudio.paused);
  return synthSpeaking || audioPlaying;
}

/* Stops any current speech immediately */
export function stopSpeech() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {}
    currentAudio = null;
  }
  if (typeof window !== "undefined" && window.speechSynthesis) {
    try {
      window.speechSynthesis.cancel();
    } catch {}
  }
  currentUtterance = null;
}

/* Pause current speech */
export function pauseSpeech() {
  if (currentAudio && !currentAudio.paused) {
    try { currentAudio.pause(); } catch {}
  } else if (typeof window !== "undefined" && window.speechSynthesis?.speaking) {
    try { window.speechSynthesis.pause(); } catch {}
  }
}

/* Resume paused speech */
export function resumeSpeech() {
  if (currentAudio && currentAudio.paused) {
    try { currentAudio.play(); } catch {}
  } else if (typeof window !== "undefined" && window.speechSynthesis?.paused) {
    try { window.speechSynthesis.resume(); } catch {}
  }
}

/* Speaks the text using browser SpeechSynthesis or a custom audio endpoint.
   Options:
     - voiceName: name or voiceURI of voice
     - rate: playback speed (0.5 to 2.0, default 1.0)
     - pitch: pitch multiplier (0.5 to 2.0, default 1.0)
     - volume: volume (0.0 to 1.0, default 1.0)
     - dialogueOnly: boolean
     - endpoint: optional custom audio endpoint (e.g. OpenAI / ElevenLabs)
     - apiKey: optional key for custom endpoint
     - onStart: callback when playback begins
     - onEnd: callback when playback ends
     - onError: callback on error
*/
export function speak(text, {
  voiceName = "",
  rate = 1.0,
  pitch = 1.0,
  volume = 1.0,
  dialogueOnly = false,
  endpoint = null,
  apiKey = "",
  model = "tts-1",
  onStart,
  onEnd,
  onError,
} = {}) {
  stopSpeech();

  const cleaned = cleanTextForSpeech(text, { dialogueOnly });
  if (!cleaned) {
    onEnd?.();
    return null;
  }

  // 1. Custom Endpoint Support (e.g. OpenAI TTS or ElevenLabs)
  if (endpoint) {
    let cancelled = false;
    (async () => {
      try {
        const res = await providerFetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            input: cleaned,
            voice: voiceName || "alloy",
            speed: rate,
          }),
        });
        if (cancelled) return;
        if (!res.ok) throw new Error(`Custom TTS error: ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        currentAudio = audio;
        audio.playbackRate = 1;
        audio.volume = Math.max(0, Math.min(1, volume));

        audio.onplay = () => onStart?.();
        audio.onended = () => {
          if (currentAudio === audio) currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          onEnd?.();
        };
        audio.onerror = (e) => {
          if (currentAudio === audio) currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          onError?.(e);
        };
        await audio.play();
      } catch (err) {
        if (!cancelled) onError?.(err);
      }
    })();
    return {
      cancel: () => {
        cancelled = true;
        stopSpeech();
      },
    };
  }

  // 2. Browser SpeechSynthesis API
  if (typeof window === "undefined" || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance === "undefined") {
    onError?.(new Error("Speech synthesis not supported in this environment"));
    return null;
  }

  const utter = new window.SpeechSynthesisUtterance(cleaned);
  utter.rate = Math.max(0.1, Math.min(10, rate || 1.0));
  utter.pitch = Math.max(0, Math.min(2, pitch ?? 1.0));
  utter.volume = Math.max(0, Math.min(1, volume ?? 1.0));

  if (voiceName) {
    const voices = getVoices();
    const matched = voices.find((v) => v.name === voiceName || v.voiceURI === voiceName);
    if (matched) utter.voice = matched;
  }

  utter.onstart = () => {
    onStart?.();
  };

  utter.onend = () => {
    if (currentUtterance === utter) currentUtterance = null;
    onEnd?.();
  };

  utter.onerror = (e) => {
    if (currentUtterance === utter) currentUtterance = null;
    if (e.error === "interrupted" || e.error === "canceled") {
      onEnd?.();
      return;
    }
    onError?.(e);
  };

  // Keep a global reference to prevent garbage collection mid-utterance on Chromium
  currentUtterance = utter;
  try {
    window.speechSynthesis.speak(utter);
  } catch (err) {
    currentUtterance = null;
    onError?.(err);
    return null;
  }

  return utter;
}
