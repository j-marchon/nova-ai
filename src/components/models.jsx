import { MotionList } from "./motion/MotionList.jsx";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, Check, ChevronRight, Search, Star } from "lucide-react";
import { AccBtn, Button, Modal, Segmented, Skeleton, TextInput, selStyle } from "./ui.jsx";
import { activeModel, fetchOpenAIModels, fetchProviderModels, priceLabel, prettyCtx, providerOf, sourceOf } from "../lib/api.js";
import { activeProvider, patchProvider } from "../lib/providers.js";

import { modelLabel } from "../lib/models.js";
export { modelLabel };

/* What is actually answering right now. A local server with no model picked
   runs whatever it has loaded, so it is asked. */
export function useEndpointLabel(settings) {
  const [loaded, setLoaded] = useState(null);
  /* "loading" | "ok" | "fail" — only meaningful for a local server */
  const [status, setStatus] = useState("loading");
  const p = providerOf(settings);
  const src = sourceOf(settings);
  const id = activeModel(settings);
  /* only a local server with nothing picked is asked what it has loaded */
  const ask = src === "local" && (!id || id === "local") ? p.base : "";

  useEffect(() => {
    if (!ask) { setLoaded(null); setStatus("loading"); return; }
    let alive = true;
    setLoaded(null);
    setStatus("loading");
    fetchOpenAIModels(ask, p.key)
      .then((l) => {
        if (!alive) return;
        const raw = l?.[0]?.name || l?.[0]?.id || "";
        /* KoboldCpp reports things like "koboldcpp/L3-8B-Stheno-v3.2.Q4_K_M" */
        const clean = raw.split(/[\\/]/).pop().replace(/\.gguf$/i, "").trim();
        setLoaded(clean || "Local server");
        setStatus("ok");
      })
      .catch(() => { if (alive) { setLoaded("Local server"); setStatus("fail"); } });
    return () => { alive = false; };
  }, [ask, p.key]);

  const base = { isLocal: src === "local" || src === "nova-bridge", isGoogle: src === "google", provider: p.name, src };
  /* `picked`: a model is set (or a local server reports one loaded) */
  if (ask) return { ...base, status, picked: status === "ok", label: loaded || "Local server", full: loaded ? `${loaded} — ${p.name}` : p.base };
  return { ...base, status: "ok", picked: !!id, label: id ? modelLabel(id, src) : "Choose a model", full: id ? `${id} — ${p.name}` : p.name };
}

/* ============================================================
   the model picker
   ============================================================

   One picker for every provider: the provider's own live list, nothing
   curated and no descriptions. Two tabs, Favorites and Models, with search,
   a price sort and a free-only filter where the provider's list makes those
   possible. Favourites, sort and filter belong to the provider entry, so a
   star on OpenRouter shows only when picking for OpenRouter.

   `current` and `onPick` let a caller pick for something other than the chat
   (the card writer); by default the pick is the active provider's model. */

const SORTS = [
  { id: "default", label: "Default" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
];

/* Cost of a typical turn, for sorting: prompts are most of the tokens, so
   input price is weighted the way a chat actually spends. */
const turnCost = (m) => m.pricing.prompt * 4 + m.pricing.completion;

/* one model in the list; outside ModelList so it is not a new component
   type, and remounted, on every render */
function Item({ m, on, fav, onPick, onToggleFav }) {
  const price = m.pricing ? priceLabel(m.pricing) : m.free ? "Free" : null;
  const meta = [price, prettyCtx(m.ctx)].filter(Boolean).join(" · ");
  return (
    <div
      style={on ? selStyle(true) : {}}
      className={`w-full flex items-center rounded-xl border  ${on ? "" : "border-zinc-800 bg-[var(--nv-control)] hover:border-zinc-700"}`}
    >
      <button onClick={() => onPick(m.id)} className="min-w-0 flex-1 text-left pl-3.5 py-2.5">
        <div className="flex items-center gap-1.5">
          <p className="text-sm text-zinc-100 truncate">{m.name}</p>
          {on && <Check size={14} style={{ color: "var(--acc)" }} className="shrink-0" />}
        </div>
        {meta && <p className="text-[11px] mt-0.5" style={{ color: price === "Free" ? "var(--nv-ink)" : "var(--nv-ink)" }}>{meta}</p>}
      </button>
      <Button
        variant="icon"
        onClick={() => onToggleFav(m.id)}
        aria-pressed={fav}
        aria-label={fav ? "Remove from favourites" : "Add to favourites"}
        title={fav ? "Remove from favourites" : "Add to favourites"}
      >
        <Star size={16} style={fav ? { color: "var(--acc)", fill: "var(--acc)" } : {}} className={fav ? "" : "text-zinc-600 hover:text-zinc-300"} />
      </Button>
    </div>
  );
}

export function ModelPicker({ settings, onChange, onClose, onProviders, current, onPick }) {
  return (
    <Modal title="Choose a model" onClose={onClose}>
      <ModelList settings={settings} onChange={onChange} onDone={onClose} onProviders={onProviders} current={current} onPick={onPick} />
    </Modal>
  );
}

/* The picker itself, with no sheet around it, so the Model tab can be the
   list. `onDone` runs after a pick (a sheet closes itself there). The
   provider row is a dropdown that switches the active provider in place;
   it is left out when picking for something other than the chat, because
   that pick must not move the chat's own provider. */
export function ModelList({ settings, onChange, onDone, onProviders, current, onPick }) {
  const provider = activeProvider(settings);
  const providers = settings.providers || [];
  const src = sourceOf(settings);
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [custom, setCustom] = useState("");
  /* how many rows are drawn; a phone does not need three hundred buttons to
     show the first screenful */
  const [limit, setLimit] = useState(60);
  const favs = provider?.favorites || [];
  const [tab, setTab] = useState(() => (favs.length ? "favorites" : "models"));
  const sort = provider?.sort || "default";
  const freeOnly = !!provider?.freeOnly;
  const picked = current ?? (provider ? activeModel(settings) : "");

  const save = (patch) => provider && onChange(patchProvider(settings, provider.id, patch));
  const pick = (id) => {
    if (onPick) onPick(id);
    else save({ model: id, ...(list?.find(m => m.id === id)?.ctx ? { modelContexts: { ...provider.modelContexts, [id]: list.find(m => m.id === id).ctx } } : {}) });
    onDone?.();
  };

  /* asked again whenever the provider, its address or its key changes */
  const listKey = provider ? `${provider.id}|${provider.base}|${provider.key}|${provider.protocol}|${(provider.models || []).join(",")}` : "";
  useEffect(() => {
    if (!provider) return;
    let alive = true;
    setList(null);
    setErr(null);
    fetchProviderModels(provider)
      .then((l) => alive && setList(l))
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [listKey]);

  const byId = useMemo(() => Object.fromEntries((list || []).map((m) => [m.id, m])), [list]);
  /* what the list can say about money: a sort needs prices, a free filter
     needs either prices or OpenRouter's :free ids */
  const hasPrices = !!list?.some((m) => m.pricing);
  const canFilterFree = hasPrices || !!list?.some((m) => m.free);

  if (!provider) {
    return (
      <div className="py-6 text-center space-y-3">
        <p className="text-sm text-zinc-300">No provider added yet.</p>
        {onProviders && <AccBtn onClick={onProviders}>Add a provider</AccBtn>}
      </div>
    );
  }

  const info = (id) => byId[id] || { id, name: id, ctx: null, pricing: null, free: id.endsWith(":free") };

  let rows = tab === "favorites" ? favs.map(info) : list || [];
  if (freeOnly && canFilterFree) rows = rows.filter((m) => m.free);
  const query = q.trim().toLowerCase();
  if (query) rows = rows.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(query));
  if (hasPrices && sort !== "default") {
    const dir = sort === "price-asc" ? 1 : -1;
    /* unknown prices last either way */
    rows = [...rows].sort((a, b) => (!a.pricing - !b.pricing) || (a.pricing && b.pricing ? dir * (turnCost(a) - turnCost(b)) : 0));
  }
  const shown = rows.slice(0, limit);

  const toggleFav = (id) => save({ favorites: favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id] });

  const TABS = [
    { id: "favorites", label: "Favorites", icon: Star },
    { id: "models", label: "Models" },
  ];
  const sortLabel = SORTS.find((x) => x.id === sort)?.label || "Default";

  return (
      <div className="space-y-3">
        {/* which provider this list belongs to; a dropdown to pick another */}
        <div className="relative flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-[var(--nv-control)] border border-[var(--nv-line)]">
          <p className="text-xs text-zinc-500 shrink-0">Provider</p>
          {!onPick && providers.length > 1 ? (
            <>
              <select
                aria-label="Provider"
                value={provider.id}
                onChange={(e) => { onChange({ activeProvider: e.target.value }); setQ(""); setLimit(60); }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              >
                {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <p className="text-sm text-zinc-100 truncate flex-1">{provider.name}</p>
              <ChevronRight size={14} className="rotate-90 text-zinc-500 shrink-0 pointer-events-none" />
            </>
          ) : (
            <p className="text-sm text-zinc-100 truncate flex-1">{provider.name}</p>
          )}
        </div>

        <Segmented value={tab} onChange={(id) => { setTab(id); setLimit(60); }} options={TABS} />

        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setLimit(60); }}
              placeholder={tab === "favorites" ? "Search favourites" : "Search models"}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 pl-9 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none  focus:border-[var(--nv-edge-ink)]"
            />
          </div>
          {hasPrices && (
            <Button
              size="sm"
              icon={ArrowDownUp}
              onClick={() => save({ sort: SORTS[(SORTS.findIndex((x) => x.id === sort) + 1) % SORTS.length].id })}
              className="shrink-0"
              title="Sort by price"
            >
              {sortLabel}
            </Button>
          )}
        </div>

        {canFilterFree && (
          <label className="flex items-center gap-2 text-xs text-zinc-300 select-none cursor-pointer w-fit">
            <input
              type="checkbox"
              checked={freeOnly}
              onChange={() => save({ freeOnly: !freeOnly })}
              className="w-4 h-4"
              style={{ accentColor: "var(--acc)" }}
            />
            Free models only
          </label>
        )}

        {!list && !err && (
          <div className="space-y-1.5" aria-busy="true" aria-label={`Loading ${provider.name}'s models`}>
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[54px] w-full rounded-xl" />)}
          </div>
        )}
        {err && <p className="text-[11px] text-zinc-100 leading-relaxed">{err}</p>}

        {tab === "favorites" && favs.length === 0 && (
          <p className="text-xs text-zinc-500 py-4 text-center leading-relaxed">
            Nothing starred yet. Tap the star on any model in Models to keep it here.
          </p>
        )}

        <MotionList className="space-y-1.5">
          {shown.map((m) => <Item key={m.id} m={m} on={picked === m.id} fav={favs.includes(m.id)} onPick={pick} onToggleFav={toggleFav} />)}
        </MotionList>
        {rows.length > shown.length && (
          <Button
            onClick={() => setLimit((n) => n + 100)}
            className="w-full text-xs text-zinc-400"
          >
            Show more ({rows.length - shown.length} left)
          </Button>
        )}
        {rows.length === 0 && (tab === "models" ? list : favs.length > 0) && (
          <p className="text-xs text-zinc-600 py-3 text-center">Nothing matched.</p>
        )}

        {/* any id the list does not show: a brand-new model, or a server
            that does not publish its list */}
        <div className="pt-1 border-t border-[var(--nv-edge-ink)]">
          <div className="flex items-center gap-2 pt-3">
            <TextInput value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={src === "openrouter" ? "Any model id, e.g. author/model" : "Any model id"} />
            <AccBtn disabled={!custom.trim()} onClick={() => pick(custom.trim().replace(/^models\//, ""))} className="shrink-0">
              Use
            </AccBtn>
          </div>
        </div>
      </div>
  );
}
