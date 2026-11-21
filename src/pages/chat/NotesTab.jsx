import React, { useState } from "react";
import { Disclosure } from "../../components/motion/Disclosure.jsx";
import { MotionList } from "../../components/motion/MotionList.jsx";
import { AccBtn, Button, Field, PickRow, TextArea, TextInput } from "../../components/ui.jsx";
import { showToast, undoToast } from "../../lib/toast.js";
import { restoreList } from "../../lib/undo.js";
import { uid } from "../../lib/util.js";

const firstLine = (t) => String(t || "").split("\n").find((l) => l.trim())?.trim() || "";
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/* Escape closes the little prompt or editor it is pressed in, not the
   whole sheet (the sheet listens for Escape on the window). */
const keys = (onEnter, onEscape) => (e) => {
  if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); }
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onEscape(); }
};

const quiet = "text-zinc-400 hover:text-zinc-100";

/* The chat settings sheet's Notes tab: this chat's author's note, and the
   saved notes picked the way a reply style is (StylePicker). The note is
   sent near the end of the chat, three messages up, every turn
   (prompt.js). Presets live in settings.authorNotePresets as
   { id, name, text }. */
export function NotesTab({ text = "", onText, presets, onPresets }) {
  const list = Array.isArray(presets) ? presets : [];
  const hasText = !!text.trim();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState(null); // { id, name, text } of the preset being edited

  const clash = name.trim() ? list.find((x) => sameName(x.name, name)) : null;
  const openNaming = () => { setName(""); setNaming(true); };
  const closeNaming = () => { setNaming(false); setName(""); };
  const confirm = () => {
    const n = name.trim();
    if (!n || !hasText) return;
    if (clash) onPresets((cur) => cur.map((x) => (x.id === clash.id ? { ...x, name: n, text } : x)));
    else onPresets((cur) => [...cur, { id: uid(), name: n, text }]);
    showToast(`Saved preset "${n}"`);
    closeNaming();
  };

  const remove = (id) => {
    const before = list;
    const after = list.filter((x) => x.id !== id);
    onPresets(after);
    if (draft?.id === id) setDraft(null);
    undoToast("Preset deleted", () => onPresets((cur) => restoreList(cur, before, after)));
  };

  const draftClash = draft && list.some((x) => x.id !== draft.id && sameName(x.name, draft.name));
  const canSaveDraft = draft && draft.name.trim() && draft.text.trim() && !draftClash;
  const saveDraft = () => {
    if (!canSaveDraft) return;
    const next = { name: draft.name.trim(), text: draft.text };
    onPresets((cur) => cur.map((x) => (x.id === draft.id ? { ...x, ...next } : x)));
    setDraft(null);
  };
  const editor = () => (
    <div className="p-3.5 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-3">
      <Field label="Preset name">
        <TextInput
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={keys(saveDraft, () => setDraft(null))}
        />
      </Field>
      <Field label="Preset text">
        <TextArea
          rows={5}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={keys(null, () => setDraft(null))}
        />
      </Field>
      {draftClash && <p className="text-[11px] text-zinc-400">Another preset already has this name.</p>}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setDraft(null)} className={quiet}>Cancel</Button>
        <AccBtn onClick={saveDraft} disabled={!canSaveDraft}>Save</AccBtn>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Field label="Note">
        <TextArea
          rows={5}
          value={text}
          onChange={(e) => onText(e.target.value)}
          placeholder="e.g. Slow the pace. {{char}} does not trust {{user}} yet."
        />
      </Field>

      <div>
        {!naming && (
          <Button type="button" onClick={openNaming} disabled={!hasText}>
            Save preset
          </Button>
        )}
        <Disclosure open={naming}>
          <div>
            {naming && (
              <div className="p-3.5 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-3">
                <TextInput
                  aria-label="Preset name"
                  placeholder="Preset name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={keys(confirm, closeNaming)}
                />
                {clash && <p className="text-[11px] text-zinc-400">A preset named “{clash.name}” exists. Replace it with this note?</p>}
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={closeNaming} className={quiet}>Cancel</Button>
                  <AccBtn onClick={confirm} disabled={!name.trim() || !hasText}>
                    {clash ? "Replace" : "Confirm"}
                  </AccBtn>
                </div>
              </div>
            )}
          </div>
        </Disclosure>
      </div>

      {list.length > 0 && (
        <MotionList className="space-y-2">
          {list.map((x) => {
            const on = hasText && x.text === text;
            return (
              <React.Fragment key={x.id}>
                <PickRow
                  on={on}
                  onPick={() => onText(on ? "" : x.text)}
                  title={<span className="flex-1 min-w-0 truncate">{x.name}</span>}
                  sub={firstLine(x.text) || null}
                  editLabel={x.name}
                  onEdit={() => setDraft(draft?.id === x.id ? null : { id: x.id, name: x.name, text: x.text })}
                  onRemove={() => remove(x.id)}
                />
                {draft?.id === x.id && editor()}
              </React.Fragment>
            );
          })}
        </MotionList>
      )}
    </div>
  );
}
