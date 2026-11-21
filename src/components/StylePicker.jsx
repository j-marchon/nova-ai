import { Disclosure } from "./motion/Disclosure.jsx";
import { MotionList } from "./motion/MotionList.jsx";
import React, { useRef, useState } from "react";
import { ChevronRight, Plus, Upload } from "lucide-react";
import { clamp } from "./theme.jsx";
import { AccBtn, Button, Field, PickRow, TextArea, TextInput, Toggle } from "./ui.jsx";
import { activeModel, endpointFor, sentSampler } from "../lib/api.js";
import { DEFAULT_STYLE, STYLE_PRESETS, STYLE_TUNING, activeCustomStyle, activePreset, customStyleList, parseStyleImport, samplerPreset, savedTuning, styleDefaults, styleTuning, thinkingOn, withThinking, withTuning } from "../lib/styles.js";

/* One fine-tuning value: a slider for feel, and a box for typing an exact
   number, since 0.95 is hard to land on with a thumb. The box keeps its own
   text while it is being typed in and commits on blur or Enter. */
export function TuneRow({ field, value, onChange }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    if (draft == null) return;
    const v = parseFloat(draft.replace(",", "."));
    if (Number.isFinite(v)) onChange(clamp(v, field.min, field.max));
    setDraft(null);
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-medium tracking-wide text-zinc-400 uppercase min-w-0 truncate">
          {field.label}
          {field.hint && <span className="normal-case tracking-normal text-zinc-600 font-normal"> · {field.hint}</span>}
        </span>
        <input
          type="text" inputMode="decimal"
          value={draft ?? String(value)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          className="w-16 px-2 py-0.5 rounded-md bg-[var(--nv-control)] border border-zinc-800 text-xs text-right tabular-nums outline-none focus:border-zinc-600"
          style={{ color: "var(--acc)" }}
        />
      </div>
      <input
        type="range" min={field.min} max={field.max} step={field.step} value={value} aria-label={field.label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="nv-range"
      />
    </div>
  );
}

/* The fine-tuning switch and values for one style, on the selected model.
   Each model keeps its own values, so the header names the model. The switch and the
   values are apart: the values sit folded away until opened, even while
   tuning is on, so a scroll past them cannot nudge a slider. Every change
   passes closes=false so the in-chat sheet stays open while tuning. */

export function AdvancedSamplersSection({ values = {}, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);

  const dry_multiplier = values.dry_multiplier ?? 0;
  const dry_base = values.dry_base ?? 1.75;
  const dry_allowed_length = values.dry_allowed_length ?? 2;
  const top_a = values.top_a ?? 0;
  const mirostat_mode = values.mirostat_mode ?? 0;
  const mirostat_tau = values.mirostat_tau ?? 5.0;
  const mirostat_eta = values.mirostat_eta ?? 0.1;
  const cfg_scale = values.cfg_scale ?? 1.0;
  const dynatemp_min = values.dynatemp_min ?? 0;
  const dynatemp_max = values.dynatemp_max ?? 0;
  const dynatemp_exponent = values.dynatemp_exponent ?? 1.0;

  const isActive =
    dry_multiplier > 0 ||
    top_a > 0 ||
    mirostat_mode > 0 ||
    (cfg_scale != null && cfg_scale > 1.0) ||
    dynatemp_min > 0 ||
    dynatemp_max > 0;

  return (
    <div className="rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight
            size={14}
            className="text-zinc-500 shrink-0 nv-chevron" data-angle="90" data-open={open ? "1" : "0"}
          />
          <span className="text-xs font-medium text-zinc-200 truncate">
            Advanced Samplers (DRY, Mirostat, CFG)
          </span>
        </div>
        <span
          className="text-[11px] shrink-0 tabular-nums"
          style={{ color: isActive ? "var(--acc)" : "var(--color-zinc-600)" }}
        >
          {isActive ? "active" : "off"}
        </span>
      </button>

      <Disclosure open={open}>
        <div>
          <div className={`px-3.5 pb-3.5 space-y-3.5 border-t border-[var(--nv-line)] pt-3 ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
            {/* DRY Repetition Penalty */}
            <div className="space-y-2">
              <div className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                DRY Repetition Penalty
              </div>
              <TuneRow
                field={{ key: "dry_multiplier", label: "DRY Multiplier", min: 0, max: 2, step: 0.01, hint: "0 = off" }}
                value={dry_multiplier}
                onChange={(v) => onChange({ dry_multiplier: v })}
              />
              <TuneRow
                field={{ key: "dry_base", label: "DRY Base", min: 1, max: 3, step: 0.01 }}
                value={dry_base}
                onChange={(v) => onChange({ dry_base: v })}
              />
              <TuneRow
                field={{ key: "dry_allowed_length", label: "DRY Allowed Length", min: 1, max: 10, step: 1, hint: "tokens" }}
                value={dry_allowed_length}
                onChange={(v) => onChange({ dry_allowed_length: v })}
              />
            </div>

            {/* Top-A */}
            <div className="space-y-2 pt-1 border-t border-[var(--nv-edge-ink)]">
              <div className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                Top-A Sampling
              </div>
              <TuneRow
                field={{ key: "top_a", label: "Top-A", min: 0, max: 1, step: 0.01, hint: "0 = off" }}
                value={top_a}
                onChange={(v) => onChange({ top_a: v })}
              />
            </div>

            {/* Mirostat */}
            <div className="space-y-2 pt-1 border-t border-[var(--nv-edge-ink)]">
              <div className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                Mirostat
              </div>
              <TuneRow
                field={{ key: "mirostat_mode", label: "Mirostat Mode", min: 0, max: 2, step: 1, hint: "0 = off, 1 = v1, 2 = v2" }}
                value={mirostat_mode}
                onChange={(v) => onChange({ mirostat_mode: v })}
              />
              {mirostat_mode > 0 && (
                <>
                  <TuneRow
                    field={{ key: "mirostat_tau", label: "Target Entropy (Tau)", min: 0, max: 10, step: 0.1 }}
                    value={mirostat_tau}
                    onChange={(v) => onChange({ mirostat_tau: v })}
                  />
                  <TuneRow
                    field={{ key: "mirostat_eta", label: "Learning Rate (Eta)", min: 0, max: 1, step: 0.01 }}
                    value={mirostat_eta}
                    onChange={(v) => onChange({ mirostat_eta: v })}
                  />
                </>
              )}
            </div>

            {/* CFG Scale */}
            <div className="space-y-2 pt-1 border-t border-[var(--nv-edge-ink)]">
              <div className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                Classifier-Free Guidance
              </div>
              <TuneRow
                field={{ key: "cfg_scale", label: "CFG Scale", min: 1, max: 5, step: 0.1, hint: "1 = off" }}
                value={cfg_scale}
                onChange={(v) => onChange({ cfg_scale: v })}
              />
            </div>

            {/* Dynamic Temperature */}
            <div className="space-y-2 pt-1 border-t border-[var(--nv-edge-ink)]">
              <div className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                Dynamic Temperature
              </div>
              <TuneRow
                field={{ key: "dynatemp_min", label: "Dynamic Temp Min", min: 0, max: 2, step: 0.01, hint: "0 = off" }}
                value={dynatemp_min}
                onChange={(v) => onChange({ dynatemp_min: v })}
              />
              <TuneRow
                field={{ key: "dynatemp_max", label: "Dynamic Temp Max", min: 0, max: 2, step: 0.01, hint: "0 = off" }}
                value={dynatemp_max}
                onChange={(v) => onChange({ dynatemp_max: v })}
              />
              <TuneRow
                field={{ key: "dynatemp_exponent", label: "Dynamic Temp Exponent", min: 0.1, max: 5, step: 0.1 }}
                value={dynatemp_exponent}
                onChange={(v) => onChange({ dynatemp_exponent: v })}
              />
            </div>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

export function StyleTuner({ settings, preset, onChange }) {
  const tune = styleTuning(settings, preset);
  const { src } = endpointFor(settings);
  const [open, setOpen] = useState(false);
  const model = activeModel(settings);
  const save = (patch) => onChange(withTuning(settings, preset.id, { ...tune, ...patch }), false);
  return (
    <div className="rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)]">
      <div className="flex items-center gap-2 pl-3.5 pr-2 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left"
          aria-expanded={open}
        >
          <ChevronRight size={15} className="text-zinc-500 shrink-0 nv-chevron" data-angle="90" data-open={open ? "1" : "0"} />
          <span className="min-w-0">
            <span className="block text-sm text-zinc-100 truncate">Fine tune {preset.name}</span>
            {model && <span className="block text-[11px] text-zinc-500 truncate">for {model.split("/").pop()}</span>}
          </span>
          <span className="text-[11px] shrink-0" style={{ color: tune.on ? "var(--acc)" : "var(--color-zinc-600)" }}>{tune.on ? "on" : "off"}</span>
        </button>
        <button
          onClick={() => save({ on: !tune.on })}
          role="switch"
          aria-checked={!!tune.on}
          data-on={tune.on ? "1" : undefined}
          aria-label={`Fine tune ${preset.name}`}
          className="p-1.5 rounded-full"
        >
          <Toggle on={!!tune.on} />
        </button>
      </div>
      <Disclosure open={open}>
        <div>
          <div className={`px-3.5 pb-3.5 space-y-3 border-t border-[var(--nv-line)] pt-3 ${tune.on ? "" : "opacity-40 pointer-events-none"}`}>
            {STYLE_TUNING.map((f) => (
              <TuneRow key={f.key} field={f} value={tune[f.key]} onChange={(v) => save({ [f.key]: v })} />
            ))}
            <AdvancedSamplersSection values={tune} onChange={(patch) => save(patch)} disabled={!tune.on} />
            {src === "openrouter" && (
              <button
                onClick={() => save({ strict: !tune.strict })}
                role="switch"
                aria-checked={!!tune.strict}
                data-on={tune.strict ? "1" : undefined}
                className="w-full flex items-center justify-between gap-3 pt-1 text-left"
              >
                <p className="text-xs text-zinc-200 min-w-0">Only providers that support every value</p>
                <Toggle on={!!tune.strict} />
              </button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => save(styleDefaults(preset))}
              className="text-zinc-400 hover:text-zinc-200"
            >
              Reset to defaults
            </Button>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

const fmt = (v) => String(Math.round(Number(v) * 1000) / 1000);
/* the value at which a sampler does nothing */
const NEUTRAL = { top_p: 1, top_k: 0, min_p: 0, frequency_penalty: 0, presence_penalty: 0, repetition_penalty: 1 };

/* What one style sends on the selected model and service, folded under it,
   whether fine tuning is on or not. It is for feedback only: the values come
   from sentSampler, the function the request itself is built from, so a
   value a service does not take shows as not sent rather than as set. */
export function GenSettings({ settings, styleId }) {
  const [open, setOpen] = useState(false);
  const { style, ep, sent } = sentSampler({ ...settings, stylePreset: styleId });
  const wanted = style.tuned || { temperature: style.temperature, max_tokens: style.max_tokens };
  const source = style.tuned?.on ? "fine tune" : style.tuned ? "preset" : "style defaults";
  const known = new Set([...STYLE_TUNING.map((f) => f.key), "rep_pen"]);
  const extras = Object.entries(sent).filter(([k]) => !known.has(k));
  const rows = STYLE_TUNING.map((f) => {
    const v = sent[f.key] ?? (f.key === "repetition_penalty" ? sent.rep_pen : undefined);
    if (v != null) return { f, text: f.key === "max_tokens" ? `${fmt(v)} tokens` : fmt(v), sent: true };
    const w = wanted[f.key];
    if (w != null && w !== NEUTRAL[f.key]) return { f, text: fmt(w), sent: false, note: `not sent, ${ep.name} does not take it` };
    return { f, text: w != null ? "off" : "service default", sent: false };
  });
  const summary = [
    sent.temperature != null ? `temp ${fmt(sent.temperature)}` : "",
    sent.top_p != null ? `top P ${fmt(sent.top_p)}` : "",
    sent.max_tokens != null ? `${fmt(sent.max_tokens)} tokens` : "",
  ].filter(Boolean).join(" · ");
  return (
    <div className="ml-3 rounded-xl border border-[var(--nv-line)] bg-[var(--nv-control)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
        aria-expanded={open}
      >
        <ChevronRight size={13} className="text-zinc-600 shrink-0 nv-chevron" data-angle="90" data-open={open ? "1" : "0"} />
        <span className="text-[11px] text-zinc-400 shrink-0">Gen settings</span>
        <span className="text-[11px] text-zinc-600 truncate min-w-0 flex-1">{summary}</span>
        <span className="text-[10px] shrink-0" style={{ color: style.tuned?.on ? "var(--acc)" : "var(--color-zinc-600)" }}>{source}</span>
      </button>
      <Disclosure open={open}>
        <div>
          <div className="px-3 pb-2.5 pt-2 border-t border-[var(--nv-line)] space-y-1">
            {rows.map(({ f, text, sent: on, note }) => (
              <div key={f.key} className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="text-zinc-500 min-w-0 truncate">{f.label}</span>
                <span className="tabular-nums text-right shrink-0" style={{ color: on ? "var(--color-zinc-200)" : "var(--color-zinc-600)" }}>
                  <span className={note ? "line-through" : ""}>{text}</span>
                  {note && <span className="block text-[10px]">{note}</span>}
                </span>
              </div>
            ))}
            {extras.length > 0 && (
              <p className="text-[10px] text-zinc-600 leading-snug pt-0.5">
                Also sent: {extras.map(([k, v]) => `${k} ${typeof v === "number" ? fmt(v) : v}`).join(", ")}
              </p>
            )}
            <p className="text-[10px] text-zinc-600 leading-snug pt-0.5">
              Sent to {ep.name}{activeModel(settings) ? ` for ${activeModel(settings).split("/").pop()}` : ""}.
              {" "}{style.tuned?.on ? "From this style's fine tuning." : style.tuned ? "The preset's own settings; fine tuning is off." : "This style's own settings; fine tuning is off."}
              {thinkingOn(settings) ? " The cap gets extra room while thinking is on." : ""}
            </p>
          </div>
        </div>
      </Disclosure>
    </div>
  );
}

/* The one reply-style picker, used in Settings and from inside a chat.

   onChange(next, closes) — closes is false for changes that should leave an
   open sheet open, so flipping the thinking switch does not dismiss it. */
export function StyleChips({ settings, onChange }) {
  const think = thinkingOn(settings);
  const preset = activePreset(settings);
  const current = preset.id;
  return (
    <div className="space-y-2">
      {STYLE_PRESETS.map((p) => {
        const on = current === p.id;
        return (
          <React.Fragment key={p.id}>
          <PickRow
            /* Custom keeps an open sheet open: the pick happens in the list */
            on={on}
            onPick={() => onChange({ ...settings, stylePreset: p.id }, !p.custom)}
            leading={<span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--acc)", opacity: on ? 1 : 0.35 }} />}
            title={<>
              <span className="flex-1 min-w-0">{p.name}</span>
              {p.id === DEFAULT_STYLE && <span className="text-[10px] shrink-0" style={{ opacity: .7 }}>default</span>}
              {savedTuning(settings, p.id)?.on && <span className="text-[10px] shrink-0">tuned</span>}
            </>}
            sub={on && p.desc ? p.desc : null}
          />
          {on && <GenSettings settings={settings} styleId={p.id} />}
          {p.custom && on && <CustomStyles settings={settings} onChange={onChange} />}
          </React.Fragment>
        );
      })}

      <button
        onClick={() => onChange(withThinking(settings, !think), false)}
        role="switch"
        aria-checked={think}
        data-on={think ? "1" : undefined}
        className="w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] hover:border-zinc-700 text-left"
      >
        <p className="text-sm text-zinc-100">Model thinking</p>
        <Toggle on={think} />
      </button>

      <StyleTuner settings={settings} preset={samplerPreset(settings)} onChange={onChange} />
    </div>
  );
}

/* What an imported SillyTavern preset brought besides its text: blocks
   placed deeper in the chat, and its prompt-only and display regex scripts
   (tavern.js, html.js). */
function draftExtras(d) {
  const n = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
  return [
    n("inject") ? `${n("inject")} in-chat block${n("inject") > 1 ? "s" : ""}` : "",
    n("regex") ? `${n("regex")} prompt regex script${n("regex") > 1 ? "s" : ""} (trims what is sent, not what you see)` : "",
    n("display") ? `${n("display")} display regex script${n("display") > 1 ? "s" : ""} (styles the bubbles, shows the model's HTML)` : "",
  ].filter(Boolean).join(", ");
}

/* The settings an editor draft carries, as one line, or "" */
function draftSettings(d) {
  if (d.sampler) {
    return STYLE_TUNING.filter((f) => d.sampler[f.key] != null && d.sampler[f.key] !== NEUTRAL[f.key])
      .map((f) => `${f.label} ${fmt(d.sampler[f.key])}`).join(" · ");
  }
  return [d.temperature != null ? `Temperature ${fmt(d.temperature)}` : "", d.maxTokens != null ? `Max reply length ${d.maxTokens}` : ""]
    .filter(Boolean).join(" · ");
}

/* The list behind Custom: pick a prompt, add one by pasting text or loading
   a .txt or .json file, edit or delete it. Everything is saved into
   settings, on the device. */
export function CustomStyles({ settings, onChange }) {
  const list = customStyleList(settings);
  const selected = list.find((x) => x.id === settings.customStyleId) || list[0];
  const usable = activeCustomStyle(settings);
  /* the editor: null when closed, otherwise the draft being written */
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const saved = Array.isArray(settings.customStyles) ? settings.customStyles : [];
  const newId = () => `imp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const open = (d) => { setErr(""); setDraft(d); };

  /* Upserts each item by id; the last one becomes the selected prompt. */
  const commit = (items) => {
    let next = [...saved];
    for (const it of items) {
      const i = next.findIndex((x) => x.id === it.id);
      if (i >= 0) next[i] = it;
      else next.push(it);
    }
    onChange({ ...settings, stylePreset: "custom", customStyles: next, customStyleId: items[items.length - 1].id }, false);
    setDraft(null);
    setErr("");
  };

  const save = () => {
    try {
      const fallback = draft.name.trim() || "Imported prompt";
      const parsed = parseStyleImport(draft.text, fallback);
      if (parsed.length > 1 && !draft.id) {
        commit(parsed.map((x) => ({ ...x, id: newId(), importedAt: Date.now() })));
        return;
      }
      const x = parsed[0];
      /* settings found in the box win; otherwise the ones loaded or saved
         with this prompt are kept, so editing its text does not lose them */
      const found = x.sampler || x.temperature != null || x.maxTokens != null;
      const sampler = found ? x.sampler : draft.sampler;
      const temperature = found ? x.temperature : draft.temperature;
      const maxTokens = found ? x.maxTokens : draft.maxTokens;
      /* A SillyTavern preset pasted in brings its own after-chat blocks and
         regex; plain text keeps the ones this prompt already has. */
      const st = x.post || x.inject || x.regex || x.display ? x : draft;
      commit([{
        id: draft.id || newId(),
        /* a name typed in the box wins over one found in the JSON */
        name: draft.name.trim() || x.name,
        text: x.text,
        ...(sampler ? { sampler } : {}),
        ...(!sampler && temperature != null ? { temperature } : {}),
        ...(!sampler && maxTokens != null ? { maxTokens } : {}),
        ...(st.post?.trim() ? { post: st.post } : {}),
        ...(st.inject?.length ? { inject: st.inject } : {}),
        ...(st.regex?.length ? { regex: st.regex } : {}),
        ...(st.display?.length ? { display: st.display } : {}),
        importedAt: Date.now(),
      }]);
    } catch (e) {
      setErr(e.message || String(e));
    }
  };

  /* A file goes through the same reader as pasted text. One prompt lands in
     the editor to be checked before saving; several are saved straight away.
     A file of generation settings alone, loaded while a prompt is open,
     gives that prompt its settings and leaves the text as it is. */
  const loadFile = async (file) => {
    try {
      const raw = await file.text();
      const base = file.name.replace(/\.[^.]+$/, "") || "Imported prompt";
      const parsed = parseStyleImport(raw, base, { allowEmpty: !!draft?.text?.trim() });
      if (parsed.length > 1 && !draft?.id) {
        commit(parsed.map((x) => ({ ...x, id: newId(), importedAt: Date.now() })));
        return;
      }
      const x = parsed[0];
      setErr("");
      setDraft((d) => ({
        ...(d || {}),
        id: d?.id,
        name: !x.text ? d.name : x.name,
        text: x.text || d.text,
        /* a new prompt replaces the old one's after-chat blocks and regex */
        ...(x.text ? { post: x.post, inject: x.inject, regex: x.regex, display: x.display } : {}),
        /* a file with no settings leaves the open prompt's own in place */
        ...(x.sampler || x.temperature != null || x.maxTokens != null
          ? { sampler: x.sampler, temperature: x.temperature, maxTokens: x.maxTokens }
          : {}),
      }));
    } catch (e) {
      setErr(`${file.name}: ${e.message || e}`);
    }
  };

  const remove = (id) => {
    const next = saved.filter((x) => x.id !== id);
    const s2 = { ...settings, customStyles: next };
    if (!customStyleList(s2).some((x) => x.id === s2.customStyleId)) s2.customStyleId = s2.customStyles?.[0]?.id || "";
    onChange(s2, false);
  };

  /* The editor, opened right under the prompt being edited (or at the end
     for a new one), and tall enough to read a whole prompt in. */
  const editor = () => (
    <div className="nv-fade p-3.5 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-3">
      <Field label="Name">
        <TextInput
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Name this prompt"
        />
      </Field>
      <Field label="Prompt">
        <TextArea
          rows={16}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          placeholder={"Paste the prompt as plain text, or paste JSON.\n{{char}} and {{user}} are filled in."}
        />
      </Field>
      {draft.post != null && (
        <Field label="After the chat">
          <TextArea
            rows={6}
            value={draft.post}
            onChange={(e) => setDraft({ ...draft, post: e.target.value })}
            placeholder="Sent after the newest message, the last thing the model reads."
          />
        </Field>
      )}
      {draftExtras(draft) && (
        <p className="text-[11px] text-zinc-500 leading-snug">
          Also imported: {draftExtras(draft)}. Blocks meant for impersonation, continue or background requests, and regex that rewrites saved messages, are left out.{" "}
          <button
            className="underline hover:text-zinc-300"
            onClick={() => setDraft({ ...draft, inject: undefined, regex: undefined, display: undefined })}
          >
            Remove
          </button>
        </p>
      )}
      {draftSettings(draft) && (
        <p className="text-[11px] text-zinc-500 leading-snug">Generation settings: {draftSettings(draft)}</p>
      )}
      {err && <p className="text-[11px] text-zinc-100 leading-snug">{err}</p>}
      <div className="flex items-center gap-2">
        <Button icon={Upload} onClick={() => fileRef.current?.click()}>
          Load file
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => { setDraft(null); setErr(""); }} className="text-zinc-400 hover:text-zinc-100">
          Cancel
        </Button>
        <AccBtn onClick={save} disabled={!draft.text.trim()}>Save</AccBtn>
      </div>
    </div>
  );

  return (
    <div className="pl-3 space-y-2">
      {!usable && (
        <p className="text-[11px] leading-snug px-1" style={{ color: "var(--nv-ink)" }}>
          {selected?.name || "This prompt"} has no text yet, so replies are written as {STYLE_PRESETS.find((p) => p.id === DEFAULT_STYLE).name} until you add some.
        </p>
      )}

      <MotionList className="space-y-2">{list.map((c) => {
        const on = selected?.id === c.id;
        const empty = !c.text?.trim();
        const temp = c.sampler?.temperature ?? c.temperature;
        const cap = c.sampler?.max_tokens ?? c.maxTokens;
        const meta = [
          temp != null ? `temp ${temp}` : "",
          c.sampler ? `top P ${c.sampler.top_p}` : "",
          cap != null ? `${cap} tokens` : "",
          c.thinking ? "thinking on" : "",
        ].filter(Boolean).join(" · ");
        return (
          <React.Fragment key={c.id}>
          <PickRow
            on={on}
            onPick={() =>
              empty
                ? (onChange({ ...settings, customStyleId: c.id }, false), open({ id: c.id, name: c.name, text: "" }))
                : onChange(withThinking({ ...settings, stylePreset: "custom", customStyleId: c.id }, c.thinking || thinkingOn(settings)))
            }
            title={c.name}
            sub={empty ? "Text not added yet — tap to paste it or load a file" : c.text.trim().slice(0, 160)}
            editLabel={c.name}
            onEdit={() => open({ id: c.id, name: c.name, text: c.text || "", sampler: c.sampler, temperature: c.temperature, maxTokens: c.maxTokens, post: c.post, inject: c.inject, regex: c.regex, display: c.display })}
            onRemove={() => remove(c.id)}
          >
            {meta && <span className="block text-[10px] mt-0.5" style={{ opacity: .7 }}>{meta}</span>}
          </PickRow>
          {draft?.id === c.id && editor()}
          </React.Fragment>
        );
      })}</MotionList>

      <input
        ref={fileRef}
        type="file"
        accept=".json,.txt,.md,application/json,text/plain,text/markdown"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) loadFile(f); }}
      />

      {draft && !draft.id ? (
        editor()
      ) : (
        <div className="flex items-center gap-2">
          <Button icon={Plus} onClick={() => open({ name: "", text: "" })} className="flex-1">
            Paste a prompt
          </Button>
          <Button icon={Upload} onClick={() => fileRef.current?.click()} className="flex-1">
            Import file
          </Button>
        </div>
      )}
    </div>
  );
}
