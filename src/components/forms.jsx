import { Disclosure } from "./motion/Disclosure.jsx";
import { useEffect, useRef, useState } from "react";
import { BookMarked, ChevronLeft, ChevronRight, Download, ImageIcon, MapPin, Plus, Trash2, Upload } from "lucide-react";
import { LorebookForm } from "./LorebookForm.jsx";
import { AiFill } from "./AiFill.jsx";
import { ThemeSection } from "./theme.jsx";
import { AccBtn, Avatar, Button, Field, Modal, TextArea, TextInput } from "./ui.jsx";
import { AvatarPicker, useAvatarFile } from "./clip.jsx";
import { characterCardPng, fileSafe, saveFile } from "../lib/cards.js";
import { DEFAULT_THEME, greetingsOf, packGreetings } from "../lib/data.js";
import { EMOTIONS } from "../lib/sprites.js";
import { readImage, snapshotFile, uid } from "../lib/util.js";

/* ---------- opening scenarios, on the create forms ----------

   One opening is the normal case and it looks exactly as it always did: a
   single box with no numbering and no extra controls. The list only reveals
   itself once there is a second one, because a card with one way of starting
   should not be made to look like it is missing something.

   Labels appear at the same moment, for the same reason — a label is only
   worth typing when there is something to tell it apart from, and it is what
   the picker in the chat shows. An unlabelled scenario is fine; the picker
   falls back to numbering it. */
export function GreetingsEditor({ value, onChange, single = "First message", plural = "Opening scenarios", placeholder, hint }) {
  const rows = value?.length ? value : [{ id: "new", label: "", text: "" }];
  const many = rows.length > 1;

  const patch = (i, k, v) => onChange(rows.map((g, j) => (j === i ? { ...g, id: g.id === "new" ? uid() : g.id, [k]: v } : g)));
  const add = () => onChange([...rows.map((g) => ({ ...g, id: g.id === "new" ? uid() : g.id })), { id: uid(), label: "", text: "" }]);
  const drop = (i) => onChange(rows.filter((_, j) => j !== i));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
          {many ? `${plural} (${rows.length})` : single}
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((g, i) => (
          <div key={g.id || i} className={many ? "p-3 rounded-xl nv-hair space-y-2" : ""}>
            {many && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-500 shrink-0 w-4">{i + 1}.</span>
                <TextInput
                  value={g.label}
                  onChange={(e) => patch(i, "label", e.target.value)}
                  placeholder="Name this scenario — e.g. Late for the train"
                />
                <Button
                  type="button"
                  variant="icon"
                  size="sm"
                  icon={Trash2}
                  onClick={() => drop(i)}
                  aria-label="Remove this scenario"
                />
              </div>
            )}
            <TextArea
              rows={3}
              value={g.text}
              onChange={(e) => patch(i, "text", e.target.value)}
              placeholder={placeholder}
            />
          </div>
        ))}
      </div>

      <Button
        type="button"
        icon={Plus}
        onClick={add}
        className="w-full text-xs text-zinc-500 hover:text-zinc-300"
      >
        Add another opening
      </Button>

    </div>
  );
}

/* one glass group of fields on an editor screen */
export function Group({ title, children, i = 0 }) {
  return (
    <section className="nv-rise nv-block p-4 sm:p-5 space-y-4" style={{ "--i": i }}>
      {title && (
        <div className="nv-block-head">
          <p className="nv-label nv-label--ink shrink-0">{title}</p>
          <span aria-hidden className="nv-kicker-rule" />
        </div>
      )}
      {children}
    </section>
  );
}

const SaveBtn = ({ onClick, disabled }) => (
  <AccBtn onClick={onClick} disabled={disabled} className="shrink-0">
    Save
  </AccBtn>
);

/* The model returns plain arrays; every row in the app needs a stable id. */
export const withIds = (rows, shape) =>
  (Array.isArray(rows) ? rows : [])
    .filter((r) => r && String(r.name || r.title || r.character || r.keywords || "").trim())
    .map((r) => ({ id: uid(), ...shape, ...r }));

/* Tells the app whether the open form holds edits, so opening something
   else over it can ask first. */
function useReportDirty(f, dirtyRef) {
  const first = useRef(f);
  useEffect(() => { if (dirtyRef) dirtyRef.current = f !== first.current; }, [f, dirtyRef]);
  useEffect(() => () => { if (dirtyRef) dirtyRef.current = false; }, [dirtyRef]);
}

export const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));

/* The fields a row has beyond what the app itself manages, so a studio
   rewrite of one part sends them along and gets them back. */
const OWN_KEYS = new Set(["id", "avatar", "links", "name", "description", "personality"]);
export const cardExtras = (row) =>
  Object.fromEntries(Object.entries(row || {}).filter(([k, v]) => !OWN_KEYS.has(k) && ["string", "number", "boolean"].includes(typeof v)));
const keepOwn = (prev, keys) => Object.fromEntries(keys.filter((k) => prev?.[k] !== undefined).map((k) => [k, prev[k]]));
/* takes the name from name, title or character, then drops an alias that
   only repeated it, so it is not sent again as an extra field */
export const named = (row) => {
  const name = str(row.name || row.title || row.character);
  const out = { ...row, name };
  for (const alias of ["title", "character"]) if (alias in out && (!row.name || str(out[alias]) === name)) delete out[alias];
  return out;
};

/* Reading the openings back out of whatever the model actually sent.

   Asking for `greetings` gets `greetings` most of the time, but not always:
   a model that has seen a thousand character cards will reach for
   `alternate_greetings`, and one told to write a single opening will
   sometimes ignore the array and answer with the bare `firstMessage` or
   `opening` string the old schema used. Entries come back as objects with a
   label, or as bare strings, depending on the same coin toss.

   All of that is one field's worth of shapes, so it is handled here rather
   than by making the prompt longer and stricter — a retry costs the user a
   request, and a permissive reader costs nothing. `legacyKey` is the single
   string field to fall back on for this card type. */
/* the form's openings as the card studio writes them, without the ids */
const cardGreetings = (list) => (list || []).filter((g) => g.text?.trim()).map((g) => ({ label: g.label || "", text: g.text }));

export function toGreetings(o, legacyKey) {
  const raw =
    (Array.isArray(o?.greetings) && o.greetings) ||
    (Array.isArray(o?.alternate_greetings) && o.alternate_greetings) ||
    (Array.isArray(o?.alternateGreetings) && o.alternateGreetings) ||
    (Array.isArray(o?.openings) && o.openings) ||
    [];

  const rows = raw
    .map((g) =>
      typeof g === "string"
        ? { id: uid(), label: "", text: str(g) }
        : { id: uid(), label: str(g?.label || g?.name || g?.title), text: str(g?.text ?? g?.content ?? g?.message ?? g?.greeting) }
    )
    .filter((g) => g.text.trim());

  if (rows.length) return rows;

  /* nothing usable in the array — fall back to the old single field */
  const single = str(o?.[legacyKey] ?? o?.firstMessage ?? o?.first_mes ?? o?.opening);
  return single.trim() ? [{ id: uid(), label: "", text: single }] : [];
}

/* Personas have no picture: you are the one person in the chat who never
   needs one. A picture saved by an older version is dropped on save. */
export function PersonaForm({ initial, settings, onSave, onSettings, onClose, dirtyRef }) {
  const [f, setF] = useState(initial || { id: uid(), name: "", description: "", avatar: "" });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  useReportDirty(f, dirtyRef);
  return (
    <Modal
      title={initial ? "Edit persona" : "New persona"}
      onClose={onClose}
      screen
      action={<SaveBtn disabled={!f.name.trim()} onClick={() => onSave(f)} />}
    >
      <div className="space-y-4">
        <AvatarPicker value={f.avatar} onChange={(v) => set("avatar", v)} />
        <AiFill
          kind="personas"
          itemId={initial?.id || null}
          settings={settings}
          onSettings={onSettings}
          current={f.name || f.description ? { name: f.name, description: f.description } : null}
          onFill={(o) => {
            /* only the keys the studio sent; the form as it was comes back on Undo */
            let before;
            setF((p) => {
              before = p;
              return { ...p, ...("name" in o ? { name: str(o.name) || p.name } : {}), ...("description" in o ? { description: str(o.description) } : {}) };
            });
            return () => { if (before) setF(before); };
          }}
        />
        <Group title="Persona">
          <Field label="Name">
            <TextInput value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="What characters should call you" />
          </Field>
          <Field label="Description">
            <TextArea rows={5} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Appearance, personality, background..." />
          </Field>
        </Group>
      </div>
    </Modal>
  );
}

export function CharacterForm({ initial, settings, onSave, onSettings, onClose, dirtyRef }) {
  const [f, setF] = useState(() => {
    if (!initial) {
      return {
        id: uid(), name: "", description: "",
        greetings: [{ id: uid(), label: "", text: "" }],
        exampleDialogs: "", avatar: "",
        theme: { ...DEFAULT_THEME },
        sprites: {},
      };
    }
    /* older characters kept these apart — fold them into one box on open */
    const merged = [initial.description, initial.personality].filter(Boolean).join("\n\n");
    /* and older ones still have a single firstMessage; greetingsOf turns it
       into a one-entry list so the editor has something to work with */
    return { ...initial, description: merged, personality: "", greetings: greetingsOf(initial), sprites: initial.sprites ? { ...initial.sprites } : {} };
  });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  useReportDirty(f, dirtyRef);
  const save = () => onSave({ ...f, ...packGreetings(f.greetings, "firstMessage"), sprites: f.sprites || {} });
  const [editBook, setEditBook] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState(null);
  const [exportedTo, setExportedTo] = useState(null);
  /* Exports what is in the form, saved or not, as a PNG card any other
     frontend can read. */
  const exportCard = async () => {
    setExporting(true);
    setExportErr(null);
    setExportedTo(null);
    try {
      const png = await characterCardPng({ ...f, ...packGreetings(f.greetings, "firstMessage") });
      setExportedTo(await saveFile(`${fileSafe(f.name)}.png`, png, "image/png"));
    } catch {
      setExportErr("Could not export the card.");
    } finally {
      setExporting(false);
    }
  };
  return (
    <Modal
      title={initial ? "Edit character" : "New character"}
      onClose={onClose}
      screen
      action={<SaveBtn disabled={!f.name.trim()} onClick={save} />}
    >
      <div className="space-y-4">
        <AiFill
          kind="characters"
          itemId={initial?.id || null}
          settings={settings}
          onSettings={onSettings}
          current={f.name || f.description || f.greetings?.some((g) => g.text) || f.exampleDialogs ? {
            name: f.name, tagline: f.tagline || "", description: f.description,
            greetings: cardGreetings(f.greetings), exampleDialogs: f.exampleDialogs || "",
          } : null}
          onFill={(o) => {
            /* only the keys the studio sent; the form as it was comes back on Undo */
            let before;
            setF((p) => {
              before = p;
              return {
                ...p,
                ...("name" in o ? { name: str(o.name) || p.name } : {}),
                ...("tagline" in o ? { tagline: str(o.tagline) || p.tagline || "" } : {}),
                ...("description" in o ? { description: str(o.description) } : {}),
                ...("greetings" in o ? { greetings: toGreetings(o, "firstMessage") } : {}),
                ...("exampleDialogs" in o ? { exampleDialogs: str(o.exampleDialogs) } : {}),
              };
            });
            return () => { if (before) setF(before); };
          }}
        />

        <Group i={0} title="Identity">
          <AvatarPicker value={f.avatar} onChange={(v) => set("avatar", v)} />
          <Field label="Name">
            <TextInput value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Character name" />
          </Field>
          <Field label="Tagline">
            <TextInput value={f.tagline || ""} onChange={(e) => set("tagline", e.target.value)} placeholder="One line that sums them up" />
          </Field>
          <Field label="Description">
            <TextArea
              rows={7}
              value={f.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Appearance, history, traits, mannerisms, way of speaking..."
            />
          </Field>
        </Group>

        <Group i={1} title="Opening">
          <GreetingsEditor
            value={f.greetings}
            onChange={(v) => set("greetings", v)}
            placeholder="*She looks up from her book...* Oh, you made it."
          />
          <Field label="Example dialogue">
            <TextArea rows={3} value={f.exampleDialogs} onChange={(e) => set("exampleDialogs", e.target.value)} placeholder={"{{user}}: Hey\n{{char}}: *grins* About time."} />
          </Field>
        </Group>

        <Group i={2} title="Card">
          {/* The card author's public description, kept from an import. */}
          <Fold title="About this card" status={f.creatorNotes ? "" : "Empty"} start={!!f.creatorNotes && !initial}>
            <TextArea
              rows={6}
              value={f.creatorNotes || ""}
              onChange={(e) => set("creatorNotes", e.target.value)}
              placeholder="The card's description, as its author wrote it"
            />
          </Fold>
          {/* The card author's own instructions. Usually filled by an import. */}
          <Fold title="Card instructions" status={f.systemPrompt || f.postHistoryInstructions ? "Set" : "None"}>
            <Field label="System prompt">
              <TextArea rows={4} value={f.systemPrompt || ""} onChange={(e) => set("systemPrompt", e.target.value)} />
            </Field>
            <Field label="Post-history instructions">
              <TextArea rows={3} value={f.postHistoryInstructions || ""} onChange={(e) => set("postHistoryInstructions", e.target.value)} />
            </Field>
          </Fold>
          {/* Emotion Sprites */}
          <Fold title="Emotion Sprites" status={Object.values(f.sprites || {}).filter(Boolean).length ? `${Object.values(f.sprites || {}).filter(Boolean).length} set` : "None"}>
            <EmotionSpritesEditor sprites={f.sprites} onChange={(s) => set("sprites", s)} />
          </Fold>
          {/* The card's own lorebook, sent in every chat with them. */}
          <button
            type="button"
            onClick={() => setEditBook(true)}
            className="nv-hair w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-left hover:bg-[var(--nv-control)]"
          >
            <BookMarked size={16} className="text-zinc-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-200">Lorebook</p>
              <p className="text-[11px] text-zinc-600 truncate">
                {f.lorebook?.entries?.length ? `${f.lorebook.entries.length} ${f.lorebook.entries.length === 1 ? "entry" : "entries"}` : "None"}
              </p>
            </div>
            <ChevronRight size={15} className="text-zinc-600 shrink-0" />
          </button>
        </Group>
        {editBook && (
          <LorebookForm
            initial={f.lorebook}
            embeddedIn={f.name || "This character"}
            title={`${f.name || "Character"} — lorebook`}
            onSave={(b) => {
              setF((p) => {
                const { lorebook, ...rest } = p;
                return b.entries.length ? { ...rest, lorebook: b } : rest;
              });
              setEditBook(false);
            }}
            onClose={() => setEditBook(false)}
          />
        )}

        <ThemeSection theme={f.theme} onChange={(t) => set("theme", t)} />

        <Button
          size="lg"
          icon={Download}
          onClick={exportCard}
          disabled={!f.name.trim() || exporting}
          className="w-full"
        >
          {exporting ? "Exporting..." : "Export card"}
        </Button>
        {exportErr && <p className="text-[11px] text-zinc-100">{exportErr}</p>}
        {exportedTo && <p className="text-[11px] text-zinc-500">Saved to {exportedTo}</p>}
      </div>
    </Modal>
  );
}

/* A folded block inside a group: title, a short state, and its fields once
   opened. */
function Fold({ title, status, start = false, children }) {
  const [open, setOpen] = useState(start);
  return (
    <div className="nv-hair rounded-xl">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-3.5 py-3 text-left rounded-xl" aria-expanded={open}>
        <p className="text-sm text-zinc-200 flex-1 min-w-0 truncate">{title}</p>
        {status && <span className="text-[11px] text-zinc-600 shrink-0">{status}</span>}
        <ChevronRight size={15} className="text-zinc-600 shrink-0 nv-chevron" data-angle="90" data-open={open ? "1" : "0"} />
      </button>
      <Disclosure open={open}>
        <div>
          <div className="px-3.5 pb-3.5 space-y-3">{children}</div>
        </div>
      </Disclosure>
    </div>
  );
}

export function EmotionSpritesEditor({ sprites = {}, onChange }) {
  const fileInputRefs = useRef({});

  const setSprite = (emotion, url) => {
    const next = { ...(sprites || {}) };
    if (!url) {
      delete next[emotion];
    } else {
      next[emotion] = url;
    }
    onChange(next);
  };

  const handleFileUpload = async (emotion, file) => {
    if (!file) return;
    try {
      const snap = await snapshotFile(file);
      const { data } = await readImage(snap, 800, 0.85);
      setSprite(emotion, data);
    } catch (err) {
      console.error("Sprite upload failed:", err);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Attach sprite images or URLs for character emotions. In Visual Novel mode, the character's expression adapts to their dialogue and actions.
      </p>
      <div className="space-y-2.5">
        {EMOTIONS.map(({ id, label, emoji }) => {
          const currentUrl = sprites?.[id] || "";
          return (
            <div
              key={id}
              className="p-2.5 rounded-xl border border-[var(--nv-line)] bg-[var(--nv-control)] flex flex-col sm:flex-row items-start sm:items-center gap-2.5"
            >
              <div className="flex items-center gap-2.5 shrink-0 min-w-32">
                <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-[var(--nv-edge-ink)] flex items-center justify-center overflow-hidden shrink-0">
                  {currentUrl ? (
                    <img src={currentUrl} alt={label} className="w-full h-full object-cover object-top" />
                  ) : (
                    <span className="text-base select-none">{emoji}</span>
                  )}
                </div>
                <div>
                  <div className="text-xs font-medium text-zinc-200">{label}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">{id}</div>
                </div>
              </div>

              <div className="flex-1 w-full flex items-center gap-1.5 min-w-0">
                <TextInput
                  value={currentUrl}
                  onChange={(e) => setSprite(id, e.target.value)}
                  placeholder="Image URL or upload..."
                  aria-label={`${label} sprite URL`}
                />
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label={`Upload ${label} sprite file`}
                  ref={(el) => (fileInputRefs.current[id] = el)}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(id, file);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  variant="icon"
                  icon={Upload}
                  onClick={() => fileInputRefs.current[id]?.click()}
                  className="bg-[var(--nv-control)] text-zinc-300"
                  title={`Upload ${label} picture`}
                  aria-label={`Upload ${label} picture`}
                />
                {currentUrl && (
                  <Button
                    type="button"
                    variant="icon"
                    icon={Trash2}
                    onClick={() => setSprite(id, "")}
                    title={`Clear ${label} sprite`}
                    aria-label={`Clear ${label} sprite`}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- universe builder (four-step wizard) ---------- */

export function UniverseForm({ initial, existingCharacters, settings, onSave, onSettings, onClose, dirtyRef }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState(() =>
    initial
      ? { ...initial, greetings: greetingsOf(initial) }
      : {
          id: uid(), name: "", tagline: "", avatar: "", story: "", rules: "",
          greetings: [{ id: uid(), label: "", text: "" }],
          characters: [], locations: [], theme: { ...DEFAULT_THEME },
        }
  );
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  useReportDirty(f, dirtyRef);
  const [importing, setImporting] = useState(false);

  const setChar = (i, k, v) =>
    set("characters", f.characters.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const setLoc = (i, k, v) =>
    set("locations", f.locations.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const steps = ["World", "Characters", "Places", "Look"];

  return (
    <Modal title={initial ? "Edit universe" : "Create universe"} onClose={onClose} wide screen action={<SaveBtn disabled={!f.name.trim()} onClick={() => onSave({ ...f, ...packGreetings(f.greetings, "opening"), characters: f.characters.filter((c) => c.name.trim()), locations: f.locations.filter((l) => l.name.trim()) })} />}>
      {/* step indicator */}
      <div className="flex items-center gap-2 mb-5">
        {steps.map((s, i) => (
          <Button
            key={s}
            variant="ghost"
            size="sm"
            selected={i === step}
            onClick={() => setStep(i)}
            aria-current={i === step ? "step" : undefined}
            className={`flex-1 px-1 text-[11px] ${i === step ? "" : "text-zinc-600 hover:text-zinc-400"}`}
          >
            {i + 1}. {s}
          </Button>
        ))}
      </div>

      <div className="mb-4">
        {/* Keep the studio listener mounted on every wizard step */}
        <AiFill
          kind="universes"
          itemId={initial?.id || null}
          settings={settings}
          onSettings={onSettings}
          current={f.name || f.story || f.rules || f.greetings?.some((g) => g.text) || f.characters.length || f.locations.length ? {
            name: f.name, tagline: f.tagline || "", story: f.story, rules: f.rules,
            greetings: cardGreetings(f.greetings),
            characters: f.characters.map((c) => ({ ...cardExtras(c), name: c.name, description: c.description, personality: c.personality || "" })),
            locations: f.locations.map((l) => ({ ...cardExtras(l), name: l.name, description: l.description })),
          } : null}
          onFill={(o) => {
            /* only the keys the studio sent; the form as it was comes back on Undo */
            let before;
            setF((p) => {
              before = p;
              return {
                ...p,
                ...("name" in o ? { name: str(o.name) || p.name } : {}),
                ...("tagline" in o ? { tagline: str(o.tagline) } : {}),
                ...("story" in o ? { story: str(o.story) } : {}),
                ...("rules" in o ? { rules: str(o.rules) } : {}),
                ...("greetings" in o ? { greetings: toGreetings(o, "opening") } : {}),
                ...("characters" in o ? {
                  characters: withIds(o.characters, { avatar: "", description: "", personality: "" })
                    /* a rewrite keeps each existing character's picture and links */
                    .map((c, i) => named({
                      ...c,
                      ...keepOwn(p.characters[i], ["id", "avatar", "links"]),
                      description: str(c.description), personality: str(c.personality),
                    })),
                } : {}),
                /* places keep the model's extra fields too, and their own id */
                ...("locations" in o ? {
                  locations: withIds(o.locations, { description: "" }).map((l, i) => named({
                    ...l,
                    ...keepOwn(p.locations[i], ["id"]),
                    description: str(l.description),
                  })),
                } : {}),
              };
            });
            return () => { if (before) setF(before); };
          }}
        />
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <AvatarPicker value={f.avatar} onChange={(v) => set("avatar", v)} label="Universe cover" />
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Universe name">
              <TextInput value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Overwatch — Mission in King's Row" />
            </Field>
            <Field label="Tagline">
              <TextInput value={f.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="One line that sums up the setting" />
            </Field>
          </div>
          <Field label="Story / setting">
            <TextArea rows={6} value={f.story} onChange={(e) => set("story", e.target.value)} placeholder="The state of the world, where the story picks up, what is happening..." />
          </Field>
          <Field label="World rules">
            <TextArea rows={5} value={f.rules} onChange={(e) => set("rules", e.target.value)} placeholder="How the world works, what is and is not possible, the tone..." />
          </Field>
          <GreetingsEditor
            value={f.greetings}
            onChange={(v) => set("greetings", v)}
            single="Opening scene"
            placeholder="*Rain sweeps across King's Row as the transport touches down...*"
          />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          {(f.characters.length > 10 || f.locations.length > 10) && <p role="status" className="text-xs text-amber-300">Every character and place is sent with every reply, so replies use more tokens, get slower and cost more. Scope only scans the first part of a very large universe.</p>}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">
              Characters ({f.characters.length})
            </span>
            <div className="flex items-center gap-2">
              {existingCharacters.length > 0 && (
                <Button size="sm" onClick={() => setImporting(true)}>
                  Import existing
                </Button>
              )}
              <Button size="sm" icon={Plus} onClick={() => set("characters", [...f.characters, { id: uid(), name: "", avatar: "", description: "", personality: "" }])}>
                New
              </Button>
            </div>
          </div>
          {f.characters.map((c, i) => (
            <div key={c.id} className="p-3 rounded-xl nv-hair space-y-2">
              <div className="flex items-center gap-2">
                <Avatar src={c.avatar} name={c.name} size="w-9 h-9" />
                <TextInput value={c.name} onChange={(e) => setChar(i, "name", e.target.value)} placeholder="Name" />
                <Button
                  variant="icon"
                  icon={Trash2}
                  onClick={() => set("characters", f.characters.filter((_, j) => j !== i))}
                  aria-label="Remove character"
                />
              </div>
              <TextArea rows={4} value={c.description} onChange={(e) => setChar(i, "description", e.target.value)} placeholder="Who they are, how they look, their role..." />
              <TextInput value={c.personality} onChange={(e) => setChar(i, "personality", e.target.value)} placeholder="Personality and way of speaking (optional)" />
              <UniverseCharAvatar value={c.avatar} onChange={(v) => setChar(i, "avatar", v)} />
            </div>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {(f.characters.length > 10 || f.locations.length > 10) && <p role="status" className="text-xs text-amber-300">Every character and place is sent with every reply, so replies use more tokens, get slower and cost more. Scope only scans the first part of a very large universe.</p>}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Places ({f.locations.length})</span>
            <Button size="sm" icon={Plus} onClick={() => set("locations", [...f.locations, { id: uid(), name: "", description: "" }])}>
              Add place
            </Button>
          </div>
          {f.locations.map((l, i) => (
            <div key={l.id} className="p-3 rounded-xl nv-hair space-y-2">
              <div className="flex items-center gap-2">
                <MapPin size={15} className="text-zinc-600 shrink-0" />
                <TextInput value={l.name} onChange={(e) => setLoc(i, "name", e.target.value)} placeholder="Place name" />
                <Button
                  variant="icon"
                  icon={Trash2}
                  onClick={() => set("locations", f.locations.filter((_, j) => j !== i))}
                  aria-label="Remove place"
                />
              </div>
              <TextArea rows={4} value={l.description} onChange={(e) => setLoc(i, "description", e.target.value)} placeholder="What this place is like (optional)" />
            </div>
          ))}
        </div>
      )}

      {step === 3 && (
        <ThemeSection theme={f.theme} onChange={(t) => set("theme", t)} />
      )}

      {/* navigation */}
      <div className="flex items-center gap-2 mt-6">
        {step > 0 && (
          <Button icon={ChevronLeft} onClick={() => setStep(step - 1)} className="flex-1">
            Back
          </Button>
        )}
        {step < 3 ? (
          <AccBtn disabled={!f.name.trim()} iconRight={ChevronRight} onClick={() => setStep(step + 1)} className="flex-1">
            Next
          </AccBtn>
        ) : (
          <AccBtn
            disabled={!f.name.trim()}
            onClick={() => onSave({ ...f, ...packGreetings(f.greetings, "opening"), characters: f.characters.filter((c) => c.name.trim()), locations: f.locations.filter((l) => l.name.trim()) })}
            className="flex-1"
          >
            Save universe
          </AccBtn>
        )}
      </div>

      {importing && (
        <Modal title="Import character" onClose={() => setImporting(false)}>
          <div className="space-y-2">
            {existingCharacters.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  set("characters", [...f.characters, { id: uid(), name: c.name, avatar: c.avatar || "", description: c.description || "", personality: c.personality || "" }]);
                  setImporting(false);
                }}
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 text-left "
              >
                <Avatar src={c.avatar} name={c.name} size="w-9 h-9" />
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200">{c.name}</p>
                  <p className="text-xs text-zinc-600 truncate">{c.description || "—"}</p>
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </Modal>
  );
}

export function UniverseCharAvatar({ value, onChange }) {
  const pick = useAvatarFile(onChange);
  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" icon={ImageIcon} onClick={pick.open} className="text-zinc-400">
        {value ? "Change avatar" : "Avatar (optional)"}
      </Button>
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")} className="text-zinc-500 hover:text-zinc-300">
          Remove
        </Button>
      )}
      {pick.input}
      {pick.err && <span className="text-[11px] text-zinc-100">{pick.err}</span>}
      {pick.editor}
    </div>
  );
}
