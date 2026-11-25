import { WebUpdate } from "./components/WebUpdate.jsx";
import { UpdateDialog } from "./components/UpdateDialog.jsx";
import { watchKeyboard } from "./lib/keyboard.js";
import { applyUiScale, normalizeBubbleScale, layoutRect, layoutViewport, toLayout } from "./lib/uiScale.js";
import { Activity, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { enter, gsap, motionMode, set, stop, tween } from "./components/motion/runtime.js";
import { useNavigationMarker } from "./components/motion/navigation.js";
import { useMotionRoot } from "./components/motion/hooks.js";
import { Settings as Cog, MessagesSquare, Plus } from "lucide-react";
import { useResolvedScheme } from "./components/scheme.js";
import { PageBackdrop } from "./components/backdrops.jsx";
import { isReordering } from "./components/reorder.js";
import { useStableActions } from "./components/stable.js";
import { Toasts } from "./components/Toasts.jsx";
import { ActivityIsland } from "./components/ActivityIsland.jsx";
import { requestActivityOpen } from "./lib/activity.js";
import { showToast } from "./lib/toast.js";
import { bootUpdateCheck, installUpdate, shortVersion } from "./lib/updates.js";
import { ChatSkeleton, NovaMark, useNeedsSetup, PageSkeleton, ScreenSkeleton, topModal } from "./components/ui.jsx";
import { findBridgeOnce, pageHost } from "./lib/bridgeFind.js";
import { activeProvider, patchProvider } from "./lib/providers.js";
import { saveFile, fillNames } from "./lib/cards.js";
import { DEFAULT_AUTHORS_NOTE, greetingsOf } from "./lib/data.js";
import { castMember } from "./lib/scope.js";
import { emptyHandset } from "./lib/phone.js";
import { askForPersistence, loadData, saveData } from "./lib/storage.js";
import { backupName, backupParts, dailyBackup } from "./lib/backup.js";
import { rememberData } from "./components/ErrorBoundary.jsx";
import { RecoveryScreen } from "./components/RecoveryScreen.jsx";
import { Splash } from "./components/Splash.jsx";
import { useSkin } from "./components/useSkin.js";
import { loadedSkin, sceneSetOf, skinOf, skinScheme, storedSkin } from "./skins/skins.js";
import { LayeredScene } from "./skins/LayeredScene.jsx";
import { exportPacks } from "./skins/store.js";
import { appIconOf, applyAppIcon } from "./skins/icons.js";
import { version } from "../package.json";
import { uid } from "./lib/util.js";
import { isVideo } from "./lib/video.js";
import { CreatePage } from "./pages/CreatePage.jsx";
import { ChatDataSource } from "./pages/chat/appData.jsx";

/* Create is the first screen and comes with the app. Everything else loads
   on its own: the other tabs in the background straight after launch (they
   are pre-rendered, hidden, below), the chat and the editors when the phone
   is idle. A phone parses far less before the first screen can show. */
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const loadChat = () => import("./pages/ChatPage.jsx");
const loadForms = () => import("./components/forms.jsx");
const loadLorebook = () => import("./components/LorebookForm.jsx");
const ChatPage = named(loadChat, "ChatPage");
const HistoryPage = named(() => import("./pages/HistoryPage.jsx"), "HistoryPage");
const SettingsPage = named(() => import("./pages/SettingsPage.jsx"), "SettingsPage");
const CharacterForm = named(loadForms, "CharacterForm");
const PersonaForm = named(loadForms, "PersonaForm");
const UniverseForm = named(loadForms, "UniverseForm");
const LorebookForm = named(loadLorebook, "LorebookForm");

const TABS = ["create", "history", "settings"];
const SPLASH = import.meta.env?.MODE !== "test";

/* A hidden tab keeps the data it last showed, so changes made elsewhere (a
   reply landing in a chat, a spend tally) do not re-render it in the
   background. It catches up the moment it is shown. */
/* Whether the window is wide enough for the desktop layout (the rail, the
   Chats list beside the open chat): the same 1024px as index.css. */
const WIDE = "(min-width: 1024px)";
function useWide() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(WIDE).matches);
  useEffect(() => {
    const m = window.matchMedia?.(WIDE);
    if (!m) return undefined;
    const on = () => setWide(m.matches);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return wide;
}

function useWhileShown(value, shown) {
  const [kept, setKept] = useState(value);
  if (shown && kept !== value) setKept(value);
  return shown ? value : kept;
}

/* ============================================================
   NOVA — AI roleplay
   Tabs: Create · Chats · Settings (fixed at the bottom)
   Models: OpenRouter, Google AI Studio, or your own server

   Where things live:
     lib/         no React — storage, prompt assembly, the API, cards,
                  Chub, memory and scene notes, swipes, Nova Scope
     components/  shared pieces: inputs and sheets, pickers, forms
     pages/       one file per screen
     App.jsx      navigation, the save loop, starting chats
   ============================================================ */

/* Loading, then the app. The app itself only ever renders with data, so
   nothing in it has to allow for there being none yet — which the React
   Compiler relies on: it reads what a function uses while rendering. */
/* Stored data that cannot be read shows the recovery screen, never the app:
   the app would start empty and its first save would write that over the
   data (storage.js also refuses such saves). */
export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    askForPersistence();
    loadData().then((d) => { if (alive) setData(d); }).catch((e) => {
      console.error("Could not load saved data", e);
      if (alive) setLoadError(e || new Error("Could not load saved data"));
    });
    return () => { alive = false; };
  }, [attempt]);

  /* The launch splash plays over the app while it loads and draws, then
     lifts away onto it. Not in tests, which drive the app straight away. */
  const [splash, setSplash] = useState(SPLASH);
  const endSplash = useCallback(() => setSplash(false), []);
  /* a skin worn on this device may bring its own (main.jsx put it on) */
  const [SplashView] = useState(() => loadedSkin(storedSkin())?.Splash || Splash);
  const app = loadError ? <RecoveryScreen
    error={loadError}
    onRetry={() => { setLoadError(null); setAttempt((n) => n + 1); }}
    onRestored={(state) => { setLoadError(null); setData(state); }}
  /> : data ? <Nova data={data} setData={setData} /> : null;
  return <>
    {app}
    {splash && <SplashView ready={!!app} onDone={endSplash} />}
  </>;
}

function Nova({ data, setData }) {
  const [page, setPage] = useState("create"); // create | history | settings | chat
  /* a wide window (the desktop app, a laptop browser): Chats becomes a list
     beside the open chat, and the rail stays */
  const desktop = useWide();
  const [activeChatId, setActiveChatId] = useState(null);
  const [editing, setEditing] = useState(null); // { type, item }
  const [chatOrigin, setChatOrigin] = useState("create"); // tab a chat was opened from
  const saveTimer = useRef(null);
  const [saveError, setSaveError] = useState(false);
  const saveGeneration = useRef(0);
  const restoreRecovery = useRef(null);

  /* mirrors of the nav state, so the back handler can stay stable and
     still read current values without being re-registered constantly */
  const pageRef = useRef(page);
  const editingRef = useRef(editing);
  const formDirty = useRef(false); // the open form reports unsaved edits here
  const originRef = useRef(chatOrigin);
  const scrollPositions = useRef(new Map());
  useEffect(() => {
    const remember = () => { if (pageRef.current !== "chat") scrollPositions.current.set(pageRef.current, window.scrollY); };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, []);
  useLayoutEffect(() => {
    pageRef.current = page;
    if (typeof window.matchMedia === "function") window.scrollTo(0, scrollPositions.current.get(page) || 0);
  }, [page]);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { editingRef.current = editing; }, [editing]);
  useEffect(() => { originRef.current = chatOrigin; }, [chatOrigin]);

  /* The daily backup, once per launch and a few seconds after it, so
     opening the app is not held up by writing the file. It reads the data as
     it is then, not as it was loaded. */
  const dataRef = useRef(null);
  useEffect(() => { dataRef.current = data; rememberData(data); }, [data]);
  const loaded = !!data;
  /* a newer release found at launch: { latest, url } */
  const [updateNotice, setUpdateNotice] = useState(null);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const d = dataRef.current;
      if (d && d.settings.dailyBackup !== false) {
        /* tried once per launch; a failure says so once and waits for the next */
        /* skins too when Include skins is on (Settings → You → Backup) */
        dailyBackup(d, version, undefined, { skins: d.settings.backupSkins ? exportPacks : null }).catch((e) => {
          console.error("Daily backup failed", e);
          showToast("Today's automatic backup could not be saved. Back up from Settings to be safe.", { tone: "warn" });
        });
      }
      /* Check for updates (Settings → You): on every launch while it is on */
      if (d) bootUpdateCheck(d.settings.updateCheck === true, version).then((u) => {
        if (u?.newer) setUpdateNotice(u);
      });
    }, 5000);
    return () => clearTimeout(t);
  }, [loaded]);

  /* Accepts a patch object, or a function of the previous state for updates
     that have to read what is already there. A running spend tally must not
     be computed from a value captured at render time, or two replies landing
     close together would each overwrite the other's total. */
  /* the state waiting for the save timer, if any */
  const unsaved = useRef(null);
  const save = useCallback((next) => {
    clearTimeout(saveTimer.current);
    const generation = ++saveGeneration.current;
    unsaved.current = next;
    return saveData(next).then(() => {
      if (generation === saveGeneration.current && unsaved.current === next) {
        unsaved.current = null;
        setSaveError(false);
      }
    }).catch((e) => {
      if (generation === saveGeneration.current) setSaveError(true);
      console.error("Could not save", e);
      throw e;
    });
  }, []);
  const update = useCallback((patch, { durable = false } = {}) => {
    if (durable) {
      clearTimeout(saveTimer.current);
      const next = typeof patch === "function" ? patch(dataRef.current) : { ...dataRef.current, ...patch };
      restoreRecovery.current ??= dataRef.current;
      dataRef.current = next;
      setData(next);
      return save(next).then(() => { restoreRecovery.current = null; });
    }
    setData((prev) => {
      const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
      clearTimeout(saveTimer.current);
      unsaved.current = next;
      saveTimer.current = setTimeout(() => { save(next).catch(() => {}); }, 350);
      return next;
    });
  }, [save]);

  /* Leaving the app saves at once: Android may stop a backgrounded app
     before the timer above runs, and the last change would be lost. */
  useEffect(() => {
    const flush = () => { if (unsaved.current) save(unsaved.current).catch(() => {}); };
    const onVisibility = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [save]);

  /* Nova Bridge keeps its own address up to date: checked at launch and
     each time the app comes back to the front, and moved when a chat request
     found it somewhere new (sendTo in lib/api.js) — the computer's address
     changes now and then, and nobody should have to go and retype it. */
  useEffect(() => {
    if (!loaded) return;
    const moveTo = ({ base, health }) => update((d) => {
      const entry = (d.settings.providers || []).find((p) => p.preset === "nova-bridge");
      const lan = health?.lan || d.settings.bridgeLan || "";
      if (!entry || (entry.key && entry.base !== base) || (entry.base === base && lan === d.settings.bridgeLan)) return d;
      return { ...d, settings: { ...d.settings, ...patchProvider(d.settings, entry.id, { base }), bridgeLan: lan } };
    });
    const check = () => {
      const s = dataRef.current?.settings;
      const p = s && activeProvider(s);
      if (p?.preset !== "nova-bridge") return;
      findBridgeOnce({ saved: p.base, lan: s.bridgeLan, pageHost: pageHost() })
        .then((hit) => { if (hit) moveTo(hit); })
        .catch((e) => console.error("Nova Bridge lookup failed", e));
    };
    const onMoved = (e) => { if (e.detail?.base) moveTo(e.detail); };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    check();
    window.addEventListener("nova-bridge-moved", onMoved);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    return () => {
      window.removeEventListener("nova-bridge-moved", onMoved);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, [loaded, update]);

  /* Account for native resizing before adding any keyboard clearance. */
  useEffect(() => watchKeyboard(), []);

  /* the chat and the editors, fetched and parsed while the phone is idle
     after launch, so opening one never waits on the file */
  useEffect(() => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    const h = idle(() => { loadChat(); loadForms(); loadLorebook(); });
    return () => (window.cancelIdleCallback || clearTimeout)(h);
  }, []);


  /* Navigation commits immediately; an inert outgoing copy overlaps the new page. */
  const navAnimation = useRef(null);
  const navigate = (kind, fn) => {
    if (pageRef.current !== "chat") scrollPositions.current.set(pageRef.current, window.scrollY);
    navAnimation.current?.();
    const outgoing = pageRef.current === "chat" ? document.querySelector(".nv-chat-root") : pageEl.current;
    let ghost = null;
    const leanNavigation = window.innerWidth < 640 || !!window.matchMedia?.("(pointer: coarse)").matches;
    if (outgoing && !leanNavigation && motionMode() === "full" && document.visibilityState === "visible") {
      ghost = outgoing.cloneNode(true);
      ghost.setAttribute("aria-hidden", "true"); ghost.dataset.motionGhost = "1"; ghost.inert = true;
      ghost.querySelectorAll("[id]").forEach(el => el.removeAttribute("id")); ghost.removeAttribute("id");
      const rect = layoutRect(outgoing.getBoundingClientRect());
      Object.assign(ghost.style, { position: "fixed", top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", zIndex: "35", pointerEvents: "none", overflow: "hidden" });
      document.querySelector(".nv-root")?.appendChild(ghost);
    }
    flushSync(fn);
    const incoming = document.querySelector(".nv-chat-root:not([data-motion-ghost])") || pageEl.current;
    // Tabs slide in their direction, a chat rises to the front, and closing drops back a layer.
    enter(incoming, kind === "open" ? { y: 32, scale: .97, duration: .5 }
      : kind === "close" ? { x: -24, scale: .985, duration: .46 }
      : { x: kind === "tab-right" ? -32 : 32, duration: .46 });
    const clean = () => { if (ghost) { stop(ghost); ghost.remove(); ghost = null; } };
    navAnimation.current = clean;
    if (ghost) tween(ghost, kind === "open" ? { opacity: 0, scale: .96, duration: .26, ease: "power2.in", onComplete: clean }
      : kind === "close" ? { opacity: 0, y: 32, scale: .98, duration: .26, ease: "power2.in", onComplete: clean }
      : { opacity: 0, x: kind === "tab-right" ? 32 : -32, duration: .28, ease: "power2.in", onComplete: clean });
  };
  useEffect(() => () => navAnimation.current?.(), []);

  /* Nova Scope's default for new chats, of any kind; the card, world or
     members are read for their cast as soon as the chat opens */
  const scopeStart = (kind) => {
    const picked = ["manual", "auto"].includes(data.settings.scopeDefault) ? data.settings.scopeDefault : null;
    /* a universe is a living world: its cast keeps itself up to date and the
       scene may play on by itself (Auto, with carry), unless you chose a
       mode for new chats */
    if (kind === "universe") return { scope: { mode: picked || "auto", carry: true, turns: 3 } };
    return picked ? { scope: { mode: picked } } : {};
  };
  /* the phone new chats start with (phone.js), off unless you chose a level */
  const phoneStart = () =>
    ["light", "lively"].includes(data.settings.phoneDefault) ? { handset: emptyHandset(data.settings.phoneDefault) } : {};

  /* `extra`: fields the new chat starts with on top (a group chat's Scope
     cast and title) */
  const startChat = (kind, item, personaId, extra = {}) => {
    /* A chat opens on the first scenario. Which one it is gets recorded, so
       the picker in the chat knows where it currently sits and reordering the
       card later cannot quietly change what an open chat thinks it shows. */
    const greets = greetingsOf(item);
    const g = greets[0];
    const userName = data.personas.find((p) => p.id === personaId)?.name || data.username || "You";
    const chat = {
      id: uid(),
      kind,
      ...(kind === "universe" ? { universeId: item.id } : { characterId: item.id }),
      personaId: personaId || "",
      greetingId: g?.id || "",
      authorsNote: { ...DEFAULT_AUTHORS_NOTE },
      bookmarks: [],
      ...scopeStart(kind),
      ...phoneStart(),
      ...extra,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: g?.text ? [{ id: uid(), role: "assistant", content: fillNames(g.text, item.name, userName), at: Date.now() }] : [],
    };
    update({ chats: [...data.chats, chat] });
    openNew(chat.id);
  };

  const openNew = (id) => openChatFrom(page, id);
  const openChatFrom = (origin, id) => navigate("open", () => {
    setActiveChatId(id);
    setChatOrigin(origin);
    setPage("chat");
  });

  /* A group chat is a chat with the first character picked (the host: its
     opening, look and lorebook), with Nova Scope already on and the others
     in its cast, linked to their cards so each one's whole card is sent. */
  const startGroupChat = ({ memberIds, name }, personaId) => {
    const picked = (memberIds || []).map((id) => data.characters.find((c) => c.id === id)).filter(Boolean);
    if (!picked.length) return;
    const [host, ...rest] = picked;
    const mode = ["manual", "auto"].includes(data.settings.scopeDefault) ? data.settings.scopeDefault : "manual";
    startChat("character", host, personaId, {
      scope: { mode, carry: true, cast: rest.map((c) => castMember({ id: uid(), name: c.name, characterId: c.id })) },
      ...(name?.trim() ? { title: name.trim() } : {}),
    });
  };

  /* leaving a chat returns you wherever you opened it from */
  const goBackFromChat = () => navigate("close", () => setPage(chatOrigin || "history"));
  /* on a wide window a chat opens beside the Chats list, wherever it was
     opened from, and closing it leaves the list */
  const split = desktop && page === "history";
  /* the chat list is a drawer over an open chat: closed whenever a chat opens */
  const drawer = desktop && page === "chat";
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => { setListOpen(false); }, [page, activeChatId]);
  const navRef = useRef(navigate);
  navRef.current = navigate;

  /* ---- swipe between tabs -------------------------------------------
     Touch events rather than pointer events: Chrome on Android fires
     pointercancel the moment its own scroller claims a gesture, which
     killed the swipe halfway through. Touch events keep firing, and
     because we never preventDefault, vertical scrolling and the
     sideways-scrolling tab strip both keep working normally. */
  const TAB_ORDER = ["create", "history", "settings"];
  const [swipeDir, setSwipeDir] = useState(null);
  const sw = useRef(null);
  /* The page follows the finger by writing its style directly. It used to go
     through state, which re-rendered the whole app — every card on the
     Create page included — on every touchmove of a swipe. */
  const pageEl = useRef(null);
  const dragTo = (x) => {
    const el = pageEl.current;
    if (!el) return;
    stop(el);
    set(el, { x: toLayout(x), opacity: x ? 1 - Math.min(Math.abs(x) / 400, .35) : 1 });
    el.style.willChange = x ? "transform" : "";
  };

  const settle = () => {
    const was = sw.current?.dx;
    sw.current = null;
    if (was) dragTo(0);
  };

  const swipe = {
    onTouchStart: (e) => {
      if (pageRef.current === "chat" || e.touches.length !== 1) return;
      if (e.target?.closest?.("button, a, input, textarea, select, [data-noswipe]")) return;
      const t = e.touches[0];
      sw.current = { x: t.clientX, y: t.clientY, dx: 0, locked: null };
    },
    onTouchMove: (e) => {
      const s = sw.current;
      if (!s || e.touches.length !== 1) return;
      /* a card being dragged into a new place is not a tab swipe */
      if (isReordering()) { settle(); return; }
      const t = e.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (s.locked === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;   // too small to judge yet
        s.locked = Math.abs(dx) > Math.abs(dy) * 1.3 ? "x" : "y";
      }
      if (s.locked !== "x") return;
      s.dx = dx;                                              // keep the raw distance
      const i = TAB_ORDER.indexOf(pageRef.current);
      /* resist at the ends so it feels like a wall, not a bug */
      const atEdge = (dx < 0 && i === TAB_ORDER.length - 1) || (dx > 0 && i === 0);
      dragTo(atEdge ? dx * 0.2 : dx * 0.55);
    },
    onTouchEnd: () => {
      const s = sw.current;
      settle();
      if (!s || s.locked !== "x") return;
      const i = TAB_ORDER.indexOf(pageRef.current);
      if (s.dx <= -60 && i < TAB_ORDER.length - 1) {
        navigate("tab-left", () => { setSwipeDir("left"); setPage(TAB_ORDER[i + 1]); });
      } else if (s.dx >= 60 && i > 0) {
        navigate("tab-right", () => { setSwipeDir("right"); setPage(TAB_ORDER[i - 1]); });
      }
    },
    onTouchCancel: settle,
  };

  /* tapping the nav bar should not inherit the swipe animation */
  const goTab = (id) => {
    if (id === page) return;
    const kind = TABS.indexOf(id) > TABS.indexOf(page) ? "tab-left" : "tab-right";
    navigate(kind, () => { setSwipeDir(null); setPage(id); });
  };

  /* One place that decides what "back" means, used by both the Android
     hardware button and the browser back gesture. Returns false when
     there is nothing left to go back to. */
  /* `instant`: the back gesture has already moved the screen out of the
     way, so it goes without its own animation. */
  const goBack = useCallback(({ instant = false } = {}) => {
    /* an open sheet or editor first, as on any Android screen */
    const m = topModal();
    if (m) { instant ? m.close() : m.dismiss(); return true; }
    if (editingRef.current) { setEditing(null); return true; }
    if (pageRef.current === "chat") {
      const out = () => setPage(originRef.current || "history");
      if (instant) out();
      else navRef.current("close", out);
      return true;
    }
    if (pageRef.current !== "create") { setPage("create"); return true; }
    return false;
  }, []);

  /* ---- predictive back (Android 14+, NovaBackPlugin) ----
     While the back gesture is held, whatever back would close follows the
     finger: a sheet sinks and shrinks, an editor or the chat slides toward
     the edge and shrinks, showing the page it will return to underneath, and
     a tab slides toward Create. Letting go past the point commits it; going
     back cancels it and everything springs back. All by style, so a gesture
     is no React renders. The plugin is on only while there is somewhere to
     go back to; otherwise back leaves the app as before. */
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    const nb = window.Capacitor?.Plugins?.NovaBack;
    if (!nb?.addListener) return;
    const sync = () => {
      const can = !!topModal() || !!editingRef.current || pageRef.current !== "create";
      Promise.resolve(nb.setEnabled({ enabled: can })).catch(() => {});
    };
    sync();
    window.addEventListener("nova-modals", sync);
    window.addEventListener("nova-page", sync);

    let layer = null;
    const pick = () => {
      const m = topModal();
      if (m) return { kind: m.screen ? "screen" : "sheet", el: m.el?.() };
      if (pageRef.current === "chat") return { kind: "chat", el: document.querySelector(".nv-chat-root") };
      if (pageRef.current !== "create") return { kind: "tab", el: pageEl.current };
      return null;
    };
    const paint = (l, p) => {
      const s = l.el?.style;
      if (!s) return;
      stop(l.el);
      if (l.kind === "sheet") set(l.el, { y: p * 32, scale: 1 - p * .06 });
      else if (l.kind === "tab") set(l.el, { x: p * 56, opacity: 1 - p * .35 });
      else {
        set(l.el, { x: p * layoutViewport().width * .12, scale: 1 - p * .1 });
        s.borderRadius = `${Math.round(p * 32)}px`;
        s.overflow = "hidden";
      }
    };
    const clear = (l) => {
      const s = l.el?.style;
      if (!s) return;
      set(l.el, { clearProps: "transform,opacity,borderRadius,overflow" });
    };
    const handles = [
      nb.addListener("start", ({ progress = 0 } = {}) => {
        layer = pick();
        if (!layer?.el) { layer = null; return; }
        if (layer.kind === "chat") setPeek(true);
        paint(layer, progress);
      }),
      nb.addListener("progress", ({ progress = 0 } = {}) => { if (layer) paint(layer, progress); }),
      nb.addListener("cancel", () => {
        const l = layer;
        layer = null;
        if (!l?.el) return;
        tween(l.el, { x: 0, y: 0, scale: 1, opacity: 1, duration: .22, onComplete: () => { clear(l); setPeek(false); } });
      }),
      nb.addListener("commit", () => {
        const l = layer;
        layer = null;
        /* three-button navigation and older Android: no gesture, just back */
        if (!l?.el) { goBack(); return; }
        tween(l.el, { x: l.kind === "sheet" ? 0 : l.kind === "tab" ? 120 : layoutViewport().width, yPercent: l.kind === "sheet" ? 100 : 0, opacity: 0, duration: .18, onComplete: () => {
          goBack({ instant: true }); clear(l); setPeek(false);
        } });
      }),
    ];
    return () => {
      window.removeEventListener("nova-modals", sync);
      window.removeEventListener("nova-page", sync);
      handles.forEach((h) => Promise.resolve(h).then((x) => x?.remove?.()).catch(() => {}));
    };
  }, [goBack]);
  useEffect(() => { window.dispatchEvent(new Event("nova-page")); }, [page, editing]);

  /* Android hardware back. Reached through Capacitor's global plugin
     registry rather than a bare import, so the web build never depends
     on the plugin being installed — if it is missing this simply does
     nothing and the browser handler below still covers the PWA. */
  useEffect(() => {
    const CapApp = window.Capacitor?.Plugins?.App;
    if (!CapApp?.addListener) return;
    let handle;
    let cancelled = false;
    Promise.resolve(
      CapApp.addListener("backButton", () => {
        if (!goBack()) CapApp.exitApp?.();
      })
    )
      .then((h) => {
        if (cancelled) h?.remove?.();
        else handle = h;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      handle?.remove?.();
    };
  }, [goBack]);

  /* browser / PWA back gesture */
  useEffect(() => {
    const onPop = () => {
      if (goBack()) window.history.pushState(null, "");
    };
    window.history.pushState(null, "");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [goBack]);

  /* Used by the card writer's model row. It patches settings without the
     caller needing the whole object, and reads the previous state rather than
     a value captured at render time. */
  const patchSettings = useCallback((patch) => {
    update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  }, [update]);

  const saveEntity = (type, saved) => {
    /* when it last changed, so syncing through the Bridge keeps the newer
       copy of something edited on two devices (lib/sync.js) */
    const item = { ...saved, updatedAt: Date.now() };
    const list = data[type];
    const exists = list.some((x) => x.id === item.id);
    update({ [type]: exists ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item] });
    /* an editor opened from a chat (its Persona tab) hears what was saved */
    editing?.onSaved?.(item);
    setEditing(null);
  };

  const scheme = useResolvedScheme(data.appearance?.scheme);
  useLayoutEffect(() => {
    applyUiScale(data.appearance?.uiScale);
  }, [data.appearance?.uiScale]);
  useEffect(() => () => applyUiScale(1), []);

  const navItems = [
    { id: "create", label: "Create", icon: Plus },
    { id: "history", label: "Chats", icon: MessagesSquare },
    { id: "settings", label: "Settings", icon: Cog },
  ];

  /* a tab shows when it is the page, and under the chat while a back
     gesture is peeking at the tab the chat will return to */
  const shows = (p) => page === p || (peek && page === "chat" && (chatOrigin || "history") === p) || (p === "history" && desktop && page === "chat");
  const createData = useWhileShown(data, page === "create");
  const historyData = useWhileShown(data, page === "history");
  const settingsData = useWhileShown(data, page === "settings");
  /* what the tabs call, as one object that never changes, so a hidden tab
     is not re-rendered just because a handler was made again */
  const pageActions = useStableActions({
    edit: (type, item, onSaved) => setEditing({ type, item, onSaved }),
    startChat,
    startGroupChat,
    openFromCreate: (id) => openChatFrom("create", id),
    openFromHistory: (id) => openChatFrom("history", id),
  });
  const tabClass = `nv-tab ${swipeDir === "left" ? "nv-slide-left" : swipeDir === "right" ? "nv-slide-right" : "nv-page"}`;

  const needsKey = useNeedsSetup(data.settings);
  const motionRoot = useRef(null);
  useMotionRoot(motionRoot, data.appearance?.motion || "full");
  const ap = data.appearance;
  /* a skin drawn for one mode (Aero is light) wears it whatever Mode says */
  /* Look → Skin in chats off: the skin stays on everywhere (rail, chat
     list, dock, sheets, the phone); only the chat itself drops it, on a
     solid black or white page in Nova's plain look (ChatPage `plain`) */
  const plainChat = page === "chat" && ap.skinInChat !== true;
  const worn = skinOf(ap);
  const light = (skinScheme(worn) || scheme) === "light";
  const skin = useSkin(worn);
  /* its layered scenes, if it has them (Nova's own; a pack's once loaded).
     A plain chat on a phone covers the whole screen, so nothing is drawn
     behind it then (except while a back swipe peeks at the page under it);
     on a desktop the rail beside it still sits on the scene. */
  const behindChat = !plainChat || desktop || peek;
  const sceneSet = !behindChat ? null : worn === "nova" || skin ? sceneSetOf(worn) : null;
  /* the desktop app's Nova Bridge window wears the same skin */
  const skinId = skinOf(ap);
  useEffect(() => { window.novaDesktop?.setSkin?.(skinId); }, [skinId]);
  /* and the desktop window's title bar, light or dark with the app */
  useEffect(() => { window.novaDesktop?.setScheme?.(light ? "light" : "dark"); }, [light]);
  /* the app's icon: the skin's own, or the one picked in Look (skins/icons.js) */
  const iconId = appIconOf(ap);
  useEffect(() => { if (loaded) applyAppIcon(iconId); }, [iconId, loaded]);
  const SkinBackground = skin?.Background;
  /* for the next startup screen, which shows before the saved data loads */
  useEffect(() => { try { localStorage.setItem("nova-scheme", light ? "light" : "dark"); } catch { /* private mode */ } }, [light]);
  const navigationRef = useNavigationMarker(page);

  return (
    <div
      ref={motionRoot}
      className="nv-root min-h-screen text-zinc-100 antialiased"
      data-theme={light ? "light" : "dark"}
      /* a GIF or video behind the pages: see "moving backdrops" in index.css */
      data-moving={ap.bgPreset === "custom" && (ap.bgFrame || isVideo(ap.bgImage)) ? "1" : "0"}
      data-motion={ap.motion || "full"}
      data-bubbles={ap.bubbles === "aligned" ? "aligned" : "full"}
      data-flow={ap.fx?.flow ? "1" : "0"}
      data-split={split ? "1" : undefined}
      data-drawer={drawer ? (listOpen ? "open" : "closed") : undefined}
      data-scene={sceneSet ? "1" : undefined}
      style={{
        "--acc": light ? "#000" : "#fff",
        "--on-acc": light ? "#fff" : "#000",
        "--nv-bubble-scale": normalizeBubbleScale(ap.bubbleScale),
      }}
    >
      <WebUpdate prepare={async () => {
        do { await save(unsaved.current || data); } while (unsaved.current);
      }} />
      {updateNotice && (
        <UpdateDialog
          detail={`Nova ${updateNotice.latest} · you have ${shortVersion(version)}`}
          prepare={async () => { do { await save(unsaved.current || data); } while (unsaved.current); }}
          onLater={() => setUpdateNotice(null)}
          install={(onProgress) => installUpdate(updateNotice, onProgress)}
        />
      )}
      {saveError && <div role="alert" className="fixed top-0 inset-x-0 z-[9999] p-4 bg-zinc-900 text-white">
        Changes not saved. Keep this tab open until you retry or export a backup.
        <button className="px-3 underline" onClick={() => save(unsaved.current || data).catch(() => {})}>Retry</button>
        <button className="px-3 underline" onClick={() => saveFile(backupName(), backupParts(data, version), "application/json").catch(() => showToast("Backup download failed", { tone: "warn" }))}>Export backup</button>
        {restoreRecovery.current && <button className="px-3 underline" onClick={() => saveFile(backupName(), backupParts(restoreRecovery.current, version), "application/json").catch(() => showToast("Backup download failed", { tone: "warn" }))}>Export data from before restore</button>}
      </div>}
      {/* textured backdrop everywhere but the chat, which has its own */}
      {(page !== "chat" || peek) && !sceneSet && <PageBackdrop appearance={ap} light={light} />}
      {/* the skin's layered scene, behind every screen (and behind a chat,
          sitting back, unless Look → Skin in chats is off) */}
      {sceneSet && <LayeredScene scenes={sceneSet.scenes} base={sceneSet.base} sceneId={ap.scenes?.[worn]} invert={worn === "nova" && light} />}
      {/* a skin's own background, behind every screen and behind
          a chat with no backdrop of its own; a picture of your own covers it */}
      {SkinBackground && behindChat && <SkinBackground dark={!light} paused={ap.bgPreset === "custom" && !!ap.bgImage && page !== "chat"} />}

      {/* The brand bar used to sit here. It was a fixed 56px of the screen
          spent restating the name of the app you are already inside, on a
          phone, above content that scrolls. Removed; the tab bar at the
          bottom already says where you are. */}

      {/* pages */}
      <div
        className="nv-page-host relative min-h-screen nv-safe-x"
        /* was 3.5rem of clearance for the brand bar; only the status bar
           inset is needed now, and the sides in landscape */
        onTouchStart={swipe.onTouchStart}
        onTouchMove={swipe.onTouchMove}
        onTouchEnd={swipe.onTouchEnd}
        onTouchCancel={swipe.onTouchCancel}
      >
        {/* The three tabs are pre-rendered and kept: the one showing is
            visible, the others are hidden by <Activity>, which keeps them
            built (switching is instant and keeps your place) while running
            none of their effects. Showing a tab replays its entry animation,
            since an animation restarts when an element is shown again. */}
        <Activity mode={shows("create") ? "visible" : "hidden"}>
          <div className={tabClass} ref={page === "create" ? pageEl : undefined}>
            <CreatePage
              data={createData}
              update={update}
              onEdit={pageActions.edit}
              startChat={pageActions.startChat}
              startGroupChat={pageActions.startGroupChat}
              openChat={pageActions.openFromCreate}
            />
          </div>
        </Activity>
        <Activity mode={shows("history") ? "visible" : "hidden"}>
          <div className={`${tabClass} nv-tab-history`} ref={page === "history" ? pageEl : undefined}>
            <Suspense fallback={<PageSkeleton />}>
              <HistoryPage data={desktop && page === "chat" ? data : historyData} update={update} openChat={pageActions.openFromHistory} activeId={drawer ? activeChatId : null} />
            </Suspense>
          </div>
        </Activity>
        {drawer && <div className="nv-drawer-scrim" onClick={() => setListOpen(false)} aria-hidden />}
        {/* the right of the Chats list on a wide window, before a chat is open */}
        {split && page === "history" && (
          <div className="nv-split-empty" aria-hidden>
            <NovaMark size={34} />
            <p className="nv-label">Pick a chat</p>
          </div>
        )}
        <Activity mode={shows("settings") ? "visible" : "hidden"}>
          <div className={tabClass} ref={page === "settings" ? pageEl : undefined}>
            <Suspense fallback={<PageSkeleton />}>
              <SettingsPage data={settingsData} update={update} />
            </Suspense>
          </div>
        </Activity>
        {page === "chat" && (
          <Suspense fallback={<ChatSkeleton />}>
            <ChatPage
              data={data}
              chatId={activeChatId}
              update={update}
              goBack={goBackFromChat}
              goSettings={() => navigate("close", () => setPage("settings"))}
              openChat={(id) => setActiveChatId(id)}
              onEdit={pageActions.edit}
              onToggleList={drawer ? () => setListOpen((v) => !v) : undefined}
              listOpen={listOpen}
              plain={plainChat ? (light ? "light" : "dark") : undefined}
            />
          </Suspense>
        )}
      </div>

      {/* The dock: a floating instrument strip the pages scroll under. A
          block of accent slides to the current tab, with a hairline beam
          along its top edge. */}
      {(page !== "chat" || desktop) && (
        <nav className="nv-nav" aria-label="Main navigation">
          <div className="nv-dock nv-nav-dock nv-hair">
          <div className="nv-rail-brand"><NovaMark size={26} /></div>
          <div className="nv-nav-inner" ref={navigationRef}>
            <span className="nv-nav-marker" aria-hidden />
            <span className="nv-nav-trail" aria-hidden />
            {navItems.map(n => { const here = page === n.id || (page === "chat" && n.id === "history"); return <button key={n.id} onClick={() => goTab(n.id)} aria-current={here ? "page" : undefined}>
              <n.icon size={20} strokeWidth={here ? 1.9 : 1.5} /><span>{n.label}</span>
              {n.id === "settings" && needsKey && <span className="nv-nav-badge nv-beacon" role="img" aria-label="Provider setup needed" />}
            </button>; })}
          </div>
          </div>
        </nav>
      )}

      {/* create / edit modals */}
      {editing && (
        <Suspense fallback={<ScreenSkeleton />}>
          {editing.type === "personas" && (
            <PersonaForm initial={editing.item} dirtyRef={formDirty} settings={data.settings} onSave={(f) => saveEntity("personas", f)} onSettings={patchSettings} onClose={() => setEditing(null)} />
          )}
          {editing.type === "characters" && (
            <CharacterForm initial={editing.item} dirtyRef={formDirty} settings={data.settings} onSave={(f) => saveEntity("characters", f)} onSettings={patchSettings} onClose={() => setEditing(null)} />
          )}
          {editing.type === "lorebooks" && (
            <LorebookForm initial={editing.item} onSave={(b) => saveEntity("lorebooks", b)} onClose={() => setEditing(null)} />
          )}
          {editing.type === "universes" && (
            <UniverseForm initial={editing.item} dirtyRef={formDirty} existingCharacters={data.characters} settings={data.settings} onSave={(f) => saveEntity("universes", f)} onSettings={patchSettings} onClose={() => setEditing(null)} />
          )}
        </Suspense>
      )}

      <ChatDataSource data={data} />
      <div className="nv-top">
      <ActivityIsland canOpen={(job) => !!(job.owner?.chatId || ["characters", "personas", "universes"].includes(job.owner?.cardKind))} onOpen={(job) => {
        if (["characters", "personas", "universes"].includes(job.owner?.cardKind)) {
          /* the job's own card: the one being rewritten, or a new one */
          const type = job.owner.cardKind;
          const itemId = job.owner.itemId || null;
          const open = editingRef.current;
          const detail = { kind: type, itemId };
          if (open?.type === type && (open.item?.id || null) === itemId) {
            window.dispatchEvent(new CustomEvent("nova-card-studio", { detail }));
            return;
          }
          /* another form is open: its edits are not thrown away unasked */
          const unsaved = open && (open.type === "lorebooks" || formDirty.current);
          if (unsaved && !window.confirm("Leave this form? Its unsaved changes will be lost.")) return;
          const item = itemId ? (data[type] || []).find((x) => x.id === itemId) || null : null;
          if (itemId && !item) { showToast("That card is gone. Its draft is still on the island."); return; }
          requestActivityOpen(job.id);
          setEditing({ type, item });
          window.dispatchEvent(new CustomEvent("nova-card-studio", { detail }));
          return;
        }
        const id = job.owner?.chatId;
        if (id) {
          if (page === "chat") setActiveChatId(id);
          else openChatFrom(page, id);
        }
      }} />
      <Toasts scene={page} />
      </div>
    </div>
  );
}
