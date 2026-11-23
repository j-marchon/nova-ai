/* Both editors use the same sections. Saved cards carry standard V2 text fields. */
export const DESCRIPTION = [
  { key: "notes", label: "Preliminary notes" },
  { key: "appearance", label: "Appearance" },
  { key: "story", label: "My story" },
  { key: "current", label: "How I am right now" },
  { key: "talk", label: "The way I talk" },
  { key: "move", label: "The way I move" },
  { key: "thoughts", label: "What's in my head" },
  { key: "feelings", label: "How I feel things" },
];

export const PERSONALITY = [
  { key: "likes", label: "Likes", entry: "like" },
  { key: "dislikes", label: "Dislikes", entry: "dislike" },
  { key: "shortGoals", label: "Short-term goals" },
  { key: "longGoals", label: "Long-term goals" },
  { key: "fears", label: "Fears" },
  { key: "quirks", label: "Quirks", entry: "quirk" },
  { key: "limits", label: "Hard limits", entry: "limit" },
];

export const strings = (values) => Array.isArray(values)
  ? values.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean) : [];

export function profileText(fields, value) {
  if (typeof value === "string") return value;
  const parts = [typeof value?.notes === "string" ? value.notes.trim() : ""];
  for (const f of fields) {
    if (f.key === "notes") continue;
    const v = value?.[f.key];
    const content = f.entry ? strings(v).map((line) => "- " + line).join("\n") : typeof v === "string" && v.trim();
    if (content) parts.push(`**${f.label}:**\n${content}`);
  }
  return parts.filter(Boolean).join("\n\n");
}

/* Recognize Nova's headings and the original builder's decorated Markdown.
   Free prose stays editable as notes, including personalities on older cards. */
export function profileSections(fields, value) {
  if (value && typeof value === "object") return value;
  const sections = {};
  let key = "notes";
  for (const line of (value || "").split(/\r?\n/)) {
    if (/^(?:# \{\{char\}\}'s Profile|## My Personality & What Drives Me|\*\*How I Operate:\*\*|\* +\*\*Goals:\*\*)\s*$/i.test(line)) continue;
    const heading = /^(?:\* +)?\*{1,2}([^*:\n]+):\*{1,2}[ \t]*(.*)$/.exec(line);
    if (heading) {
      const name = heading[1].toLowerCase().replace(/^(short|long)-term$/, "$1-term goals");
      const field = fields.find((f) => f.label.toLowerCase() === name);
      if (field) {
        key = field.key;
        (sections[key] ||= []).push(heading[2]);
        continue;
      }
    }
    (sections[key] ||= []).push(line);
  }
  const result = {};
  for (const [id, lines] of Object.entries(sections)) {
    const content = lines.join("\n").trim();
    if (content) result[id] = fields.find((f) => f.key === id)?.entry
      ? content.split(/^\s*- /m).map((s) => s.trim()).filter(Boolean) : content;
  }
  return result;
}

export function dialogueEntries(text) {
  if (Array.isArray(text)) return text;
  return (text || "").split(/^\s*<START>\s*$/im).map((s) => s.trim()).filter(Boolean)
    .map((s) => /\n\{\{(?:user|char)\}\}:/i.test(s) ? s : s.replace(/^\{\{char\}\}:[ \t]*/i, ""));
}

export function dialogueText(value) {
  if (typeof value === "string") return value;
  return strings(value).map((s) => "<START>\n" + (/^\{\{(?:user|char)\}\}:/i.test(s) ? s : "{{char}}: " + s)).join("\n\n");
}
