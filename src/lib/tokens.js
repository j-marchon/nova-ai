import { DEFAULT_HISTORY_TOKENS } from "./data.js";
import { MSG_OVERHEAD, trimHistory } from "./window.js";
import { activeSummary, memoryCovered } from "./memory.js";
import { DEFAULT_LORE_BUDGET, DEFAULT_SCAN_DEPTH, selectLore, withLoreMemo } from "./lore.js";
import { buildApiMessages, repetitionNotes } from "./prompt.js";
import { genParams } from "./styles.js";
import { runMacros } from "./macros.js";

/* ---------- token counting and breakdown ---------- */

/**
 * Approximate token estimator; not model-specific BPE tokenization.
 * Matches BPE patterns (contractions, words, numbers, punctuation, whitespace chunks)
 * for Western/Latin scripts and individual characters for CJK and non-Latin scripts.
 */
const TOKEN_RE =
  /'s|'t|'re|'ve|'m|'ll|'d|[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]| ?[\p{L}]+| ?[\p{N}]+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  if (!s.length) return 0;

  /* counted, not collected: no array holding every piece of a long chat.
     `test` steps through the same matches `match` would (none is empty),
     without building a result for each the way `exec` does. */
  let count = 0;
  TOKEN_RE.lastIndex = 0;
  while (TOKEN_RE.test(s)) count++;

  return Math.max(count, Math.ceil(s.length / 3.6));
}

/**
 * Format a token number to human-readable string.
 * e.g., 1400 -> "1.4k", 8000 -> "8.0k", 500 -> "500", 1200000 -> "1.2M".
 */
export function formatTokens(count) {
  const n = Number(count) || 0;
  if (n >= 1000000) {
    return (n / 1000000).toFixed(1) + "M";
  }
  if (n >= 1000) {
    return (n / 1000).toFixed(1) + "k";
  }
  return String(Math.round(n));
}

/**
 * Format total tokens and max tokens into human-readable ratio and percentage.
 * e.g., "1.4k / 8.0k (18%)".
 */
export function formatTokenUsage(totalTokens, maxTokens) {
  const total = Number(totalTokens) || 0;
  const max = Number(maxTokens) || 0;
  const totalStr = formatTokens(total);
  const maxStr = formatTokens(max);
  const pct = max > 0 ? Math.round((total / max) * 100) : 0;
  return `${totalStr} / ${maxStr} (${pct}%)`;
}

export const formatTokenBreakdown = formatTokenUsage;

/* What a reply style adds to every request, in tokens: its system text (an
   imported preset's own blocks, in its layout, when it has one), its
   post-history block and its in-chat blocks. Impersonate and Continue text
   goes only with those requests and is not counted. */
export function styleTokens(style) {
  if (!style) return 0;
  const sys = Array.isArray(style.layout)
    ? style.layout.filter((x) => !x.marker).map((x) => x.text || "").join("\n\n")
    : style.text || "";
  const inject = Array.isArray(style.inject) ? style.inject : [];
  return estimateTokens(sys.trim()) + estimateTokens(String(style.post || "").trim())
    + inject.reduce((n, b) => n + estimateTokens(String(b?.text || "").trim()), 0);
}

export function calculateSystemTokens({
  character,
  universe,
  ensemble = [],
  persona,
  username,
  settings = {},
  history = [],
} = {}) {
  const userName = persona?.name || username || "You";
  const style = genParams(settings || {});
  const frame = style.frame || "a roleplay";

  let sys = "";
  if (universe) {
    sys = `You are running ${frame} set in the world of "${universe.name || "the universe"}" with ${userName}. You play the world, the narration and every listed character. Always stay inside the fiction and never break the fourth wall.`;
  } else if (Array.isArray(ensemble) && ensemble.length > 0) {
    const names = [character, ...ensemble].map((c) => c?.name).filter(Boolean);
    sys = `You are ${names.join(", ")}, and you voice everyone else in ${frame} with ${userName}. Always stay in character and never break the fourth wall.`;
  } else {
    const charName = character?.name || "the character";
    sys = `You are ${charName} in ${frame} with ${userName}. Always stay in character and never break the fourth wall.`;
  }

  // Language directive
  sys += `\nWrite in the language ${userName} writes in.`;

  // Style directives
  if (style.prompt) sys += `\n${style.prompt}`;
  if (style.reminder) sys += `\n${style.reminder}`;
  if (style.post) sys += `\n${style.post}`;

  // Anti-repetition notes
  const repNotes = repetitionNotes(history || []);
  if (repNotes.length) sys += `\n${repNotes.join(" ")}`;

  return estimateTokens(sys.trim());
}

export function calculateCardTokens({ character, universe, ensemble, persona, username, vars = {} } = {}) {
  let text = "";
  if (character) {
    if (character.name) text += character.name + "\n";
    if (character.description) text += character.description + "\n";
    if (character.personality) text += character.personality + "\n";
    if (character.scenario) text += character.scenario + "\n";
    if (character.exampleDialogs) text += character.exampleDialogs + "\n";
    if (character.systemPrompt) text += character.systemPrompt + "\n";
    if (character.postHistoryInstructions) text += character.postHistoryInstructions + "\n";
    if (character.firstMessage) text += character.firstMessage + "\n";
  }
  if (universe) {
    const userName = persona?.name || username || "You";
    const cardVars = { ...vars };
    const fill = (value, char = universe.name) => runMacros(value || "", { vars: cardVars, user: userName, char });
    if (universe.name) text += universe.name + "\n";
    if (universe.description) text += universe.description + "\n";
    if (universe.story) text += fill(universe.story) + "\n";
    if (universe.rules) text += fill(universe.rules) + "\n";
    if (Array.isArray(universe.locations)) {
      for (const loc of universe.locations) {
        if (loc.name) text += fill(loc.name) + " ";
        if (loc.description) text += fill(loc.description) + "\n";
      }
    }
    if (Array.isArray(universe.characters)) {
      for (const char of universe.characters) {
        if (char.name) text += fill(char.name, char.name) + " ";
        if (char.description) text += fill(char.description, char.name) + " ";
        if (char.personality) text += fill(char.personality, char.name) + "\n";
        for (const [key, value] of Object.entries(char)) if (typeof value === "string" && !["id", "name", "avatar", "description", "personality"].includes(key) && value) text += fill(value, char.name) + "\n";
      }
    }
  }
  /* the linked cards a Scope cast sends in full beside the host's */
  if (Array.isArray(ensemble)) {
    for (const c of ensemble) {
      if (c.name) text += c.name + "\n";
      if (c.description) text += c.description + "\n";
      if (c.personality) text += c.personality + "\n";
      if (c.scenario) text += c.scenario + "\n";
      if (c.exampleDialogs) text += c.exampleDialogs + "\n";
      if (c.systemPrompt) text += c.systemPrompt + "\n";
      if (c.postHistoryInstructions) text += c.postHistoryInstructions + "\n";
    }
  }
  if (persona?.description) {
    text += persona.description + "\n";
  }
  return estimateTokens(text.trim());
}

export function calculateLoreTokens({ lorebooks, history = [], settings = {}, loreTimed } = {}) {
  if (!lorebooks) return 0;
  if (Array.isArray(lorebooks)) {
    if (lorebooks.length === 0) return 0;
    if (lorebooks[0]?.entries !== undefined) {
      const depth = settings?.loreDepth || DEFAULT_SCAN_DEPTH;
      const budget = settings?.loreBudget || DEFAULT_LORE_BUDGET;
      const lore = selectLore(lorebooks, history, { depth, budget, recursion: settings?.loreRecursion, timed: loreTimed });
      const active = [...(lore.constant || []), ...(lore.triggered || [])];
      return active.reduce((sum, e) => sum + estimateTokens(e.content || ""), 0);
    }
    return lorebooks.reduce((sum, e) => sum + estimateTokens(e.content || (typeof e === "string" ? e : "")), 0);
  }
  if (lorebooks.constant || lorebooks.triggered) {
    const active = [...(lorebooks.constant || []), ...(lorebooks.triggered || [])];
    return active.reduce((sum, e) => sum + estimateTokens(e.content || (typeof e === "string" ? e : "")), 0);
  }
  return 0;
}

export function calculateNoteTokens({ authorsNote, history = [] } = {}) {
  if (!authorsNote) return 0;
  if (typeof authorsNote === "string") {
    return authorsNote.trim() ? estimateTokens(`[Author's note: ${authorsNote.trim()}]`) : 0;
  }
  if (typeof authorsNote === "object" && authorsNote.text?.trim()) {
    const interval = Number.isFinite(authorsNote.interval) ? Math.max(1, authorsNote.interval) : 1;
    const active = interval <= 1 || (history.length % interval === 0);
    if (active) {
      return estimateTokens(`[Author's note: ${authorsNote.text.trim()}]`);
    }
  }
  return 0;
}

export function calculateMemoryTokens({ memory, scene, history = [] } = {}) {
  return memoryTokens(memory, scene, () => activeSummary(history, memory));
}

/* `summaryOf` gives the active summary; it is asked only when the memory is
   an object that can have one */
function memoryTokens(memory, scene, summaryOf) {
  let text = "";
  if (memory) {
    let summary = "";
    if (typeof memory === "string") {
      summary = memory.trim();
    } else if (typeof memory === "object") {
      summary = summaryOf() || memory.summary?.trim() || memory.text?.trim() || "";
    }
    if (summary) text += `[Story so far]\n${summary}\n`;
  }
  if (scene) {
    let sceneText = "";
    if (typeof scene === "string") {
      sceneText = scene.trim();
    } else if (typeof scene === "object") {
      sceneText = scene.text?.trim() || "";
    }
    if (sceneText) text += `(Private scene tracker)\n${sceneText}\n`;
  }
  return estimateTokens(text.trim());
}

/* The world log and phone notes at the end of the prompt (prompt.js
   ambient context), counted with the memory and scene. */
export function ambientTokens({ universe, world, phone } = {}) {
  let text = "";
  if (universe && Array.isArray(world) && world.length) text += `[Elsewhere lately:\n${world.slice(-3).map((e) => `- ${typeof e === "string" ? e : e?.text || ""}`).join("\n")}]\n`;
  if (typeof phone === "string" && phone.trim()) text += phone.trim();
  return estimateTokens(text.trim());
}

export function calculateHistoryTokens({ history = [], settings = {}, memory, maxTokens } = {}) {
  return historyTokens(history, settings, maxTokens, () => memoryCovered(history, memory));
}

function historyTokens(history, settings, maxTokens, coveredOf) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  const memoryOn = settings?.memoryOn !== false;
  const covered = memoryOn ? coveredOf() : Infinity;
  const budget = settings?.historyTokens || maxTokens || DEFAULT_HISTORY_TOKENS;
  const kept = trimHistory(history, budget, covered);
  return kept.reduce((sum, m) => (m.hidden ? sum : sum + estimateTokens(m.content || "") + (MSG_OVERHEAD || 4)), 0);
}

/**
 * Breakdown total context window token usage into each functional section:
 * - systemTokens: Base instructions, style directives, anti-repetition notes
 * - cardTokens: Character/universe/persona details, scenario, example dialogues
 * - loreTokens: Active world info / lorebook entries
 * - noteTokens: Author's note
 * - memoryTokens: Narrative memory summary & scene tracker
 * - historyTokens: Trimmed active conversation messages
 * - totalTokens: Sum of all sections
 * - remainingTokens: Remaining headroom
 * - percentUsed: Percentage of maxTokens used (0-100)
 */
export function breakdownTokens({
  character,
  universe,
  ensemble,
  persona,
  username,
  lorebooks,
  authorsNote,
  memory,
  scene,
  history = [],
  maxTokens,
  settings = {},
  vars = {},
  scope,
  world,
  phone,
  loreTimed,
} = {}) {
  const max = Number(maxTokens) || settings?.historyTokens || DEFAULT_HISTORY_TOKENS;
  /* how far the summary reaches, worked out once for the two sections that
     need it: the same answer activeSummary and memoryCovered would give */
  let covered;
  const coveredOf = () => (covered === undefined ? (covered = memoryCovered(history, memory)) : covered);

  /* the lore selection is shared with the request built below */
  const { sections, request } = withLoreMemo(() => ({
    sections: {
      systemTokens: calculateSystemTokens({ character, universe, ensemble, persona, username, settings, history }),
      cardTokens: calculateCardTokens({ character, universe, ensemble, persona, username, vars }),
      loreTokens: calculateLoreTokens({ lorebooks, history, settings, loreTimed }),
      noteTokens: calculateNoteTokens({ authorsNote, history }),
      memoryTokens: memoryTokens(memory, scene, () => (coveredOf() > 0 ? memory.summary.trim() : "")) + ambientTokens({ universe, world, phone }),
      historyTokens: historyTokens(history, settings, max, coveredOf),
    },
    request: buildApiMessages({ character: character || { name: "Character" }, universe, ensemble, persona, username, lorebooks, authorsNote, memory, scene, history, settings, vars: { ...vars }, scope, world, phone, loreTimed }),
  }));
  const { systemTokens, cardTokens, loreTokens, noteTokens, memoryTokens: memTokens, historyTokens: histTokens } = sections;
  const totalTokens = request.reduce((sum, m) => sum + estimateTokens(m.content) + MSG_OVERHEAD, 0);
  const remainingTokens = Math.max(0, max - totalTokens);
  const percentUsed = max > 0 ? Math.min(100, Math.round((totalTokens / max) * 100)) : 0;

  return {
    systemTokens,
    cardTokens,
    loreTokens,
    noteTokens,
    memoryTokens: memTokens,
    historyTokens: histTokens,
    totalTokens,
    remainingTokens,
    percentUsed,
    formatted: formatTokenUsage(totalTokens, max),
  };
}
