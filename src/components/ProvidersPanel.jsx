import { providerFetch } from "../lib/providerTransport.js";
import { MotionList } from "./motion/MotionList.jsx";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Pencil, Plus, RefreshCw, Server, X, Zap } from "lucide-react";
import { AccBtn, Button, ConfirmDelete, Field, Modal, Segmented, TextArea, TextInput, SwapIcon } from "./ui.jsx";
import { fetchProviderModels } from "../lib/api.js";
import { findBridgeOnce, healthOf, pageHost, probe } from "../lib/bridgeFind.js";
import { SUBSCRIPTION_PROVIDERS } from "../lib/subBridge.js";
import {
  CUSTOM, LOCAL_PRESETS, PROVIDERS, TAG_ORDER, activeProvider, bridgeUrl, isLoopbackBase, isPrivateBase,
  newProvider, patchProvider, presetForKey, presetForUrl, presetOf,
} from "../lib/providers.js";

/* ---------- the Providers tab ----------

   Where replies come from, apart from which model writes them. A list of the
   saved providers to set up (tap one to edit it); which one the chat uses
   is picked in the Model tab, next to its models. Below it, a button opens
   the list of services to add, any of them as often as you like, or a
   Custom address. */

const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };
const maskKey = (k) => (!k ? "" : k.length <= 10 ? "••••" : `${k.slice(0, 6)}…${k.slice(-4)}`);

/* `bridgeCard`: Nova Bridge's own card above the list (Settings shows it on
   its own tab instead) */
export function ProvidersPanel({ settings, onChange, bridgeCard = true }) {
  const list = settings.providers || [];
  const active = activeProvider(settings);
  /* the provider being edited: { id, draft }, or null */
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);

  const save = (entry, isNew) => {
    const providers = isNew ? [...list, entry] : list.map((p) => (p.id === entry.id ? entry : p));
    /* a provider just added is the one you meant to use */
    onChange({ providers, ...(isNew || !active ? { activeProvider: entry.id } : {}) });
    setEditing(null);
    setAdding(false);
  };
  const remove = (id) => {
    const providers = list.filter((p) => p.id !== id);
    onChange({ providers, ...(active?.id === id ? { activeProvider: providers[0]?.id || "" } : {}) });
    setEditing(null);
  };

  return (
    <div className="space-y-3">
      {bridgeCard && <NovaBridgeCard settings={settings} onChange={onChange} />}
      <div className="p-4 rounded-3xl nv-glass space-y-2">
        <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Your providers</p>
        {list.length === 0 && <p className="text-xs text-zinc-500 py-2">No providers yet. Add one below to start chatting.</p>}
        <MotionList className="space-y-2">{list.map((p) => {
          const on = active?.id === p.id;
          const pre = presetOf(p.preset);
          const isBridge = p.preset === "nova-bridge";
          const sub = p.preset === "custom"
            ? `${hostOf(p.base)} · ${p.protocol === "anthropic" ? "Anthropic format" : "OpenAI format"}`
            : isBridge
            ? hostOf(p.base)
            : p.key ? maskKey(p.key) : "No key yet";
          const open = editing?.id === p.id;
          /* Nova Bridge sets itself up (its card); it cannot be edited or removed */
          if (isBridge) return (
            <div key={p.id} className="flex items-center gap-3 pl-3.5 pr-2 py-3 min-h-[60px] rounded-2xl border" style={{ borderColor: "var(--nv-line)" }}>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-100 truncate">{pre.name}</p>
                <p className="text-[11px] truncate text-zinc-500">{sub}</p>
              </div>
              {on && <span className="shrink-0 pr-2 text-[10px] uppercase tracking-wide text-zinc-400">In use</span>}
            </div>
          );
          return (
            <div key={p.id} className="rounded-2xl border" style={{ borderColor: "var(--nv-line)" }}>
              {/* not a switch: the chat's provider is picked in the Model tab */}
              <button
                onClick={() => setEditing(open ? null : { id: p.id, draft: { ...p } })}
                className={`w-full flex items-center gap-3 pl-3.5 pr-2 py-3 text-left ${open ? "rounded-t-2xl" : "rounded-2xl"}`}
                aria-expanded={open}
                aria-label={`${open ? "Close" : "Edit"} ${p.name || pre.name}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-100 truncate">{p.name || pre.name}</p>
                  <p className={`text-[11px] truncate ${!p.key && p.preset !== "custom" && !isBridge ? "text-zinc-100" : "text-zinc-500"}`}>{sub}</p>
                </div>
                {on && <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-400">In use</span>}
                <span className="shrink-0 grid place-items-center w-9 h-9 text-zinc-400"><SwapIcon icon={open ? X : Pencil} size={16} aria-hidden /></span>
              </button>
              {open && (
                <div className="px-3.5 pb-3.5 border-t border-[var(--nv-line)] pt-3">
                  <ProviderForm
                    bridgeLan={settings.bridgeLan}
                    draft={editing.draft}
                    setDraft={(d) => setEditing({ ...editing, draft: d })}
                    onSave={() => save(editing.draft, false)}
                    onRemove={() => remove(p.id)}
                    onSwitch={null}
                  />
                </div>
              )}
            </div>
          );
        })}</MotionList>

        <Button size="lg" icon={Plus} onClick={() => { setEditing(null); setAdding(true); }} className="w-full">
          Add a provider
        </Button>
      </div>

      {adding && (
        <AddProvider
          list={list}
          bridgeLan={settings.bridgeLan}
          onSave={(entry) => save(entry, true)}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/* The add-a-provider sheet. First a list of every service (any of them as
   many times as you like, say two OpenRouter keys), then, on picking one, its
   own form: the key, a link to get one, a connection test. */
function AddProvider({ list, bridgeLan, onSave, onClose }) {
  /* null while choosing, then the provider being filled in */
  const [draft, setDraft] = useState(null);
  const pick = (presetId, key) => setDraft(newProvider(presetId, key ? { key } : {}, list));
  const hasBridge = list.some((p) => p.preset === "nova-bridge");
  /* Nova Bridge finds itself and has its own card above, so one is enough */
  const services = PROVIDERS.filter((p) => !(p.id === "nova-bridge" && hasBridge));
  const count = (id) => list.filter((p) => p.preset === id).length;

  return (
    <Modal title={draft ? `Add ${presetOf(draft.preset) === CUSTOM ? "a custom address" : presetOf(draft.preset).name}` : "Add a provider"} onClose={onClose}>
      {!draft ? (
        <div className="space-y-4">
          {TAG_ORDER.map((tag) => {
            const group = services.filter((p) => p.tag === tag);
            return group.length ? (
              <div key={tag} className="space-y-2">
                <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">{tag}</p>
                {group.map((p) => <ServiceRow key={p.id} name={p.name} sub={p.blurb} added={count(p.id)} onClick={() => pick(p.id)} />)}
              </div>
            ) : null;
          })}
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase">Anything else</p>
            <ServiceRow name="Custom address" sub="Any OpenAI- or Anthropic-compatible server" added={count("custom")} onClick={() => pick("custom")} />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" icon={ChevronLeft} onClick={() => setDraft(null)} className="-ml-2 text-zinc-400 hover:text-zinc-200">
            All services
          </Button>
          <ProviderForm
            key={draft.preset}
            bridgeLan={bridgeLan}
            draft={draft}
            setDraft={setDraft}
            onSave={() => onSave(draft)}
            onCancel={onClose}
            onSwitch={pick}
            isNew
          />
        </div>
      )}
    </Modal>
  );
}

function ServiceRow({ name, sub, added, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 min-h-[56px] px-3.5 py-2.5 rounded-2xl nv-glass text-left">
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-100 truncate">{name}</p>
        {sub && <p className="text-[11px] text-zinc-500 truncate">{sub}</p>}
      </div>
      {added > 0 && <span className="text-[10px] text-zinc-500 shrink-0">{added} added</span>}
      <ChevronRight size={15} className="text-zinc-600 shrink-0" />
    </button>
  );
}

/* The fields for one provider. A listed service needs only its key; a custom
   one needs an address and the format it speaks, and may list models by hand
   for servers that do not publish their own. */
function ProviderForm({ bridgeLan, draft, setDraft, onSave, onCancel, onRemove, onSwitch, isNew = false }) {
  const pre = presetOf(draft.preset);
  const custom = pre === CUSTOM;
  const isBridge = draft.preset === "nova-bridge";
  const set = (patch) => { setDraft({ ...draft, ...patch }); setTest(null); };
  /* null | { status: "loading" } | { status: "ok", count } | { status: "fail", msg } */
  const [test, setTest] = useState(null);
  const [typed, setTyped] = useState((draft.models || []).join("\n"));

  /* a key or address that belongs to another listed service */
  const keyOwner = presetForKey(draft.key);
  const wrongKey = keyOwner && keyOwner.id !== draft.preset ? keyOwner : null;
  const urlOwner = custom ? presetForUrl(draft.base) : null;

  const runTest = async () => {
    setTest({ status: "loading" });
    try {
      const l = await fetchProviderModels(draft, { fresh: true });
      setTest({ status: "ok", count: l.length });
    } catch (e) {
      setTest({ status: "fail", msg: e.message });
    }
  };

  const ready = (custom || isBridge) ? !!draft.base.trim() && /^https?:\/\//i.test(draft.base.trim()) : !!draft.key.trim();

  return (
    <div className="space-y-3">
      {!custom && <p className="text-[11px] text-zinc-500 leading-relaxed">{pre.blurb}</p>}

      {/* a name tells two entries of the same service apart */}
      <Field label="Name">
        <TextInput value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={custom ? "e.g. Home PC, My relay" : pre.name} />
      </Field>

      {custom && (
        <>
          <Field label="Base URL">
            <TextInput
              value={draft.base}
              onChange={(e) => set({ base: e.target.value.trim(), local: undefined })}
              placeholder="https://example.com/v1"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {LOCAL_PRESETS.map((l) => (
              <Button
                key={l.name}
                size="sm"
                icon={Server}
                onClick={() => set({ base: l.base, name: draft.name && draft.name !== "Custom" ? draft.name : l.name, protocol: "openai", local: true })}
              >
                {l.name}
              </Button>
            ))}
          </div>
          {draft.base && isPrivateBase(draft.base) && (
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              On a phone, use the computer's network address, not localhost.
            </p>
          )}
          {urlOwner && onSwitch && (
            <Hint>
              That is {urlOwner.name}'s address.{" "}
              <button className="underline underline-offset-2" style={{ color: "var(--acc)" }} onClick={() => onSwitch(urlOwner.id, draft.key)}>
                Add {urlOwner.name} instead
              </button>
            </Hint>
          )}
          <Field label="Format">
            <Segmented
              value={draft.protocol}
              onChange={(v) => set({ protocol: v })}
              options={[{ id: "openai", label: "OpenAI-compatible" }, { id: "anthropic", label: "Anthropic-compatible" }]}
            />
          </Field>
        </>
      )}

      {isBridge && (
        <Field label="Bridge URL">
          <TextInput
            value={draft.base}
            onChange={(e) => set({ base: e.target.value.trim() })}
            onBlur={() => {
              const u = bridgeUrl(draft.base);
              if (u && u !== draft.base) set({ base: u });
            }}
            placeholder="http://localhost:5005/v1"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </Field>
      )}

      <Field label={custom ? "API key (optional)" : isBridge ? "Bridge key (advanced)" : `${pre.name} key`}>
        <TextInput
          type="password"
          value={draft.key}
          onChange={(e) => set({ key: e.target.value.trim() })}
          placeholder={pre.keyPlaceholder}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </Field>
      {isBridge && <p className="text-[11px] text-zinc-500 leading-relaxed">Save, then request access above and approve the code in the Bridge window.</p>}
      {!custom && !isBridge && pre.keyUrl && (
        <a href={pre.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] underline underline-offset-2" style={{ color: "var(--acc)" }}>
          Get a key at {hostOf(pre.keyUrl)} <ExternalLink size={11} />
        </a>
      )}
      {wrongKey && !isBridge && (
        <Hint>
          This key looks like it is for {wrongKey.name}.
          {onSwitch && (
            <>
              {" "}
              <button className="underline underline-offset-2" style={{ color: "var(--acc)" }} onClick={() => onSwitch(wrongKey.id, draft.key)}>
                Use {wrongKey.name} instead
              </button>
            </>
          )}
        </Hint>
      )}

      {custom && (
        <Field label="Models (optional)">
          <TextArea
            rows={3}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              set({ models: e.target.value.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean) });
            }}
            placeholder={"One model id per line.\nLeave empty to use the server's own list."}
          />
        </Field>
      )}

      {test && (
        <p className={`text-[11px] leading-relaxed ${test.status === "fail" ? "text-zinc-100" : "text-zinc-400"}`}>
          {test.status === "loading" ? "Connecting…"
            : test.status === "ok" ? `Connected — ${test.count} model${test.count === 1 ? "" : "s"} available.`
            : test.msg}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={runTest} disabled={!ready || test?.status === "loading"}>
          Test connection
        </Button>
        <div className="flex-1" />
        {onRemove && <ConfirmDelete label={draft.name} onConfirm={onRemove} />}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} className="text-zinc-400 hover:text-zinc-200">Cancel</Button>
        )}
        <AccBtn disabled={!ready} onClick={() => onSave()} icon={isNew ? Plus : undefined}>
          {isNew ? "Add" : "Save"}
        </AccBtn>
      </div>
    </div>
  );
}

function Hint({ children }) {
  return (
    <p className="text-[11px] leading-relaxed px-3 py-2 rounded-xl border border-[var(--nv-edge-ink)] bg-zinc-900 text-zinc-100">{children}</p>
  );
}

/* ---------- Nova Bridge: the Subscription Hub ----------

   Always there, as one bar that folds open. Finds the bridge by itself (this
   device, then the Wi-Fi) and keeps looking while it is missing. Devices
   request access for approval in the desktop window; only an administrator
   credential can manage subscription sign-ins. */

const rootOf = (base) => healthOf(base).replace(/\/health$/, "");

async function bridgeCall(base, key, path, body) {
  const r = await providerFetch(`${rootOf(base)}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `Nova Bridge answered ${r.status}.`);
  return data;
}

/* Whether the page is on screen. Polling stops while the app is in the
   background (a phone keeps a hidden WebView's timers running) and picks up,
   with a check straight away, when it comes back. */
function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || !document.hidden);
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

/* `alwaysOpen`: on a tab of its own, the card is not folded */
export function NovaBridgeCard({ settings, onChange, alwaysOpen = false }) {
  const list = settings.providers || [];
  const entry = list.find((p) => p.preset === "nova-bridge");
  const open = alwaysOpen || !!settings.bridgeCardOpen;
  /* a heading on its own tab, a fold button in a list */
  const Head = alwaysOpen ? "div" : "button";
  const key = entry?.pairedBase && entry.pairedBase !== entry.base ? "" : entry?.key || "";
  /* { status: "looking" | "found" | "missing", base?, health? } */
  const [found, setFound] = useState({ status: "looking" });
  const [manual, setManual] = useState(false);
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState("");
  const [errors, setErrors] = useState({});
  const [tokenInput, setTokenInput] = useState({});
  const [pasteInput, setPasteInput] = useState({});
  const [pairing, setPairing] = useState(null);
  const latest = useRef({ settings, onChange });
  latest.current = { settings, onChange };
  const visible = usePageVisible();
  /* the Nova desktop app: it can start the Bridge, and its own session on
     this computer pairs by itself (the Bridge approves it as it asks) */
  const desktop = typeof window !== "undefined" && !!window.novaDesktop?.startBridge;
  const [launching, setLaunching] = useState(false);
  const autoPaired = useRef(false);

  /* Remember where it was found, so the next search starts there. */
  const settle = (hit) => {
    const now = latest.current.settings;
    const mine = (now.providers || []).find((p) => p.preset === "nova-bridge");
    if (mine?.key && mine.base !== hit.base) return;
    setFound({ status: "found", ...hit });
    const patch = {};
    if (hit.health?.lan && hit.health.lan !== now.bridgeLan) patch.bridgeLan = hit.health.lan;
    if (mine && mine.base !== hit.base) Object.assign(patch, patchProvider(now, mine.id, { base: hit.base }));
    if (Object.keys(patch).length) latest.current.onChange(patch);
  };
  const search = (opts) => {
    const s = latest.current.settings;
    const saved = (s.providers || []).find((p) => p.preset === "nova-bridge");
    if (saved?.key) return probe(saved.base).then((health) => health ? { base: saved.base, health } : null);
    return findBridgeOnce({ saved: saved?.base, lan: s.bridgeLan, pageHost: pageHost(), ...opts });
  };

  /* the full search, again whenever "Search again" is tapped */
  useEffect(() => {
    if (found.status === "found" && entry?.base === found.base) return;
    let cancelled = false;
    setFound({ status: "looking" });
    search().then((hit) => {
      if (cancelled) return;
      if (hit) settle(hit);
      else setFound({ status: "missing" });
    }).catch((e) => {
      console.warn("Bridge search failed", e);
      if (!cancelled) setFound({ status: "missing" });
    });
    return () => { cancelled = true; };
  }, [round, entry?.base]);

  /* while missing, keep looking (no network sweep): a bridge started after
     the panel opened, or back after a restart, shows up by itself */
  useEffect(() => {
    if (found.status !== "missing" || !visible) return;
    let cancelled = false;
    const t = setInterval(() => {
      search({ sweep: false }).then((hit) => { if (hit && !cancelled) settle(hit); }).catch((e) => console.warn("Bridge search failed", e));
    }, 6000);
    return () => { cancelled = true; clearInterval(t); };
  }, [found.status, visible]);

  /* while found, keep the status honest (and sign-ins moving) */
  const bridgeKey = entry?.pairedBase && entry.pairedBase !== found.base ? "" : key;
  const refresh = () => found.base && bridgeCall(found.base, bridgeKey, "/health")
    .then((health) => setFound((f) => (f.base !== found.base ? f : { ...f, health })))
    .catch(() => probe(found.base).then((h) => { if (!h) setFound((f) => (f.base !== found.base ? f : { status: "missing" })); }));
  const signingIn = Object.values(found.health?.providers || {}).some((p) => p.flow?.status === "pending");
  useEffect(() => {
    if (found.status !== "found" || !visible) return;
    refresh();
    const t = setInterval(refresh, signingIn ? 3000 : open ? 8000 : 20000);
    return () => clearInterval(t);
  }, [found.status, found.base, bridgeKey, signingIn, open, visible]);

  /* a subscription just connected: its models belong in the picker */
  const connected = SUBSCRIPTION_PROVIDERS.filter((p) => found.health?.providers?.[p.id]?.connected);
  const connectedIds = connected.map((p) => p.id).join(",");
  useEffect(() => {
    if (entry && found.status === "found") fetchProviderModels({ ...entry, base: found.base, key: bridgeKey }, { fresh: true }).catch(() => {});
  }, [connectedIds]);

  const { status, base, health } = found;
  const addBridge = () => {
    const fresh = newProvider("nova-bridge", { base });
    onChange({ providers: [...list, fresh], activeProvider: fresh.id });
  };
  const inUse = !!entry && activeProvider(settings)?.id === entry.id;
  const onThisComputer = base && isLoopbackBase(base);
  /* a locked bridge tells a device without its key nothing about its sign-ins */
  const locked = health?.locked && !Object.keys(health?.providers || {}).length;
  const canManage = health?.management !== false;

  const startBridge = async () => {
    setLaunching(true);
    try { await window.novaDesktop.startBridge(); } catch (e) { console.warn("Could not start Nova Bridge", e); }
    /* the window opens and starts hosting in a moment: look again then */
    setTimeout(() => { setLaunching(false); setRound((r) => r + 1); }, 2500);
  };

  /* `auto`: this computer's own session pairing by itself; it does not
     switch away from a provider already in use */
  const requestAccess = (auto = false) => {
    try {
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
      const now = latest.current.settings;
      const saved = (now.providers || []).find((p) => p.preset === "nova-bridge");
      const fresh = saved ? { ...saved, base, pairedBase: base, key: token } : newProvider("nova-bridge", { base, pairedBase: base, key: token }, now.providers || []);
      setPairing({ status: "requesting" });
      const keepActive = auto && now.activeProvider && (now.providers || []).some((p) => p.id === now.activeProvider);
      latest.current.onChange({ providers: saved ? now.providers.map((p) => p.id === saved.id ? fresh : p) : [...(now.providers || []), fresh], ...(keepActive ? {} : { activeProvider: fresh.id }) });
    } catch {
      setPairing({ status: "error", message: "Cannot create a secure device key. Open Nova over HTTPS or on localhost and try again." });
    }
  };

  /* this computer's own session asks once by itself; no code to compare */
  useEffect(() => {
    if (!desktop || autoPaired.current || status !== "found" || !onThisComputer || !locked) return;
    if (/^[a-f0-9]{64}$/.test(key) && entry?.pairedBase === base) return;
    autoPaired.current = true;
    requestAccess(true);
  }, [desktop, status, onThisComputer, locked, base]);

  useEffect(() => {
    if (entry?.pairedBase !== base) { setPairing(null); return; }
    if (!locked || !base || entry?.base !== base || !/^[a-f0-9]{64}$/.test(key) || (!open && !(desktop && onThisComputer)) || !visible) return;
    let cancelled = false, timer;
    const check = async (request) => {
      try {
        const next = await bridgeCall(base, "", request ? "/pair/status" : "/pair/request", request ? { id: request.id, token: key } : { token: key, name: desktop ? "Nova desktop" : /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "Nova mobile" : "Nova browser" });
        if (cancelled) return;
        const current = { ...request, ...next };
        setPairing(current);
        if (current.status === "pending") timer = setTimeout(() => check(current), 2000);
        if (current.status === "approved") refresh();
      } catch (error) {
        if (!cancelled) setPairing({ status: "error", message: error.message });
      }
    };
    setPairing({ status: "requesting" });
    check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [locked, base, entry?.base, entry?.pairedBase, key, open, visible]);

  const act = async (id, path, body = {}) => {
    setBusy(id);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      await bridgeCall(base, bridgeKey, path, body);
      if (path.endsWith("/token")) setTokenInput((t) => ({ ...t, [id]: "" }));
      if (path.endsWith("/callback")) setPasteInput((t) => ({ ...t, [id]: "" }));
    } catch (e) {
      setErrors((x) => ({ ...x, [id]: e.message }));
    }
    await refresh();
    setBusy("");
  };

  const summary = status === "looking" ? "Looking…"
    : status === "missing" ? "Not found"
    : locked ? pairing?.status === "pending" ? "Awaiting approval" : "Access required"
    : connected.length ? `${connected.length} connected` : "Running";

  return (
    <div className="rounded-3xl nv-glass border border-[var(--nv-line)] overflow-hidden">
      <Head
        {...(alwaysOpen ? {} : { onClick: () => onChange({ bridgeCardOpen: !open }), "aria-expanded": open })}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <Zap size={14} className="shrink-0" style={{ color: "var(--acc)" }} />
        <span className="text-sm font-medium text-zinc-100 shrink-0">Nova Bridge</span>
        <span className="flex-1" />
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === "found" ? "bg-zinc-900" : status === "looking" ? "bg-zinc-400 nv-pulse" : "bg-zinc-600"}`} />
        <span className={`text-[11px] truncate min-w-0 ${status === "found" ? "text-zinc-100 font-medium" : "text-zinc-500"}`}>{summary}</span>
        {!alwaysOpen && <ChevronRight size={14} className={`shrink-0 text-zinc-500  ${open ? "rotate-90" : ""}`} />}
      </Head>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-[var(--nv-line)] pt-3">
          {status === "looking" && (
            <p className="text-[11px] text-zinc-500">Checking the saved address and this device…</p>
          )}

          {status === "missing" && desktop && (
            <Button variant="primary" icon={Zap} onClick={startBridge} disabled={launching} className="w-full">
              {launching ? "Starting…" : "Start Bridge"}
            </Button>
          )}
          {status === "missing" && !desktop && <Hint>Open Nova Bridge on your computer, on the same Wi-Fi as this device.</Hint>}
          {status === "found" && health?.name && (
            <p className="text-[11px] text-zinc-500 truncate">Running on {health.name}</p>
          )}

          {status === "found" && locked && (
            <div className="space-y-2">
              {!(desktop && onThisComputer) && <Hint>Request access here, then approve the matching code in the Nova Bridge window on your computer.</Hint>}
              {pairing?.status === "pending" && (
                <p role="status" className="text-xs text-zinc-200 leading-relaxed">Comparison code: <code className="font-mono text-lg tracking-widest select-all">{pairing.code}</code><br />Only approve a matching code in the Bridge window.{pairing.expiresAt && ` Expires ${new Date(pairing.expiresAt).toLocaleTimeString()}.`}</p>
              )}
              {pairing?.status === "requesting" && <p role="status" className="text-[11px] text-zinc-400">Requesting access…</p>}
              {pairing?.status === "approved" && <p role="status" className="text-[11px] text-zinc-400">Approved. Connecting…</p>}
              {pairing?.status === "expired" && <p role="alert" className="text-[11px] text-zinc-200">This request expired. Request access again to get a new comparison code.</p>}
              {pairing?.status === "rejected" && <p role="alert" className="text-[11px] text-zinc-200">Access was rejected or revoked in the Bridge window. Request access again if needed.</p>}
              {pairing?.status === "error" && <p role="alert" className="text-[11px] text-zinc-200">{pairing.message}</p>}
              <Button onClick={requestAccess} disabled={pairing?.status === "pending" || pairing?.status === "requesting" || pairing?.status === "approved"} className="self-start">{pairing ? "Request access again" : "Request access"}</Button>
            </div>
          )}

          {status === "found" && !locked && (
            <div className="grid gap-2">
              {!canManage && <Hint>Manage subscription connections in the Nova Bridge window on your computer.</Hint>}
              {SUBSCRIPTION_PROVIDERS.map((p) => {
                const st = health?.providers?.[p.id] || {};
                const flow = st.flow;
                const pending = !st.connected && flow?.status === "pending";
                const err = errors[p.id] || (flow?.status === "error" ? flow.message : "");
                return (
                  <div key={p.id} className="p-2.5 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-2 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-zinc-100 truncate">{p.name}</p>
                        <p data-motion-state={st.connected ? "connected" : "disconnected"} className={`text-[10px] truncate ${st.connected ? "text-zinc-100" : "text-zinc-500"}`}>
                          {st.connected ? `Connected${st.source ? ` · ${st.source}` : ""}` : p.studentOffer}
                        </p>
                      </div>
                      {canManage && p.auth !== "bridge" && <Button
                        variant={st.connected ? "secondary" : "primary"}
                        size="sm"
                        onClick={() => act(p.id, st.connected ? `/auth/${p.id}/logout` : `/auth/${p.id}/start`)}
                        disabled={busy === p.id}
                        className={`shrink-0 ${st.connected ? "text-zinc-400" : ""}`}
                      >
                        {busy === p.id ? "…" : st.connected ? "Disconnect" : pending ? "Restart" : "Connect"}
                      </Button>}
                    </div>

                    {canManage && pending && flow.user_code && (
                      <p className="text-[11px] text-zinc-100 leading-relaxed [overflow-wrap:anywhere]">
                        Enter <code className="font-mono font-medium px-1.5 py-0.5 rounded bg-[var(--nv-control)] select-all">{flow.user_code}</code> at{" "}
                        <a href={flow.verification_uri} target="_blank" rel="noreferrer" className="underline">{hostOf(flow.verification_uri)}</a>
                      </p>
                    )}

                    {canManage && pending && flow.message && !flow.user_code && !flow.url && (
                      <p role="status" className="text-[11px] text-zinc-100 leading-relaxed">{flow.message}</p>
                    )}

                    {canManage && pending && flow.url && onThisComputer && (
                      <p className="text-[11px] text-zinc-100 leading-relaxed">
                        Finish signing in in the browser tab that opened (or <a href={flow.url} target="_blank" rel="noreferrer" className="underline">open it again</a>).
                      </p>
                    )}

                    {canManage && pending && flow.url && !onThisComputer && (
                      <div className="space-y-2 text-[11px] text-zinc-300 leading-relaxed">
                        <a
                          href={flow.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium"
                          style={{ background: "var(--acc)", color: "var(--on-acc)" }}
                        >
                          1. Sign in with Google <ExternalLink size={11} />
                        </a>
                        <p>2. Google then opens a page that does not load. Copy that page's whole address and paste it here:</p>
                        <div className="flex items-center gap-1.5">
                          <input
                            value={pasteInput[p.id] || ""}
                            onChange={(e) => setPasteInput((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            placeholder="http://localhost:51121/oauth-callback?…"
                            autoCapitalize="off"
                            autoCorrect="off"
                            className="flex-1 min-w-0 bg-[var(--nv-control)] border border-[var(--nv-line)] rounded-lg px-2 py-1.5 text-[11px] text-zinc-200 outline-none"
                          />
                          <Button
                            size="sm"
                            onClick={() => act(p.id, `/auth/${p.id}/callback`, { url: (pasteInput[p.id] || "").trim() })}
                            disabled={!pasteInput[p.id]?.trim() || busy === p.id}
                            className="shrink-0"
                          >
                            Done
                          </Button>
                        </div>
                      </div>
                    )}

                    {(err || (st.connected && st.problem)) && (
                      <p role="alert" className="nv-fade text-[11px] text-zinc-100 leading-relaxed [overflow-wrap:anywhere]">{err || st.problem}</p>
                    )}

                    {canManage && !st.connected && !pending && p.tokenHint && (
                      <div className="flex items-center gap-1.5">
                        <input
                          value={tokenInput[p.id] || ""}
                          onChange={(e) => setTokenInput((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          placeholder={p.tokenHint}
                          type="password"
                          className="flex-1 min-w-0 bg-[var(--nv-control)] border border-[var(--nv-line)] rounded-lg px-2 py-1.5 text-[11px] text-zinc-200 outline-none"
                        />
                        <Button
                          size="sm"
                          onClick={() => act(p.id, `/auth/${p.id}/token`, { token: (tokenInput[p.id] || "").trim() })}
                          disabled={!tokenInput[p.id]?.trim() || busy === p.id}
                          className="shrink-0"
                        >
                          Save
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {status === "found" && !locked && (
            !entry ? (
              <Button variant="primary" icon={Plus} onClick={addBridge} className="w-full">
                Add Nova Bridge
              </Button>
            ) : (
              <p className="text-[11px] text-zinc-400 flex items-start gap-1"><Check size={12} className="text-zinc-100 shrink-0 mt-0.5" /> {inUse ? "In use." : "Added."} Pick it and a subscription model in the Model tab.</p>
            )
          )}

          {status === "missing" && (
            <>
              <div className="text-[11px] text-zinc-500 leading-relaxed space-y-1">
                <p>Use your Google (including the Gemini app), Claude or ChatGPT subscription like OpenRouter, at no API cost.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button icon={RefreshCw} onClick={() => setRound((r) => r + 1)}>
                  Search again
                </Button>
                {!manual && (
                  <Button variant="ghost" size="sm" onClick={() => setManual(true)} className="text-zinc-500 hover:text-zinc-300">
                    Enter address
                  </Button>
                )}
              </div>
              {entry?.key && <p className="text-[11px] text-zinc-400">Only the saved address is checked. Computer moved? Enter its new address.</p>}
              {manual && (
                <ManualAddress onFound={(hit) => {
                  setManual(false);
                  /* a moved, paired bridge: save the address; the old key no longer counts there (pairedBase) */
                  if (entry?.key && entry.base !== hit.base) onChange(patchProvider(settings, entry.id, { base: hit.base }));
                  else settle(hit);
                }} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* For a bridge that cannot be found by itself (another network, a VPN). */
function ManualAddress({ onFound }) {
  const [text, setText] = useState("");
  const [state, setState] = useState(null);
  const tryIt = async () => {
    const u = bridgeUrl(text);
    if (!u) return;
    setState("trying");
    const health = await probe(u, 4000);
    if (health) onFound({ base: u, health });
    else setState("fail");
  };
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <TextInput
            value={text}
            onChange={(e) => { setText(e.target.value.trim()); setState(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); tryIt(); } }}
            placeholder="e.g. 192.168.1.5 or a Tailscale name"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <AccBtn disabled={!bridgeUrl(text) || state === "trying"} onClick={tryIt} className="shrink-0">Connect</AccBtn>
      </div>
      {state === "fail" && <p className="text-[11px] text-zinc-100">Nothing answered at {hostOf(bridgeUrl(text))}.</p>}
    </div>
  );
}
