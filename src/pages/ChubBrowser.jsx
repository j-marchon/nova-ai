import { MotionList } from "../components/motion/MotionList.jsx";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Link2, RefreshCw, Search, ShieldCheck, Shuffle, Star, X } from "lucide-react";
import { AccBtn, Button, EmptyState, Modal, Skeleton } from "../components/ui.jsx";
import { Media } from "../components/media.jsx";
import { CHUB_PAGE, chubImport, chubNotes, chubSearch, isAdultHit, parseChubPath } from "../lib/chub.js";

/* ---------- create: build and manage everything ---------- */

/* ---------- Chub browser ----------

   A tab inside Characters. Search and sort Chub's public library, star
   cards into a Favorites list kept on this device, paste a link, and import
   into your own characters. No content filter: that is left to you.

   Results page in from the API 24 at a time as the list is scrolled. The
   card size follows the same small/large switch as your own characters. */
export const CHUB_SORTS = [
  { id: "random", label: "Random", icon: Shuffle },
  { id: "download_count", label: "Popular" },
  { id: "created_at", label: "New" },
  { id: "last_activity_at", label: "Recent" },
  { id: "favorites", label: "Favorites", icon: Star },
];

export const compact = (n) => (n == null ? null : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 1e4 ? 0 : 1)}k` : String(n));

export function ChubBrowser({ data, update, layout, controls, onStartChat }) {
  const big = !!layout?.big;
  const showDesc = !!layout?.desc;
  /* the paste-a-link field, folded behind a button beside the search */
  const [linkOpen, setLinkOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("random");
  const [shuffle, setShuffle] = useState(0);
  const [hits, setHits] = useState([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);
  const [link, setLink] = useState("");
  const [linkErr, setLinkErr] = useState(null);
  const [detail, setDetail] = useState(null);     // a hit
  const [importing, setImporting] = useState(null); // fullPath in flight
  const [imported, setImported] = useState(null);  // { fullPath, character }
  const [importErr, setImportErr] = useState(null);
  const reqRef = useRef(0);
  const sentinel = useRef(null);

  /* the NSFW filter: on unless it was turned off */
  const safe = data.settings.chubSafe !== false;
  const toggleSafe = () => update((d) => ({ ...d, settings: { ...d.settings, chubSafe: d.settings.chubSafe === false } }));
  const allFavs = data.settings.chubFavorites || [];
  const favs = useMemo(() => (safe ? allFavs.filter((f) => !isAdultHit(f)) : allFavs), [allFavs, safe]);
  /* looked up once per tile, so built once per change rather than searched
     per tile */
  const favPaths = useMemo(() => new Set(allFavs.map((f) => f.fullPath)), [allFavs]);
  const localByPath = useMemo(() => {
    const m = new Map();
    for (const c of data.characters) {
      const p = c.source?.fullPath;
      if (p && !m.has(p)) m.set(p, c);
    }
    return m;
  }, [data.characters]);
  const isFav = (p) => favPaths.has(p);
  const localFor = (p) => localByPath.get(p) || null;
  const showingFavs = sort === "favorites";

  const toggleFav = (hit) =>
    update((d) => {
      const list = d.settings.chubFavorites || [];
      const has = list.some((f) => f.fullPath === hit.fullPath);
      return { ...d, settings: { ...d.settings, chubFavorites: has ? list.filter((f) => f.fullPath !== hit.fullPath) : [hit, ...list] } };
    });

  const load = async (n, reset) => {
    const id = ++reqRef.current;
    setLoading(true);
    setErr(null);
    try {
      const r = await chubSearch({ q: query, page: n, sort, safe });
      if (id !== reqRef.current) return;
      setHits((prev) => {
        const base = reset ? [] : prev;
        const seen = new Set(base.map((h) => h.fullPath));
        return [...base, ...r.hits.filter((h) => !seen.has(h.fullPath))];
      });
      setPage(n);
      setDone((r.raw ?? r.hits.length) < CHUB_PAGE);
    } catch (e) {
      if (id === reqRef.current) setErr(e.message || "Could not reach Chub.");
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  };

  /* a new search or sort starts over */
  useEffect(() => {
    if (showingFavs) return;
    setHits([]);
    setDone(false);
    load(1, true);
  }, [query, sort, shuffle, safe]);

  /* next page when the bottom of the list scrolls into view */
  useEffect(() => {
    const el = sentinel.current;
    if (!el || showingFavs || done || loading || err) return;
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) load(page + 1, false); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [page, done, loading, err, showingFavs, hits.length]);

  const runImport = async (fullPath) => {
    setImporting(fullPath);
    setImportErr(null);
    try {
      const ch = await chubImport(fullPath);
      update((d) => ({ ...d, characters: [ch, ...d.characters] }));
      setImported({ fullPath, character: ch });
      return ch;
    } catch (e) {
      setImportErr(e.message || "The import failed.");
      return null;
    } finally {
      setImporting(null);
    }
  };

  const importLink = async () => {
    const p = parseChubPath(link);
    if (!p) { setLinkErr("That doesn't look like a Chub character link."); return; }
    setLinkErr(null);
    const ch = await runImport(p);
    if (ch) {
      setLink("");
      setDetail({ fullPath: p, name: ch.name, tagline: "", avatar: ch.avatar, topics: ch.tags || [] });
    }
  };

  const shown = showingFavs ? favs : hits;

  /* The tiles are memoised, so they get one stable handle to the current
     callbacks rather than new functions on every render — otherwise a page
     of results arriving would redraw every tile already in the list. */
  const actions = useRef(null);
  actions.current = {
    open: (h) => { setDetail(h); setImported(null); setImportErr(null); },
    toggleFav,
  };

  const d = detail;
  const dLocal = d ? (imported?.fullPath === d.fullPath ? imported.character : localFor(d.fullPath)) : null;

  return (
    <div className="nv-fade">
      {/* search, with the link import beside it */}
      <div className="flex items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); if (showingFavs) setSort("random"); setQuery(draft.trim()); }}
          className="relative flex-1 min-w-0"
        >
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search Chub"
            enterKeyHint="search"
            className="w-full h-10 rounded-full nv-glass pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none  focus:border-[var(--nv-edge-ink)]"
          />
        </form>
        <Button
          icon={ShieldCheck}
          selected={safe}
          onClick={toggleSafe}
          aria-pressed={safe}
          aria-label="Hide NSFW"
          title={safe ? "NSFW hidden" : "NSFW shown"}
          className="shrink-0"
        >
          Safe
        </Button>
        <Button
          icon={Link2}
          selected={linkOpen}
          onClick={() => setLinkOpen((v) => !v)}
          aria-pressed={linkOpen}
          aria-label="Import from a link"
          className="shrink-0"
        >
          Link
        </Button>
      </div>

      {/* sort */}
      <div className="nv-fade-x flex items-center gap-1.5 mt-3 overflow-x-auto" style={{ scrollbarWidth: "none" }} data-noswipe>
        {CHUB_SORTS.map((s) => {
          const on = sort === s.id;
          return (
            <Button
              key={s.id}
              size="sm"
              icon={s.icon}
              selected={on}
              onClick={() => (s.id === "random" && sort === "random" ? setShuffle((n) => n + 1) : setSort(s.id))}
              className={`whitespace-nowrap shrink-0 ${on ? "" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {s.label}{s.id === "favorites" && favs.length ? ` ${favs.length}` : ""}
            </Button>
          );
        })}
        {query && !showingFavs && (
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            onClick={() => { setDraft(""); setQuery(""); }}
            className="whitespace-nowrap shrink-0 text-zinc-500 hover:text-zinc-200"
          >
            "{query}"
          </Button>
        )}
      </div>

      {/* import by link */}
      {linkOpen && (
      <div className="nv-fade flex items-center gap-2 mt-3">
        <div className="relative flex-1">
          <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          <input
            value={link}
            onChange={(e) => { setLink(e.target.value); setLinkErr(null); }}
            placeholder="Paste a chub.ai character link"
            autoFocus
            className="w-full rounded-full nv-glass pl-9 pr-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none  focus:border-[var(--nv-edge-ink)]"
          />
        </div>
        <AccBtn disabled={!link.trim() || !!importing} onClick={importLink} className="shrink-0">
          {importing && !detail ? "Importing..." : "Import"}
        </AccBtn>
      </div>
      )}
      {linkErr && <p className="text-[11px] text-zinc-100 mt-1.5">{linkErr}</p>}
      {importErr && !detail && <p className="text-[11px] text-zinc-100 mt-1.5">{importErr}</p>}

      {/* the description and size switches, at the end of their own row */}
      {controls && <div className="flex items-center justify-end mt-3">{controls}</div>}

      {/* results */}
      <MotionList className={`${layout?.grid || "grid grid-cols-3 gap-2.5"} mt-4`}>
        {shown.map((h) => (
          <ChubTile key={h.fullPath} h={h} mine={localByPath.has(h.fullPath)} fav={favPaths.has(h.fullPath)} big={big} showDesc={showDesc} actions={actions} />
        ))}
      </MotionList>

      {showingFavs && favs.length === 0 && (
        <EmptyState icon={Star} title="No favourites yet" />
      )}
      {!showingFavs && !loading && !err && hits.length === 0 && (
        <EmptyState icon={Search} title="Nothing found" />
      )}
      {err && (
        <div className="text-center py-6">
          <p className="text-xs text-zinc-100">{err}</p>
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => load(hits.length ? page + 1 : 1, !hits.length)} className="mt-2 text-zinc-400 hover:text-zinc-100">
            Try again
          </Button>
        </div>
      )}
      {loading && (
        /* the shape of the cards on their way */
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 py-3" aria-busy="true" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}
        </div>
      )}
      {!showingFavs && <div ref={sentinel} className="h-1" />}

      {/* one card, up close */}
      {d && (
        <Modal title={d.name} onClose={() => setDetail(null)}>
          <div className="space-y-4">
            <div className="flex gap-3.5">
              <Media src={dLocal?.avatar || d.avatar} alt={d.name} lazy={false} className="w-28 aspect-[3/4] object-cover rounded-xl bg-zinc-800 shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                {d.tagline && <p className="text-sm text-zinc-300 leading-snug whitespace-pre-wrap break-words">{d.tagline}</p>}
                <p className="text-[11px] text-zinc-500">
                  {[d.fullPath.split("/")[0] && `by ${d.fullPath.split("/")[0]}`, d.stars != null && `${compact(d.stars)} downloads`, d.chats != null && `${compact(d.chats)} chats`, d.tokens != null && `${compact(d.tokens)} tokens`].filter(Boolean).join(" · ")}
                </p>
                {d.topics?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.topics.slice(0, 14).map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--nv-control)] text-zinc-400">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <ChubNotes fullPath={d.fullPath} tagline={d.tagline} />

            {importErr && <p className="text-[11px] text-zinc-100">{importErr}</p>}

            <div className="flex items-center gap-2">
              {dLocal ? (
                <AccBtn onClick={() => { setDetail(null); onStartChat(dLocal); }} className="flex-1">
                  Start chat
                </AccBtn>
              ) : (
                <AccBtn disabled={importing === d.fullPath} onClick={() => runImport(d.fullPath)} className="flex-1">
                  {importing === d.fullPath ? "Importing..." : "Import"}
                </AccBtn>
              )}
              <Button
                onClick={() => toggleFav(d)}
                className="w-10 px-0 shrink-0"
                aria-label={isFav(d.fullPath) ? "Remove from favourites" : "Add to favourites"}
              >
                <Star style={isFav(d.fullPath) ? { color: "var(--acc)", fill: "var(--acc)" } : {}} className={`nv-btn-icon ${isFav(d.fullPath) ? "" : "text-zinc-400"}`} />
              </Button>
              <a
                href={`https://chub.ai/characters/${d.fullPath}`}
                target="_blank"
                rel="noreferrer"
                className="p-2.5 rounded-lg border border-zinc-800 bg-[var(--nv-control)] hover:border-zinc-700 text-zinc-400 "
                aria-label="Open on chub.ai"
              >
                <ExternalLink size={16} />
              </a>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* One result. A module-level memoised component rather than one defined in
   ChubBrowser: an inner component is a new type on every render, which would
   remount — and re-decode — every image in a long scrolled list each time a
   page arrives. */
const ChubTile = memo(function ChubTile({ h, mine, fav, big, showDesc, actions }) {
  return (
    <div
      className="nv-card group relative nv-glass nv-glass-hover overflow-hidden"
      /* skipped by the browser while far off screen (see the card grid on
         the Create page) */
      style={{ contentVisibility: "auto", containIntrinsicSize: big ? "auto 260px" : "auto 170px" }}
    >
      <button onClick={() => actions.current.open(h)} className="block w-full text-left">
        <div className="aspect-[3/4] bg-[var(--nv-control)] relative overflow-hidden">
          <img src={h.avatar} alt={h.name} loading="lazy" decoding="async" className="w-full h-full object-cover   " />

          {mine && (
            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-[var(--nv-control)] text-[9px] text-zinc-200 border border-[var(--nv-edge-ink)] inline-flex items-center gap-1">
              <Check size={9} /> Imported
            </span>
          )}
          <div className="nv-card-caption absolute inset-x-0 bottom-0 p-2">
            <p className={`${big ? "text-sm" : "text-xs"} font-medium text-white truncate`}>{h.name}</p>
            {big && showDesc && h.tagline && <p className="text-[11px] text-zinc-300/90 leading-snug line-clamp-2 mt-0.5">{h.tagline}</p>}
            {big && (h.stars != null || h.chats != null) && (
              <p className="text-[10px] text-zinc-400 mt-1">
                {[h.stars != null && `${compact(h.stars)} downloads`, h.chats != null && `${compact(h.chats)} chats`].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
        {!big && showDesc && h.tagline && (
          <p className="px-2 py-2 text-[10.5px] line-clamp-4 text-zinc-400 leading-snug">{h.tagline}</p>
        )}
      </button>
      <Button
        size="sm"
        onClick={() => actions.current.toggleFav(h)}
        className="absolute top-1.5 right-1.5 w-7 min-h-7 px-0"
        aria-label={fav ? "Remove from favourites" : "Add to favourites"}
      >
        <Star style={fav ? { color: "var(--acc)", fill: "var(--acc)" } : {}} className={`nv-btn-icon ${fav ? "" : "text-zinc-300"}`} />
      </Button>
    </div>
  );
});

/* The card's full public description, fetched when its sheet opens, and
   shown whole: the sheet itself scrolls, and drags up to a full screen. */
function ChubNotes({ fullPath, tagline }) {
  const [notes, setNotes] = useState(null);
  useEffect(() => {
    let alive = true;
    setNotes(null);
    chubNotes(fullPath).then((n) => alive && setNotes(n)).catch(() => alive && setNotes(""));
    return () => { alive = false; };
  }, [fullPath]);
  if (notes === null) {
    return <div className="h-16 rounded-2xl bg-[var(--nv-control)] border border-[var(--nv-line)] nv-breathe" />;
  }
  const text = notes && notes !== tagline ? notes : "";
  if (!text) return null;
  return (
    <div className="rounded-2xl bg-[var(--nv-control)] border border-[var(--nv-line)] p-3.5">
      <p className="text-[13px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">{text}</p>
    </div>
  );
}
