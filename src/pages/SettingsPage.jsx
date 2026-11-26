import { useStage } from "../components/motion/hooks.js";
import { normalizeUiScale, UI_SCALE_MIN, UI_SCALE_MAX } from "../lib/uiScale.js";
import { BubbleSizeSlider } from "../components/theme.jsx";
import { version } from "../../package.json";
import { shortVersion } from "../lib/updates.js";
import { useEffect, useRef, useState } from "react";
import {
  Brain, Check, Cpu, Activity, Lock, MessageCircle, MessagesSquare, Monitor, Moon,
  Palette, Pause, RectangleHorizontal, Sparkles, Sun, User, Waves, Zap,
} from "lucide-react";
import { AccountPanel, fmtNum } from "../components/AccountPanel.jsx";
import { BackupPanel } from "../components/BackupPanel.jsx";
import { UpdatePanel } from "../components/UpdatePanel.jsx";
import { SyncPanel } from "../components/SyncPanel.jsx";
import { BridgeUsage } from "../components/BridgeUsage.jsx";
import { StyleChips } from "../components/StylePicker.jsx";
import { ModelList, useEndpointLabel } from "../components/models.jsx";
import { NovaBridgeCard, ProvidersPanel } from "../components/ProvidersPanel.jsx";
import { VoiceSection } from "../components/VoiceSection.jsx";
import { Button, Field, ScrollTabs, Segmented, Slider, TextArea, TextInput, ToggleRow, TopBar, inputCls, selStyle, useNeedsSetup } from "../components/ui.jsx";
import { hasKey } from "../lib/api.js";
import { DEFAULT_HISTORY_TOKENS, MAX_HISTORY_TOKENS } from "../lib/data.js";
import { bannedList } from "../lib/prompt.js";
import { SUPPORTED_LANGUAGES } from "../lib/translate.js";
import { STANDARD, SUPPORT_URL, canWear, isBuiltInSkin, loadSkin, sceneSetOf, skinList, skinOf, skinScheme, skinTileArt } from "../skins/skins.js";
import { SkinTile } from "../skins/SkinTile.jsx";
import { iconChoices, iconFor, iconPick, iconSrc } from "../skins/icons.js";
import { MAX_ZIP_BYTES, SkinError } from "../skins/pack.js";
import { installPack, removePack } from "../skins/store.js";
import { useInstalledSkins, useLoadedSkins } from "../components/useSkin.js";

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
   The whole look, chosen here (skins/skins.js): the two that come with the
   app (Nova, Minimal), then every supporter skin. One not unlocked on this
   device shows locked; tapping it asks for its .zip, which is checked
   against the published file (skins/official.js) and kept on this device,
   so the download can go. No other file can be added. */
const SKIN_FILES = ".zip,application/zip,application/x-zip-compressed,application/octet-stream";

function SkinPicker({ value, onChange }) {
  const skins = skinList(useInstalledSkins());
  const rev = useLoadedSkins();
  const fileRef = useRef(null);
  const [unlocking, setUnlocking] = useState(null); // the locked skin whose file is being asked for
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { ok, text }
  const [removing, setRemoving] = useState(null);

  async function add(file) {
    setBusy(true);
    setNote(null);
    try {
      if (file.size > MAX_ZIP_BYTES) throw new SkinError(`That file is larger than a skin can be (${MAX_ZIP_BYTES / 1048576} MB).`);
      const { meta, status } = await installPack(await file.arrayBuffer(), { expect: unlocking?.id || null });
      onChange(meta.id);
      setNote({ ok: true, text: status === "added" ? `${meta.name} unlocked. It is on now.` : `${meta.name} updated to ${meta.version}.` });
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
              onClick={() => {
                if (!k.locked) { onChange(k.id); return; }
                /* a supporter skin: ask for its file */
                setUnlocking(k); setNote({ ok: true, locked: k });
                fileRef.current?.click();
              }}
              className="nv-tile nv-hair relative rounded-2xl overflow-hidden text-left"
              style={{ borderColor: on ? "var(--nv-ink)" : undefined }}
            >
              {/* the skin's first background, moving while on screen
                  (skins/SkinTile), or its colours when it has none */}
              {skinTileArt(k.id, rev)
                ? <SkinTile {...skinTileArt(k.id, rev)} className="block w-full aspect-video object-cover" />
                : <span aria-hidden className="block w-full aspect-video" style={{ background: k.swatch || STANDARD.swatch, opacity: k.locked ? 0.45 : undefined }} />}
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
        {busy && <p role="status" className="text-xs text-zinc-400">Checking the file…</p>}
        {picked && !isBuiltInSkin(picked.id) && !picked.locked && (removing === picked.id ? (
          <span className="flex items-center gap-2">
            <Button variant="danger" size="sm" onClick={() => remove(picked)}>Remove {picked.name}</Button>
            <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>Keep</Button>
          </span>
        ) : (
          <button type="button" onClick={() => setRemoving(picked.id)} className="text-[11px] underline underline-offset-2 text-zinc-500">Remove {picked.name} from this device</button>
        ))}
      </div>
      {note?.locked ? (
        <p role="status" className="text-xs leading-snug text-zinc-400">
          Supporter skin. Pick its .zip, still zipped, to unlock it.
          {SUPPORT_URL && <> <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-zinc-200">Get {note.locked.name}</a></>}
        </p>
      ) : note && <p role="status" className={`text-xs leading-snug ${note.ok ? "text-zinc-500" : ""}`} style={note.ok ? undefined : { color: "var(--nv-danger)" }}>{note.text}</p>}
    </div>
  );
}

/* The skin's backgrounds, when it has layered scenes (skins/LayeredScene):
   a tile for each, its still plate as the picture. */
function ScenePicker({ skin, value, onChange }) {
  useInstalledSkins();
  /* a pack's scenes are known once it has loaded: ask for it; the
     revision redraws this when it lands */
  const rev = useLoadedSkins();
  useEffect(() => { if (canWear(skin)) loadSkin(skin).catch(() => {}); }, [skin]);
  const set = sceneSetOf(skin, rev);
  if (!set) return null;
  const on = set.scenes.some((s) => s.id === value) ? value : set.scenes[0].id;
  return (
    <div className="space-y-2">
      <p className="nv-label">Background</p>
      <div className="grid grid-cols-3 lg:grid-cols-4 gap-2" role="radiogroup" aria-label="Background">
        {set.scenes.map((s) => {
          const picked = s.id === on;
          const plate = s.thumb || (s.desktop || s.phone).layers[0].src;
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={picked}
              data-on={picked ? "1" : undefined}
              onClick={() => onChange(s.id)}
              className="nv-tile nv-hair relative rounded-xl overflow-hidden text-left"
              style={{ borderColor: picked ? "var(--nv-ink)" : undefined }}
            >
              <img src={set.base + plate} alt="" loading="lazy" decoding="async" className="block w-full aspect-video object-cover" />
              <span className="flex items-center gap-1.5 px-2 py-1.5">
                <span className="text-[11px] text-zinc-100 truncate">{s.name}</span>
                {picked && <Check size={12} className="ml-auto shrink-0" aria-hidden />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- the app icon ----------
   Auto wears the skin's own icon; any other is kept whatever the skin
   (skins/icons.js). */
function IconPicker({ ap, onChange }) {
  const pick = iconPick(ap);
  const names = Object.fromEntries(skinList().map((k) => [k.id, k.name]));
  return (
    <div className="space-y-2">
      <p className="nv-label">App icon</p>
      <div className="grid grid-cols-4 gap-2 sm:gap-3" role="radiogroup" aria-label="App icon">
        {["auto", ...iconChoices()].map((id) => (
          <button key={id} type="button" role="radio" aria-checked={pick === id} onClick={() => onChange({ icon: id })}
            className="nv-hair min-h-11 rounded-[var(--nv-r-card)] p-2 flex flex-col items-center gap-1.5 hover:bg-[var(--nv-control)]">
            <img src={iconSrc(id === "auto" ? iconFor(skinOf(ap)) : id)} alt="" className="w-10 h-10 rounded-[22%]" />
            <span className="flex items-center gap-1 text-[11px] text-zinc-300">
              {id === "auto" ? "Auto" : names[id] || id}
              {pick === id && <Check size={12} className="shrink-0" aria-hidden />}
            </span>
          </button>
        ))}
      </div>
      {window.Capacitor?.isNativePlatform?.() && <p className="text-[11px] text-zinc-500 leading-snug">Changes the next time Nova starts.</p>}
    </div>
  );
}

/* ---------- appearance ---------- */
export function AppearancePanel({ ap, onChange }) {
  const pref = ap.scheme || "dark";

  const setScheme = (next) => onChange({ scheme: next });
  /* a skin drawn for one mode (Aero is light) holds Mode while it is worn */
  const fixedScheme = skinScheme(skinOf(ap));
  useInstalledSkins();
  const skinName = skinList().find((k) => k.id === skinOf(ap))?.name;

  return (
    /* two columns of their own on a wide window (as on You): the skin
       beside the rest, so no short block leaves a hole beside a tall one */
    <div className="nv-settings-stage nv-look-stage space-y-3 xl:space-y-0">
      <div className="space-y-3 min-w-0">
      <Block label="Skin" i={0}>
        <SkinPicker value={skinOf(ap)} onChange={(skin) => onChange({ skin })} />
        <ScenePicker skin={skinOf(ap)} value={ap.scenes?.[skinOf(ap)]} onChange={(id) => onChange({ scenes: { ...(ap.scenes || {}), [skinOf(ap)]: id } })} />
        <ToggleRow
          on={ap.skinInChat === true}
          onClick={() => onChange({ skinInChat: ap.skinInChat !== true })}
          title="Skin background in chats"
          sub="Off: a plain black or white page behind the chat. Bubbles, bar and buttons keep the skin"
        />
        <IconPicker ap={ap} onChange={onChange} />
      </Block>
      </div>

      <div className="space-y-3 min-w-0">

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
            {skinName} is a {fixedScheme} skin.
          </p>
        )}
      </Block>

      <Block label="Interface size" i={2}>
        <Slider label="UI size" value={normalizeUiScale(ap.uiScale)} min={UI_SCALE_MIN} max={UI_SCALE_MAX} step={0.05}
          onChange={value => onChange({ uiScale: normalizeUiScale(value) })}
          fmt={value => `${Math.round(value * 100)}%`} />
        <BubbleSizeSlider value={ap.bubbleScale} onChange={bubbleScale => onChange({ bubbleScale })} />
        <div className="flex justify-end">
          <Button type="button" size="sm" className="shrink-0" onClick={() => onChange({ uiScale: 1, bubbleScale: 1 })}>Reset size</Button>
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
      </div>

    </div>
  );
}

/* ---------- page: settings ----------

   One tab at a time, picked from the bar at the top, so each screen holds
   one subject instead of the whole list. */
/* Nova Bridge: the Bridge itself, its sync and backups. Model: the
   providers and their keys, then the model to use. */
const TABS = [
  { id: "bridge", label: "Nova Bridge", icon: Zap },
  { id: "model", label: "Model", icon: Cpu },
  { id: "replies", label: "Replies", icon: MessageCircle },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "look", label: "Look", icon: Palette },
  { id: "usage", label: "Usage", icon: Zap },
  { id: "profile", label: "You", icon: User },
];

export function SettingsPage({ data, update }) {
  const s = data.settings;
  const needsSetup = useNeedsSetup(s);
  const ap = data.appearance;
  /* Model first: a fresh install adds a provider there */
  const [tab, setTab] = useState("model");
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
            {t.id === "model" && needsSetup && <span className="nv-dot nv-beacon" aria-label="Setup needed" />}
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
        {tab === "bridge" && (
          /* the Bridge beside what travels through it (sync) */
          <div className="nv-settings-stage space-y-3 xl:space-y-0">
            <div className="space-y-3 min-w-0">
              <NovaBridgeCard settings={s} onChange={setS} alwaysOpen />
            </div>
            <div className="space-y-3 min-w-0">
              <SyncPanel data={data} update={update} />
            </div>
          </div>
        )}

        {tab === "model" && (
          <>
            <ProvidersPanel settings={s} onChange={setS} bridgeCard={false} />
            {(s.providers || []).length > 0 && (
              <div className="space-y-3 p-4 sm:p-5 nv-block">
                {!hasKey(s) && <p className="text-sm text-zinc-100">Add your {endpoint.provider} key first.</p>}
                <ModelList settings={s} onChange={setS} />
              </div>
            )}
          </>
        )}

        {tab === "replies" && (
          /* On a wide window the blocks flow down two balanced columns
             (.nv-settings-flow): the reply styles grow with your prompts,
             so no fixed split would stay even */
          <div className="nv-settings-flow space-y-3">
            <StyleChips settings={s} onChange={(next) => update({ settings: next })} />

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
          </div>
        )}

        {tab === "memory" && (
          <div className="space-y-3 p-4 sm:p-5 nv-block">
            <Slider
              label="Context window"
              value={s.historyTokens ?? DEFAULT_HISTORY_TOKENS}
              min={1000} max={MAX_HISTORY_TOKENS} step={500}
              onChange={(v) => setS({ historyTokens: v })}
              fmt={(v) => `${(v / 1000).toFixed(1)}k tokens`}
            />
            <p className="nv-label pt-1">Memory</p>
            <ToggleRow on={s.memoryOn !== false} onClick={() => setS({ memoryOn: s.memoryOn === false })} title="Story summary" sub="Old messages become a short note" />
            <div className="nv-hair px-3.5 py-3 rounded-xl">
              <p className="text-sm text-zinc-100">Scene tracker</p>
              <p className="text-[11px] text-zinc-500 leading-snug mt-0.5 mb-2.5">Who, where and when</p>
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
            <ToggleRow on={!!s.ragOn} onClick={() => setS({ ragOn: !s.ragOn })} title="Recall" sub="Older messages that match the newest one" />
            <p className="nv-label pt-1">Cards and lore</p>
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
                <div>
                  <p className="text-sm text-zinc-100">Recursive scan</p>
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[{ v: 0, l: "Off" }, { v: 1, l: "1 step" }, { v: 3, l: "3 steps" }, { v: 99, l: "No limit" }].map(({ v, l }) => {
                      const on = (s.loreRecursion || 0) === v;
                      return (
                        <Button
                          key={v}
                          selected={on}
                          onClick={() => setS({ loreRecursion: v })}
                          className={`px-1 text-xs ${on ? "" : "text-zinc-400 hover:text-zinc-200"}`}
                        >
                          {l}
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
              <p className="text-[11px] text-zinc-500 leading-relaxed">{endpoint.provider} does not report spend to apps.</p>
            )}
            <p className="text-[11px] text-zinc-600">
              {fmtNum(data.ledger?.tokensIn)} tokens in · {fmtNum(data.ledger?.tokensOut)} out
            </p>
          </div>
        ) : (
          <AccountPanel settings={s} ledger={data.ledger} />
        ))}

        {tab === "profile" && (
          /* two columns of their own on a wide window, so a short panel
             never leaves a gap beside a tall one */
          <div className="nv-settings-stage space-y-3 xl:space-y-0">
            <div className="space-y-3 min-w-0">
              <div className="p-4 sm:p-5 nv-block">
                <Field label="Your name">
                  <TextInput value={data.username} onChange={(e) => update({ username: e.target.value })} placeholder="What characters call you" />
                </Field>
              </div>
              <BackupPanel data={data} update={update} />
            </div>
            <div className="space-y-3 min-w-0">
              <UpdatePanel data={data} update={update} />
            </div>
          </div>
        )}

      </div>
      </div>
      {/* the one place the version shows; a .0 patch reads as "1.0" */}
      <p className="nv-label text-center pt-6">Nova {shortVersion(version)}</p>
    </div>
  );
}
