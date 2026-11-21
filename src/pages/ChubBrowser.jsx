import { MotionList } from "../components/motion/MotionList.jsx";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ExternalLink, Link2, RefreshCw, Search, ShieldCheck, Shuffle, Star, User, X } from "lucide-react";
import { AccBtn, Button, EmptyState, Modal, Skeleton } from "../components/ui.jsx";
import { Media } from "../components/media.jsx";
import { CHUB_PAGE, chubCreator, chubImport, chubNotes, chubPicture, chubSearch, isAdultHit, parseChubPath, parseChubQuery } from "../lib/chub.js";

/* ---------- create: build and manage everything ---------- */

/* ---------- Chub browser ----------

   A tab inside Characters, laid out the way chub.ai is: search by words
   and #tags, sort, open a card's page (its picture, creator, stats, tags and
   notes), tap its creator for their profile and every card they made, tap a
   tag for every card with it. Star cards into a Favorites list kept on this
   device, paste a link, and import into your own characters.

   Results page in from the API 24 at a time as the list is scrolled. The
   card size follows the same small/large switch as your own characters. */
export const CHUB_SORTS = [
  { id: "random", label: "Random", icon: Shuffle },
  { id: "download_count", label: "Popular" },
  { id: "created_at", label: "New" },
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
  const [tags, setTags] = useState([]);       // every card has all of these
  const [creator, setCreator] = useState(""); // one creator's cards (their profile)
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
      const r = await chubSearch({ q: query, page: n, sort, safe, tags, creator });
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
  }, [query, sort, shuffle, safe, tags.join("\n"), creator]);

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

  /* from a card's page: its creator's profile, or every card with a tag */
  const openCreator = (name) => {
    if (!name) return;
    setDetail(null); setCreator(name); setTags([]); setQuery(""); setDraft("");
    if (showingFavs || sort === "random") setSort("download_count");
  };
  const searchTag = (t) => {
    setDetail(null); setCreator(""); setQuery(""); setDraft(""); setTags([t]);
    if (showingFavs) setSort("download_count");
  };

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
          onSubmit={(e) => {
            e.preventDefault();
            if (showingFavs) setSort("random");
            /* "#tag" words become tag filters, added to the ones already on */
            const { q, tags: more } = parseChubQuery(draft);
            setQuery(q);
            if (more.length) setTags((t) => [...new Set([...t, ...more])]);
            setDraft(q);
          }}
          className="relative flex-1 min-w-0"
        >
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search Chub, or #tag"
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
            aria-label={`Clear the search for ${query}`}
          >
            "{query}"
          </Button>
        )}
        {!showingFavs && tags.map((t) => (
          <Button
            key={t}
            variant="ghost"
            size="sm"
            icon={X}
            onClick={() => setTags((list) => list.filter((x) => x !== t))}
            className="whitespace-nowrap shrink-0 text-zinc-300 hover:text-zinc-100"
            aria-label={`Remove the tag ${t}`}
          >
            #{t}
          </Button>
        ))}
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

      {/* a creator's profile, over their cards */}
      {creator && !showingFavs && <CreatorHeader username={creator} onBack={() => setCreator("")} />}

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

      {/* one card, up close: laid out like its page on chub.ai */}
      {d && (
        <Modal title={d.name} wide onClose={() => setDetail(null)}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
            <Media src={dLocal?.avatar || chubPicture(d)} alt={d.name} lazy={false} className="w-full max-w-[15rem] mx-auto sm:mx-0 aspect-[2/3] object-cover rounded-2xl bg-zinc-800" />
            <div className="min-w-0 space-y-3">
              {(d.creator || d.fullPath.split("/")[0]) && (
                <button
                  type="button"
                  onClick={() => openCreator(d.creator || d.fullPath.split("/")[0])}
                  className="inline-flex items-center gap-2 text-sm text-zinc-200 hover:text-zinc-100"
                  aria-label={`See every card by ${d.creator || d.fullPath.split("/")[0]}`}
                >
                  <span className="w-7 h-7 rounded-full bg-[var(--nv-control)] border border-[var(--nv-line)] inline-flex items-center justify-center"><User size={14} /></span>
                  <span className="underline underline-offset-4 decoration-[var(--nv-line-strong)]">{d.creator || d.fullPath.split("/")[0]}</span>
                </button>
              )}
              {d.tagline && <p className="text-sm text-zinc-300 leading-snug whitespace-pre-wrap break-words">{d.tagline}</p>}
              <p className="text-[11px] text-zinc-500">
                {[
                  d.stars != null && `${compact(d.stars)} downloads`,
                  d.chats != null && `${compact(d.chats)} chats`,
                  d.favorites != null && `${compact(d.favorites)} favourites`,
                  d.rating != null && `${d.rating.toFixed(1)}★${d.ratings ? ` (${compact(d.ratings)})` : ""}`,
                  d.tokens != null && `${compact(d.tokens)} tokens`,
                  d.createdAt && `made ${new Date(d.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`,
                ].filter(Boolean).join(" · ")}
              </p>
              {d.topics?.length > 0 && (
                <div className="flex flex-wrap gap-1.5" aria-label="Tags">
                  {d.topics.slice(0, 24).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => searchTag(t)}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--nv-control)] border border-[var(--nv-line)] text-zinc-300 hover:text-zinc-100 hover:border-[var(--nv-line-strong)]"
                      aria-label={`Every card tagged ${t}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}

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

              <ChubNotes fullPath={d.fullPath} tagline={d.tagline} />
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
          {/* the full portrait, falling back to Chub's small square if it will not load */}
          <img
            src={chubPicture(h)}
            alt={h.name}
            loading="lazy"
            decoding="async"
            onError={(e) => { if (h.avatar && e.currentTarget.src !== h.avatar) e.currentTarget.src = h.avatar; }}
            className="w-full h-full object-cover object-top"
          />

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

/* A creator's profile, the way chub.ai shows it above their cards: their
   picture and name, followers and card count, and their bio. */
function CreatorHeader({ username, onBack }) {
  const [u, setU] = useState(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let alive = true;
    setU(null); setMore(false);
    chubCreator(username).then((x) => alive && setU(x)).catch(() => alive && setU({ username, name: username, bio: "", avatar: "" }));
    return () => { alive = false; };
  }, [username]);
  const bio = u?.bio || "";
  return (
    <section aria-label={`${username} on Chub`} className="nv-fade mt-4 rounded-3xl nv-glass p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack} aria-label="Back to all of Chub" className="w-8 px-0 shrink-0" />
        {u?.avatar
          ? <img src={u.avatar} alt="" className="w-12 h-12 rounded-full object-cover bg-zinc-800 shrink-0" />
          : <span className="w-12 h-12 rounded-full bg-[var(--nv-control)] inline-flex items-center justify-center shrink-0"><User size={18} /></span>}
        <div className="min-w-0 flex-1">
          <p className="text-base text-zinc-100 font-medium truncate">{u?.name || username}</p>
          <p className="text-[11px] text-zinc-500">
            {[u?.name && u.name !== username && `@${username}`, u?.cards != null && `${compact(u.cards)} cards`, u?.followers != null && `${compact(u.followers)} followers`].filter(Boolean).join(" · ") || "Creator"}
          </p>
        </div>
        <a href={`https://chub.ai/users/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer" className="p-2.5 rounded-lg border border-zinc-800 bg-[var(--nv-control)] hover:border-zinc-700 text-zinc-400 shrink-0" aria-label="Open their profile on chub.ai">
          <ExternalLink size={16} />
        </a>
      </div>
      {bio && (
        <div>
          <p className={`text-[12.5px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words ${more ? "" : "line-clamp-3"}`}>{bio}</p>
          {bio.length > 180 && <button type="button" onClick={() => setMore((m) => !m)} className="text-[11px] underline underline-offset-2 text-zinc-500 mt-1">{more ? "Less" : "More"}</button>}
        </div>
      )}
    </section>
  );
}

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
