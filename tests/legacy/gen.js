/* Large, seeded inputs for the lib equivalence tests (libPerf.test.js) and
   the benchmarks (perf.bench.js): long multi-speaker Scope replies, a
   300-entry lorebook and a 1,000-message history. The same seed always
   gives the same inputs. */

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOf = (r) => (list) => list[Math.floor(r() * list.length)];

export const NAMES = ["Mira", "Elena", "Jule", "Andrew", "Tomas Vale", "Sora", "Kade", "Ines"];

const WORDS = (
  "the a light rain fell over harbor town while lanterns swayed on their hooks and somebody laughed " +
  "far away café naïve résumé dragon sword tavern ledger promise river crown shadow ember valley " +
  "quietly suddenly glance smile frown lean whisper shout table door window stair corridor bell " +
  "running jumped walked hopes wishes stations nation's isn't can't won't they're we've I'm"
).split(" ");

export const LORE_WORDS = [
  "Vale", "Ember Court", "St. Mary's", "Silver-Tongue", "Harbor", "Crown of Ash", "Ledger", "Nightbell",
  "Ironwood", "Lantern Guild", "Skyreach", "Mournwater", "Duskfall", "Old Road", "Saltmarsh", "Greymoor",
];

function sentence(r, extra = []) {
  const pick = pickOf(r);
  const n = 4 + Math.floor(r() * 12);
  const out = [];
  for (let i = 0; i < n; i++) {
    const roll = r();
    if (roll < 0.08 && extra.length) out.push(pick(extra));
    else if (roll < 0.1) out.push(String(Math.floor(r() * 1000)));
    else out.push(pick(WORDS));
  }
  const s = out.join(" ");
  return s[0].toUpperCase() + s.slice(1);
}

const END = [".", ".", ".", "!", "?", "…", "...", ".)", ".*", ".”", ".’"];
const SPACE = [" ", " ", " ", "  ", " ", " \t", "\r\n"];

/* One paragraph: narration, italic actions, speech with tags, names opening
   sentences, pronouns, stray markup and the odd unclosed quote. */
function paragraph(r, names) {
  const pick = pickOf(r);
  const n = 2 + Math.floor(r() * 8);
  let out = "";
  if (r() < 0.25) out += pick(["She ", "He ", "They ", "*She ", "_Her "]);
  for (let i = 0; i < n; i++) {
    const roll = r();
    let s;
    if (roll < 0.25) s = `${pick(names).split(" ")[0]}${r() < 0.3 ? "'s" : ""} ${sentence(r, LORE_WORDS).toLowerCase()}${pick(END)}`;
    else if (roll < 0.4) s = `"${sentence(r)}${pick([",", "!", "?", "—", "."])}" ${pick(names).split(" ")[0]} ${pick(["says", "mutters", "laughs"])}.`;
    else if (roll < 0.5) s = `“${sentence(r)}${pick([",", ".", "…"])}” ${pick(["she", "Mira", "Jule"])} adds.`;
    else if (roll < 0.62) s = `*${pick(names).split(" ")[0]} ${sentence(r).toLowerCase()}.*`;
    else if (roll < 0.66) s = `**${sentence(r)}**${pick(END)}`;
    else if (roll < 0.68) s = `"${sentence(r)} ${pick(names)} never closes this`;
    else if (roll < 0.7) s = `(${sentence(r)}.)`;
    else if (roll < 0.72) s = `漢字のテキスト ${sentence(r)}。`;
    else s = `${sentence(r, [...names, ...LORE_WORDS])}${pick(END)}`;
    out += s + (i < n - 1 ? pick(SPACE) : "");
  }
  return out;
}

/* A Scope reply: labelled parts in every label style, some for people not
   in the cast yet, and ordinary bold that is not a label. */
export function scopeReply(r, names = NAMES, { parts = 8 } = {}) {
  const pick = pickOf(r);
  const labels = [
    (n) => `**${n}:**`, (n) => `**${n}**:`, (n) => `*${n}:*`, (n) => `${n}:`,
    (n) => `**${n} (quietly):**`, () => `**Note:**`, () => `**Bartender:**`,
  ];
  let out = r() < 0.5 ? paragraph(r, names) + "\n\n" : "";
  for (let p = 0; p < parts; p++) {
    out += `${pick(labels)(pick(names))}${pick([" ", "\n", " \n", "  "])}`;
    const pars = 1 + Math.floor(r() * 3);
    for (let q = 0; q < pars; q++) out += paragraph(r, names) + (q < pars - 1 ? pick(["\n\n", "\n \n", "\n\n\n"]) : "");
    out += pick(["\n\n", "\n", "\n\n"]);
  }
  return out;
}

export function scopeReplies(count = 60, seed = 7) {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => scopeReply(r, NAMES, { parts: 4 + (i % 10) }));
}

/* 300 entries across three books: whole-word, phrase, punctuated and regex
   keys (with /g, /y, /i and broken ones), case-sensitive entries, every
   secondary-key logic, constants and disabled entries. */
export function lorebooks(entries = 300, seed = 11) {
  const r = rng(seed);
  const pick = pickOf(r);
  const logics = ["and_any", "and_all", "not_any", "not_all"];
  const keyOf = (i) => {
    const roll = r();
    if (roll < 0.08) return `/${pick(LORE_WORDS).split(" ")[0]}\\w*/${pick(["", "g", "gi", "y", "i", "m"])}`;
    if (roll < 0.1) return "/([unclosed/";
    if (roll < 0.15) return pick(["St. Mary's", "Silver-Tongue", "old road!", "C++", "$5"]);
    if (roll < 0.5) return pick(LORE_WORDS);
    if (roll < 0.6) return pick(WORDS);
    return `${pick(LORE_WORDS)}${i % 7}`;
  };
  const books = [{ id: "b0", name: "A", entries: [] }, { id: "b1", name: "B", entries: [] }, { id: "b2", name: "C", entries: [] }];
  for (let i = 0; i < entries; i++) {
    const nk = 1 + Math.floor(r() * 3);
    const e = {
      id: `e${i}`,
      comment: `Entry ${i}`,
      keys: Array.from({ length: nk }, () => keyOf(i)),
      secondaryKeys: r() < 0.3 ? Array.from({ length: 1 + Math.floor(r() * 2) }, () => keyOf(i)) : [],
      content: `${sentence(r, LORE_WORDS)}. ${sentence(r)}.`.repeat(1 + Math.floor(r() * 4)),
      enabled: r() > 0.05,
      constant: r() < 0.05,
      selective: r() < 0.3,
      logic: pick(logics),
      caseSensitive: r() < 0.15,
      order: Math.floor(r() * 5) * 50,
    };
    books[i % 3].entries.push(e);
  }
  return books;
}

/* 1,000 messages, user and assistant (some with speakers), the odd system
   line, mentioning lore keywords and cast names. */
export function history(count = 1000, seed = 23) {
  const r = rng(seed);
  const pick = pickOf(r);
  return Array.from({ length: count }, (_, i) => {
    const role = i % 2 ? "assistant" : r() < 0.03 ? "system" : "user";
    const pars = 1 + Math.floor(r() * 3);
    const content = Array.from({ length: pars }, () => paragraph(r, NAMES)).join("\n\n") + (r() < 0.2 ? ` ${pick(LORE_WORDS)}` : "");
    return { id: `m${i}`, role, content, ...(role === "assistant" && r() < 0.2 ? { speaker: pick(NAMES) } : {}) };
  });
}
