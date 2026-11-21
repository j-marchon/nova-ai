/* ============================================================
   Emotion Sprites & Sentiment Engine
   ============================================================ */

export const EMOTIONS = [
  { id: "neutral", label: "Neutral", emoji: "😐" },
  { id: "joy", label: "Joy", emoji: "😊" },
  { id: "anger", label: "Anger", emoji: "😠" },
  { id: "sadness", label: "Sadness", emoji: "😢" },
  { id: "surprise", label: "Surprise", emoji: "😲" },
  { id: "fear", label: "Fear", emoji: "😨" },
  { id: "blush", label: "Blush", emoji: "😳" },
  { id: "smug", label: "Smug", emoji: "😏" },
];

export const EMOTION_KEYS = EMOTIONS.map((e) => e.id);

/* Regex rules for sentiment and emotion detection */
const PATTERNS = {
  smug: [
    /\bsmirk(?:s|ed|ing)?\b/i,
    /\bsmug(?:ly)?\b/i,
    /\bsly(?:ly)?\b/i,
    /\bplayful(?:ly)?\b/i,
    /\bteas(?:e|es|ed|ing)\b/i,
    /\bmock(?:s|ed|ing|ingly)?\b/i,
    /\bchuckl(?:es|ed|ing)\s+slyly\b/i,
    /\bgrin(?:s|ned|ning)?\s+slyly\b/i,
    /\bamused(?:ly)?\b/i,
    /\bcocky\b/i,
    /\btriumphant(?:ly)?\b/i,
    /\b(?:arch(?:es|ed)?|rais(?:es|ed)?)\s+(?:an?\s+)?eyebrow\b/i,
    /\beyebrow\s+raised\b/i,
    /\bsnicker(?:s|ed|ing)?\b/i,
    /\b(?:heh|fufufu|too easy)\b/i,
  ],
  blush: [
    /\bblush(?:es|ed|ing|ingly)?\b/i,
    /\bfluster(?:ed|ing)?\b/i,
    /\bshy(?:ly)?\b/i,
    /\bembarrass(?:ed|ing|ment)?\b/i,
    /\bbashful(?:ly)?\b/i,
    /\bflush(?:es|ed|ing)?\b/i,
    /\bred-faced\b/i,
    /\bredden(?:s|ed|ing)?\b/i,
    /\bcheeks?\s+(?:burn(?:ing|s|ed)?|turn(?:ed|ing)?\s+red)\b/i,
    /\bturned\s+crimson\b/i,
    /\bavert(?:s|ed|ing)?\s+(?:her|his|their)?\s*(?:eyes|gaze)\b/i,
    /\blook(?:s|ed|ing)?\s+away\s+shyly\b/i,
    /\bstammer(?:s|ed|ing)?\b/i,
    /\bstutter(?:s|ed|ing)?\b/i,
    /\b(?:b-but|d-don'?t|dummy|i-it'?s not like)\b/i,
  ],
  surprise: [
    /\bgasp(?:s|ed|ing)?\b/i,
    /\bshock(?:ed|ing)?\b/i,
    /\bsurprise(?:d|s|ing)?\b/i,
    /\bstartl(?:e|ed|ing|es)?\b/i,
    /\bstun(?:ned|ning)?\b/i,
    /\bwide-eyed\b/i,
    /\beyes?\s+widen(?:ed|ing|s)?\b/i,
    /\bjaw\s+drop(?:ped|ping|s)?\b/i,
    /\bdisbelief\b/i,
    /\bastonish(?:ed|ing|ment)?\b/i,
    /\bflabbergasted\b/i,
    /\bbewilder(?:ed|ing|ment)?\b/i,
    /\bspeechless\b/i,
    /\btaken\s+aback\b/i,
    /\b(?:whoa|what\?!|wait,\s*what|no way\!)\b/i,
  ],
  fear: [
    /\btrembl(?:e|es|ed|ing)\b/i,
    /\bshudder(?:s|ed|ing)?\b/i,
    /\bshiver(?:s|ed|ing)?\b/i,
    /\bpanic(?:s|ked|king)?\b/i,
    /\bterrifi(?:ed|ying)\b/i,
    /\bterror\b/i,
    /\bfright(?:ened|ening)?\b/i,
    /\bscared\b/i,
    /\bdread(?:ing|ed)?\b/i,
    /\bcower(?:s|ed|ing)?\b/i,
    /\bhorror\b/i,
    /\bhorrifi(?:ed|ying)?\b/i,
    /\bshrink(?:s|ing)?\s+back\b/i,
    /\bshrank\s+back\b/i,
    /\bpetrifi(?:ed)?\b/i,
    /\bfrozen\s+in\s+fear\b/i,
    /\b(?:please\s+don'?t|stay\s+back|help\s+me)\b/i,
  ],
  sadness: [
    /\btear(?:s|ful|fully)?\b/i,
    /\btears?\s+stream(?:s|ed|ing)?\b/i,
    /\bcr(?:y|ies|ied|ying)\b/i,
    /\bweep(?:s|ing)?\b/i,
    /\bwept\b/i,
    /\bsob(?:s|bed|bing)?\b/i,
    /\bsad(?:ly|ness)?\b/i,
    /\bsorrow(?:ful|fully)?\b/i,
    /\bgrief\b/i,
    /\bmourn(?:s|ed|ing)?\b/i,
    /\bmelanchol(?:y|ic)\b/i,
    /\bheartbroken\b/i,
    /\bwhimper(?:s|ed|ing)?\b/i,
    /\bsniff(?:s|ed|ing|le|les|led)?\b/i,
    /\bdowncast\b/i,
    /\bdejected(?:ly)?\b/i,
    /\bdespair(?:ing)?\b/i,
    /\bdepressed\b/i,
    /\bgloomy\b/i,
    /\b(?:i'?m\s+sorry|it\s+hurts|leave\s+me\s+alone)\b/i,
  ],
  anger: [
    /\bglar(?:e|es|ed|ing)\b/i,
    /\bfur(?:y|ious|iously)\b/i,
    /\bang(?:er|ry|rily)\b/i,
    /\brage\b/i,
    /\braging\b/i,
    /\benrag(?:e|ed|ing)\b/i,
    /\bscowl(?:s|ed|ing)?\b/i,
    /\bfrown(?:s|ed|ing)?\b/i,
    /\bgrowl(?:s|ed|ing)?\b/i,
    /\bseeth(?:e|es|ed|ing)\b/i,
    /\bhiss(?:es|ed|ing)?\b/i,
    /\bsnarl(?:s|ed|ing)?\b/i,
    /\bsnap(?:s|ped|ping)?\b/i,
    /\bslam(?:s|med|ming)?\b/i,
    /\bclench(?:es|ed|ing)?\s+(?:fists?|teeth|jaw)\b/i,
    /\bgrit(?:s|ted|ting)?\s+(?:her|his|their)?\s*teeth\b/i,
    /\bvenom(?:ous|ously)?\b/i,
    /\bfuming\b/i,
    /\bshout(?:s|ed|ing)?\b/i,
    /\byell(?:s|ed|ing)?\b/i,
    /\b(?:shut\s+up|damn\s+it|dammit|how\s+dare\s+you|piss\s+off)\b/i,
  ],
  joy: [
    /\bsmil(?:e|es|ed|ing)\b/i,
    /\bgrin(?:s|ned|ning)?\b/i,
    /\bbeam(?:s|ed|ing)?\b/i,
    /\blaugh(?:s|ed|ing|ter)?\b/i,
    /\bgiggle(?:s|d|ing)?\b/i,
    /\bchuckle(?:s|d|ing)?\b/i,
    /\bcheerful(?:ly)?\b/i,
    /\bdelight(?:ed|ful|fully)?\b/i,
    /\bwarmly\b/i,
    /\bhappy\b/i,
    /\bhappily\b/i,
    /\boverjoyed\b/i,
    /\bradiant\b/i,
    /\bglee(?:ful|fully)?\b/i,
    /\bexcited(?:ly)?\b/i,
    /\bpleased\b/i,
    /\b(?:haha|hehe|yay|wonderful|so\s+happy)\b/i,
  ],
};

/* Evaluate a text segment for matching emotion */
function matchSegment(str) {
  if (!str) return null;
  const scores = {};
  for (const [emotion, regexList] of Object.entries(PATTERNS)) {
    let score = 0;
    for (const rx of regexList) {
      if (rx.test(str)) score++;
    }
    if (score > 0) scores[emotion] = score;
  }
  const entries = Object.entries(scores);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/**
 * Detect character emotion from roleplay text.
 * Prioritizes actions in asterisks, then dialogue cues, falling back to neutral.
 */
export function detectEmotion(text) {
  if (!text || typeof text !== "string") return "neutral";

  // 1. Check actions inside asterisks (*...*)
  const actions = [];
  const rx = /\*([^*]+)\*/g;
  let match;
  while ((match = rx.exec(text)) !== null) {
    const act = match[1].trim();
    if (act) actions.push(act);
  }

  // Scan actions in reverse order (the last action usually captures the final reaction)
  for (let i = actions.length - 1; i >= 0; i--) {
    const emo = matchSegment(actions[i]);
    if (emo) return emo;
  }

  // 2. If no emotion in asterisks, scan whole text
  const whole = matchSegment(text);
  if (whole) return whole;

  return "neutral";
}

/**
 * Resolve sprite URL for a given character and emotion.
 * Fallbacks: character.sprites[emotion] -> character.sprites.neutral -> character.avatar -> ""
 */
export function spriteForCharacter(character, emotion) {
  if (!character) return "";
  const sprites = character.sprites || {};
  if (emotion && sprites[emotion]) {
    return sprites[emotion];
  }
  if (sprites.neutral) {
    return sprites.neutral;
  }
  return character.avatar || "";
}

/**
 * Returns true if character has any emotion sprite defined.
 */
export function hasSprites(character) {
  if (!character || !character.sprites) return false;
  return Object.values(character.sprites).some((v) => typeof v === "string" && v.trim());
}
