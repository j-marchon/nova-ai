import { useEffect, useRef, useState } from "react";
import { Brain, ChevronRight, Cpu, Sparkles, Wand2 } from "lucide-react";
import { Disclosure } from "./motion/Disclosure.jsx";
import { ModelPicker } from "./models.jsx";
import { AccBtn, Button, TextArea, Toggle, Segmented } from "./ui.jsx";
import { activity, activityModelLabel, cancelActivity, dismissActivity, runActivity, takeActivityOpen, takeActivityResult, useActivity, useActivityFocus } from "../lib/activity.js";
import { completeJson, hasKey, short, writerModelOf, writerModelPatch } from "../lib/api.js";
import { undoToast } from "../lib/toast.js";
import { AI_SCHEMAS, DETAIL_IDS, DETAIL_LEVELS, cardJobOf, fieldOf, requestOptions, resultFill, writeCard } from "../lib/cardStudio.js";

/* The engine (schemas, prompts, coercion) lives in lib/cardStudio.js. */
export { AI_SCHEMAS, DETAIL_LEVELS, cardJobOf, cardSystem, cardUser, paramLines } from "../lib/cardStudio.js";

/* what reopens the panel by itself: work still running, or a result nobody has used */
const pendingCard = (j) => j.status === "running" || (j.status === "done" && j.result !== undefined);
const cardJob = (kind, itemId) => activity.get().findLast((j) => cardJobOf(j, kind, itemId) && pendingCard(j));
/* the island's event: { kind, itemId }, or a bare kind */
const studioEventFor = (detail, kind, itemId) =>
  typeof detail === "string" ? detail === kind : detail?.kind === kind && (detail.itemId || null) === (itemId || null);
const asList = (v) => (Array.isArray(v) ? v : []);
const crowded = (kind, values) => kind === "universes" && (asList(values?.characters).length > 10 || asList(values?.locations).length > 10);

/* ---------- Card studio: a dropdown inside every create form ----------

   The row opens a panel in place: the brief, the detail level, the part to
   rewrite (once the form has content), the writer model and the thinking
   switch. The result goes straight into the form through `onFill(values,
   { part })`, which returns a function that restores the form as it was;
   an Undo toast offers it. The form is the review.

   `current` is what the form already holds, in the card's own shape, or
   null for an empty form. The job runs in the activity store, so it keeps
   going when the form closes; reopened, the panel shows the running job, or
   offers a result that finished while the form was closed. */

export function AiFill({ kind, itemId = null, settings, current, onFill, onSettings }) {
  const schema = AI_SCHEMAS[kind];
  const job = useActivity((jobs) => jobs.findLast((j) => cardJobOf(j, kind, itemId)));
  const [open, setOpen] = useState(() => !!cardJob(kind, itemId) || !!takeActivityOpen((j) => cardJobOf(j, kind, itemId)));
  const saved = settings.cardStudio?.[kind] || {};
  const [brief, setBrief] = useState(current ? "" : saved.brief || "");
  const [detail, setDetail] = useState(DETAIL_LEVELS[saved.detail] ? saved.detail : "medium");
  const [part, setPart] = useState(null);
  const [reasoning, setReasoning] = useState("");
  const [showReasoning, setShowReasoning] = useState(false);
  const [showModel, setShowModel] = useState(false);
  const [warn, setWarn] = useState(false);
  const row = useRef(null);
  /* jobs this mount watched run: their results go straight into the form */
  const watched = useRef(new Set());
  const running = job?.status === "running";
  const held = job?.status === "done" && job.result !== undefined && !watched.current.has(job.id) ? job : null;
  /* while the panel shows the job's own progress, the pill does not repeat it */
  useActivityFocus(job?.id, open && running);

  useEffect(() => {
    const reopen = (event) => {
      if (!studioEventFor(event.detail, kind, itemId)) return;
      takeActivityOpen((j) => cardJobOf(j, kind, itemId));
      setOpen(true);
      row.current?.scrollIntoView?.({ block: "nearest" });
    };
    window.addEventListener("nova-card-studio", reopen);
    return () => window.removeEventListener("nova-card-studio", reopen);
  }, [kind, itemId]);

  /* the form only knows a part while it has content */
  useEffect(() => { if (!current && part) setPart(null); }, [current, part]);

  const fillRef = useRef(onFill);
  fillRef.current = onFill;
  const apply = (j) => {
    const result = takeActivityResult(j.id);
    if (result === undefined) return;
    const { part: key, values } = resultFill(kind, result);
    const restore = fillRef.current?.(values, { part: key });
    setOpen(false);
    /* the form now has content: the box becomes "what to change", empty */
    setBrief("");
    setPart(null);
    setWarn(crowded(kind, values));
    const what = key ? `${fieldOf(schema, key)?.label || "Part"} rewritten` : "Card written";
    undoToast(what, () => { if (typeof restore === "function") restore(); setWarn(false); });
  };
  useEffect(() => {
    if (!job) return;
    if (job.status === "running") watched.current.add(job.id);
    else if (job.status === "done" && job.result !== undefined && watched.current.has(job.id)) {
      watched.current.delete(job.id);
      apply(job);
    }
  }); // every render: the job object changes on each status patch

  if (!schema) return null;
  const noKey = !hasKey(settings);
  const writer = writerModelOf(settings);
  const thinking = settings.writerThinking !== false;
  const field = part ? fieldOf(schema, part) : null;
  const error = job?.status === "error" ? job.error : null;

  const store = (patch) => {
    const all = settings.cardStudio || {};
    const mine = all[kind] || {};
    onSettings?.({ cardStudio: { ...all, [kind]: { ...(mine.brief ? { brief: mine.brief } : {}), detail, ...patch } } });
  };
  const pickDetail = (id) => { setDetail(id); store({ detail: id }); };

  const write = async () => {
    if (cardJob(kind, itemId)?.status === "running") return;
    if (!current) store({ brief });
    setReasoning("");
    setWarn(false);
    /* a new attempt replaces any failure of this kind still on the island */
    for (const previous of activity.get()) {
      if (previous.owner?.cardKind === kind && previous.status === "error") dismissActivity(previous.id);
    }
    const snapshot = { brief, current, part: field?.key || null, detail, thinking };
    const { maxTokens, effort } = requestOptions(detail, thinking);
    try {
      await runActivity({
        kind: "Card Studio · " + schema.label, owner: { cardKind: kind, itemId: itemId || null },
        dedupeKey: `card:${kind}:${itemId || "new"}`, model: activityModelLabel(settings, writer),
        phase: field ? `Rewriting ${field.label.toLowerCase()}` : "Writing the card",
      }, async (h) => {
        watched.current.add(h.id);
        let phase = null;
        const ask = (system, user) => completeJson({
          settings, system, user, signal: h.signal, activity: h, maxTokens, effort,
          onReasoning: (t) => { if (phase) h.phase(phase); setReasoning((r) => r + t); },
          onProgress: () => { if (phase) h.phase(phase); },
        });
        const out = await writeCard({ kind, ...snapshot, ask, signal: h.signal, onPhase: (p) => { phase = p; h.phase(p); } });
        h.signal.throwIfAborted();
        /* an older finished result for this card is superseded */
        for (const previous of activity.get()) {
          if (!cardJobOf(previous, kind, itemId) || previous.id === h.id) continue;
          if ((previous.status === "done" && previous.result !== undefined) || previous.status === "error") takeActivityResult(previous.id);
        }
        return { studio: true, ...out };
      });
    } catch {
      /* failures stay on the job, which the panel shows */
    }
  };

  const stop = () => job && cancelActivity(job.id);
  const discard = () => held && takeActivityResult(held.id);
  const label = schema.label;
  const subtitle = running
    ? job.phase || "Writing…"
    : held ? "A result is ready"
    : "";

  return (
    <div ref={row} className="rounded-2xl nv-glass">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3.5 py-3.5 text-left"
      >
        <Wand2 size={18} strokeWidth={1.6} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-100">Card studio</p>
          {subtitle && <p className="text-[11px] text-zinc-500 truncate">{subtitle}</p>}
        </div>
        <ChevronRight size={16} className="text-zinc-600 shrink-0 nv-chevron" data-angle="90" data-open={open ? "1" : "0"} />
      </button>
      <Disclosure open={open}>
        <div>
          {open && (
            <section aria-label={`Card studio · ${label}`} className="px-3.5 pb-3.5 space-y-3">
              {held && (
                <div className="p-3 rounded-xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-2.5" role="status">
                  <p className="text-[12px] text-zinc-200">
                    {resultFill(kind, held.result).part ? `A rewritten ${fieldOf(schema, resultFill(kind, held.result).part)?.label.toLowerCase()} is ready.` : `A new ${label} finished while this form was closed.`}
                  </p>
                  <div className="flex gap-2">
                    <AccBtn onClick={() => apply(held)} className="flex-1">Use it</AccBtn>
                    <Button type="button" onClick={discard}>Discard</Button>
                  </div>
                </div>
              )}

              <label className="block">
                <span className="block mb-1.5 text-[11px] font-medium tracking-wide text-zinc-400 uppercase">
                  {current ? "What to change" : `Your ${label}, in your own words`}
                </span>
                <TextArea
                  rows={current ? 3 : 5}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder={current ? (field ? `How should the ${field.label.toLowerCase()} change? (optional)` : "Darker, give her a brother, more openings… (optional)") : schema.placeholder}
                />
              </label>

              <div className="space-y-1.5">
                <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Detail</p>
                <Segmented value={detail} onChange={pickDetail} options={DETAIL_IDS.map((id) => ({ id, label: DETAIL_LEVELS[id].label }))} />
              </div>

              {current && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Part</p>
                  <div role="radiogroup" aria-label="Part to write" className="flex flex-wrap gap-1.5">
                    {[{ key: null, label: "Whole card" }, ...schema.fields].map((f) => {
                      const on = (part || null) === f.key;
                      return (
                        <Button
                          key={f.key || "all"}
                          type="button"
                          size="sm"
                          selected={on}
                          role="radio"
                          aria-checked={on}
                          data-on={on ? "1" : undefined}
                          onClick={() => setPart(f.key)}
                        >
                          {f.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-[var(--nv-line)] bg-[var(--nv-control)] px-3 py-2 space-y-1.5">
                <button type="button" onClick={() => setShowModel(true)} className="w-full flex items-center gap-2.5 text-left">
                  <Cpu size={14} className="text-zinc-500 shrink-0" />
                  <p className="text-[12px] text-zinc-400 shrink-0">Written by</p>
                  <p className="text-[12px] text-zinc-100 truncate flex-1 min-w-0">{short(writer)}</p>
                  <ChevronRight size={14} className="text-zinc-600 shrink-0" />
                </button>
                <button type="button" onClick={() => onSettings?.({ writerThinking: !thinking })} role="switch" aria-checked={thinking} className="w-full flex items-center gap-2.5 text-left">
                  <Brain size={14} className="text-zinc-500 shrink-0" />
                  <p className="text-[12px] text-zinc-200 flex-1">Think it through first</p>
                  <Toggle on={thinking} />
                </button>
              </div>

              {noKey && <p className="text-[11px] text-zinc-100">Add a provider and key in Settings first.</p>}

              {running ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2" role="status">
                    <Sparkles size={13} style={{ color: "var(--acc)" }} className="nv-pulse shrink-0" />
                    <p className="text-[12px] text-zinc-300 flex-1 min-w-0 truncate">{job.phase || "Writing…"}</p>
                    {job.percent != null && <p className="text-[11px] text-zinc-500 tabular-nums">{job.percent}%</p>}
                    <Button type="button" size="sm" onClick={stop} className="shrink-0">Stop</Button>
                  </div>
                  {reasoning && (
                    <div className="rounded-xl border border-[var(--nv-line)] bg-[var(--nv-control)]">
                      <button type="button" onClick={() => setShowReasoning((v) => !v)} aria-expanded={showReasoning} className="w-full flex items-center gap-2 px-3 py-1.5 text-left">
                        <p className="text-[11px] text-zinc-500 flex-1">Thinking…</p>
                        <ChevronRight size={13} className="text-zinc-600 nv-chevron" data-angle="90" data-open={showReasoning ? "1" : "0"} />
                      </button>
                      <Disclosure open={showReasoning}>
                        <div>
                          {showReasoning && <Reasoning text={reasoning} />}
                        </div>
                      </Disclosure>
                    </div>
                  )}
                </div>
              ) : (
                <AccBtn
                  disabled={(!current && !brief.trim()) || noKey}
                  onClick={write}
                  size="lg"
                  icon={Wand2}
                  className="w-full"
                >
                  {current ? (field ? `Rewrite ${field.label.toLowerCase()}` : "Rewrite") : `Write the ${label}`}
                </AccBtn>
              )}

              {error && <p role="alert" className="text-[11px] text-zinc-100 leading-relaxed">{error}</p>}
            </section>
          )}
        </div>
      </Disclosure>
      {warn && crowded(kind, current) && (
        <p role="status" className="px-3.5 pb-3 text-xs text-zinc-400">Every character and place is sent with every reply, so replies use more tokens, get slower and cost more. Scope only scans the first part of a very large universe.</p>
      )}

      {showModel && (
        <ModelPicker
          settings={settings}
          current={writer}
          onPick={(id) => onSettings?.(writerModelPatch(settings, id))}
          onChange={(patch) => onSettings?.(patch)}
          onClose={() => setShowModel(false)}
        />
      )}
    </div>
  );
}

/* the model's thinking, streamed while it writes; kept small */
function Reasoning({ text }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <div ref={ref} className="max-h-28 overflow-y-auto px-3 pb-2">
      <p className="text-[11px] leading-relaxed text-zinc-500 whitespace-pre-wrap">{text}</p>
    </div>
  );
}
