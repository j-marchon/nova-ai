import { DEFAULT_HISTORY_TOKENS } from "../../src/lib/data.js";
import { MSG_OVERHEAD, trimHistory } from "../../src/lib/window.js";
import { activeSummary, memoryCovered } from "../../src/lib/memory.js";
import { DEFAULT_LORE_BUDGET, DEFAULT_SCAN_DEPTH, selectLore } from "./lore.js";
import { buildApiMessages, repetitionNotes } from "../../src/lib/prompt.js";
import { genParams } from "../../src/lib/styles.js";

/* ---------- token counting and breakdown ---------- */

/**
 * Approximate token estimator; not model-specific BPE tokenization.
 * Matches BPE patterns (contractions, words, numbers, punctuation, whitespace chunks)
 * for Western/Latin scripts and individual characters for CJK and non-Latin scripts.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  if (!s.length) return 0;

  const matches = s.match(
    /'s|'t|'re|'ve|'m|'ll|'d|[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]| ?[\p{L}]+| ?[\p{N}]+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu
  );

  return Math.max(matches?.length || 0, Math.ceil(s.length / 3.6));
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

export function calculateSystemTokens({
  character,
  universe,
  group,
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
  } else if (Array.isArray(group) && group.length > 0) {
    sys = `You are playing ${group.map((c) => c.name).join(", ")} in ${frame} with ${userName}. Each reply is written by exactly one of them, the one named at the end of the latest message, and only that character speaks and acts in it. Always stay in character and never break the fourth wall.`;
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

export function calculateCardTokens({ character, universe, group, persona } = {}) {
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
    if (universe.name) text += universe.name + "\n";
    if (universe.description) text += universe.description + "\n";
    if (universe.story) text += universe.story + "\n";
    if (universe.rules) text += universe.rules + "\n";
    if (Array.isArray(universe.locations)) {
      for (const loc of universe.locations) {
        if (loc.name) text += loc.name + " ";
        if (loc.description) text += loc.description + "\n";
      }
    }
    if (Array.isArray(universe.characters)) {
      for (const char of universe.characters) {
        if (char.name) text += char.name + " ";
        if (char.description) text += char.description + " ";
        if (char.personality) text += char.personality + "\n";
      }
    }
  }
  if (Array.isArray(group)) {
    for (const c of group) {
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

export function calculateLoreTokens({ lorebooks, history = [], settings = {} } = {}) {
  if (!lorebooks) return 0;
  if (Array.isArray(lorebooks)) {
    if (lorebooks.length === 0) return 0;
    if (lorebooks[0]?.entries !== undefined) {
      const depth = settings?.loreDepth || DEFAULT_SCAN_DEPTH;
      const budget = settings?.loreBudget || DEFAULT_LORE_BUDGET;
      const lore = selectLore(lorebooks, history, { depth, budget });
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
  let text = "";
  if (memory) {
    let summary = "";
    if (typeof memory === "string") {
      summary = memory.trim();
    } else if (typeof memory === "object") {
      summary = activeSummary(history, memory) || memory.summary?.trim() || memory.text?.trim() || "";
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

export function calculateHistoryTokens({ history = [], settings = {}, memory, maxTokens } = {}) {
  if (!Array.isArray(history) || history.length === 0) return 0;
  const memoryOn = settings?.memoryOn !== false;
  const covered = memoryOn ? memoryCovered(history, memory) : Infinity;
  const budget = settings?.historyTokens || maxTokens || DEFAULT_HISTORY_TOKENS;
  const kept = trimHistory(history, budget, covered);
  return kept.reduce((sum, m) => sum + estimateTokens(m.content || "") + (MSG_OVERHEAD || 4), 0);
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
  group,
  speaker,
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
} = {}) {
  const max = Number(maxTokens) || settings?.historyTokens || DEFAULT_HISTORY_TOKENS;

  const systemTokens = calculateSystemTokens({ character, universe, group, persona, username, settings, history });
  const cardTokens = calculateCardTokens({ character, universe, group, persona });
  const loreTokens = calculateLoreTokens({ lorebooks, history, settings });
  const noteTokens = calculateNoteTokens({ authorsNote, history });
  const memoryTokens = calculateMemoryTokens({ memory, scene, history });
  const historyTokens = calculateHistoryTokens({ history, settings, memory, maxTokens: max });

  const request = buildApiMessages({ character: character || { name: "Character" }, universe, group, speaker, persona, username, lorebooks, authorsNote, memory, scene, history, settings, vars: { ...vars }, scope });
  const totalTokens = request.reduce((sum, m) => sum + estimateTokens(m.content) + MSG_OVERHEAD, 0);
  const remainingTokens = Math.max(0, max - totalTokens);
  const percentUsed = max > 0 ? Math.min(100, Math.round((totalTokens / max) * 100)) : 0;

  return {
    systemTokens,
    cardTokens,
    loreTokens,
    noteTokens,
    memoryTokens,
    historyTokens,
    totalTokens,
    remainingTokens,
    percentUsed,
    formatted: formatTokenUsage(totalTokens, max),
  };
}
