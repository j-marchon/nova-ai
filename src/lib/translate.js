/**
 * Auto-Translation Layer for Nova
 * Provides client-side translation via the Google Translate web endpoint
 * with fallback support and an in-memory cache.
 */

const translationCache = new Map();

export const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "ru", name: "Russian" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
];

export function getLanguageName(code) {
  if (!code) return "Unknown";
  const found = SUPPORTED_LANGUAGES.find(
    (l) =>
      l.code.toLowerCase() === code.toLowerCase() ||
      l.code.split("-")[0].toLowerCase() === code.toLowerCase()
  );
  return found ? found.name : code;
}

export function clearTranslationCache() {
  translationCache.clear();
}

export function getTranslationCache() {
  return translationCache;
}

/**
 * Translates text into targetLang using client-side translation.
 * Uses Google Translate web endpoint with in-memory caching.
 *
 * @param {string} text - The input text to translate.
 * @param {object} options
 * @param {string} [options.targetLang="en"] - ISO-639 language code for target language.
 * @param {string} [options.sourceLang="auto"] - Source language code or "auto" to detect.
 * @param {function} [options.fetchFn=globalThis.fetch] - Fetch function (can be overridden for tests).
 * @returns {Promise<{ text: string, translatedText: string, sourceLang: string, detectedLang: string, targetLang: string }>}
 */
export async function translateText(
  text,
  { targetLang = "en", sourceLang = "auto", fetchFn = globalThis.fetch } = {}
) {
  if (!text || !String(text).trim()) {
    const clean = text ? String(text) : "";
    return {
      text: clean,
      translatedText: clean,
      sourceLang: sourceLang === "auto" ? "en" : sourceLang,
      detectedLang: sourceLang === "auto" ? "en" : sourceLang,
      targetLang,
      toString() {
        return this.text;
      },
    };
  }

  const raw = String(text);
  const src = (sourceLang || "auto").trim().toLowerCase();
  const tgt = (targetLang || "en").trim().toLowerCase();
  const cacheKey = `${src}:${tgt}:${raw}`;

  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  // If source and target are the same language
  if (src !== "auto" && src === tgt) {
    const res = {
      text: raw,
      translatedText: raw,
      sourceLang: src,
      detectedLang: src,
      targetLang: tgt,
      toString() {
        return this.text;
      },
    };
    translationCache.set(cacheKey, res);
    return res;
  }

  // 1. Primary: Google Translate web endpoint
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
      src
    )}&tl=${encodeURIComponent(tgt)}&dt=t&q=${encodeURIComponent(raw)}`;

    const resp = await fetchFn(url);
    if (!resp.ok) {
      throw new Error(`Google Translate error ${resp.status}`);
    }
    const data = await resp.json();
    const translatedText = (data[0] || []).map((seg) => seg[0] || "").join("");
    const detected = data[2] || (src !== "auto" ? src : "auto");

    const result = {
      text: translatedText,
      translatedText,
      sourceLang: detected,
      detectedLang: detected,
      targetLang: tgt,
      toString() {
        return this.text;
      },
    };

    translationCache.set(cacheKey, result);
    if (src === "auto" && detected && detected !== "auto") {
      translationCache.set(`${detected.toLowerCase()}:${tgt}:${raw}`, result);
    }
    return result;
  } catch (err) {
    // 2. Secondary fallback: LibreTranslate public endpoint
    try {
      const libreUrl = "https://libretranslate.de/translate";
      const resp = await fetchFn(libreUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: raw,
          source: src === "auto" ? "auto" : src,
          target: tgt,
          format: "text",
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const translatedText = data.translatedText || raw;
        const detected =
          data.detectedLanguage?.language || (src !== "auto" ? src : "auto");
        const result = {
          text: translatedText,
          translatedText,
          sourceLang: detected,
          detectedLang: detected,
          targetLang: tgt,
          toString() {
            return this.text;
          },
        };
        translationCache.set(cacheKey, result);
        return result;
      }
    } catch {
      // Secondary fallback also failed
    }

    throw new Error(`Translation failed: ${err.message || String(err)}`);
  }
}
