import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, RefreshCw, X } from "lucide-react";
import { enter, MOTION, tween } from "../motion/runtime.js";
import { Button, useBackLayer } from "../ui.jsx";
import { looseAnchorOf } from "../../lib/anchor.js";
import { sceneHead, visibleLog } from "../../lib/memory.js";
import { YOU, handsetOf, phoneAccounts, setLevel, setRefreshStep, slug, unread, visiblePhone } from "../../lib/phone.js";
import { showToast } from "../../lib/toast.js";
import { REFRESH_STEPS, clockOf, timeLabel } from "../../lib/phoneClock.js";
import { toLayout } from "../../lib/uiScale.js";
import { scopeOf } from "../../lib/scope.js";
import { PhoneHome } from "./PhoneHome.jsx";
import { ProfilePage } from "./AccountSheet.jsx";
import { PhoneAvatar, StepMenu } from "./parts.jsx";
import { usePhoneBusy } from "./usePhoneTick.js";
import { ageLabel, phoneWrites, shownStats } from "./social.js";
import { Murmur } from "./apps/Murmur.jsx";
import { StoryViewer } from "./apps/Stories.jsx";
import { Messages } from "./apps/Messages.jsx";
import { Gallery } from "./apps/Gallery.jsx";
import { NotificationsPage } from "./Notifications.jsx";
import { PhoneSettings } from "./PhoneSettings.jsx";
import { Bank } from "./apps/Bank.jsx";
import { World } from "./apps/World.jsx";

const overlayRoute = (r) => !!r && r.app === "murmur" && !!r.story;
/* a route's place in the scroll memory: what it shows, not how it was opened */
const routeKey = (r) => JSON.stringify({ ...r, focus: undefined, comments: undefined });
/* the steps as the menu shows them: "Sync", "15m", "1h", "3h", "1d" */
export const PHONE_STEPS = REFRESH_STEPS.map((s) => ({ ...s, short: s.id === "sync" ? "Sync" : timeLabel(s.min) }));
const APP_TITLES = { murmur: "Murmur", messages: "Messages", gallery: "Gallery", bank: "Bank", settings: "Settings", notifications: "Notifications", world: "World" };

/* ---------- the persona's phone ----------

   An overlay over the chat: a full-height sheet on a phone-sized screen, a
   device in the middle of a scrim on a wider one. It keeps its own small
   stack (home, an app, a post, a thread or a profile page); back (hardware, gesture,
   Escape) goes up one level and closes from home, through the same back
   stack as the app's sheets (useBackLayer), which also makes everything
   behind it inert while it is on top.

   It never writes app data itself: `onHandset(fn)` patches the chat with
   `fn(handset, chat)`, `onSettings(patch)` the settings; `tick` asks the
   chat's phone job (usePhoneTick: now, later, refresh, more, setup). The
   first fill is the setup, which only runs from its card (SetupCard: the
   phone is on but not set up); nothing seeds or refreshes by itself.
   Refresh (a step of time, or Sync to chat) is on the home screen's top
   row; opening the phone asks for DM answers that came due meanwhile
   (tick.checkDue). The chat never renders it while it is off (ChatPage
   offers "Turn phone on"); Off in its Settings closes it first (turnOff).
   Every persona write goes through phoneAct (social.js), so the phone
   works in an empty chat and its clock moves with what the persona does.
   A route may carry
   `focus: true` (it was opened by a tap meant to type: Reply, Message,
   Quote), and its field focuses as it mounts, inside that tap, so Android
   brings up the keyboard. */
export function Phone({ chat, data, persona, userName, character, ensemble, universe, onHandset, onSettings, tick, onPreview, onClose }) {
  const h = useMemo(() => handsetOf(chat), [chat.handset]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = useMemo(() => visiblePhone(h, chat.messages), [h, chat.messages]);
  const counts = useMemo(() => unread(h, chat.messages, { userName }), [h, chat.messages, userName]);
  const accounts = useMemo(
    () => phoneAccounts({ chat, character, ensemble, universe, userName }),
    [chat.handset, chat.scope, character, ensemble, universe, userName] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const busy = usePhoneBusy(chat.id);
  const empty = !v.posts.length && !Object.keys(v.threads).length;

  const avatarOf = useCallback((key) => {
    if (key === YOU) return persona?.avatar || null;
    const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    if (kind === "char") return data.characters.find((c) => c.id === id)?.avatar || null;
    if (kind === "uni") return universe?.characters?.find((c) => (c.id || slug(c.name)) === id)?.avatar || null;
    if (kind === "cast") return scopeOf(chat).cast.find((m) => m.id === id)?.avatar || null;
    return null;
  }, [persona, data.characters, universe, chat.scope]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- navigation ---- */
  const [stack, setStack] = useState([{ app: "home" }]);
  const route = stack.at(-1);
  const dir = useRef(1);
  const root = useRef(null);
  const device = useRef(null);
  const scrim = useRef(null);
  const page = useRef(null);
  const closing = useRef(false);
  /* one level deep per app: home, the app, one page; a page opened from a page takes its place */
  /* a page opened forward starts at its top (before it renders, so its own
     layout effects, a thread scrolled to its newest line, win); back
     restores where the page was (prefs.scroll, per route) */
  const top = (r) => { if (!overlayRoute(r) && page.current) page.current.scrollTop = 0; };
  const open = useCallback((r) => { dir.current = 1; top(r); setStack((s) => (s.length >= 3 ? [...s.slice(0, 2), r] : [...s, r])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const replace = useCallback((r) => { dir.current = 1; top(r); setStack((s) => [...s.slice(0, -1), r]); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* `after` runs once the phone has gone (turning it off: the level
     changes after the exit, so the phone is not cut off mid-tween) */
  const leave = (instant, after) => {
    if (closing.current) return;
    closing.current = true;
    const done = () => { onClose(); after?.(); };
    if (instant) { done(); return; }
    tween(scrim.current, { opacity: 0, duration: MOTION.exit });
    tween(device.current, { opacity: 0, y: 28, duration: MOTION.exit, ease: MOTION.leave, onComplete: done });
  };
  const back = ({ instant } = {}) => {
    if (stack.length > 1) { dir.current = -1; setStack((s) => s.slice(0, -1)); }
    else leave(instant);
  };
  useBackLayer(back, () => root.current);
  /* A tap on a text field focuses it, so the Android keyboard always comes
     up (nothing in the phone or above it may have kept the focus away). No
     scrolling here, while the keyboard is still opening: once it is up
     (html[data-kb="1"], keyboard.js) the page scrolls the field into view. */
  const focusField = (e) => {
    const el = e.target;
    if (!el?.matches?.('input:not([type="file"]):not([type="checkbox"]):not([type="radio"]),textarea') || el.disabled || el.readOnly) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
  };
  useEffect(() => {
    const html = document.documentElement;
    if (typeof MutationObserver === "undefined") return undefined;
    const watch = new MutationObserver(() => {
      if (html.dataset.kb !== "1") return;
      const el = document.activeElement;
      const sc = page.current;
      if (!el || !sc?.contains(el)) return;
      const r = el.getBoundingClientRect();
      const box = sc.getBoundingClientRect();
      if (r.bottom > box.bottom) sc.scrollTop += toLayout(r.bottom - box.bottom) + 12;
      else if (r.top < box.top) sc.scrollTop -= toLayout(box.top - r.top) + 12;
    });
    watch.observe(html, { attributes: true, attributeFilter: ["data-kb"] });
    return () => watch.disconnect();
  }, []);

  /* while the phone is open the top stack (island, toasts) sits below its top row */
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.phone = "1";
    return () => { delete html.dataset.phone; };
  }, []);
  /* DM answers that came due while the person was chatting */
  useEffect(() => { tick?.checkDue?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    enter(scrim.current, { y: 0, duration: MOTION.feedback });
    enter(device.current, { y: 32, scale: 0.98 });
    const was = document.activeElement;
    root.current?.focus({ preventScroll: true });
    return () => { if (was?.isConnected && !was.closest?.("[inert]")) was.focus?.({ preventScroll: true }); };
  }, []);
  const depth = stack.length;
  const firstPage = useRef(true);
  const lastRoute = useRef(route);
  useLayoutEffect(() => {
    const was = lastRoute.current;
    lastRoute.current = route;
    if (firstPage.current) { firstPage.current = false; return; }
    /* a story opens over the page and leaves it as it was */
    if (overlayRoute(route) || overlayRoute(was)) return;
    if (page.current && dir.current < 0) page.current.scrollTop = prefs.scroll?.[routeKey(route)] || 0;
    enter(page.current, { x: dir.current * 28, y: 0, duration: MOTION.feedback });
  }, [depth, route]);

  /* ---- what the apps share ---- */
  const level = h.level;
  const messages = chat.messages;
  const byId = useMemo(() => new Map(v.posts.map((p) => [p.id, p])), [v.posts]);
  /* loose: the persona's items stay through a swipe or regenerate of the last reply */
  const anchorIn = useCallback((c) => looseAnchorOf(c?.messages?.at(-1)), []);
  const write = useMemo(() => phoneWrites({ act: onHandset, tick, anchorIn }), [onHandset, tick, anchorIn]);
  /* the persona's world events written in this opening, shown until the log has them */
  const [worldDrafts, setWorldDrafts] = useState([]);
  const addWorldDraft = (text) => setWorldDrafts((d) => [{ id: `draft${Date.now()}${d.length}`, text }, ...d]);
  /* choices kept while the phone is open (the feed's and the replies' sort) */
  const prefs = useRef({}).current;
  /* on, but not set up yet: the setup card stands in for the apps */
  const needsSetup = level !== "off" && !h.tick?.seeded;
  /* Refresh moves the phone's clock by the chosen step (a time skip: what
     happened meanwhile), or with Sync catches the phone up with the chat;
     its slots show at once, until the job answers */
  const step = clockOf(h).step;
  const syncing = step === "sync";
  const syncCount = syncing ? Number(tick?.syncPending) || 0 : 0;
  const stepLabel = REFRESH_STEPS.find((s) => s.id === step)?.label || step;
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    if (busy || refreshing) return;
    setRefreshing(true);
    Promise.resolve().then(() => (tick.refresh ? tick.refresh(step) : tick.now?.())).catch(() => {}).finally(() => setRefreshing(false));
  };
  const remember = () => {
    if (!page.current || overlayRoute(route)) return;
    (prefs.scroll ||= {})[routeKey(base)] = page.current.scrollTop;
  };
  const ctx = {
    h, v, accounts, avatarOf, busy, tick, onPreview, onSettings, refreshing, prefs, worldDrafts, addWorldDraft, needsSetup,
    worldLog: visibleLog(chat),
    sceneWhen: sceneHead(chat.scene?.text).when,
    unread: counts,
    settings: data.settings,
    chatId: chat.id,
    messages,
    act: onHandset,
    anchorIn,
    /* Off in Settings: the phone leaves, then the level goes to off */
    turnOff: () => leave(false, () => {
      onHandset((x) => setLevel(x, "off"));
      showToast("Phone off for this chat. Tap the phone icon to turn it on.");
    }),
    open, replace, back: () => back(),
    /* a profile page; not again on top of the same one */
    openAccount: (key) => { if (!(route.app === "profile" && (route.account || YOU) === key)) open({ app: "profile", account: key }); },
    /* the feed: shown counts (phoneStats over the story clock), ages, lookups */
    postById: (id) => byId.get(id) || null,
    statsOf: (post) => shownStats(post, messages, v.posts, h),
    ageLabel: (item) => ageLabel(item, messages, h),
    /* the persona's local writes (like, repost, reply, quote, post, story, dm) */
    write,
    /* the last batch failed: the feed shows "Couldn't update" with Retry */
    error: h.tick.error || tick?.error || null,
    /* nothing is on the phone yet and its job is running: a seed is coming */
    waiting: empty && busy,
    emptyText: "Nothing new yet.",
  };

  const head = sceneHead(chat.scene?.text);
  /* a story opens over the screen below it, which stays */
  const base = [...stack].reverse().find((r) => !overlayRoute(r)) || { app: "home" };
  const story = route.app === "murmur" && route.story ? route.story : null;
  const title = base.app === "messages" && base.thread ? accounts.nameOf(base.thread)
    : base.app === "messages" && base.pick ? "New message"
    : base.app === "murmur" && base.post ? "Post"
    : base.app === "murmur" && base.quote ? "Quote"
    : base.app === "murmur" && base.compose === "story" ? "Your story"
    : base.app === "profile" ? accounts.nameOf(base.account || YOU)
    : base.app === "bank" && (base.pick || base.to) ? "Send money"
    : APP_TITLES[base.app] || "Home";
  /* Refresh and its step, in the top row of the home screen */
  const homeTop = base.app === "home" && depth === 1 && !needsSetup && level !== "off";

  let screen;
  if (base.app === "murmur") screen = <Murmur ctx={ctx} route={base} />;
  else if (base.app === "messages") screen = <Messages ctx={ctx} thread={base.thread} pick={base.pick} focus={!!base.focus} />;
  else if (base.app === "gallery") screen = <Gallery ctx={ctx} messages={chat.messages} />;
  else if (base.app === "bank") screen = <Bank ctx={ctx} route={base} />;
  else if (base.app === "settings") screen = <PhoneSettings ctx={ctx} />;
  else if (base.app === "world") screen = <World ctx={ctx} />;
  else if (base.app === "notifications") screen = <NotificationsPage ctx={ctx} />;
  else if (base.app === "profile") screen = <ProfilePage key={base.account || YOU} ctx={ctx} accountKey={base.account || YOU} />;
  else screen = <PhoneHome ctx={ctx} />;

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={`${userName}'s phone`}
      tabIndex={-1}
      data-noswipe
      data-testid="phone"
      onClick={focusField}
      className="nv-screen nv-kb nv-safe-x fixed inset-0 z-50 flex items-center justify-center outline-none"
      style={{ background: "transparent" }}
    >
      <div ref={scrim} aria-hidden className="absolute inset-0 hidden min-[480px]:block" style={{ background: "var(--nv-scrim)" }} onClick={() => leave(false)} />
      <div
        ref={device}
        className="nv-ios-device relative flex flex-col w-full h-full overflow-hidden min-[480px]:w-[390px] min-[480px]:h-[800px] min-[480px]:max-h-[calc(100%-2rem)]"
        style={{ background: "var(--nv-bg)", color: "var(--nv-ink)" }}
      >
        <span aria-hidden className="nv-ios-island hidden min-[480px]:block" />
        {/* the one top row: back (every page but home), whose phone (a
            button to the persona's profile), the story's time and place,
            Refresh with its step on the home screen, and Close. No app bar:
            the page's name is for screen readers only. */}
        <div className="nv-ios-bar relative shrink-0 flex items-center gap-2 pl-2 pr-3 h-12 text-[12px] text-zinc-400" style={{ marginTop: "var(--sa-t)" }}>
          {depth > 1 && (
            <button
              type="button"
              onClick={() => back()}
              aria-label="Back"
              className="nv-ios-back flex items-center shrink-0 min-h-10 pr-1 text-[17px] text-zinc-100"
              data-testid="phone-back"
            >
              <ChevronLeft size={28} strokeWidth={2.2} aria-hidden className="-mr-1" />
            </button>
          )}
          {depth <= 1 && (
          <button
            type="button"
            onClick={() => ctx.openAccount(YOU)}
            aria-label="Your profile"
            data-testid="phone-you"
            className="flex items-center gap-2 min-w-0 min-h-10 rounded-full pr-2 pl-2"
          >
            <PhoneAvatar src={persona?.avatar} name={userName} size={18} />
            <span className="font-semibold text-[14px] text-zinc-100 truncate">{userName}</span>
          </button>
          )}
          {depth > 1 && base.app !== "settings"
            ? <h2 className="nv-ios-title absolute left-1/2 -translate-x-1/2 text-[17px] font-semibold text-zinc-100 truncate max-w-[45%] pointer-events-none">{title}</h2>
            : <h2 className="sr-only">{title}</h2>}
          <span className="flex-1" />
          {depth <= 1 && (head.when || head.place) && (
            <span className="truncate min-w-0 max-w-[40%]" data-testid="phone-scene">{[head.when, head.place].filter(Boolean).join(" · ")}</span>
          )}
          {busy && <span role="status" aria-label="Updating" className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--nv-ink)" }} />}
          {homeTop && (
            <StepMenu steps={PHONE_STEPS} value={step} onChange={(id) => onHandset((x) => setRefreshStep(x, id))} label="Refresh step" />
          )}
          {homeTop && (
            <span className="relative inline-flex shrink-0">
              <Button
                type="button"
                variant="icon"
                icon={RefreshCw}
                onClick={refresh}
                disabled={busy || refreshing}
                aria-busy={refreshing || undefined}
                aria-label={syncing ? `Sync to chat, ${syncCount} new in the chat` : `Refresh, ${stepLabel} later`}
                className="text-zinc-300 [--nv-btn-icon:17px]"
                data-motion="spin"
                data-testid="phone-refresh"
              />
              {syncCount > 0 && (
                <span
                  data-testid="phone-sync-count"
                  aria-hidden
                  className="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full text-[9px] font-semibold leading-4 text-center tabular-nums pointer-events-none"
                  style={{ background: "var(--nv-ink)", color: "var(--nv-bg)" }}
                >
                  {syncCount > 9 ? "9+" : syncCount}
                </span>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={() => leave(false)}
            aria-label="Close phone"
            className="nv-ios-close shrink-0 flex items-center justify-center"
            data-testid="phone-close"
          >
            <X size={16} strokeWidth={2.6} aria-hidden />
          </button>
        </div>
        <div ref={page} onScroll={remember} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain" style={{ paddingBottom: "var(--sa-b)" }} data-route={base.app}>
          {screen}
        </div>
        {story && <StoryViewer key="story-viewer" ctx={ctx} owner={story} comments={route.comments || null} />}
      </div>
    </div>
  );
}
