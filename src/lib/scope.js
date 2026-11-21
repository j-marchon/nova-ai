/* ============================================================
   Nova Scope
   ============================================================

   A chat that grows a cast. A card is one character, a universe a handful
   — but every story fills up with other people: a bartender, a rival, a
   sister. Scope
   notices them as they come up, writes each a short description from what
   the story has shown of them, and lets them into the scene:

     - several people can speak in one reply, and talk to each other, not
       only to you
     - with "carry on" on, the scene keeps playing by itself for a few
       turns while the people in it have reasons to keep going, and hands
       over when you are addressed, when you would naturally act, or the
       moment you start typing
     - everyone works from the scene tracker (time, place, who is present),
       so somebody across town does not chime in

   Modes, per chat:
     off     the chat works exactly as it always has. Nothing here runs.
     manual  people found in the story are offered as chips; you add them
     auto    they are added on their own once they have come up often enough

   It runs in both kinds of chat. The people a chat already has — the card's
   character, the universe's characters — are its "leads": never offered as
   side characters.

   A chat with several of your own characters (what the Create tab calls a
   group chat) is a card chat with Scope on: the first card is the host,
   whose greeting, look and lorebook the chat uses, and the others are cast
   members linked to their cards (`characterId`). A linked member's whole
   card goes into the prompt, not a description of them (see linkedCards).

   A reply is one message, shown as one bubble. When several people speak
   in it, each part opens with a **Name:** label, which shows as bold text.

   Off is the fallback for everything: a chat with no `scope` field behaves
   as the plain chat it always was. */

/* The leads, as names: a card, a list of cards, or a list of names. */
export const leadNames = (leads) =>
  (Array.isArray(leads) ? leads : [leads]).map((l) => (typeof l === "string" ? l : l?.name)).filter(Boolean);

/* "A", "A and B", "A, B and C" */
const listOf = (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

export const SCOPE_MODES = ["off", "manual", "auto"];

export const SCOPE_DEFAULTS = {
  mode: "off",
  /* the scene may play on without you, up to `turns` replies in a row */
  carry: true,
  turns: 3,
  /* mentions before someone is offered or added */
  threshold: 3,
  /* [{ id, name, description, characterId?, auto?, describing?, fromCard? }]
     A member with a `characterId` is linked to one of your cards: its
     description is only the fallback for when the card is gone. */
  cast: [],
  /* names that turned out not to be people, or that were removed: never
     offered again */
  dismissed: [],
};

export function scopeOf(chat) {
  const s = chat?.scope && typeof chat.scope === "object" ? chat.scope : {};
  return {
    ...SCOPE_DEFAULTS,
    ...s,
    mode: SCOPE_MODES.includes(s.mode) ? s.mode : "off",
    cast: Array.isArray(s.cast) ? s.cast.filter((c) => c && c.name) : [],
    dismissed: Array.isArray(s.dismissed) ? s.dismissed : [],
  };
}

export const scopeOn = (chat) => scopeOf(chat).mode !== "off";

/* ---------- your own characters in the cast ----------

   The cards behind the cast members linked to one of your characters, in
   cast order: each live card once, never the host (`hostId`), and none
   whose card has since been deleted (that member is then a plain side
   character, with its description). */
export function linkedCards(scope, characters, hostId) {
  const byId = new Map((characters || []).map((c) => [c.id, c]));
  const out = [];
  const seen = new Set(hostId ? [hostId] : []);
  for (const m of scope?.cast || []) {
    const card = m?.characterId && byId.get(m.characterId);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    out.push(card);
  }
  return out;
}

/* The linked cards a card chat sends in full this turn: none with Scope off
   or in a universe, where the cast is kept but nothing of it runs. */
export function ensembleOf(chat, characters) {
  if (!chat || chat.kind === "universe") return [];
  const sc = scopeOf(chat);
  return sc.mode === "off" ? [] : linkedCards(sc, characters, chat.characterId);
}

/* What a chat with several of your characters is called when it has no
   title of its own: the names, the first two and a count past three. */
export function ensembleTitle(cards) {
  const names = (cards || []).map((c) => c?.name?.trim()).filter(Boolean);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/* A short stand-in for a card that is about to be deleted, so a member who
   was linked to it can still be voiced. */
const snapshotOf = (card) => [card?.tagline, card?.description].filter(Boolean).join(" ").trim().slice(0, 600);

/* A card chat after the card `id` is deleted (`characters` is the library
   from before the delete). Members linked to it become plain side
   characters with a snapshot of the card. If it was the host, the first
   member still linked to a live card takes over as host and leaves the
   cast; the old host stays on as a side character, and the replies that
   were theirs keep their name. Null when no character is left, so the chat
   goes. A chat the card is not part of comes back unchanged (the same
   object). */
export function dropCharacter(chat, id, characters) {
  if (!chat || chat.kind === "universe") return chat;
  const cast = Array.isArray(chat.scope?.cast) ? chat.scope.cast : [];
  const isHost = chat.characterId === id;
  if (!isHost && !cast.some((m) => m?.characterId === id)) return chat;
  const card = (characters || []).find((c) => c.id === id);
  const unlink = (m) => {
    const { characterId: _gone, ...rest } = m;
    return { ...rest, description: m.description?.trim() ? m.description : snapshotOf(card) };
  };
  let nextCast = cast.map((m) => (m?.characterId === id ? unlink(m) : m));
  if (!isHost) return { ...chat, scope: { ...chat.scope, cast: nextCast } };

  const alive = new Set((characters || []).filter((c) => c.id !== id).map((c) => c.id));
  const heir = nextCast.find((m) => m?.characterId && alive.has(m.characterId));
  if (!heir) return null;
  const oldName = card?.name || "";
  nextCast = nextCast.filter((m) => m !== heir);
  if (oldName && !nextCast.some((m) => m?.name?.toLowerCase() === oldName.toLowerCase())) {
    nextCast = [castMember({ id: `was-${id}`, name: oldName, description: snapshotOf(card) }), ...nextCast];
  }
  return {
    ...chat,
    characterId: heir.characterId,
    greetingId: "",
    scope: { ...chat.scope, cast: nextCast },
    /* replies with no speaker were the host's; they stay the old host's */
    messages: (chat.messages || []).map((m) =>
      m.role === "assistant" && !m.speaker && oldName ? { ...m, speaker: oldName } : m
    ),
  };
}

/* ---------- finding the people in a story ----------

   Found by a plain rule rather than a model call: a capitalised word that
   turns up in the middle of sentences (so not just because a sentence began
   with it), often enough across the recent story, is very likely a name.
   Words capitalised for other reasons (days, months, titles, "I") are
   ignored, and so are the card's and your own names. The description call
   afterwards is the second filter: a place or a thing that slipped through
   is reported as not a person and dismissed. */

const NOT_NAMES = new Set(
  (
    "I I'm I'd I'll I've The A An And But Or So Then Now Yes No Oh Okay OK Ok Hey Hi Hello Please Thanks Sorry Well " +
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August " +
    "September October November December Mr Mrs Ms Miss Dr Sir Madam Lady Lord King Queen Prince Princess Captain " +
    "God Lord Christ Jesus Heaven Hell English French Spanish German Japanese Chinese Korean Russian Italian " +
    "Portuguese American British European Asian African Christmas Easter Halloween TV OK Mom Dad Mum Mother Father " +
    "Grandma Grandpa Sister Brother Aunt Uncle Boss Doctor Officer Detective Professor Master Mistress Your You " +
    "What Who Why When Where How This That These Those There Here His Her Their Its Our My We They He She It"
  ).split(" ")
);

const firstOf = (name) => String(name || "").trim().split(/\s+/)[0] || "";
const key = (n) => firstOf(n).toLowerCase();

/* `threshold`: mentions needed, at least one of them mid-sentence. */
export function findSideCharacters(messages, exclude = [], { limit = 8, window = 40, threshold = 2 } = {}) {
  const skip = new Set();
  for (const n of exclude) {
    for (const part of String(n || "").split(/\s+/)) if (part) skip.add(part.toLowerCase());
  }
  const counts = new Map();
  const recent = (messages || []).slice(-window);
  const re = /(^|[\s\S]{0,3})\b(\p{Lu}[\p{Ll}'’-]{2,})\b/gu;
  recent.forEach((m, idx) => {
    const text = String(m.content || "").replace(/\*\*[^*\n]{1,40}?(?::\*\*|\*\*:)/g, " ");
    let x;
    re.lastIndex = 0;
    while ((x = re.exec(text))) {
      const before = x[1];
      const word = x[2].replace(/['’]s$/, "");
      if (word.length < 3 || NOT_NAMES.has(word) || skip.has(word.toLowerCase())) continue;
      const sentenceStart = x.index === 0 || /(^|[.!?…:]["”’)*_]*\s+|["“*(\-—]\s*|\n\s*)$/.test(before);
      const c = counts.get(word) || { mid: 0, all: 0, last: 0 };
      c.all += 1;
      if (!sentenceStart) c.mid += 1;
      c.last = idx;
      counts.set(word, c);
    }
  });
  return [...counts.entries()]
    .filter(([, c]) => c.mid >= 1 && c.all >= Math.max(2, threshold))
    .sort((a, b) => b[1].last - a[1].last || b[1].all - a[1].all)
    .slice(0, limit)
    .map(([w]) => w);
}

/* People found in the story who are not in the cast yet and were never
   dismissed: what manual mode offers and auto mode adds. */
export function scopeCandidates(chat, leads, userName) {
  const sc = scopeOf(chat);
  const known = [...leadNames(leads), userName, ...sc.cast.map((c) => c.name), ...sc.dismissed];
  const taken = new Set(known.filter(Boolean).map(key));
  return findSideCharacters(chat?.messages, known, { threshold: sc.threshold }).filter((n) => !taken.has(key(n)));
}

/* ---------- describing someone from the story ---------- */

export const NOT_A_PERSON = "NOT_A_PERSON";

/* The lines that mention them, most recent last, kept short. */
export function mentionsOf(messages, name, { limit = 14, chars = 700 } = {}) {
  const k = firstOf(name);
  const re = new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return (messages || [])
    .filter((m) => re.test(m.content || ""))
    .slice(-limit)
    .map((m) => String(m.content).slice(0, chars));
}

export function describeRequest({ name, messages, charName, userName }) {
  const lines = mentionsOf(messages, name);
  const system =
    "You keep the cast list for an ongoing roleplay. You are given passages from the story that mention one name. " +
    `Write who ${name} is, as the story has shown them: who they are and what they do, how they relate to ${charName} and to ${userName}, ` +
    "what they look like if it was mentioned, and how they talk or behave. Two to four plain sentences, third person, present tense. " +
    "Only what the story shows or clearly implies; invent nothing. No preamble, no heading, no em-dashes. " +
    `If ${name} is not a person in the story (a place, a thing, an organisation, a word), reply exactly ${NOT_A_PERSON} and nothing else.`;
  const user = `Passages mentioning ${name}:\n\n${lines.map((l, i) => `(${i + 1}) ${l}`).join("\n\n")}\n\nWho is ${name}?`;
  return { system, user };
}

/* ---------- the prompt ---------- */

export const CONTINUE_MARK = "[[continue]]";

/* What the model is told on a Scope turn. It rides at the end of the
   prompt with the scene tracker, so the cached system block is untouched
   whoever joins. `step` is how many replies in a row the scene has played
   without the user.

   One card: the model voices the card and everyone else. With linked
   members (`ensemble`, their cards already in the system block) it voices
   them too, and they are listed here by name only. A universe: it already
   voices the world and its characters, and is told about the side
   characters too. `lead`, for one reply: { name } who leads it, or
   { narrator: true } for world narration (universes). */
export function scopeNote({ scope, character, universe, ensemble = [], userName, step = 0, lead = null }) {
  const char = universe ? "the world" : character?.name || "the character";
  const linked = new Set(ensemble.map((c) => c.id));
  const cast = scope.cast;
  const list = cast.length
    ? cast.map((c) => (c.characterId && linked.has(c.characterId)
      ? `- ${c.name} (card above)`
      : `- ${c.name}${c.description ? `: ${c.description.trim()}` : ""}`)).join("\n")
    : "- (nobody else yet; anyone the story brings in may speak)";
  /* "Mira and everyone else", "Mira, Tom and everyone else" */
  const voiced = listOf([char, ...ensemble.map((c) => c.name), "everyone else in the scene"]);
  const opener = universe
    ? `[Nova Scope. You voice the world of ${universe.name}, its characters, and everyone else the story brings in. People in this story besides the listed characters:`
    : `[Nova Scope. You voice ${voiced}. The other people in this story so far:`;
  const lines = [
    opener,
    list,
    "How the scene works:",
    `- Only people physically present right now may speak or act. The scene tracker says where and when this is and who is there; anyone elsewhere stays elsewhere unless the story gives them a reason to arrive.`,
    "- Each person speaks only when they have a real reason to: someone addresses them, something concerns them, or they would naturally react. Nobody butts in. Most replies need one or two voices, never everyone.",
    "- They can talk to each other, not only to " + userName + ". Each keeps their own voice, goals and knowledge: nobody knows what they did not see or hear.",
    `- When more than one person speaks or acts, begin each one's part with **Name:** on its own line, the first one included. ${universe ? "Narration that belongs to nobody in particular needs no label." : `A reply that is only ${char} needs no label; a reply by anyone else alone still starts with their label.`} That is the only place double asterisks are allowed.`,
    `- Never write ${userName}'s words, actions or thoughts.`,
  ];
  if (scope.carry) {
    lines.push(
      step > 0
        ? `- The scene is playing on by itself (turn ${step + 1}). Carry on from exactly where it stopped, without repeating anything, and hand back to ${userName} as soon as it fits.`
        : `- The scene may play on without ${userName}.`,
      `- Hand back to ${userName} whenever ${userName} is spoken to, asked something, or would naturally act now. If instead the people present would naturally keep going among themselves for now, end the reply with the line ${CONTINUE_MARK} on its own. Never use it when ${userName} has been addressed.`
    );
  }
  if (lead?.narrator) {
    lines.push("- This reply is world narration only: no character speaks.");
  } else if (lead?.name) {
    lines.push(`- ${lead.name} leads this reply: it opens with ${lead.name} and centres on what ${lead.name} says and does. Others who are present may react if they have reason to.`);
  }
  return lines.join("\n") + "]";
}

/* The reply with the continue mark taken out, and whether it was there. */
export function takeContinue(text) {
  const s = String(text || "");
  const re = /\[\[\s*continue\s*\]\]/gi;
  const cont = re.test(s);
  return { text: s.replace(re, "").replace(/\s+$/, ""), cont };
}

/* A member added by hand, or from your characters. */
export function castMember({ id, name, description = "", characterId, auto = false }) {
  return { id, name: String(name).trim(), description, ...(characterId ? { characterId } : {}), ...(auto ? { auto: true } : {}) };
}

/* ---------- reading the card for its cast ----------

   A card often names people before the chat has said a word: a sister in
   the description, a rival in the greeting, a whole crew in the lorebook.
   When Scope is on as a chat starts, or is switched on in the middle of
   one, the card is read once for them and they join with a description
   taken from the card. `cardScanned` on the chat's scope marks it done;
   switching Scope off and on again clears it, so an edited card is read
   again. */

/* Everything on the card that can name someone, kept to a sensible size. */
export function cardCastText(character, { limit = 24000 } = {}) {
  if (!character) return "";
  if (Array.isArray(character.characters) || character.story != null || character.rules != null) return worldCastText(character, limit);
  const greets = Array.isArray(character.greetings)
    ? character.greetings.map((g) => g?.text).filter(Boolean)
    : [character.firstMessage].filter(Boolean);
  const lore = (character.lorebook?.entries || [])
    .filter((e) => e && e.enabled !== false && e.content)
    .map((e) => `${(e.keys || []).join(", ")}: ${e.content}`);
  return [
    character.description && `[Description]\n${character.description}`,
    character.personality && `[Personality]\n${character.personality}`,
    greets.length && `[Openings]\n${greets.join("\n\n")}`,
    character.exampleDialogs && `[Example dialogue]\n${character.exampleDialogs}`,
    character.creatorNotes && `[Author's notes]\n${character.creatorNotes}`,
    lore.length && `[Lorebook]\n${lore.join("\n\n")}`,
  ].filter(Boolean).join("\n\n").slice(0, limit);
}

/* A universe: its story, rules, places and characters, and its openings. */
function worldCastText(u, limit) {
  const greets = Array.isArray(u.greetings) ? u.greetings.map((g) => g?.text).filter(Boolean) : [u.firstMessage].filter(Boolean);
  const lore = (u.lorebook?.entries || []).filter((e) => e && e.enabled !== false && e.content).map((e) => `${(e.keys || []).join(", ")}: ${e.content}`);
  return [
    u.story && `[Story]\n${u.story}`,
    u.rules && `[World rules]\n${u.rules}`,
    u.locations?.length && `[Locations]\n${u.locations.map((l) => `${l.name}: ${l.description || ""}`).join("\n")}`,
    u.characters?.length && `[Characters]\n${u.characters.map((c) => `${c.name}: ${[c.description, c.personality].filter(Boolean).join(" ")}`).join("\n")}`,
    greets.length && `[Openings]\n${greets.join("\n\n")}`,
    lore.length && `[Lorebook]\n${lore.join("\n\n")}`,
  ].filter(Boolean).join("\n\n").slice(0, limit);
}

/* What to read for the cast, and whose story it is: one card, a universe,
   or the host's card with every linked member's card (`ensemble`), each
   under its own name. */
function castSource({ character, universe, ensemble = [] }) {
  if (universe) return { what: "a roleplay world", name: `the world of ${universe.name}`, leads: leadNames(universe.characters || []), text: cardCastText(universe) };
  const cards = [character, ...ensemble].filter(Boolean);
  if (cards.length > 1) {
    const share = Math.floor(12000 / cards.length);
    return {
      what: "a set of roleplay character cards",
      name: listOf(cards.map((c) => c.name)),
      leads: leadNames(cards),
      text: cards.map((c) => `=== ${c.name} ===\n${cardCastText(c, { limit: share })}`).join("\n\n"),
    };
  }
  const name = character?.name || "the character";
  return { what: "a roleplay character card", name, leads: [name], text: cardCastText(character) };
}

export function cardScanRequest({ character, universe, ensemble, userName }) {
  const src = castSource({ character, universe, ensemble });
  const leads = listOf(src.leads) || src.name;
  const system =
    `You read ${src.what} and list the other people in ${src.name}'s story. ` +
    `List every named person it mentions other than ${leads} and the user ({{user}} or ${userName}): family, friends, rivals, coworkers, anyone with a name. ` +
    "Skip unnamed roles (\"a guard\"), places, groups and things. " +
    `For each, write a description of one to three sentences from what it says: who they are, how they relate to ${leads}, and anything about how they look or behave. Invent nothing. ` +
    'Reply with only a JSON array, no prose and no code fences: [{"name": "...", "description": "..."}]. If there is nobody, reply [].';
  return { system, user: `${src.what[0].toUpperCase()}${src.what.slice(1)}, for ${src.name}:\n\n${src.text}` };
}

/* The model's list, read leniently: a bare array, an object holding one,
   or an array inside code fences or prose. */
export function parseCardCast(text) {
  const s = String(text || "");
  let data = null;
  const tryParse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  data = tryParse(s.trim());
  if (data == null) {
    const a = s.indexOf("[");
    const b = s.lastIndexOf("]");
    if (a >= 0 && b > a) data = tryParse(s.slice(a, b + 1));
  }
  if (data && !Array.isArray(data)) data = Object.values(data).find(Array.isArray) || null;
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  return data
    .map((x) => (typeof x === "string" ? { name: x, description: "" } : { name: String(x?.name || "").trim(), description: String(x?.description || "").trim() }))
    .filter((x) => x.name && x.name.length <= 60 && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase()))
    .slice(0, 20);
}

/* The people from the card who are not in the cast yet, never a lead or
   the user, and never anyone dismissed. */
export function newFromCard(found, scope, leads, userName) {
  const mine = [...leadNames(leads), userName].filter(Boolean);
  const taken = new Set(
    [...mine, ...scope.cast.map((c) => c.name), ...scope.dismissed].filter(Boolean).map((n) => n.toLowerCase())
  );
  const firstTaken = new Set(mine.map((n) => key(n)));
  return found.filter((f) => !taken.has(f.name.toLowerCase()) && !firstTaken.has(key(f.name)) && !/\{\{/.test(f.name));
}
