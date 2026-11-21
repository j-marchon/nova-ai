import { useStage } from "../components/motion/hooks.js";
import { readAppearancePreset } from "../lib/appearancePreset.js";
import { normalizeUiScale, UI_SCALE_MIN, UI_SCALE_MAX } from "../lib/uiScale.js";
import { version } from "../../package.json";
import { shortVersion } from "../lib/updates.js";
import { useRef, useState } from "react";
import {
  Brain, Check, Cpu, Image as ImageIcon, Activity, Lock, MessageCircle, MessagesSquare, Monitor, Moon,
  Palette, Pause, Plug, Plus, RectangleHorizontal, Sparkles, Sun, User, Waves, Zap,
} from "lucide-react";
import { AccountPanel, fmtNum } from "../components/AccountPanel.jsx";
import { BackupPanel } from "../components/BackupPanel.jsx";
import { UpdatePanel } from "../components/UpdatePanel.jsx";
import { SyncPanel } from "../components/SyncPanel.jsx";
import { BridgeUsage } from "../components/BridgeUsage.jsx";
import { StyleChips } from "../components/StylePicker.jsx";
import { BG_PRESETS } from "../components/backdrops.jsx";
import { ModelList, useEndpointLabel } from "../components/models.jsx";
import { ProvidersPanel } from "../components/ProvidersPanel.jsx";
import { VoiceSection } from "../components/VoiceSection.jsx";
import { BgEditor } from "../components/theme.jsx";
import { LoopVideo } from "../components/media.jsx";
import { Button, Field, ScrollTabs, Segmented, Slider, TextArea, TextInput, ToggleRow, TopBar, inputCls, selStyle } from "../components/ui.jsx";
import { hasKey } from "../lib/api.js";
import { DEFAULT_HISTORY_TOKENS, DEFAULT_THEME, MAX_HISTORY_TOKENS } from "../lib/data.js";
import { bannedList } from "../lib/prompt.js";
import { SUPPORTED_LANGUAGES } from "../lib/translate.js";
import { isVideo } from "../lib/video.js";
import { STANDARD, SUPPORT_URL, isBuiltInSkin, skinList, skinOf, skinPlain, skinScheme, skinSurface } from "../skins/skins.js";
import { MAX_ZIP_BYTES, SkinError } from "../skins/pack.js";
import { installPack, removePack } from "../skins/store.js";
import { useInstalledSkins } from "../components/useSkin.js";

/* A solid section with a concise label. */
function Block({ label, aside, children, i = 0 }) {
  return (
    <div className="nv-rise nv-block p-4 sm:p-5 space-y-4" style={{ "--i": i }}>
      {(label || aside) && (
        <div className="nv-block-head">
          {label && <p className="nv-label nv-label--ink shrink-0">{label}</p>}
          <span aria-hidden className="nv-kicker-rule" />
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

/* ---------- skins ----------
   The whole look, chosen here (skins/skins.js). The two looks that come with
   the app (Nova, Minimal), then every skin added on this device, then the
   supporter skins not added yet, shown locked so everyone can see them; each
   tile shows the skin's own colours, so the choice can be made at a glance. A skin comes as a .zip (from Ko-fi, say):
   Add skin checks it (skins/pack.js) and keeps a copy on this device, so
   the downloaded file can go. */
const SKIN_FILES = ".zip,application/zip,application/x-zip-compressed,application/octet-stream";

function SkinPicker({ value, onChange }) {
  const skins = skinList(useInstalledSkins());
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { ok, text }
  const [removing, setRemoving] = useState(null);

  async function add(file) {
    setBusy(true);
    setNote(null);
    try {
      if (file.size > MAX_ZIP_BYTES) throw new SkinError("That file is larger than a skin can be (12 MB).");
      const { meta, status } = await installPack(await file.arrayBuffer());
      onChange(meta.id);
      setNote({ ok: true, text: status === "added" ? `${meta.name} added. It is on now.` : `${meta.name} updated to ${meta.version}.` });
    } catch (e) {
      console.warn("Could not add the skin", e);
      setNote({ ok: false, text: e instanceof SkinError ? e.message : "Nova could not save the skin on this device." });
    } finally { setBusy(false); }
  }

  async function remove(skin) {
    setRemoving(null);
    if (value === skin.id) onChange("nova");
    try {
      await removePack(skin.id);
      setNote({ ok: true, text: `${skin.name} removed from this device.` });
    } catch { setNote({ ok: false, text: `Could not remove ${skin.name}.` }); }
  }

  const picked = skins.find((k) => k.id === value);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Skin">
        {skins.map((k) => {
          const on = value === k.id;
          return (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={on}
              data-on={on ? "1" : undefined}
              aria-disabled={k.locked || undefined}
              onClick={() => (k.locked ? setNote({ ok: true, locked: k }) : onChange(k.id))}
              className="nv-tile nv-hair relative rounded-2xl overflow-hidden text-left"
              style={{ borderColor: on ? "var(--nv-ink)" : undefined }}
            >
              <span aria-hidden className="block h-16" style={{ background: k.swatch || STANDARD.swatch, opacity: k.locked ? 0.45 : undefined }} />
              <span className="flex items-center gap-2 px-3 pt-2.5">
                <span className="text-sm text-zinc-100 font-medium truncate">{k.name}</span>
                {on && <Check size={14} className="ml-auto shrink-0" aria-hidden />}
                {k.locked && <Lock size={13} className="ml-auto shrink-0 text-zinc-500" aria-label="Not added" />}
              </span>
              <span className="block px-3 pb-3 pt-0.5 text-[11px] text-zinc-500 leading-snug">{k.note || (k.version ? `Version ${k.version}` : "")}</span>
            </button>
          );
        })}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={SKIN_FILES}
        data-skin-file=""
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) add(f); }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Plus} onClick={() => fileRef.current?.click()} disabled={busy}>{busy ? "Adding…" : "Add skin from file"}</Button>
        {picked && !isBuiltInSkin(picked.id) && !picked.locked && (removing === picked.id ? (
          <span className="flex items-center gap-2">
            <Button variant="danger" size="sm" onClick={() => remove(picked)}>Remove {picked.name}</Button>
            <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>Keep</Button>
          </span>
        ) : (
          <button type="button" onClick={() => setRemoving(picked.id)} className="text-[11px] underline underline-offset-2 text-zinc-500">Remove {picked.name} from this device</button>
        ))}
      </div>
      <p className="text-[11px] text-zinc-500 leading-snug">Skins come as .zip files. Pick the file as it is, without unzipping it. Nova keeps its own copy, so you can delete the download afterwards.</p>
      {note?.locked ? (
        <p role="status" className="text-xs leading-snug text-zinc-400">
          {note.locked.name} is a supporter skin, sold separately. Once you have its .zip, add it with Add skin from file.
          {SUPPORT_URL && <> <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-zinc-200">Get {note.locked.name}</a></>}
        </p>
      ) : note && <p role="status" className={`text-xs leading-snug ${note.ok ? "text-zinc-500" : ""}`} style={note.ok ? undefined : { color: "var(--nv-danger)" }}>{note.text}</p>}
    </div>
  );
}

/* ---------- appearance ---------- */
export function AppearancePanel({ ap, onChange }) {
  const [showBg, setShowBg] = useState(false);
  const pref = ap.scheme || "dark";

  const [importNote, setImportNote] = useState("");
  async function importPreset(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 4096) throw new Error();
      onChange(readAppearancePreset(await file.text()));
      setImportNote("Appearance applied.");
    } catch { setImportNote("Choose a Nova appearance preset JSON file."); }
  }

  const setScheme = (next) => onChange({ scheme: next });
  /* a skin drawn for one mode (Aero is light) holds Mode while it is worn */
  const fixedScheme = skinScheme(skinOf(ap));
  useInstalledSkins();
  const skinName = skinList().find((k) => k.id === skinOf(ap))?.name;

  return (
    <div className="nv-settings-stage space-y-3">

      <Block label="Skin" i={0}>
        <SkinPicker value={skinOf(ap)} onChange={(skin) => onChange({ skin })} />
      </Block>

      <Block label="Mode" i={1}>
        <Segmented
          size="lg"
          value={fixedScheme || pref}
          onChange={setScheme}
          disabled={!!fixedScheme}
          describedBy={fixedScheme ? "mode-held-note" : undefined}
          options={[
            { id: "dark", label: "Dark", icon: Moon },
            { id: "light", label: "Light", icon: Sun },
            { id: "auto", label: "Auto", icon: Monitor },
          ]}
        />
        {fixedScheme && (
          <p id="mode-held-note" className="text-xs text-zinc-500 leading-snug">
            {skinName} is a {fixedScheme} skin. Your Mode comes back when you pick another skin.
          </p>
        )}
      </Block>

      <Block label="Interface size" i={2}>
        <Slider label="UI size" value={normalizeUiScale(ap.uiScale)} min={UI_SCALE_MIN} max={UI_SCALE_MAX} step={0.05}
          onChange={value => onChange({ uiScale: normalizeUiScale(value) })}
          fmt={value => `${Math.round(value * 100)}%`} />
        <div className="flex justify-end">
          <Button type="button" size="sm" className="shrink-0" onClick={() => onChange({ uiScale: 1 })}>Reset size</Button>
        </div>
      </Block>

      <Block label="Chat bubbles" i={2}>
        <Segmented
          value={ap.bubbles === "aligned" ? "aligned" : "full"}
          onChange={(v) => onChange({ bubbles: v })}
          options={[
            { id: "full", label: "Full width", icon: RectangleHorizontal },
            { id: "aligned", label: "Aligned", icon: MessagesSquare },
          ]}
        />
        <p className="text-xs text-zinc-500 leading-snug">
          {ap.bubbles === "aligned"
            ? "Yours on the right, theirs on the left, like a messaging app."
            : "Every bubble runs the width of the chat. Roomy on a phone."}{" "}
          Phone messages follow this too.
        </p>
      </Block>

      <Block label="Motion" i={2}>
        <Segmented
          value={ap.motion || "full"}
          onChange={(v) => onChange({ motion: v })}
          options={[
            { id: "full", label: "Full motion", icon: Activity },
            { id: "calm", label: "Calm", icon: Waves },
            { id: "off", label: "Off", icon: Pause },
          ]}
        />
      </Block>

      <Block label="Surface" i={3}>
        {skinPlain(skinOf(ap)) ? (
          <p className="text-xs text-zinc-500 leading-snug">{skinName} keeps the page plain black: no grid, grain or background picture. They come back when you pick another skin.</p>
        ) : skinSurface(skinOf(ap)) ? (
          <p className="text-xs text-zinc-500 leading-snug">{skinName} draws its own surface. Grid and grain comes back when you pick another skin.</p>
        ) : (
          <ToggleRow title="Grid and grain" on={ap.texture !== false} onClick={() => onChange({ texture: ap.texture === false })} />
        )}
      </Block>
      <Block label="Background" i={4}>
        <div className="grid grid-cols-4 gap-2">
          {BG_PRESETS.map((b, n) => {
            const on = ap.bgPreset === b.id;
            return (
              <button
                key={b.id}
                onClick={() => onChange({ bgPreset: b.id, bgImage: null, preset: null })}
                aria-pressed={on}
                data-on={on ? "1" : undefined}
                className="nv-tile nv-hair relative rounded-xl overflow-hidden"
                style={{ "--i": n, borderColor: on ? "var(--nv-ink)" : undefined }}
              >
                {on && <span aria-hidden className="absolute top-1 right-1 z-[1] w-4 h-4 rounded-full flex items-center justify-center" style={{ background: "var(--nv-ink)", color: "var(--nv-bg)" }}><Check size={11} /></span>}
                <div
                  className="h-12"
                  style={b.url
                    ? { backgroundImage: `url(${b.url})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : { background: b.css || "#000" }}
                />
                <p className="text-[10px] text-zinc-400 py-1.5 text-center truncate px-1">{b.name}</p>
              </button>
            );
          })}
          <button
            onClick={() => setShowBg(true)}
            aria-pressed={ap.bgPreset === "custom"}
            data-on={ap.bgPreset === "custom" ? "1" : undefined}
            className="rounded-xl overflow-hidden border border-dashed"
            style={{ borderColor: ap.bgPreset === "custom" ? "var(--nv-ink)" : "var(--nv-line-strong)" }}
          >
            <div
              className="relative h-12 flex items-center justify-center text-zinc-500 overflow-hidden"
              style={ap.bgImage && !isVideo(ap.bgImage) ? { backgroundImage: `url(${ap.bgImage})`, backgroundSize: "cover", backgroundPosition: "center" } : {}}
            >
              {isVideo(ap.bgImage) && <LoopVideo src={ap.bgImage} className="absolute inset-0 w-full h-full object-cover" />}
              {!ap.bgImage && <Plus size={15} />}
            </div>
            <p className="text-[10px] text-zinc-400 py-1.5 text-center inline-flex items-center gap-1 justify-center w-full"><ImageIcon size={10} /> Yours</p>
          </button>
        </div>
        {ap.bgPreset !== "none" && (
          <Slider
            label="Background opacity"
            value={ap.bgOpacity ?? 0.75}
            min={0} max={1} step={0.05}
            onChange={(v) => onChange({ bgOpacity: v, preset: null })}
            fmt={(v) => `${Math.round(v * 100)}%`}
          />
        )}
      </Block>

      <Block label="Appearance preset">
        <label className="nv-btn nv-btn--secondary nv-btn--sm nv-hair cursor-pointer w-fit">
          <input type="file" accept=".json,application/json" aria-label="Import appearance preset" onChange={importPreset} className="sr-only" />
          <span className="nv-btn-label">Import preset</span>
        </label>
        {importNote && <p role="status" className="text-xs text-zinc-400">{importNote}</p>}
      </Block>

      {showBg && (
        <BgEditor
          initial={null}
          theme={DEFAULT_THEME}
          onSave={(bg) =>
            onChange({
              bgPreset: "custom", bgImage: bg.image, bgOpacity: bg.opacity, preset: null,
              /* a GIF keeps its framing as numbers instead of a baked crop */
              bgFrame: bg.animated
                ? { scale: bg.scale, nx: bg.nx, ny: bg.ny, ...(bg.t1 ? { t0: bg.t0, t1: bg.t1 } : {}) }
                : null,
            })
          }
          onDone={() => setShowBg(false)}
          onClose={() => setShowBg(false)}
        />
      )}
    </div>
  );
}

/* ---------- page: settings ----------

   One tab at a time, picked from the bar at the top, so each screen holds
   one subject instead of the whole list. */
const TABS = [
  { id: "providers", label: "Providers", icon: Plug },
  { id: "model", label: "Model", icon: Cpu },
  { id: "replies", label: "Replies", icon: MessageCircle },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "look", label: "Look", icon: Palette },
  { id: "usage", label: "Usage", icon: Zap },
  { id: "profile", label: "You", icon: User },
];

export function SettingsPage({ data, update }) {
  const s = data.settings;
  const ap = data.appearance;
  /* a fresh install has nothing to pick a model from yet */
  const [tab, setTab] = useState(() => (hasKey(s) ? "model" : "providers"));
  const setS = (patch) => update(d => ({ ...d, settings: { ...d.settings, ...patch } }));
  const endpoint = useEndpointLabel(s);
  const bans = bannedList(s.bannedPhrases).length;

  const tabs = (
    <ScrollTabs className="nv-settings-nav" aria-label="Settings tabs" value={tab}>
      <span className="nv-tabs-marker" data-selection-marker aria-hidden />
      {TABS.map((t, n) => {
        const on = tab === t.id;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={on} data-n={String(n + 1).padStart(2, "0")}>
            <t.icon size={16} strokeWidth={1.6} className="nv-settings-icon" />
            <span>{t.label}</span>
            {t.id === "providers" && !hasKey(s) && <span className="nv-dot" aria-label="Setup needed" />}
          </button>
        );
      })}
    </ScrollTabs>
  );
  const stage = useStage(tab, TABS.map((t) => t.id));
  return (
    <div className="nv-page-wrap max-w-[1100px] lg:max-w-none">
      <TopBar title="Settings" />
      <div className="lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-14 lg:items-start">
      <div className="nv-settings-side">{tabs}</div>
      <div ref={stage} className="nv-settings-stage space-y-3 min-w-0 max-w-2xl lg:max-w-none mt-5 lg:mt-0">
        {tab === "providers" && <ProvidersPanel settings={s} onChange={setS} />}

        {tab === "model" && (
          <div className="space-y-3 p-4 sm:p-5 nv-block">
            {!hasKey(s) && (
              <button onClick={() => setTab("providers")} className="nv-hair w-full text-left px-3.5 py-3 rounded-xl" style={{ borderColor: "var(--nv-edge-ink)" }}>
                <p className="text-sm text-zinc-100">{(s.providers || []).length ? `Add your ${endpoint.provider} key first` : "Add a provider first"}</p>
              </button>
            )}
            <ModelList settings={s} onChange={setS} onProviders={() => setTab("providers")} />
          </div>
        )}

        {tab === "replies" && (
          <>
            <StyleChips settings={s} onChange={(next) => update({ settings: next })} />

            <div className="p-4 sm:p-5 nv-block">
              <Slider
                label="Conversation memory"
                value={s.historyTokens ?? DEFAULT_HISTORY_TOKENS}
                min={1000} max={MAX_HISTORY_TOKENS} step={500}
                onChange={(v) => setS({ historyTokens: v })}
                fmt={(v) => `${(v / 1000).toFixed(1)}k tokens`}
              />
            </div>

            <Block label="Banned phrases" i={1} aside={<span className="text-[11px] text-zinc-500">{bans ? `${bans} phrase${bans === 1 ? "" : "s"}` : "Off"}</span>}>
              <TextArea
                rows={5}
                value={s.bannedPhrases || ""}
                onChange={(e) => setS({ bannedPhrases: e.target.value })}
                placeholder={"One per line, e.g.\nshivers down\nsmirk tugging"}
              />
            </Block>

            <Block label="Translation" i={2}>
              <Field label="Translate into">
                <select
                  aria-label="Translation language"
                  value={s.translateTargetLang || "en"}
                  onChange={(e) => setS({ translateTargetLang: e.target.value })}
                  className={inputCls + " cursor-pointer"}
                >
                  {SUPPORTED_LANGUAGES.filter((l) => l.code !== "auto").map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                </select>
              </Field>
              <ToggleRow
                title="Translate new replies"
                on={!!s.translateReplies}
                onClick={() => setS({ translateReplies: !s.translateReplies })}
              />
            </Block>

            <Block label="Read aloud" i={3}>
              <VoiceSection voiceSettings={s.voice} providers={s.providers || []} onChange={(voice) => setS({ voice })} />
            </Block>
          </>
        )}

        {tab === "memory" && (
          <div className="space-y-3 p-4 sm:p-5 nv-block">
            <ToggleRow on={!!s.ragOn} onClick={() => setS({ ragOn: !s.ragOn })} title="Recall related messages" sub="Local word search" />
            <ToggleRow on={s.memoryOn !== false} onClick={() => setS({ memoryOn: s.memoryOn === false })} title="Long-term memory" />
            <div className="nv-hair px-3.5 py-3 rounded-xl">
              <p className="text-sm text-zinc-100 mb-2.5">Scene tracking</p>
              <div className="grid grid-cols-4 gap-1.5">
                {[{ v: 0, l: "Off" }, { v: 2, l: "Every 2" }, { v: 4, l: "Every 4" }, { v: 8, l: "Every 8" }].map(({ v, l }) => {
                  const on = (s.sceneEvery ?? 4) === v;
                  return (
                    <Button
                      key={v}
                      selected={on}
                      onClick={() => setS({ sceneEvery: v })}
                      className={`px-1 text-xs ${on ? "" : "text-zinc-400 hover:text-zinc-200"}`}
                    >
                      {l}
                    </Button>
                  );
                })}
              </div>
            </div>
            <ToggleRow on={s.loreOn !== false} onClick={() => setS({ loreOn: s.loreOn === false })} title="Lorebooks" />
            {s.loreOn !== false && (
              <div className="nv-hair px-3.5 py-3 rounded-xl space-y-3">
                <div>
                  <p className="text-sm text-zinc-100">Keyword search depth</p>
                  <div className="grid grid-cols-3 gap-1.5 mt-2">
                    {[2, 4, 8].map((v) => {
                      const on = (s.loreDepth || 4) === v;
                      return (
                        <Button
                          key={v}
                          selected={on}
                          onClick={() => setS({ loreDepth: v })}
                          className={`px-1 text-xs ${on ? "" : "text-zinc-400 hover:text-zinc-200"}`}
                        >
                          last {v}
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <Slider
                  label="Lore budget per reply"
                  value={s.loreBudget || 800}
                  min={200} max={3000} step={100}
                  onChange={(v) => setS({ loreBudget: v })}
                  fmt={(v) => `${(v / 1000).toFixed(1)}k tokens`}
                />
              </div>
            )}
            <ToggleRow on={s.cardInstructions !== false} onClick={() => setS({ cardInstructions: s.cardInstructions === false })} title="Use card instructions" />
          </div>
        )}

        {tab === "look" && <AppearancePanel ap={ap} onChange={(patch) => update(d => ({ ...d, appearance: { ...d.appearance, ...patch } }))} />}

        {tab === "usage" && endpoint.src === "nova-bridge" && <BridgeUsage settings={s} />}

        {tab === "usage" && (endpoint.src !== "openrouter" ? (
          <div className="p-4 sm:p-5 nv-block space-y-2">
            {endpoint.isGoogle && (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                <a href="https://aistudio.google.com/rate-limit" target="_blank" rel="noreferrer" className="underline underline-offset-2" style={{ color: "var(--acc)" }}>Rate limits</a>
                {" · "}
                <a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer" className="underline underline-offset-2" style={{ color: "var(--acc)" }}>Usage</a>
              </p>
            )}
            {!endpoint.isGoogle && endpoint.src !== "nova-bridge" && (
              <p className="text-[11px] text-zinc-500 leading-relaxed">{endpoint.provider} does not report spend to apps. Its own dashboard has the figures.</p>
            )}
            <p className="text-[11px] text-zinc-600">
              {fmtNum(data.ledger?.tokensIn)} tokens in · {fmtNum(data.ledger?.tokensOut)} out
            </p>
          </div>
        ) : (
          <AccountPanel settings={s} ledger={data.ledger} />
        ))}

        {tab === "profile" && (
          <>
            <div className="p-4 sm:p-5 nv-block">
              <Field label="Your name">
                <TextInput value={data.username} onChange={(e) => update({ username: e.target.value })} placeholder="What characters call you" />
              </Field>
            </div>
            <BackupPanel data={data} update={update} />
            <SyncPanel data={data} update={update} />
            <UpdatePanel data={data} update={update} />
          </>
        )}

      </div>
      </div>
      {/* the one place the version shows; a .0 patch reads as "1.0" */}
      <p className="nv-label text-center pt-6">Nova {shortVersion(version)}</p>
    </div>
  );
}
