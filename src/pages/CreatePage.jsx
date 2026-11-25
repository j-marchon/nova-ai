import { useSelectionMarker, useWheelScroll } from "../components/motion/navigation.js";
import { MOTION, enter, motionMode, pop, set, stop, tween } from "../components/motion/runtime.js";
import { MotionList } from "../components/motion/MotionList.jsx";
import { Suspense, lazy, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, BookMarked, Globe, Grid2x2, MessageSquarePlus, MoreHorizontal, MoreVertical, Pencil, Play, Plus, Rows3, Search, Sparkles, Trash2, Upload, User, Users, X } from "lucide-react";
import { PersonaPicker } from "../components/PersonaPicker.jsx";
import { AccBtn, ActionMenu, Avatar, Button, EmptyState, Field, Modal, MoreBtn, Segmented, Skeleton, TextInput, TopBar, selStyle } from "../components/ui.jsx";
import { Media } from "../components/media.jsx";
import { useReorder } from "../components/reorder.js";
import { toLayout } from "../lib/uiScale.js";
import { importCardFile } from "../lib/cards.js";
import { clip } from "../lib/util.js";
import { greetingsOf } from "../lib/data.js";
import { parseLorebook } from "../lib/lore.js";
import { dropCharacter } from "../lib/scope.js";
import { removeWithUndo } from "../lib/removal.js";

const TYPE_KEY = { character: "characters", universe: "universes", persona: "personas", lorebook: "lorebooks" };

/* only loaded when its tab is opened */
const ChubBrowser = lazy(() => import("./ChubBrowser.jsx").then((m) => ({ default: m.ChubBrowser })));

/* One underline tab with its count. */
function TabPill({ t, on, pick }) {
  return (
    <button aria-pressed={on} onClick={pick}>
      <span>{t.label}</span>
      {t.count != null && <span className="nv-num">{String(t.count).padStart(2, "0")}</span>}
    </button>
  );
}

export function CreatePage({ data, update, onEdit, startChat, startGroupChat, openChat }) {
  const tabRow = useRef(null);
  const [tab, setTab] = useState("characters");
  useWheelScroll(tabRow);
  useSelectionMarker(tabRow, tab);
  /* a tab picked further along the row glides into view */
  useLayoutEffect(() => {
    const row = tabRow.current, pill = row?.querySelector('[aria-pressed="true"]');
    if (!pill) return;
    const left = pill.offsetLeft - row.offsetLeft, right = left + pill.offsetWidth;
    const to = left < row.scrollLeft ? left - 8 : right > row.scrollLeft + row.clientWidth ? right - row.clientWidth + 8 : null;
    if (to != null) tween(row, { scrollLeft: Math.max(0, to), duration: .4 });
  }, [tab]);
  const [charView, setCharView] = useState("mine");
  /* "mine" | "chub" — the second tab inside Characters */

  const [q, setQ] = useState("");
  const [importNote, setImportNote] = useState(null);
  const fileRef = useRef(null);
  const loreRef = useRef(null);

  /* Lorebook files: SillyTavern World Info, a card's character_book, or a
     whole card with one inside. Each file on its own, like card imports. */
  const importBooks = async (files) => {
    const ok = [];
    const bad = [];
    for (const f of files) {
      try { ok.push(parseLorebook(await f.text(), f.name.replace(/\.[^.]+$/, ""))); }
      catch (e) { bad.push(`${f.name}: ${e.message}`); }
    }
    if (ok.length) update((d) => ({ ...d, lorebooks: [...ok, ...(d.lorebooks || [])] }));
    setImportNote({
      text: [ok.length ? `Imported ${ok.length === 1 ? ok[0].name : `${ok.length} lorebooks`}.` : "", ...bad].filter(Boolean).join(" "),
      bad: bad.length > 0,
    });
  };
  /* large: two across. xl: one across. One switch for every card grid,
     remembered. A size that no longer exists (the old "xs" and "small")
     reads as large. */
  const sizeId = Object.hasOwn(CARD_SIZES, data.appearance?.cardSize ?? "") ? data.appearance.cardSize : "large";
  /* descriptions on every card, at any size: over the picture where there
     is room for them, under it where there is not */
  const showDesc = data.appearance?.cardDesc !== false;
  const layout = useMemo(() => ({ ...CARD_SIZES[sizeId], desc: showDesc }), [sizeId, showDesc]);
  const setSize = (id) => update((d) => ({ ...d, appearance: { ...d.appearance, cardSize: id } }));
  const toggleDesc = () => update((d) => ({ ...d, appearance: { ...d.appearance, cardDesc: d.appearance?.cardDesc === false } }));

  /* the search field, folded to a round button until it is wanted */
  const [searching, setSearching] = useState(false);
  const switchTab = (id) => { setTab(id); setQ(""); setSearching(false); };

  /* the description switch and the size switch; shared with the Chub view
     so every grid has the same controls */
  const gridControls = (compact = false) => (
    <CardTools showDesc={showDesc} toggleDesc={toggleDesc} sizeId={sizeId} setSize={setSize} compact={compact} />
  );

  /* Character card files, PNG or JSON, several at once. Each one is checked
     on its own, so one bad file does not stop the rest. */
  const importFiles = async (files) => {
    const ok = [];
    const bad = [];
    for (const f of files) {
      try { ok.push(await importCardFile(f)); }
      catch (e) { bad.push(e.message || f.name); }
    }
    if (ok.length) update((d) => ({ ...d, characters: [...ok, ...d.characters] }));
    setImportNote({
      text: [
        ok.length ? `Imported ${ok.length === 1 ? ok[0].name : `${ok.length} characters`}.` : "",
        ...bad,
      ].filter(Boolean).join(" "),
      bad: bad.length > 0,
    });
  };
  const [picking, setPicking] = useState(null);   // { kind, item }
  const [deleting, setDeleting] = useState(null); // { kind, item }
  /* the card or row whose menu is open: { kind, item, lastId? } */
  const [menu, setMenu] = useState(null);

  const tabs = [
    { id: "characters", label: "Characters", count: data.characters.length, singular: "Character" },
    { id: "universes", label: "Universes", count: data.universes.length, singular: "Universe" },
    { id: "personas", label: "Personas", count: data.personas.length, singular: "Persona" },
    { id: "lorebooks", label: "Lorebooks", count: (data.lorebooks || []).length, singular: "Lorebook" },
  ];
  const active = tabs.find((t) => t.id === tab);
  const chub = tab === "characters" && charView === "chub";

  const match = (name, desc) =>
    !q.trim() || `${name || ""} ${desc || ""}`.toLowerCase().includes(q.trim().toLowerCase());

  const begin = (kind, item, personaId) => {
    setPicking(null);
    if (kind === "group") startGroupChat(item, personaId);
    else startChat(kind, item, personaId);
  };
  /* the group being put together: { memberIds, name } */
  const [grouping, setGrouping] = useState(null);
  const newChat = (kind, item) => {
    if (data.personas.length > 0) setPicking({ kind, item });
    else begin(kind, item, "");
  };

  /* its chats, and how many of them disappear with it, so the confirmation
     can say so: a chat another of your characters can carry on is kept */
  const chatCountFor = (kind, id) =>
    data.chats.filter((c) => (kind === "universe" ? c.universeId === id : c.characterId === id)).length;
  const lostCountFor = (kind, id) =>
    kind === "universe" ? chatCountFor(kind, id) : data.chats.filter((c) => c.characterId === id && !dropCharacter(c, id, data.characters)).length;

  /* Gone at once, with Undo for a few seconds. Only a card that takes chats
     with it still asks first: that is the one delete worth a second look. */
  const removeNow = (kind, item) => removeWithUndo({ data, update, type: TYPE_KEY[kind], item });
  const askRemove = (kind, item) => {
    const chatty = kind === "character" || kind === "universe";
    if (chatty && lostCountFor(kind, item.id) > 0) setDeleting({ kind, item });
    else removeNow(kind, item);
  };

  /* Most recent chat per character / universe, worked out once per render
     of the page rather than once per card: it used to copy and sort every
     chat for every card, which on a big library was most of the cost of
     drawing this page. */
  const latest = useMemo(() => {
    const m = new Map();
    for (const c of data.chats) {
      const key = c.universeId ? `u:${c.universeId}` : c.characterId ? `c:${c.characterId}` : null;
      if (!key) continue;
      const cur = m.get(key);
      if (!cur || c.updatedAt > cur.updatedAt) m.set(key, c);
    }
    return m;
  }, [data.chats]);
  const latestChatFor = (kind, id) => latest.get(`${kind === "universe" ? "u" : "c"}:${id}`) || null;

  /* The cards are memoised, so they get one stable handle to the current
     callbacks rather than new functions on every render — otherwise a saved
     chat anywhere would redraw every card on this page. */
  const actions = useRef(null);
  actions.current = {
    newChat,
    openChat,
    edit: (kind, item) => onEdit(kind === "universe" ? "universes" : "characters", item),
    remove: (kind, item) => askRemove(kind, item),
    menu: (kind, item, lastId) => setMenu({ kind, item, lastId }),
  };

  const card = (kind, item, image, name, drag, index) => (
    <div key={item.id} {...drag.item(item.id)}>
      <GalleryCard
        index={index}
        kind={kind}
        item={item}
        image={image}
        name={name}
        lastId={latestChatFor(kind, item.id)?.id || null}
        layout={layout}
        actions={actions}
      />
    </div>
  );

  const chars = data.characters.filter((c) => match(c.name, c.description));
  const unis = data.universes.filter((u) => match(u.name, u.tagline || u.story));

  /* Hold a card, then drag it: your order is the order of the list itself,
     so it holds everywhere characters are listed. Off while searching, when
     the grid shows only some of them and a gap would be meaningless. */
  const reorderBy = (type) => (ids) =>
    update((d) => {
      const byId = new Map(d[type].map((x) => [x.id, x]));
      const moved = ids.map((id) => byId.get(id)).filter(Boolean);
      const rest = d[type].filter((x) => !ids.includes(x.id));
      return { ...d, [type]: [...moved, ...rest] };
    });
  const charDrag = useReorder({ ids: chars.map((c) => c.id), onReorder: reorderBy("characters"), enabled: !q.trim() });
  const uniDrag = useReorder({ ids: unis.map((u) => u.id), onReorder: reorderBy("universes"), enabled: !q.trim() });
  const charById = new Map(chars.map((c) => [c.id, c]));
  const uniById = new Map(unis.map((u) => [u.id, u]));
  const pers = data.personas.filter((p) => match(p.name, p.description));
  const books = (data.lorebooks || []).filter((b) => match(b.name, b.description));

  return (
    <div className="nv-page-wrap max-w-[1360px] lg:max-w-none">
      <TopBar title="Create" />
      <div ref={tabRow} className="nv-tabs" data-noswipe>
        <span className="nv-tabs-marker" data-selection-marker aria-hidden />
        {tabs.map((t) => <TabPill key={t.id} t={t} on={tab === t.id} pick={() => switchTab(t.id)} />)}
      </div>

      {/* New, the main thing to do here; then the tools. The Chub view has
          its own search and takes the card switches into its layout. */}
      <div className="mt-5 mb-6 space-y-3">
        {/* Mine or Chub: on a row of its own, the same size in both views, so
            switching only slides its marker and the tools below fade over.
            It used to sit among the tools, and widened, gained an icon and
            jumped a line up as they went, which read as a different control. */}
        {tab === "characters" && (
          <div className="w-full sm:w-64">
            <Segmented value={charView} onChange={setCharView} options={[{ id: "mine", label: "Mine" }, { id: "chub", label: "Chub", aria: "Browse Chub" }]} />
          </div>
        )}
        {!chub && (
        <div key="tools" className={`flex flex-wrap items-center gap-2 ${tab === "characters" ? "nv-fade" : ""}`}>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <AccBtn
                icon={Plus}
                onClick={() => onEdit(tab, null)}
                className="flex-1 sm:flex-none sm:px-6 min-w-0"
                aria-label={`New ${active.singular.toLowerCase()}`}
              >
                <span className="nv-btn-label truncate">New {active.singular.toLowerCase()}</span>
              </AccBtn>
              {tab === "characters" && (
                <Button
                  icon={Users}
                  onClick={() => setGrouping({ memberIds: [], name: "" })}
                  disabled={data.characters.length < 2}
                  aria-describedby={data.characters.length < 2 ? "nv-group-needs-two" : undefined}
                  title={data.characters.length < 2 ? "A group needs at least two characters" : "Group chat"}
                  className="shrink-0"
                >
                  Group chat
                  {data.characters.length < 2 && <span id="nv-group-needs-two" className="sr-only">A group needs at least two characters</span>}
                </Button>
              )}
            </div>
          <div className="flex items-center gap-2 min-w-0 flex-1">
              <>
                <SearchTool
                  open={searching || !!q}
                  setOpen={setSearching}
                  q={q}
                  setQ={setQ}
                  label={`Search ${active.label.toLowerCase()}`}
                />
                {tab === "characters" && (
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".png,.json,image/png,application/json"
                    multiple
                    className="hidden"
                    onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) importFiles(f); }}
                  />
                )}
                {tab === "lorebooks" && (
                  <input
                    ref={loreRef}
                    type="file"
                    accept=".json,application/json"
                    multiple
                    className="hidden"
                    onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; if (f.length) importBooks(f); }}
                  />
                )}
                {(tab === "characters" || tab === "lorebooks") && (
                  <Button
                    icon={Upload}
                    onClick={() => (tab === "lorebooks" ? loreRef : fileRef).current?.click()}
                    aria-label={tab === "lorebooks" ? "Import lorebook" : "Import character card"}
                    title={tab === "lorebooks" ? "Import a lorebook (World Info or card JSON)" : "Import a character card (PNG or JSON)"}
                    className="shrink-0 nv-import"
                  >
                    <span className="nv-import-label">Import</span>
                  </Button>
                )}
                {(tab === "characters" || tab === "universes") && (
                  <div className="ml-auto shrink-0">{gridControls(true)}</div>
                )}
              </>
          </div>
        </div>
        )}
        {importNote && (tab === "characters" || tab === "lorebooks") && (
          <p className={`text-[11px] leading-snug ${importNote.bad ? "text-zinc-100" : "text-zinc-400"}`}>{importNote.text}</p>
        )}
      </div>

      {/* ---- characters ---- */}
      {tab === "characters" && charView === "chub" && (
        <Suspense fallback={<div className="grid grid-cols-2 gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}</div>}>
          <ChubBrowser data={data} update={update} layout={layout} controls={gridControls()} onStartChat={(ch) => newChat("character", ch)} />
        </Suspense>
      )}

      {tab === "characters" && charView === "mine" && (
        chars.length === 0 ? (
          <EmptyState icon={Sparkles} title={q ? "Nothing matched" : "No characters yet"}  />
        ) : (
          /* A fixed count per size rather than responsive: the count is the
             thing being chosen, and letting it climb on a wide screen would
             shrink the cards back to the size being switched away from. */
          <MotionList className={layout.grid}>
            {charDrag.order.map((id) => charById.get(id)).filter(Boolean).map((c, n) => card("character", c, c.avatar, c.name, charDrag, n))}
          </MotionList>
        )
      )}

      {/* ---- universes ---- */}
      {tab === "universes" && (
        unis.length === 0 ? (
          <EmptyState icon={Globe} title={q ? "Nothing matched" : "No universes yet"}  />
        ) : (
          <MotionList className={layout.grid}>
            {uniDrag.order.map((id) => uniById.get(id)).filter(Boolean).map((u, n) => card("universe", u, u.avatar, u.name, uniDrag, n))}
          </MotionList>
        )
      )}

      {/* ---- personas ---- */}
      {tab === "personas" && (
        pers.length === 0 ? (
          <EmptyState icon={User} title={q ? "Nothing matched" : "No personas yet"}  />
        ) : (
          <MotionList className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 nv-hair-t">
            {pers.map((p, i) => (
              <Row key={p.id} i={i} avatar={p.avatar || null} name={p.name} sub={p.description || ""} label="Persona"
                onEditClick={() => onEdit("personas", p)}
                onMenu={() => setMenu({ kind: "persona", item: p })} />
            ))}
          </MotionList>
        )
      )}

      {/* ---- lorebooks ---- */}
      {tab === "lorebooks" && (
        books.length === 0 ? (
          <EmptyState
            icon={BookMarked}
            title={q ? "Nothing matched" : "No lorebooks yet"}
            
          />
        ) : (
          <MotionList className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 nv-hair-t">
            {books.map((b, i) => (
              <Row
                key={b.id}
                i={i}
                icon={<BookMarked size={17} className="text-zinc-500" />}
                name={b.name}
                sub={`${b.entries.length} ${b.entries.length === 1 ? "entry" : "entries"}${b.description ? ` · ${b.description}` : ""}`}
                label="Lorebook"
                onEditClick={() => onEdit("lorebooks", b)}
                onMenu={() => setMenu({ kind: "lorebook", item: b })}
              />
            ))}
          </MotionList>
        )
      )}

      {menu && (() => {
        const { kind, item, lastId } = menu;
        const chatty = kind === "character" || kind === "universe";
        const typeKey = TYPE_KEY[kind];
        const acts = [];
        if (chatty) {
          acts.push({ icon: MessageSquarePlus, label: "New chat", primary: true, run: () => actions.current.newChat(kind, item) });
          if (lastId) acts.push({ icon: Play, label: "Continue", primary: true, run: () => openChat(lastId) });
        }
        acts.push({ icon: Pencil, label: "Edit", primary: true, run: () => onEdit(typeKey, item) });
        acts.push({
          icon: Trash2, label: `Delete ${kind}`, danger: true,
          sub: chatty && lostCountFor(kind, item.id) > 0
            ? `and its ${lostCountFor(kind, item.id)} chat${lostCountFor(kind, item.id) === 1 ? "" : "s"}`
            : null,
          run: () => askRemove(kind, item),
        });
        const pic = item.avatar;
        return (
          <ActionMenu
            title={item.name || "Untitled"}
            onClose={() => setMenu(null)}
            actions={acts}
            preview={
              <div className="flex items-center gap-3 p-2.5 rounded-xl nv-hair">
                <div className="nv-hair w-14 h-[72px] rounded-lg overflow-hidden shrink-0 flex items-center justify-center">
                  {pic ? <Media src={pic} alt="" className="w-full h-full object-cover" /> : kind === "lorebook" ? <BookMarked size={20} className="text-zinc-500" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-medium text-zinc-100 truncate">{item.name}</p>
                  <p className="text-xs text-zinc-500 line-clamp-2 leading-snug mt-0.5">
                    {clip(kind === "universe" ? item.tagline || item.story : kind === "lorebook" ? `${item.entries.length} entries` : item.description || "No description")}
                  </p>
                  {chatty && (
                    <p className="nv-label mt-2">
                      {chatCountFor(kind, item.id)} chat{chatCountFor(kind, item.id) === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
              </div>
            }
          />
        );
      })()}

      {deleting && (
        <Modal
          title={`Delete ${deleting.kind}`}
          onClose={() => setDeleting(null)}
        >
          <p className="text-sm text-zinc-300 leading-relaxed">
            Delete <span className="text-zinc-100 font-medium">{deleting.item.name}</span>?
            {lostCountFor(deleting.kind, deleting.item.id) > 0 && (
              <>
                {" "}
                {lostCountFor(deleting.kind, deleting.item.id)}{" "}
                {lostCountFor(deleting.kind, deleting.item.id) === 1 ? "chat" : "chats"} will be deleted too.
              </>
            )}
          </p>
          <div className="flex items-center gap-2 mt-5">
            <Button
              onClick={() => setDeleting(null)}
              className="flex-1"
            >
              Cancel
            </Button>
            <AccBtn
              onClick={() => {
                removeNow(deleting.kind, deleting.item);
                setDeleting(null);
              }}
              className="flex-1"
            >
              Delete
            </AccBtn>
          </div>
        </Modal>
      )}

      {grouping && (
        <Modal title="New group chat" onClose={() => setGrouping(null)}>
          <div className="space-y-4">
            <Field label="Name (optional)">
              <TextInput
                value={grouping.name}
                onChange={(e) => setGrouping({ ...grouping, name: e.target.value })}
                placeholder="Named after its members if left empty"
              />
            </Field>
            <p className="text-[11px] text-zinc-500 leading-snug px-1">The first pick hosts.</p>
            <div className="space-y-1.5 max-h-[45vh] overflow-y-auto">
              {data.characters.map((c) => {
                const on = grouping.memberIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() =>
                      setGrouping({
                        ...grouping,
                        memberIds: on ? grouping.memberIds.filter((x) => x !== c.id) : [...grouping.memberIds, c.id],
                      })
                    }
                    style={on ? selStyle(true) : {}}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left ${on ? "" : "nv-hair hover:bg-[var(--nv-control)]"}`}
                  >
                    <Avatar src={c.avatar} name={c.name} size="w-9 h-9" />
                    <span className="text-sm text-zinc-100 flex-1 min-w-0 truncate">{c.name}</span>
                    {on && (
                      <span className="text-[11px] tabular-nums shrink-0" style={{ color: "var(--acc)" }}>
                        {grouping.memberIds.indexOf(c.id) + 1}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <AccBtn
              disabled={grouping.memberIds.length < 2}
              onClick={() => {
                const g = grouping;
                setGrouping(null);
                if (data.personas.length > 0) setPicking({ kind: "group", item: g });
                else begin("group", g, "");
              }}
              className="w-full"
            >
              Start group chat
            </AccBtn>
          </div>
        </Modal>
      )}

      {picking && (
        <PersonaPicker
          personas={data.personas}
          onPick={(id) => begin(picking.kind, picking.item, id)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/* ---- the tool row ----
   Search sits folded as a round button. Opened, it widens into the field
   (the row's other tools give way), takes focus, and stays open while it
   holds a query; X or Escape folds it again and clears the query. */
function SearchTool({ open, setOpen, q, setQ, label }) {
  const wrap = useRef(null);
  const field = useRef(null);
  const toggle = useRef(null);
  const was = useRef(open);
  /* how wide the field was when it folded, so it can shrink from there */
  const from = useRef(0);
  const fold = () => {
    from.current = wrap.current?.offsetWidth || 0;
    setQ("");
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (was.current === open) return;
    was.current = open;
    const el = wrap.current;
    if (!el) return;
    stop(el);
    if (open) {
      field.current?.focus({ preventScroll: true });
      if (motionMode() === "full") {
        const width = el.offsetWidth;
        set(el, { maxWidth: 44 });
        tween(el, { maxWidth: width, duration: MOTION.transition, clearProps: "maxWidth" });
      }
      enter(field.current?.parentElement, { y: 0, duration: .3 });
    } else {
      if (document.activeElement === document.body || !document.activeElement) toggle.current?.focus({ preventScroll: true });
      if (motionMode() === "full" && from.current > 44) {
        set(el, { minWidth: from.current });
        tween(el, { minWidth: 44, duration: MOTION.feedback, clearProps: "minWidth" });
      }
      pop(toggle.current, { from: .8 });
    }
  }, [open]);
  return (
    <div ref={wrap} className={open ? "flex-1 min-w-0" : "shrink-0"}>
      {open ? (
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none" />
          <input
            ref={field}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fold(); } }}
            placeholder={label}
            aria-label={label}
            enterKeyHint="search"
            className="w-full h-10 rounded-full nv-glass border border-[var(--nv-line)] pl-10 pr-11 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-[var(--nv-edge-ink)]"
          />
          <Button
            variant="icon"
            icon={X}
            onClick={fold}
            aria-label="Close search"
            className="absolute right-0 top-1/2 -translate-y-1/2"
          />
        </div>
      ) : (
        <Button
          ref={toggle}
          icon={Search}
          onClick={() => setOpen(true)}
          aria-label={label}
          aria-expanded={false}
          className="w-10 px-0"
        />
      )}
    </div>
  );
}

const SIZE_OPTIONS = [
  { id: "large", icon: Grid2x2, label: "Large cards" },
  { id: "xl", icon: Rows3, label: "Largest cards" },
];

/* The description switch, and the card size. There are two sizes, so it is
   one button showing the size in use, and a tap flips to the other. (It
   used to unfold into a row of sizes, which ran off a narrow phone.) */
function CardTools({ showDesc, toggleDesc, sizeId, setSize, compact = false }) {
  const current = SIZE_OPTIONS.find((o) => o.id === sizeId) || SIZE_OPTIONS[0];
  const next = SIZE_OPTIONS.find((o) => o.id !== current.id);
  return (
    <div className="flex items-center gap-2">
      <Button
        icon={AlignLeft}
        selected={showDesc}
        onClick={toggleDesc}
        aria-pressed={showDesc}
        aria-label="Card descriptions"
        title={showDesc ? "Hide descriptions" : "Show descriptions"}
        className={`shrink-0 ${compact ? "w-10 px-0" : ""}`}
      >
        {!compact && "Info"}
      </Button>
      <Button
        icon={current.icon}
        onClick={() => setSize(next.id)}
        aria-label={`Card size: ${current.label.replace(" cards", "").toLowerCase()}. Switch to ${next.label.toLowerCase()}`}
        title={`Switch to ${next.label.toLowerCase()}`}
        className="w-10 px-0 shrink-0"
      />
    </div>
  );
}

/* ---- plain row, for things you do not chat with ----
   Tapping the row edits it; the round button opens its menu. Outside
   CreatePage so it is not a new component type, and remounted, on every
   render. */
function Row({ icon, avatar, name, sub, onEditClick, onMenu, label, i = 0 }) {
  return (
    <div
      onClick={onEditClick}
      style={{ "--i": i }}
      className="nv-rise nv-row nv-hair-b group min-w-0"
    >
      {avatar !== undefined ? (
        <Avatar src={avatar} name={name} size="w-11 h-11" />
      ) : (
        <div className="nv-hair w-11 h-11 rounded-lg flex items-center justify-center shrink-0">{icon}</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-zinc-100 truncate tracking-tight">{name}</p>
        {sub && <p className="text-xs text-zinc-500 truncate mt-0.5">{clip(sub, 160)}</p>}
      </div>
      <MoreBtn onClick={onMenu} label={`${label} options`}><MoreHorizontal size={18} /></MoreBtn>
    </div>
  );
}

/* ---- one gallery card ----

   Three across, image only. The description is gone for good — at this size
   it was two greyed lines nobody read, and dropping it is what lets the
   portrait have the whole card instead of the top two thirds of it.

   Everything sits over the photo on a gradient, so the card is exactly as
   tall as the image and no taller.

   Kept cheap to scroll: no backdrop blurs on the buttons (each one made the
   phone re-blur the picture under it on every scrolled frame, a dozen times
   per screen), and cards off screen are skipped by the browser entirely
   (content-visibility) until they come near. Memoised on its own props. */
const GalleryCard = memo(function GalleryCard({ kind, item, image, name, lastId, layout, actions, index }) {
  const { big, wide, desc } = layout;
  const blurb = desc ? clip((kind === "universe" ? item.tagline || item.story : item.tagline || item.description) || "") : "";
  /* too small to hold it over the picture: it goes underneath instead */
  const under = blurb && !big;
  const corner = "nv-card-corner w-7 min-h-7 px-0";
  return (
    <div
      data-chat-card
      className="nv-card nv-ticks group relative nv-glass-hover"
      style={{ contentVisibility: "auto", containIntrinsicSize: wide ? "auto 480px" : big ? "auto 260px" : "auto 170px" }}
    >
      {/* every size is the same 3:4 portrait, scaled: the whole picture shows */}
      <div className={`aspect-[3/4] relative overflow-hidden rounded-[13px] ${under ? "rounded-b-none" : ""}`} style={{ background: "var(--nv-control-base)" }}>
        {image ? (
          <Media src={image} alt={name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {kind === "universe" ? <Globe size={26} strokeWidth={1.2} className="text-zinc-600" /> : <User size={26} strokeWidth={1.2} className="text-zinc-600" />}
          </div>
        )}

        {/* edit / menu: small, at the top, away from New / Continue */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          <Button size="sm" icon={Pencil} onClick={() => actions.current.edit(kind, item)} className={corner} aria-label="Edit" />
          <Button size="sm" icon={MoreHorizontal} onClick={() => actions.current.menu(kind, item, lastId)} className={corner} aria-label="Card options" />
        </div>

        <div className={`nv-card-caption absolute inset-x-0 bottom-0 ${big ? "p-3 pt-8" : "p-2 pt-6"} flex flex-col gap-2`}>
          <div className="min-w-0">
            <p className={`${wide ? "text-lg" : big ? "text-[15px]" : "text-[12.5px]"} font-semibold tracking-tight text-[var(--nv-ink)] truncate`}>{name}</p>
            {blurb && big && <p className={`text-[11.5px] text-[var(--nv-muted)] leading-snug ${wide ? "line-clamp-3" : "line-clamp-2"} mt-0.5`}>{blurb}</p>}
          </div>
          <div className="flex gap-1">
            <AccBtn
              size="sm"
              onClick={() => actions.current.newChat(kind, item)}
              className={`flex-1 min-w-0 ${big ? "" : "px-1 text-[11px]"}`}
              aria-label="New chat"
            >
              New
            </AccBtn>
            <Button
              size="sm"
              icon={big ? undefined : Play}
              data-glyph={big ? undefined : "play"}
              onClick={() => lastId && actions.current.openChat(lastId)}
              disabled={!lastId}
              aria-label="Continue"
              className={`${big ? "flex-1" : "w-8 px-0"} min-w-0 nv-card-corner`}
            >
              {big && "Continue"}
            </Button>
          </div>
        </div>
      </div>
      {under && (
        <p className="px-2.5 py-2 text-[10.5px] line-clamp-3 text-zinc-500 leading-snug">{blurb}</p>
      )}
    </div>
  );
});

/* Card sizes, smaller first. One setting for every card grid, Chub's too. */
export const CARD_SIZES = {
  large: { grid: "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 lg:gap-4", big: true },
  xl: { grid: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4", big: true, wide: true },
};
