/* ---------- recalling older messages ----------

   "Recall related messages" (Settings → Memory). Messages that have fallen
   out of the resent window are scored against the newest one by word
   overlap (TF-IDF over stemmed words, stopwords left out) and the closest few
   ride along with it. Word matching, not meaning: no embeddings, nothing
   leaves the device. The stemmer and stopwords are English; other languages
   still match on whole words. */

export const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "can't", "cannot", "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing",
  "don't", "down", "during", "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
  "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself",
  "him", "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if", "in", "into",
  "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought", "our",
  "ours", "ourselves", "out", "over", "own", "same", "shan't", "she", "she'd", "she'll", "she's",
  "should", "shouldn't", "so", "some", "such", "than", "that", "that's", "the", "their", "theirs",
  "them", "themselves", "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
  "they've", "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "wasn't",
  "we", "we'd", "we'll", "we're", "we've", "were", "weren't", "what", "what's", "when", "when's",
  "where", "where's", "which", "while", "who", "who's", "whom", "why", "why's", "with", "won't",
  "would", "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours", "yourself",
  "yourselves"
]);

/* Suffix reduction stemmer for English */
export function stem(word) {
  if (typeof word !== "string" || word.length <= 3) return word;
  let w = word.toLowerCase();
  if (w.endsWith("sses")) return w.slice(0, -2);
  if (w.endsWith("ies")) return w.slice(0, -2);
  if (w.endsWith("ss")) return w;
  if (w.endsWith("s")) return w.slice(0, -1);
  if (w.endsWith("eed")) return w.slice(0, -1);
  if (w.endsWith("ing") && w.length > 5) {
    const base = w.slice(0, -3);
    if (/(.)\1$/.test(base) && !base.endsWith("ll") && !base.endsWith("ss")) return base.slice(0, -1);
    return base;
  }
  if (w.endsWith("ed") && w.length > 4) {
    const base = w.slice(0, -2);
    if (/(.)\1$/.test(base) && !base.endsWith("ll") && !base.endsWith("ss")) return base.slice(0, -1);
    return base;
  }
  if (w.endsWith("ly") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("tion") && w.length > 6) return w.slice(0, -3);
  return w;
}

/* Normalize text into stemmed, stopword-filtered tokens */
export function tokenize(text, { filterStopwords = true, useStem = true } = {}) {
  if (!text) return [];
  const normalized = String(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[*_"“”`~[\](){}:;,.<>?!+=|/\\-]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");

  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of rawTokens) {
    if (filterStopwords && STOPWORDS.has(t)) continue;
    if (t.length < 2) continue;
    const token = useStem ? stem(t) : t;
    if (token) out.push(token);
  }
  return out;
}

/* Builds an inverted term frequency and vector representation of conversation messages */
export function indexMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const docs = list.map((m, idx) => {
    const text = typeof m === "string" ? m : m?.content || "";
    const tokens = tokenize(text);
    return {
      index: idx,
      original: m,
      text,
      tokens,
    };
  });

  const N = docs.length;
  const df = new Map();
  for (const d of docs) {
    const seen = new Set(d.tokens);
    for (const t of seen) {
      df.set(t, (df.get(t) || 0) + 1);
    }
  }

  const idf = new Map();
  for (const [t, count] of df.entries()) {
    idf.set(t, Math.log((1 + N) / (1 + count)) + 1);
  }

  const invertedIndex = new Map();
  const indexedDocs = docs.map((d) => {
    const counts = new Map();
    for (const t of d.tokens) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
    const total = d.tokens.length || 1;
    let normSq = 0;
    const weights = new Map();
    for (const [t, c] of counts.entries()) {
      const tf = c / total;
      const w = tf * (idf.get(t) || 1);
      weights.set(t, w);
      normSq += w * w;
    }
    const norm = Math.sqrt(normSq) || 1;
    const normalizedWeights = new Map();
    for (const [t, w] of weights.entries()) {
      const nw = w / norm;
      normalizedWeights.set(t, nw);
      if (!invertedIndex.has(t)) invertedIndex.set(t, []);
      invertedIndex.get(t).push({ docIndex: d.index, weight: nw });
    }
    return {
      ...d,
      weights: normalizedWeights,
      norm,
    };
  });

  return {
    _isIndex: true,
    documents: indexedDocs,
    idf,
    invertedIndex,
    size: N,
  };
}

/* The older messages that share the most words with the query, best first */
export function searchRelevantContext(query, messages, { topK = 3, threshold = 0.25 } = {}) {
  if (!query || !messages) return [];
  const index = messages._isIndex ? messages : indexMessages(messages);
  if (!index.documents || index.documents.length === 0) return [];

  let qTokens = tokenize(query, { filterStopwords: true });
  if (qTokens.length === 0) {
    qTokens = tokenize(query, { filterStopwords: false });
  }
  if (qTokens.length === 0) return [];

  const qCounts = new Map();
  for (const t of qTokens) qCounts.set(t, (qCounts.get(t) || 0) + 1);

  let qNormSq = 0;
  const qWeights = new Map();
  for (const [t, c] of qCounts.entries()) {
    const tf = c / qTokens.length;
    const idfVal = index.idf.get(t);
    if (idfVal != null) {
      const w = tf * idfVal;
      qWeights.set(t, w);
      qNormSq += w * w;
    }
  }

  if (qNormSq === 0) {
    for (const [t, c] of qCounts.entries()) {
      const tf = c / qTokens.length;
      qWeights.set(t, tf);
      qNormSq += tf * tf;
    }
  }

  const qNorm = Math.sqrt(qNormSq) || 1;
  for (const [t, w] of qWeights.entries()) {
    qWeights.set(t, w / qNorm);
  }

  const scores = new Map();
  for (const [t, qw] of qWeights.entries()) {
    const postings = index.invertedIndex.get(t);
    if (!postings) continue;
    for (const { docIndex, weight } of postings) {
      scores.set(docIndex, (scores.get(docIndex) || 0) + qw * weight);
    }
  }

  const results = [];
  for (const [docIdx, score] of scores.entries()) {
    if (score >= threshold) {
      results.push({
        score,
        doc: index.documents[docIdx].original,
        index: docIdx,
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK).map((r) => r.doc);
}
