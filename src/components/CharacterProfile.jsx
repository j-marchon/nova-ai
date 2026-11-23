import { Plus, Trash2 } from "lucide-react";
import { Button, Field, TextArea, TextInput } from "./ui.jsx";
import { PERSONALITY, profileSections } from "../lib/characterTemplate.js";

export function EntryList({ label, entry, value, onChange, multiline = false }) {
  const rows = value?.length ? value : [""];
  const Input = multiline ? TextArea : TextInput;
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="nv-label">{label}</legend>
      {rows.map((text, i) => (
        <div className="flex items-start gap-2" key={i}>
          <div className="min-w-0 flex-1">
            <Input aria-label={`${label} ${i + 1}`} rows={multiline ? 3 : undefined} value={text}
              onChange={(e) => onChange(rows.map((old, j) => i === j ? e.target.value : old))} />
          </div>
          <Button type="button" variant="icon" icon={Trash2} aria-label={`Remove ${entry} ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => i !== j))} />
        </div>
      ))}
      <Button type="button" icon={Plus} onClick={() => onChange([...rows, ""])}>Add {entry}</Button>
    </fieldset>
  );
}

export function ProfileFields({ fields, value, onChange }) {
  const sections = profileSections(fields, value);
  const set = (key, text) => onChange({ ...sections, [key]: text });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields === PERSONALITY && sections.notes != null && (
        <Field label="Personality notes">
          <TextArea rows={3} value={sections.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      )}
      {fields.map((f) => f.entry ? (
        <EntryList key={f.key} label={f.label} entry={f.entry} value={sections[f.key]} onChange={(v) => set(f.key, v)} />
      ) : (
        <Field key={f.key} label={f.label}>
          <TextArea rows={3} value={sections[f.key] || ""} onChange={(e) => set(f.key, e.target.value)} />
        </Field>
      ))}
    </div>
  );
}
