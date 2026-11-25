import { MotionList } from "./motion/MotionList.jsx";
import { Disclosure } from "./motion/Disclosure.jsx";
import { useState } from "react";
import { ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import { AccBtn, Button, Field, Modal, Segmented, TextArea, TextInput } from "./ui.jsx";
import { fileSafe, saveFile, utf8 } from "../lib/cards.js";
import { entryLabel, newBook, newEntry, toWorldInfo } from "../lib/lore.js";

/* ---------- lorebook editor ----------

   One sheet for both kinds of book: a standalone one from the Lorebooks tab,
   and the one a character card carries. Entries are a list of collapsed rows;
   one opens at a time.

   Keys are typed as a comma-separated line. They are kept as that raw text
   while the sheet is open — splitting on every keystroke would eat the comma
   before the next key could be typed — and turned into lists on save. */

const keyText = (list) => (list || []).join(", ");
const keyList = (text) => String(text || "").split(",").map((k) => k.trim()).filter(Boolean);

const toDraft = (e) => ({ ...e, keysText: keyText(e.keys), secondaryText: keyText(e.secondaryKeys) });
/* the Advanced numbers and what a blank one means */
const ADVANCED_NUMBERS = { probability: 100, sticky: 0, cooldown: 0, delay: 0, groupWeight: 100, scanDepth: null };
const numOr = (v, d) => (v === "" || v == null || !Number.isFinite(Number(v)) ? d : Math.max(0, Number(v)));

const fromDraft = ({ keysText, secondaryText, ...e }) => {
  const secondaryKeys = keyList(secondaryText);
  const order = e.order === "" || !Number.isFinite(Number(e.order)) ? 100 : Number(e.order);
  for (const [k, d] of Object.entries(ADVANCED_NUMBERS)) if (k in e) e[k] = numOr(e[k], d);
  if ("probability" in e) e.probability = Math.min(100, e.probability);
  return { ...e, order, keys: keyList(keysText), secondaryKeys, selective: !!e.selective && secondaryKeys.length > 0 };
};

function Switch({ on, onClick, label, hint }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} data-on={on ? "1" : undefined} onClick={onClick} className="flex items-start gap-2.5 text-left">
      <span aria-hidden className="w-8 h-[18px] rounded-full shrink-0 mt-0.5 relative " style={{ background: on ? "var(--nv-ink)" : "color-mix(in srgb, var(--nv-ink) 16%, transparent)" }}>
        <span className="absolute top-[2px] w-3.5 h-3.5 rounded-full" style={{ left: on ? "16px" : "2px", background: on ? "var(--nv-bg)" : "var(--nv-ink)" }} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-zinc-200">{label}</span>
        {hint && <span className="block text-[10px] text-zinc-600 leading-snug">{hint}</span>}
      </span>
    </button>
  );
}

/* SillyTavern's finer controls (see lore.js); blank keeps the default. */
function EntryAdvanced({ e, set }) {
  const number = (k, label, placeholder, extra) => (
    <Field label={label}>
      <TextInput
        type="number"
        min="0"
        inputMode="numeric"
        value={k === "probability" && e.useProbability === false ? "" : e[k] ?? ""}
        placeholder={placeholder}
        onChange={(ev) => set({ [k]: ev.target.value === "" ? "" : Number(ev.target.value), ...extra })}
      />
    </Field>
  );
  return (
    <div className="pb-1 space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {number("probability", "Chance %", "100", { useProbability: true })}
        {number("sticky", "Sticky", "0")}
        {number("cooldown", "Cooldown", "0")}
        {number("delay", "Delay", "0")}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="col-span-2">
          <Field label="Group">
            <TextInput value={e.group || ""} onChange={(ev) => set({ group: ev.target.value })} placeholder="Comma-separated" />
          </Field>
        </div>
        {number("groupWeight", "Group weight", "100")}
        {number("scanDepth", "Scan depth", "Default")}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Switch on={!!e.groupOverride} onClick={() => set({ groupOverride: !e.groupOverride })} label="Prioritize in group" />
        <Switch on={!!e.useGroupScoring} onClick={() => set({ useGroupScoring: e.useGroupScoring ? null : true })} label="Group scoring" />
        <Switch on={e.matchWholeWords !== false} onClick={() => set({ matchWholeWords: e.matchWholeWords === false ? null : false })} label="Whole words" />
        <Switch on={!!e.excludeRecursion} onClick={() => set({ excludeRecursion: !e.excludeRecursion })} label="Not triggered by other entries" />
        <Switch on={!!e.preventRecursion} onClick={() => set({ preventRecursion: !e.preventRecursion })} label="Doesn't trigger other entries" />
        <Switch on={!!e.delayUntilRecursion} onClick={() => set({ delayUntilRecursion: e.delayUntilRecursion ? 0 : 1 })} label="Only triggered by other entries" />
      </div>
    </div>
  );
}

export function LorebookForm({ initial, title, onSave, onClose, embeddedIn }) {
  const [book, setBook] = useState(() => {
    const b = initial || newBook();
    return { ...b, entries: (b.entries || []).map(toDraft) };
  });
  const [openId, setOpenId] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [err, setErr] = useState(null);
  const [exportedTo, setExportedTo] = useState(null);

  const setEntry = (id, patch) =>
    setBook((b) => ({ ...b, entries: b.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
  const addEntry = () => {
    const e = toDraft(newEntry());
    setBook((b) => ({ ...b, entries: [...b.entries, e] }));
    setOpenId(e.id);
  };
  const dropEntry = (id) => setBook((b) => ({ ...b, entries: b.entries.filter((e) => e.id !== id) }));

  const finished = () => ({
    ...book,
    name: book.name.trim() || (embeddedIn ? `${embeddedIn}'s lorebook` : "Untitled lorebook"),
    entries: book.entries.map(fromDraft).filter((e) => e.content.trim() || e.keys.length),
  });

  const exportBook = async () => {
    setErr(null);
    setExportedTo(null);
    try {
      const b = finished();
      setExportedTo(await saveFile(`${fileSafe(b.name)}.json`, utf8.encode(JSON.stringify(toWorldInfo(b), null, 2)), "application/json"));
    } catch {
      setErr("Could not export the lorebook.");
    }
  };

  const sheet = (
    <Modal title={title || (initial ? "Edit lorebook" : "New lorebook")} onClose={onClose} wide screen>
      <div className="space-y-4">
        {!embeddedIn && (
          <>
            <Field label="Name">
              <TextInput value={book.name} onChange={(e) => setBook({ ...book, name: e.target.value })} placeholder="e.g. The Free Cities" />
            </Field>
            <Field label="Description">
              <TextInput value={book.description} onChange={(e) => setBook({ ...book, description: e.target.value })} placeholder="What this book covers (not sent to the model)" />
            </Field>
          </>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Entries ({book.entries.length})</span>
          </div>
          <MotionList className="space-y-2">{book.entries.map((e) => {
            const open = openId === e.id;
            const keys = keyList(e.keysText);
            return (
              <div key={e.id} className="rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)]">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : e.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${e.enabled === false ? "text-zinc-600 line-through" : "text-zinc-100"}`}>
                      {entryLabel({ comment: e.comment, keys })}
                    </p>
                    <p className="text-[11px] text-zinc-600 truncate">
                      {e.constant ? "always on" : keys.length ? keys.join(", ") : "no keywords yet"}
                    </p>
                  </div>
                  <ChevronRight size={15} className="text-zinc-600 shrink-0 nv-chevron" data-angle="90" data-open={open ? "1" : "0"} />
                </button>
                {open && (
                  <div className="nv-fade px-3.5 pb-3.5 space-y-3">
                    <Field label="Title">
                      <TextInput value={e.comment} onChange={(ev) => setEntry(e.id, { comment: ev.target.value })} placeholder="Only for you — not sent" />
                    </Field>
                    <Field label="Keywords">
                      <TextInput
                        value={e.keysText}
                        onChange={(ev) => setEntry(e.id, { keysText: ev.target.value })}
                        placeholder="Comma-separated, e.g. Vale, the valley, /val+ey/"
                      />
                    </Field>
                    <Field label="Text">
                      <TextArea
                        rows={4}
                        value={e.content}
                        onChange={(ev) => setEntry(e.id, { content: ev.target.value })}
                        placeholder="What the model should know when this comes up."
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Switch on={e.enabled !== false} onClick={() => setEntry(e.id, { enabled: e.enabled === false })} label="Enabled" />
                      <Switch on={!!e.constant} onClick={() => setEntry(e.id, { constant: !e.constant })} label="Always on" />
                      <Switch on={!!e.selective} onClick={() => setEntry(e.id, { selective: !e.selective })} label="Check second keywords" />
                      <Switch on={!!e.caseSensitive} onClick={() => setEntry(e.id, { caseSensitive: !e.caseSensitive })} label="Match case" />
                    </div>
                    {e.selective && (
                      <>
                        <Field label="Second keywords">
                          <TextInput
                            value={e.secondaryText}
                            onChange={(ev) => setEntry(e.id, { secondaryText: ev.target.value })}
                            placeholder="Comma-separated"
                          />
                        </Field>
                        <Field label="Fires when">
                          <Segmented
                            value={e.logic || "and_any"}
                            onChange={(logic) => setEntry(e.id, { logic })}
                            options={[
                              { id: "and_any", label: "Any" },
                              { id: "and_all", label: "All" },
                              { id: "not_any", label: "None" },
                              { id: "not_all", label: "Not all" },
                            ]}
                          />
                        </Field>
                      </>
                    )}
                    <div className="border-t border-[var(--nv-line)]">
                      <button
                        type="button"
                        onClick={() => setAdvanced(!advanced)}
                        aria-expanded={advanced}
                        className="w-full min-h-11 flex items-center justify-between gap-2 text-left"
                      >
                        <span className="text-xs text-zinc-200">Advanced</span>
                        <ChevronRight size={14} className="text-zinc-600 shrink-0 nv-chevron" data-angle="90" data-open={advanced ? "1" : "0"} />
                      </button>
                      <Disclosure open={advanced}>
                        <div>{advanced && <EntryAdvanced e={e} set={(patch) => setEntry(e.id, patch)} />}</div>
                      </Disclosure>
                    </div>
                    <div className="flex items-end gap-3">
                      <Field label="Priority">
                        <TextInput
                          type="number"
                          value={e.order}
                          onChange={(ev) => setEntry(e.id, { order: ev.target.value === "" ? "" : Number(ev.target.value) })}
                          className="w-24"
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="icon"
                        icon={Trash2}
                        onClick={() => dropEntry(e.id)}
                        aria-label="Delete entry"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}</MotionList>
          <Button
            type="button"
            icon={Plus}
            onClick={addEntry}
            className="w-full text-xs text-zinc-500 hover:text-zinc-300"
          >
            Add an entry
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <AccBtn onClick={() => onSave(finished())} className="flex-1">
            {embeddedIn ? "Done" : "Save lorebook"}
          </AccBtn>
          <Button
            type="button"
            icon={Download}
            onClick={exportBook}
            disabled={!book.entries.length}
            title="Export as a SillyTavern World Info file"
          >
            Export
          </Button>
        </div>
        {err && <p className="text-[11px] text-zinc-100">{err}</p>}
        {exportedTo && <p className="text-[11px] text-zinc-500">Saved to {exportedTo}</p>}
      </div>
    </Modal>
  );

  /* opened from the character form, Modal lifts it over the form */
  return sheet;
}
