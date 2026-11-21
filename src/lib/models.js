import { googleLabel } from "./api.js";

/* ---------- models ----------
   The picker shows each provider's own live list, with nothing curated. What
   is kept here is the filter that keeps non-chat endpoints out of every list. */

/* Embedding and reranking models are priced at zero but cannot hold a
   conversation, so they must never reach the picker. */
export const NON_CHAT = /(embed|rerank|guard|moderation|whisper|tts|lyria|seedream|image)/i;

/* A model id as people say it: the readable half of "author/model:free".
   (Moved here from components/models.jsx so non-UI code can name a model.) */
export const modelLabel = (id, src) =>
  src === "google" ? googleLabel(id) : String(id || "").split("/").pop().replace(/:free$/, "");
