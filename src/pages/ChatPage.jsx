import { MOTION, tween } from "../components/motion/runtime.js";
import { anchorTranscript } from "../lib/keyboard.js";
import { toLayout } from "../lib/uiScale.js";
import { chatAppearance } from "../components/chatAppearance.js";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookMarked, Brain, PanelLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FastForward, Gauge, GitBranch, Globe, Image as ImageIcon, Languages, ListX, MoreVertical, Palette, Pencil, Play, Plus, RefreshCw, Reply, Send, Settings as Cog, Smartphone, SlidersHorizontal, Square, StickyNote, Trash2, User, Volume2, VolumeX, Wand2, X, Zap } from "lucide-react";
import { BookmarksModal } from "../components/BookmarksModal.jsx";
import { ImageGenModal } from "../components/ImageGenModal.jsx";
import { QuickRepliesStrip, QuickRepliesManager, SendAsModal } from "../components/QuickReplies.jsx";
import { RP } from "../components/RP.jsx";
import { StyleChips } from "../components/StylePicker.jsx";
import { ChatBackdrop, Texture } from "../components/backdrops.jsx";
import { CyclingAvatar } from "../components/CyclingAvatar.jsx";
import { useLongPress, useMultiTap } from "../components/gestures.js";
import { ModelPicker, useEndpointLabel } from "../components/models.jsx";
import { ThemeSection } from "../components/theme.jsx";
import { AccBtn, ActionMenu, Button, Modal, Pic, ScrollTabs, TextArea, useBackLayer, selStyle } from "../components/ui.jsx";
import { providerOf, short } from "../lib/api.js";
import { fileSafe, fillNames, saveFile } from "../lib/cards.js";
import { chatToJsonl } from "../lib/chatFile.js";
import { DEFAULT_AUTHORS_NOTE, DEFAULT_HISTORY_TOKENS, addBookmark, bgListOf, castBgListOf, createChatBranch, greetingsOf, removeBookmark, themeOf } from "../lib/data.js";
import { activeSummary, afterDeleting, cleanNote, keepIfCovered, memoryConflicts, memoryCovered, memoryOffEverywhere, sceneHead } from "../lib/memory.js";
import { MemoryConflict } from "../components/MemoryConflict.jsx";
import { buildSceneVisualPrompt } from "../lib/imageGen.js";
import { runMacros } from "../lib/macros.js";
import { executeSlashCommand, isSlashCommand, parseSlashCommand, suggestSlashCommands } from "../lib/slash.js";
import { breakdownTokens, formatTokens } from "../lib/tokens.js";
import { translateText } from "../lib/translate.js";
import { canSpeak, speak, speechOptions, speechProblem, stopSpeech } from "../lib/tts.js";
import { activePreset, genParams, styleLabel, thinkingOn, withThinking } from "../lib/styles.js";
import { DEFAULT_LORE_BUDGET, DEFAULT_SCAN_DEPTH, chatBooks, entryLabel, selectLore } from "../lib/lore.js";
import { castMember, ensembleOf, ensembleTitle, leadNames, linkedCards, replySpeakers, scopeCandidates, scopeOf } from "../lib/scope.js";
import { ScopeSheet, ScopeStrip } from "../components/Scope.jsx";
import { WorldSheet, timeOf } from "../components/WorldSheet.jsx";
import { editMessage, showSwipe, swipeIndex, swipeList } from "../lib/swipes.js";
import { RP_SPAN, hideNotes, notesOf, tidyRP } from "../lib/text.js";
import { uid } from "../lib/util.js";
import { undoToast, showToast } from "../lib/toast.js";
import { restoreList } from "../lib/undo.js";
import { getAppChatData } from "./chat/appData.jsx";
import { Composer } from "./chat/Composer.jsx";
import { MessageRow } from "./chat/MessageRow.jsx";
import { StreamingBubble } from "./chat/StreamingBubble.jsx";
import { createStreamStore, useStream, useStableActions } from "./chat/streamStore.js";
import { useFollow } from "./chat/follow.js";
import { NotesTab } from "./chat/NotesTab.jsx";
import { PersonaTab } from "./chat/PersonaTab.jsx";
import { removeWithUndo } from "../lib/removal.js";

import { activity, cancelWhere, takeActivityResult, useActivity, useActivityFocus } from "../lib/activity.js";
import { retryRun, startReply, startChatSide, waitForReply } from "./chat/replyJob.js";
import { Phone } from "../components/phone/Phone.jsx";
import { usePhoneTick } from "../components/phone/usePhoneTick.js";
import { handsetOf, keepPhoneOnDelete, phoneAccounts, phoneNote, setLevel, unread as phoneUnreadOf } from "../lib/phone.js";
import { messageStamp, phoneGapOf, phoneNow, spanLabel, timeLabel } from "../lib/phoneClock.js";
import { visibleLog as phoneWorldLog } from "../lib/memory.js";

export { MessageImages, rpHtml, rpText } from "./chat/bubbles.jsx";
import { isVideo } from "../lib/video.js";

/* ============================================================
   chat
   ============================================================ */


/* The not-found case is answered here, before any hooks run, so the chat
   view below always calls the same hooks in the same order — returning early
   from inside it would change their count the moment a chat was deleted while
   open, which React treats as a crash. */
export function ChatPage(props) {
  const [currentId, setCurrentId] = useState(props.chatId);
  useEffect(() => {
    setCurrentId(props.chatId);
  }, [props.chatId]);

  const activeId = props.chatId || currentId;
  const chat = props.data.chats.find((c) => c.id === activeId);
  if (!chat) {
    return (
      <div className="max-w-2xl mx-auto px-4 pt-16 text-center text-sm text-zinc-500">
        Chat not found.
        <Button variant="ghost" onClick={props.goBack} className="mx-auto mt-3" style={{ color: "var(--acc)" }}>Go back</Button>
      </div>
    );
  }
  const handleOpenChat = (id) => {
    setCurrentId(id);
    if (props.openChat) props.openChat(id);
    if (props.onOpenChat) props.onOpenChat(id);
  };
  return <ChatView key={activeId} {...props} chatId={activeId} openChat={handleOpenChat} />;
}



function ChatView({ data, chatId, update, goBack, goSettings, openChat, onEdit, onToggleList, listOpen, plain }) {
  const chat = data.chats.find((c) => c.id === chatId);
  const isUni = chat?.kind === "universe";
  const universe = isUni ? data.universes.find((u) => u.id === chat?.universeId) : null;
  const character = !isUni ? data.characters.find((c) => c.id === chat?.characterId) : null;
  /* your other characters in the Scope cast, whose whole cards are sent
     (scope.js linkedCards); none while Scope is off */
  const ensemble = useMemo(
    () => (character ? ensembleOf(chat, data.characters) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [character, chat?.scope, data.characters]
  );
  const persona = data.personas.find((p) => p.id === chat?.personaId);
  /* lorebooks in play: the cards' own, then the ones attached to this chat */
  const books = chatBooks({ chat, character, ensemble, universe, lorebooks: data.lorebooks });
  /* Bubble colours and backdrop belong to whoever you are talking to: the
     universe, or the chat's own character (the host, with an ensemble). */
  const theme = themeOf(isUni ? universe : character);
  const userName = persona?.name || data.username || "You";

  const [lightboxUrl, setLightboxUrl] = useState(null);
  /* the message box owns the draft (chat/Composer.jsx); this reaches it */
  const composerRef = useRef(null);
  const [speakingMsgId, setSpeakingMsgId] = useState(null);

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, [chatId]);
  /* ---------- Nova Scope (see scope.js) ----------
     Every kind of chat. With it off, nothing below runs and the chat is
     exactly the plain chat it always was. */
  const sc = useMemo(() => scopeOf(chat), [chat.scope]);
  const scopeActive = sc.mode !== "off";
  /* the people this chat already has: never side characters */
  const leads = isUni ? universe?.characters || [] : character ? [character] : [];
  /* names that are never offered as side characters: the leads, and in a
     universe the world and its places too */
  const notCast = isUni ? [...leads, universe?.name, ...(universe?.locations || []).map((l) => l.name)] : leads;
  const [showScope, setShowScope] = useState(false);
  /* the persona's phone (components/phone) */
  const [showPhone, setShowPhone] = useState(false);
  /* tapped while the phone is off for this chat: the offer to turn it on */
  const [phoneOffMenu, setPhoneOffMenu] = useState(false);
  /* a universe's World sheet (WorldSheet.jsx), opened from the strip */
  const [showWorld, setShowWorld] = useState(false);
  /* people found in the story, for the cast strip and the sheet. A regex
     pass over the recent story, so it runs when the story changes, not on
     every render. */
  const notCastKey = leadNames(notCast).join("\u0001");
  const castCandidates = useMemo(
    () => (scopeActive || showScope ? scopeCandidates(chat, notCast, userName) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat.messages, chat.scope, notCastKey, userName, scopeActive, showScope]
  );
  const dataRef = useRef(data);
  dataRef.current = data;
  const getData = () => getAppChatData() || dataRef.current;
  /* the running reply's stream store, not the job: the job is replaced on
     every percent and phase patch, and the whole view would re-render with it */
  const focusedReplyId = useActivity(a => a.findLast(j => j.owner.chatId === chatId && j.kind === "reply")?.id);
  useActivityFocus(focusedReplyId);
  const replyStream = useActivity(a => a.find(j => j.owner.chatId === chatId && j.kind === "reply" && j.status === "running")?.stream || null);
  const replyJob = !!replyStream;
  const draftJob = useActivity(a => a.find(j => j.owner.chatId === chatId && j.kind === "reply" && j.result?.draft !== undefined));
  const [idleStream] = useState(createStreamStore);
  const stream = replyStream || idleStream;
  const impersonating = !!replyJob && stream.get().kind === "impersonate";
  const streaming = !!replyJob && !impersonating;
  const isThinking = useStream(stream, "isThinking") || false;
  useEffect(() => {
    if (!impersonating) return;
    const paintDraft = () => {
      const draft = stream.get().draft;
      if (draft !== undefined) composerRef.current?.setDraft(draft);
    };
    paintDraft();
    return stream.subscribe(paintDraft);
  }, [impersonating, stream]);
  useEffect(() => {
    if (!draftJob) return;
    const result = takeActivityResult(draftJob.id);
    if (result) composerRef.current?.setDraft(result.draft);
  }, [draftJob]);
  /* true while the scene is playing on by itself */
  const chainOn = useStream(stream, "chainOn") || false;
  const paused = useStream(stream, "paused") || false;
  /* a message sent while the scene was playing: it goes out the moment the
     reply in progress is stopped and saved */
  const queuedSend = useRef(null);
  /* the newest SillyTavern variables written for this chat, { id, vars } */
  const varsRef = useRef(null);
  /* the name being described right now, for the chip's pulse */
  const describing = useActivity(a => a.find(j => j.owner.chatId === chatId && j.kind === "describe" && j.status === "running")?.stream?.get().describing);
  const scopeBusy = useRef(false);
  /* the active prompt's display regex (html.js); empty for every prompt
     but an imported SillyTavern preset that has some */
  const display = useMemo(() => {
    const rules = genParams(data.settings).display || [];
    /* patterns that name {{user}} or {{char}} are filled from this chat */
    return rules.some((r) => r.sub) ? Object.assign([...rules], { ctx: { user: userName, char: character?.name || universe?.name } }) : rules;
  }, [data.settings, userName, character?.name, universe?.name]);
  const scopeSettings = scopeActive && !(data.settings.sceneEvery > 0) ? { ...data.settings, sceneEvery: 2 } : data.settings;
  const [thinkOpen, setThinkOpen] = useState(false);
  const error = chat.lastError;
  const setError = lastError => update(d => ({ ...d, chats: d.chats.map(c => c.id === chatId ? { ...c, lastError, lastErrorRetry: null } : c) }));
  /* a short line that says where an export went; clears itself */
  const [notice, setNotice] = useState(null);
  /* For screen readers: the streaming list is not announced token by token,
     so say once, politely, that a reply is done. */
  const [replyDone, setReplyDone] = useState("");
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (streaming) { wasStreaming.current = true; setReplyDone(""); return; }
    if (!wasStreaming.current) return;
    wasStreaming.current = false;
    const last = chat?.messages?.findLast?.((m) => m.role === "assistant");
    const who = last?.speaker || character?.name || universe?.name || "";
    setReplyDone(who ? `Reply from ${who} finished.` : "Reply finished.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  /* who leads the next reply, picked from the cast strip for one reply:
     { id, name, characterId? } or { id: "narrator", narrator: true } */
  const [lead, setLead] = useState(null);
  /* whoever leads the reply being written */
  const streamSpeaker = useStream(stream, "streamSpeaker");
  /* the message a new version is being written for, hidden meanwhile */
  const swipingId = useStream(stream, "swipingId");
  /* the reply being continued in place (Continue on a message) */
  const continuingId = useStream(stream, "continuingId");
  /* writing your next message for you: the stream lands in the draft */
  const [sendAs, setSendAs] = useState({ type: "user", id: null, name: "", lock: false });
  const [showSendAs, setShowSendAs] = useState(false);
  const [showQrManager, setShowQrManager] = useState(false);

  /* the chat's own settings sheet: "look" | "memory" while open */
  const [chatSettings, setChatSettings] = useState(null);
  /* "memory" | "scene" while a side request runs */
  const noteBusy = useActivity(a => a.find(j => j.owner.chatId === chatId && ["memory", "scene"].includes(j.kind) && j.status === "running")?.kind);
  /* the chat as of the latest render, for notes written after an await */
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const [menuMsg, setMenuMsg] = useState(null);   // message whose menu is open
  const longPress = useLongPress();               // touch access to that menu
  /* Editing happens in the bubble itself: the id of the message being
     edited, the width the bubble had (so it never shrinks), and where the
     double tap landed (so the cursor starts there). The text lives in the
     bubble's DOM while editing and is read back out on save. */
  const [inlineEdit, setInlineEdit] = useState(null); // { id, at, width }
  const lastTap = useRef(null);
  const [regenMsg, setRegenMsg] = useState(null); // { msg, text }
  const [confirm, setConfirm] = useState(null);   // { title, body, run }
  const [showStyle, setShowStyle] = useState(false);     // reply-style preset
  const [conflictAsked, setConflictAsked] = useState(null); // style id the overlap sheet was closed for
  const [showModelPick, setShowModelPick] = useState(false);
  const [showGreetings, setShowGreetings] = useState(false); // opening scenario sheet
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [bookmarkTarget, setBookmarkTarget] = useState(null);
  const [highlightMsgId, setHighlightMsgId] = useState(null);
  const [imageGenOpen, setImageGenOpen] = useState(false);
  const [imageGenPrompt, setImageGenPrompt] = useState("");
  /* the header's ⋮ menu and the composer's + menu */
  const [showComposerMenu, setShowComposerMenu] = useState(false);
  const [translations, setTranslations] = useState({});
  /* Built only while the Tokens tab is open: it assembles the whole request,
     which is too much to redo on every paint of a reply being continued. */
  const tokenMax = data.settings?.historyTokens || DEFAULT_HISTORY_TOKENS;
  const tokenBreakdown = useMemo(() => {
    if (chatSettings !== "tokens") return null;
    return breakdownTokens({
      character: isUni ? null : character,
      universe: isUni ? universe : null,
      ensemble,
      persona,
      username: userName,
      lorebooks: books,
      authorsNote: chat.authorsNote,
      vars: chat.vars,
      memory: chat.memory,
      scene: chat.scene,
      world: isUni ? phoneWorldLog(chat) : undefined,
      phone: phoneNote(chat, { userName, nameOf: phoneAccounts({ chat, character, ensemble, universe, userName }).nameOf }) || undefined,
      history: chat.messages,
      settings: data.settings,
      maxTokens: tokenMax,
    });
  }, [chatSettings, character, universe, isUni, ensemble, persona, userName, books, chat.authorsNote, chat.vars, chat.memory, chat.scene, chat.world, chat.handset, chat.messages, data.settings, tokenMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTranslate = useCallback(async (msg) => {
    const targetLang = data.settings?.translateTargetLang || "en";
    if (translations[msg.id]?.targetLang === targetLang && translations[msg.id]?.sourceText === msg.content) {
      setTranslations((prev) => {
        const next = { ...prev };
        delete next[msg.id];
        return next;
      });
      return;
    }

    setTranslations((prev) => ({
      ...prev,
      [msg.id]: { loading: true, targetLang, sourceText: msg.content },
    }));

    try {
      const res = await translateText(msg.content, { targetLang });
      setTranslations((prev) => ({
        ...prev,
        [msg.id]: {
          sourceText: msg.content,
          translatedText: res.translatedText,
          sourceLang: res.sourceLang || res.detectedLang || "auto",
          targetLang: res.targetLang || targetLang,
          loading: false,
        },
      }));
    } catch (err) {
      setTranslations((prev) => ({
        ...prev,
        [msg.id]: {
          error: "Translation failed: " + (err.message || "Network error"),
          loading: false,
        },
      }));
    }
  }, [translations, data.settings?.translateTargetLang]);

  /* "Translate new replies": the newest reply, once it has finished */
  const translatedReplies = useRef(new Set());
  useEffect(() => {
    const message = chat.messages.at(-1);
    if (!data.settings.translateReplies || message?.role !== "assistant" || streaming) return;
    const key = `${chatId}:${message.id}:${message.content}:${data.settings.translateTargetLang}`;
    if (translatedReplies.current.has(key)) return;
    translatedReplies.current.add(key);
    if (!translations[message.id] || translations[message.id].targetLang !== (data.settings.translateTargetLang || "en") || translations[message.id].sourceText !== message.content) toggleTranslate(message);
  }, [chatId, chat.messages, streaming, data.settings.translateReplies, data.settings.translateTargetLang, toggleTranslate, translations]);

  const scrollerRef = useRef(null);
  /* bumped only by send(), so nothing else can trigger a scroll */
  const [sendTick, setSendTick] = useState(0);

  /* The view is yours. It gets positioned once, when the chat opens, and is
     only adjusted for viewport height changes or when you send a message.
     Incoming replies never move the reader.

     useLayoutEffect rather than useEffect so the jump lands before the browser
     paints; doing it after paint shows a visible lurch down from the top of the
     conversation. Setting scrollTop on the scroller directly is also safer than
     scrollIntoView, which will happily scroll parent elements too.

     Keyed on chatId so switching chats re-anchors, but re-renders within the
     same chat (new messages, streaming tokens) do nothing. */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    /* rows off screen are laid out lazily (content-visibility), so the
       height can settle once the bottom ones are drawn: land again */
    const r = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(r);
  }, [chatId]);

  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (element) return anchorTranscript(element);
  }, [chatId]);

  /* while a reply is written, and only if you are at the end: glide after it */
  useFollow(scrollerRef, streaming || chainOn);

  /* Sending your own message is the one thing that moves the view.

     Keyed on a counter bumped inside send(), not on the message count, so an
     arriving reply cannot trigger it. React batches the message commit and this
     bump into one render, so by the time a layout effect runs the new message is
     already measured and scrollHeight includes it. */
  useLayoutEffect(() => {
    if (!sendTick) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sendTick]);

  // Chat requests stay active in background when navigated away; abort only on explicit Stop

  /* Several of your characters: the chat's own title (the name a group
     chat was given), or their names. A plain chat keeps its card's name. */
  const linkedHere = isUni ? [] : linkedCards(sc, data.characters, character?.id);
  /* The header shows each person's picture in a row while there are fewer
     five or fewer of them; from six on it shows the names instead. */
  const castPeople = isUni ? [] : [character, ...linkedHere].filter(Boolean);
  const castNames = castPeople.map((c) => c.name?.trim()).filter(Boolean);
  const castTitle = isUni
    ? universe?.name
    : castPeople.length > 5 ? castNames.join(", ") : ensembleTitle(castPeople) || character?.name;
  const title = (linkedHere.length && chat.title?.trim()) || castTitle;
  /* the header shows the chat's own name, or everyone in it, cut with …
     where it does not fit */
  const headTitle = (linkedHere.length && chat.title?.trim()) || (castPeople.length > 1 ? castPeople.map((c) => c.name).filter(Boolean).join(", ") : title);
  const headerAvatar = isUni ? universe?.avatar : character?.avatar;
  /* who the conversation is with, as far as names in notes go */
  const charLabel = castTitle;

  /* Functional, so a background note landing mid-reply is not overwritten by
     a reply that started before it — each write changes only its own field. */
  const patchChatWith = (fn) =>
    update((d) => ({ ...d, chats: d.chats.map((c) => (c.id === chatId ? fn(c) : c)) }));

  /* Replacing the messages also re-checks the notes: a chat cut back to
     before what a note covers keeps a note about things that never happened. */
  const commit = (messages) =>
    patchChatWith((c) => ({
      ...c,
      messages,
      updatedAt: Date.now(),
      memory: keepIfCovered(c.memory, messages),
      scene: keepIfCovered(c.scene, messages),
    }));

  /* change a field on this chat without touching its messages */
  const patchChat = (patch) => patchChatWith((c) => ({ ...c, ...patch }));

  const handleAddBookmark = ({ messageId, label }) => {
    patchChatWith((c) => addBookmark(c, { messageId, label }));
  };

  const handleDeleteBookmark = (bmId) => {
    let before = null;
    let after = null;
    patchChatWith((c) => { before = c.bookmarks || []; const next = removeBookmark(c, bmId); after = next.bookmarks || []; return next; });
    undoToast("Bookmark deleted", () => patchChatWith((c) => (before ? { ...c, bookmarks: restoreList(c.bookmarks, before, after) } : c)));
  };

  const handleJump = (bm) => {
    setShowBookmarks(false);
    setBookmarkTarget(null);
    const targetId = bm.messageId;
    setHighlightMsgId(targetId);
    setTimeout(() => {
      const el = document.getElementById(`msg-${targetId}`);
      if (el) {
        const scroller = scrollerRef.current;
        if (scroller) tween(scroller, { scrollTop: scroller.scrollTop + toLayout(el.getBoundingClientRect().top - scroller.getBoundingClientRect().top) - scroller.clientHeight / 2 + el.clientHeight / 2, duration: .24 });
      }
    }, 50);
    setTimeout(() => setHighlightMsgId(null), 2500);
  };

  /* The chat as a SillyTavern .jsonl (chatFile.js), saved to Downloads or,
     in the app, Documents/Nova. */
  const exportChat = async () => {
    try {
      const name = `${fileSafe(title || "chat")} ${new Date().toISOString().slice(0, 10)}.jsonl`;
      const where = await saveFile(name, chatToJsonl(chat, { user: userName, char: (isUni ? universe?.name : character?.name) || title || "Character" }), "application/jsonl");
      setNotice(`Saved to ${where}`);
    } catch (e) {
      setError(`Could not save the chat: ${e?.message || e}`);
    }
  };

  /* A new chat holding everything up to a message or a bookmark, opened
     straight away. */
  const handleBranch = (target, branchTitle) => {
    const isBm = target && typeof target === "object" && "messageId" in target;
    const messageId = isBm ? target.messageId : target?.id;
    const bookmark = isBm ? target : null;
    const baseTitle = title;

    const newChat = createChatBranch(chatRef.current, {
      messageId,
      bookmark,
      label: bookmark?.label,
      branchTitle: branchTitle?.trim() || undefined,
      baseTitle,
      characterName: character?.name,
    });

    if (!newChat) return;

    update((d) => ({ ...d, chats: [...(d.chats || []), newChat] }));

    setShowBookmarks(false);
    setBookmarkTarget(null);
    setMenuMsg(null);

    if (openChat) {
      openChat(newChat.id);
    }
  };

  const voicesSeen = useRef(new Map());
  /* the picture for a name said in a reply: one of the cards in this chat,
     a cast member, or one of the universe's characters */
  const picOf = (name) => {
    const n = String(name || "").trim().toLowerCase();
    const card = [character, ...linkedHere].find((c) => c?.name?.trim().toLowerCase() === n);
    if (card) return card.avatar || null;
    if (isUni) return universe?.characters.find((c) => c.name?.trim().toLowerCase() === n)?.avatar || null;
    const side = sc.cast.find((c) => c.name?.trim().toLowerCase() === n);
    return (side?.characterId ? data.characters.find((x) => x.id === side.characterId)?.avatar : null) || side?.avatar || null;
  };
  const avatarFor = (m) => {
    /* a reply with several voices: only theirs, one picture taking turns */
    if (m.role === "assistant" && (isUni || linkedHere.length || sc.cast.length)) {
      const names = replySpeakers(m.content);
      if (names.length > 1) {
        /* the same object while the voices and their pictures stay the same,
           so the memoised row is not drawn again for nothing */
        const people = names.map((name) => ({ name, src: picOf(name) }));
        const key = people.map((p) => `${p.name}\u0000${p.src?.length || 0}`).join("\u0001");
        const hit = voicesSeen.current.get(m.id);
        if (hit?.key === key) return hit.av;
        const av = { src: people.find((p) => p.src)?.src || null, name: names[0], people, label: names.join(", ") };
        voicesSeen.current.set(m.id, { key, av });
        return av;
      }
    }
    if (m.role === "system") return { src: null, name: m.speaker || "Narrator", isSystem: true };
    if (m.role === "user") return { src: null, name: userName };
    /* one of your characters, by id (a reply they led, or from a chat that
       was once a group chat), while the card exists */
    const own = m.speakerId ? data.characters.find((x) => x.id === m.speakerId) : null;
    if (own) return { src: own.avatar, name: own.name };
    if (isUni) {
      const c = universe?.characters.find((x) => x.name === m.speaker);
      if (c) return { src: c.avatar, name: c.name };
      return { src: universe?.avatar, name: universe?.name || "?" };
    }
    /* a side character who was given the reply */
    if (m.speaker && m.speaker !== character?.name) {
      const side = sc.cast.find((c) => c.name?.toLowerCase() === m.speaker?.toLowerCase());
      const card = side?.characterId ? data.characters.find((x) => x.id === side.characterId) : null;
      return { src: card?.avatar || side?.avatar || null, name: m.speaker };
    }
    return { src: character?.avatar, name: character?.name || "?" };
  };

  /* `swipeOf`: write a new version of that reply rather than a new reply.
     It is always the last message by the time this runs, and `history` is
     everything before it. */
  /* the lead is for one reply: it goes with the next one that starts */
  const generate = (history, opts = {}) => {
    /* a lead passed in (Go here: the narration) wins over the strip's pick */
    const next = startReply({ getData, update, chatId, history, opts: { ...(lead ? { lead } : {}), ...opts } });
    if (lead) setLead(null);
    return next;
  };
  const runNotes = (messages, opts) => startChatSide({ getData, update, chatId, messages, opts });
  /* the phone: a tick asked for after the persona's own actions, debounced
     (usePhoneTick), and what is new on it for the composer's button */
  const phoneTick = usePhoneTick({ chatId, getData, update });
  /* nothing on the phone runs by itself on open or mount: its first fill is
     the setup, which the person starts from the phone (SetupCard) */
  const phoneLevel = handsetOf(chat).level;
  /* the phone's in-world now while it is on: each message shows how long
     ago it was in the story ("5m ago"), from its stamp (m.wt) */
  const clockNow = useMemo(() => (phoneLevel !== "off" ? phoneNow(handsetOf(chat), chat.messages) : null), [chat.handset, chat.messages]); // eslint-disable-line react-hooks/exhaustive-deps
  /* phone time since the newest stamped message (phone actions, a refresh):
     from 15 minutes on, a caption under the transcript says so */
  const phoneGap = useMemo(() => (phoneLevel !== "off" ? phoneGapOf(handsetOf(chat), chat.messages) : null), [chat.handset, chat.messages]); // eslint-disable-line react-hooks/exhaustive-deps
  const whenOf = (m) => {
    if (clockNow == null || !Number.isFinite(m.wt)) return null;
    const l = timeLabel(clockNow - m.wt);
    return l === "now" ? "now" : `${l} ago`;
  };
  /* a new message's in-world stamp, once the phone is set up (any level) */
  const stampOf = (role) => {
    const wt = messageStamp(getData().chats.find((c) => c.id === chatId), role);
    return wt != null ? { wt } : {};
  };
  /* on at the new-chat default when that is a level, else Light; then open */
  const turnPhoneOn = () => {
    const def = data.settings?.phoneDefault;
    const lvl = ["light", "lively"].includes(def) ? def : "light";
    patchChatWith((c) => ({ ...c, handset: setLevel(handsetOf(c), lvl) }));
    setShowPhone(true);
  };
  const phoneUnread = useMemo(() => phoneUnreadOf(chat.handset, chat.messages, { userName }).total, [chat.handset, chat.messages, userName]);
  const describeMember = (member, messages) => startChatSide({ getData, update, chatId, kind: "describe", member, messages });
  const scanning = useActivity(a => a.some(j => j.owner.chatId === chatId && j.kind === "scan" && j.status === "running"));
  const patchScope = fn => patchChatWith(c => ({ ...c, scope: fn(scopeOf(c)) }));
  useEffect(() => {
    if (scopeActive && !sc.cardScanned) startChatSide({ getData, update, chatId, kind: "scan" });
  }, [scopeActive, sc.cardScanned, chatId]);

  /* added by tapping a suggestion, or by name in the Scope sheet */
  const addToScope = (name) => {
    const n = String(name || "").trim();
    if (!n || [...sc.cast.map((c) => c.name), ...leadNames(leads)].some((x) => x.toLowerCase() === n.toLowerCase())) return;
    const m = castMember({ id: uid(), name: n });
    patchScope((x) => ({ ...x, cast: [...x.cast, m], dismissed: x.dismissed.filter((d) => d.toLowerCase() !== n.toLowerCase()) }));
    if (!scopeBusy.current) {
      scopeBusy.current = true;
      describeMember(m, chat.messages).finally(() => { scopeBusy.current = false; });
    }
  };

  /* ---------- Image Generation Subsystem ---------- */
  const openImageGen = (opts = {}) => {
    if (typeof opts?.customPrompt === "string" && opts.customPrompt.trim()) {
      setImageGenPrompt(opts.customPrompt.trim());
    } else {
      const targetMsg = opts?.msg || (chatRef.current?.messages?.length ? chatRef.current.messages[chatRef.current.messages.length - 1] : null);
      const sceneText = cleanNote(chatRef.current?.sceneTracker || chatRef.current?.scene?.text || "");
      const autoPrompt = buildSceneVisualPrompt({
        character,
        scene: sceneText,
        messageText: targetMsg?.content || "",
        universe,
      });
      setImageGenPrompt(autoPrompt);
    }
    setImageGenOpen(true);
  };

  const handleSendImageToChat = (imageUrl, promptText) => {
    const newMsg = {
      id: uid(),
      role: "system",
      content: promptText ? `*Visualized Scene: ${promptText}*` : "*Visualized Scene*",
      image: imageUrl,
      speaker: "Scene Art",
      at: Date.now(),
      ...stampOf("user"),
    };
    commit([...chatRef.current.messages, newMsg]);
    setImageGenOpen(false);
  };

  const handleSetBackdrop = (imageUrl) => {
    const currentBgs = bgListOf(theme);
    const newBg = { id: uid(), image: imageUrl, opacity: 0.6, scale: 1, nx: 0.5, ny: 0.5 };
    saveTheme({
      ...theme,
      bg: newBg,
      bgs: [newBg, ...currentBgs.filter((b) => b.image !== imageUrl)],
    });
    setImageGenOpen(false);
  };

  const handleSaveImageGenSettings = (patch) => {
    update((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        imageGen: {
          ...(prev.settings?.imageGen || {}),
          ...patch,
        },
      },
    }));
  };

  /* ---------- Interactive Slash Commands ---------- */
  const handleSlashCommand = (cmdText) => {
    const parsed = parseSlashCommand(cmdText);
    if (!parsed.name) return;

    executeSlashCommand(parsed, {
      chat: chatRef.current,
      messages: chatRef.current.messages,
      vars: chatRef.current.vars || {},
      thinking: thinkingOn(data.settings),
      notePresets: data.settings.authorNotePresets || [],
      onLoadNotePreset: ({ text }) => {
        patchChatWith((c) => ({ ...c, authorsNote: { ...(c.authorsNote || DEFAULT_AUTHORS_NOTE), text } }));
      },
      onImagine: (prompt) => {
        openImageGen({ customPrompt: prompt });
      },
      onSystemMessage: (content) => {
        const sysMsg = {
          id: uid(),
          role: "system",
          speaker: "System",
          content,
          at: Date.now(),
          ...stampOf("user"),
        };
        const history = [...chatRef.current.messages, sysMsg];
        commit(history);
    setSendTick((n) => n + 1);
      },
      onSendAs: (speaker, message) => {
        const isSys = speaker.toLowerCase() === "narrator" || speaker.toLowerCase() === "system";
        sendText(message, {
          sendAs: {
            type: isSys ? "system" : "character",
            name: speaker,
            id: null,
          },
          lockSendAs: false,
        });
      },
      onImpersonate: (guidance) => {
        impersonateUser(guidance);
      },
      onContinue: () => {
        continueScene();
      },
      onUpdateNote: (noteText) => {
        patchChatWith((c) => ({
          ...c,
          authorsNote: {
            ...(c.authorsNote || DEFAULT_AUTHORS_NOTE),
            text: noteText,
          },
        }));
      },
      onSetVar: (k, v) => {
        patchChatWith((c) => {
          const nextVars = { ...(c.vars || {}), [k]: v };
          if (varsRef.current) varsRef.current = { id: c.id, vars: nextVars };
          return { ...c, vars: nextVars };
        });
      },
      onToggleThinking: (nextState) => {
        update((d) => ({ ...d, settings: withThinking(d.settings, nextState) }));
      },
      onClear: () => {
        setConfirm({
          title: "Clear conversation",
          body: "Are you sure you want to clear all messages in this chat?",
          run: () => {
            changeWithUndo("Chat cleared", (c) => withMessages(c, []));
        setSendTick((n) => n + 1);
          },
        });
      },
      onBranch: (branchName) => handleBranch(chatRef.current.messages.at(-1), branchName),
    });
  };

  const sendText = async (text, customOpts = {}) => {
    // Stop removes the activity before its partial reply finishes saving.
    await waitForReply(chatId);
    if (isSlashCommand(text)) {
      handleSlashCommand(text);
      return;
    }
    const currentSendAs = customOpts.sendAs || sendAs;
    const isSystem = currentSendAs.type === "system";
    const isChar = currentSendAs.type === "character" || currentSendAs.type === "cast";

    const evaluated = text ? runMacros(text, { vars: chatRef.current.vars || {}, user: userName, char: charLabel }) : "";

    const newMsg = {
      id: uid(),
      role: isSystem ? "system" : isChar ? "assistant" : "user",
      content: evaluated,
      at: Date.now(),
      ...stampOf(isChar ? "assistant" : "user"),
      ...(isSystem ? { speaker: "Narrator" } : {}),
      ...(isChar && currentSendAs.name ? { speaker: currentSendAs.name } : {}),
      ...(isChar && currentSendAs.id ? { speakerId: currentSendAs.id } : {}),
      ...(customOpts.images?.length ? { images: customOpts.images } : {}),
    };

    const history = [...(getData().chats.find(c => c.id === chatId)?.messages || []), newMsg];
    patchChatWith(c => ({ ...c, messages: [...c.messages, newMsg], updatedAt: Date.now() }));
    setSendTick((n) => n + 1);

    if (currentSendAs.type !== "user" && !currentSendAs.lock && !customOpts.lockSendAs) {
      setSendAs({ type: "user", id: null, name: "", lock: false });
    }

    /* `reply`: one-off options for the reply that follows (Go here) */
    generate(history, customOpts.reply);
  };
  const sendRef = useRef(null);
  sendRef.current = sendText;
  useEffect(() => {
    if (!replyJob && queuedSend.current) {
      const queued = queuedSend.current;
      queuedSend.current = null;
      waitForReply(chatId).then(() => sendRef.current?.(queued.text, { images: queued.images })).catch((e) => {
        console.warn("Queued message was not sent", e);
        showToast("Your queued message was not sent.", { tone: "warn" });
      });
    }
  }, [replyStream]);

  /* Impersonate: generate the next turn as the user persona */
  const impersonateUser = (customPrompt) => {
    if (streaming || impersonating) return;
    const guidance = typeof customPrompt === "string" ? customPrompt : composerRef.current?.getDraft() || "";
    return startReply({ getData, update, chatId, kind: "impersonate", opts: { guidance } });
  };

  /* Quick replies action handler */
  const handleQuickReply = (qr) => {
    if (qr.mode === "action") {
      if (qr.action === "impersonate") impersonateUser();
      else if (qr.action === "continue") continueScene();
      else if (qr.action === "authorsNote" || qr.action === "note") setChatSettings("note");
      return;
    }
    const evaluated = runMacros(qr.text || qr.label, { vars: chatRef.current.vars || {}, user: userName, char: charLabel });
    if (qr.mode === "insert") {
      composerRef.current?.setDraft((prev) => (prev ? prev + " " + evaluated : evaluated));
    } else {
      sendText(evaluated);
    }
  };

  /* what the message box hands over: already trimmed, and the box has
     already been cleared */
  const send = (text, imagesToSend) => {
    if (streaming || chainOn) {
      /* With Scope on you can step in at any moment: the reply being written
         is stopped and kept, and yours goes straight after it. */
      if (!scopeActive) return;
      if (streaming) { queuedSend.current = { text, images: imagesToSend }; stopAll(); }
      else { stopAll(); sendText(text, { images: imagesToSend }); }
      return;
    }
    sendText(text, { images: imagesToSend });
  };

  /* continue button: generates the next reply with no input from you */
  const continueScene = () => {
    if (streaming || chat.messages.length === 0) return;
    generate(chat.messages, { continueScene: true });
  };

  /* Continue a reply: the model carries on from where it stopped and the
     text is added to the same bubble. The stream bubble stays hidden; the
     message itself grows. */
  const continueMessage = msg => startReply({ getData, update, chatId, kind: "continue", opts: { message: msg } });

  const stopAll = () => {
    stream.set({ stopChain: true });
    cancelWhere(j => j.owner.chatId === chatId);
    stopSpeech();
    setSpeakingMsgId(null);
  };

  const toggleSpeak = (m) => {
    if (speakingMsgId === m.id) {
      stopSpeech();
      setSpeakingMsgId(null);
    } else {
      stopSpeech();
      speak(m.content, {
        ...speechOptions(data.settings?.voice || {}, data.settings?.providers || []),
        onStart: () => setSpeakingMsgId(m.id),
        onEnd: () => setSpeakingMsgId((cur) => (cur === m.id ? null : cur)),
        onError: (err) => {
          setSpeakingMsgId((cur) => (cur === m.id ? null : cur));
          showToast(speechProblem(err), { tone: "warn" });
        },
      });
    }
  };


  /* "Try again" repeats the request that failed — a new version of a reply
     stays a new version, rather than turning into a reply after it. */
  const retry = () => {
    const failed = activity.get().findLast(j => j.owner.chatId === chatId && j.kind === "reply" && j.status === "error");
    const run = retryRun(chat.lastErrorRetry || failed?.stream?.get(), chat.messages);
    if (run && (run.kind !== "generate" || run.fresh)) {
      return startReply({ getData, update, chatId, kind: run.kind, history: run.history, opts: run.opts });
    }
    else generate(chat.messages);
  };

  /* message menu actions. Regenerating further up forks the chat there;
     editing and deleting one message no longer touch the rest. */
  const idxOf = (msg) => chat.messages.findIndex((m) => m.id === msg.id);
  const belowCount = (msg) => chat.messages.length - idxOf(msg) - 1;

  const withForkWarning = (msg, actionLabel, run) => {
    const below = belowCount(msg);
    if (below > 0) {
      setConfirm({
        title: actionLabel,
        body: `This is not the last message. Doing this here will delete the ${below} message${below > 1 ? "s" : ""} below it. Continue?`,
        run,
      });
    } else run();
  };

  /* A regenerated reply is a new version of it (see swipes.js): the old one
     stays a swipe away. Further up the chat, everything below has to go
     first, because it answered the version being replaced. */
  const doRegenerate = (msg, instruction) => {
    const i = idxOf(msg);
    if (i < 0) return;
    const current = chat.messages[i];
    const history = chat.messages.slice(0, i);
    if (i < chat.messages.length - 1) commit([...history, current]);
    generate(history, { swipeOf: current, ...(instruction ? { instruction } : {}) });
  };

  /* An edit changes that one message, in place. Nothing below it is touched:
     fixing a typo forty messages up used to cost the forty messages. */
  const doEdit = (msg, text) => {
    changeWithUndo("Message edited", (c) => withMessages(c, c.messages.map((m) => (m.id === msg.id ? editMessage(m, text) : m))));
  };

  /* ---------- swipes ----------

     On the newest reply: the arrows under it. Back shows the previous version; forward shows the next, and past
     the last one writes a new one. Not on an untouched opening, which has
     its own picker for the card's scenarios. */
  const showVersion = (msg, i) => commit(chat.messages.map((m) => (m.id === msg.id ? showSwipe(m, i) : m)));
  const swipeBack = (msg) => {
    const k = swipeIndex(msg);
    if (k > 0) showVersion(msg, k - 1);
  };
  const swipeForward = (msg) => {
    const k = swipeIndex(msg);
    if (k < swipeList(msg).length - 1) showVersion(msg, k + 1);
    else doRegenerate(msg);
  };

  /* ---------- editing in place ----------

     Opening an edit is a state change on one bubble rather than a sheet, and
     saving it changes only that message. */
  /* `tap`: where a double tap landed and the bubble it landed on, when the
     edit came from one, so the cursor starts on that word and the bubble
     keeps its width. From a menu there is no tap; the cursor goes to the end. */
  const startEdit = (msg, tap = null) => {
    if (streaming) return;
    /* how far into the shown text the tap landed, so the cursor opens on
       that word (the editor maps it back onto the raw text) */
    let offset = null;
    if (tap?.el) {
      try {
        let range = document.caretRangeFromPoint?.(tap.x, tap.y) || null;
        if (!range && document.caretPositionFromPoint) {
          const p = document.caretPositionFromPoint(tap.x, tap.y);
          if (p) { range = document.createRange(); range.setStart(p.offsetNode, p.offset); }
        }
        if (range && tap.el.contains(range.startContainer)) {
          const before = document.createRange();
          before.selectNodeContents(tap.el);
          before.setEnd(range.startContainer, range.startOffset);
          offset = before.toString().length;
        }
      } catch { offset = null; }
    }
    setInlineEdit({ id: msg.id, at: offset != null ? { offset } : null });
  };

  /* `text` is what the bubble holds when Save is pressed; `changed` is false
     when nothing was touched, so opening an edit and confirming it is not
     an edit. */
  const saveInlineEdit = (text, changed) => {
    if (!inlineEdit) return;
    const msg = chat.messages.find((m) => m.id === inlineEdit.id);
    const t = (text || "").trim();
    setInlineEdit(null);
    if (!msg || !t || !changed || t === msg.content) return;
    doEdit(msg, t);
  };

  /* ---------- gestures ----------

     Two taps on a bubble edit it; that is the only tap gesture. */
  const onBubbleTap = (m) => {
    if (streaming || inlineEdit) return;
    navigator.vibrate?.(8);
    startEdit(m, lastTap.current);
  };

  /* One counter for every bubble rather than one per message: a hook cannot
     live inside the map, and a shared counter is also more correct — tapping
     two different bubbles in quick succession is two first taps, not a double,
     which the target check below enforces. */
  const tapTarget = useRef(null);
  const countTap = useMultiTap({
    max: 2,
    onTap: () => { const m = tapTarget.current; if (m) onBubbleTap(m); },
  });
  const bubbleTap = (m) => (e) => {
    if (tapTarget.current?.id !== m.id) tapTarget.current = m;
    lastTap.current = { x: e.clientX, y: e.clientY, el: e.currentTarget };
    countTap(e);
  };

  /* A change to the messages that can be taken back for a few seconds. The
     undo puts the messages back as they were (lib/undo.js keeps anything
     that happened since), and the notes too unless they have moved on. */
  const changeWithUndo = (label, op) => {
    let before = null;
    let after = null;
    patchChatWith((c) => { before = c; after = op(c); return after; });
    undoToast(label, () => patchChatWith((c) => (!before || !after ? c : {
      ...c,
      messages: restoreList(c.messages, before.messages, after.messages),
      memory: c.memory === after.memory ? before.memory : c.memory,
      scene: c.scene === after.scene ? before.scene : c.scene,
      updatedAt: Date.now(),
    })));
  };

  /* the same change commit() makes, as a function of the chat */
  const withMessages = (c, messages) => ({
    ...c,
    messages,
    updatedAt: Date.now(),
    memory: keepIfCovered(c.memory, messages),
    scene: keepIfCovered(c.scene, messages),
  });

  /* Just this one message. A note that ended on it moves back one, and what
     the phone hung loose on it moves to the message before (keepPhoneOnDelete). */
  const doDelete = (msg) =>
    changeWithUndo("Message deleted", (c0) => {
      const c = keepPhoneOnDelete(c0, msg.id);
      return {
        ...c,
        messages: c.messages.filter((m) => m.id !== msg.id),
        updatedAt: Date.now(),
        memory: afterDeleting(c.memory, c.messages, msg.id),
        scene: afterDeleting(c.scene, c.messages, msg.id),
      };
    });

  /* This one and everything after it. */
  const doDeleteFrom = (msg) => {
    const n = belowCount(msg) + 1;
    changeWithUndo(`${n} messages deleted`, (c) => {
      const i = c.messages.findIndex((m) => m.id === msg.id);
      return i < 0 ? c : withMessages(c, c.messages.slice(0, i));
    });
  };

  const copyText = (msg) => {
    try { navigator.clipboard?.writeText(hideNotes(msg.content)); } catch { /* no clipboard here */ }
    navigator.vibrate?.(8);
  };

  /* The long-press menu. The everyday actions are big tiles, the destructive
     ones tall rows at the bottom, set apart. */
  const menuActions = (msg) => {
    const below = belowCount(msg);
    const ai = msg.role === "assistant";
    const acts = [];
    /* the everyday ones, big, up top */
    acts.push({ icon: Copy, label: "Copy", primary: true, run: () => copyText(msg) });
    acts.push({ icon: Pencil, label: "Edit", primary: true, run: () => startEdit(msg) });
    if (ai) {
      acts.push({
        icon: RefreshCw, label: "Regenerate", primary: true,
        run: () => withForkWarning(msg, "Regenerate", () => doRegenerate(msg)),
      });
    }
    /* then the rest, as a list */
    if (ai) {
      acts.push({ icon: Wand2, label: "Regenerate with a note", sub: "say what to change", run: () => setRegenMsg({ msg, text: "" }) });
      if (!streaming) {
        acts.push({
          icon: Play, label: "Continue this reply", sub: "pick up where it stopped",
          run: () => withForkWarning(msg, "Continue", () => continueMessage(msg)),
        });
      }
    }
    if (!streaming) {
      acts.push({ icon: FastForward, label: "Continue the story", sub: "a new reply without you writing", run: () => continueScene() });
    }
    if (ai && canSpeak(data.settings.voice, data.settings.providers)) {
      const on = speakingMsgId === msg.id;
      acts.push({ icon: on ? VolumeX : Volume2, label: on ? "Stop reading" : "Read aloud", run: () => toggleSpeak(msg) });
    }
    acts.push({
      icon: Languages,
      label: translations[msg.id] ? "Hide translation" : "Translate",
      run: () => toggleTranslate(msg),
    });
    acts.push({
      icon: BookMarked, label: "Bookmark",
      sub: "a checkpoint to jump back to or branch from",
      run: () => { setBookmarkTarget(msg); setShowBookmarks(true); },
    });
    acts.push({
      icon: GitBranch, label: "Branch from here",
      sub: "a new chat with everything up to this message",
      run: () => handleBranch(msg),
    });
    acts.push({
      icon: ImageIcon, label: "Picture this",
      sub: "make an image of this moment",
      run: () => openImageGen({ msg }),
    });
    /* and deleting, at the foot: what goes is spelled out on each */
    if (below > 0) {
      acts.push({
        icon: Trash2, label: "Delete only this message",
        sub: `The ${below} message${below > 1 ? "s" : ""} after it stay${below > 1 ? "" : "s"}.`,
        danger: true, soft: true,
        run: () => doDelete(msg),
      });
      acts.push({
        icon: ListX, label: "Delete this and everything after",
        sub: `This message and the ${below} after it: ${below + 1} in all.`,
        danger: true,
        run: () =>
          setConfirm({
            title: "Delete this and everything after",
            body: `This deletes this message and the ${below} after it (${below + 1} in all). You can undo it right after.`,
            run: () => doDeleteFrom(msg),
          }),
      });
    } else {
      acts.push({ icon: Trash2, label: "Delete this message", danger: true, run: () => doDelete(msg) });
    }
    return acts;
  };

  /* the message itself at the top of its menu, so it is clear which one */
  const menuPreview = (msg) => (
    <div className="rounded-xl px-3.5 py-2.5" style={{ background: "var(--nv-control)", boxShadow: "inset 2px 0 0 var(--nv-ink)" }}>
      <p className="nv-label mb-1" style={{ fontSize: 9.5 }}>{msg.role === "user" ? userName || "You" : msg.speaker || charLabel || "Reply"}</p>
      <p className="text-[13px] leading-snug text-zinc-300 line-clamp-3 whitespace-pre-wrap break-words">{hideNotes(msg.content || "").trim() || "(a picture)"}</p>
    </div>
  );

  /* labels shown on the composer buttons */
  const styleName = styleLabel(data.settings);
  /* a reply style that already keeps what Nova keeps (memory.js): asked once per chat and style */
  const overlapKey = `${data.settings.stylePreset}:${data.settings.customStyleId || ""}`;
  const overlap = useMemo(
    () => (chat?.memoryOff?.asked === overlapKey || conflictAsked === overlapKey || !chat?.messages?.length ? [] : memoryConflicts(genParams(data.settings), data.settings, chat)),
    [data.settings, chat?.memoryOff, chat?.messages?.length, overlapKey, conflictAsked],
  );
  const styleColor = "var(--acc)";
  /* lit on the composer: a prompt of your own, and an author's note with
     something in it */
  const styleOn = activePreset(data.settings).id !== "neutral";
  const noteOn = !!chat.authorsNote?.text?.trim();
  const endpoint = useEndpointLabel(data.settings);
  const modelName = endpoint.label;

  /* the newest message carries an inline action row */
  const lastMsg = chat?.messages?.[chat.messages.length - 1] || null;

  /* ---------- opening scenarios ----------

     Swapping the opening is offered only while it is still the only message
     in the chat. That is exactly the window where nothing depends on it: once
     you have replied, the scene has been built on top of that opening and
     silently replacing its foundation would leave your own first message
     answering something that no longer happened.

     The choice is stored on the chat by id rather than by index, so editing
     the card and reordering its openings afterwards cannot slide an open chat
     onto a different one. */
  const greets = greetingsOf(isUni ? universe : character);
  const canPickGreeting =
    greets.length > 1 &&
    chat.messages.length === 1 &&
    chat.messages[0]?.role === "assistant" &&
    !streaming;
  const greetIdx = Math.max(0, greets.findIndex((g) => g.id === chat.greetingId));

  const pickGreeting = (i) => {
    const g = greets[i];
    if (!g) return;
    update({
      chats: data.chats.map((c) =>
        c.id === chat.id
          ? {
              ...c,
              greetingId: g.id,
              updatedAt: Date.now(),
              /* the message id is kept so React does not tear the bubble down
                 and replay its entry animation on every tap of the arrows */
              messages: [{ ...c.messages[0], role: "assistant", content: fillNames(g.text, isUni ? universe?.name : character?.name, userName), at: Date.now() }],
            }
          : c
      ),
    });
  };

  const greetLabel = (g, i) => g?.label?.trim() || `Opening ${i + 1}`;


  /* Who can lead a reply, as chips in the cast strip: the chat's own
     character, or in a universe its characters and the narration. The
     cast's own chips follow them. */
  const leadChips = isUni
    ? [
        { id: "narrator", name: "Narrator", narrator: true },
        ...(universe?.characters || []).map((c) => ({ id: c.id, name: c.name, avatar: c.avatar })),
      ]
    : character ? [{ id: character.id, name: character.name, avatar: character.avatar, characterId: character.id }] : [];
  const toggleLead = (who) => setLead((cur) => (cur?.id === who.id ? null : {
    id: who.id,
    ...(who.narrator ? { narrator: true } : { name: who.name }),
    ...(who.characterId ? { characterId: who.characterId } : {}),
  }));

  /* ---------- the World (a universe only) ----------
     The strip's World chip shows where and when the tracker last put the
     scene; its sheet lists the places and where everyone is. */
  const worldHead = useMemo(() => (isUni ? sceneHead(chat.scene?.text) : null), [isUni, chat.scene?.text]);
  const world = isUni ? { name: universe?.name || "", place: worldHead?.place || "", time: timeOf(worldHead?.when) } : null;
  const worldBusy = streaming || chainOn || impersonating;
  /* Go here: a narrator line in the chat (sent the way Send as Narrator
     sends one, so it is stored, undone and deleted like any message), then
     one ordinary reply, narrated, told to open on the arrival. No extra
     model call. */
  const goTo = (place) => {
    if (worldBusy || !place) return;
    setShowWorld(false);
    setLead(null);
    sendText(`*${userName} heads to ${place}.*`, {
      sendAs: { type: "system", name: "Narrator", id: null },
      lockSendAs: true,
      reply: {
        instruction: `Move the scene to ${place}: the arrival, who is there and what is going on there right now.`,
        lead: { id: "narrator", narrator: true },
      },
    });
  };

  /* Swipes live on the newest reply only, and not on an untouched opening,
     which has the scenario picker instead. */
  const canSwipe = (m) =>
    m.role === "assistant" &&
    m.id === lastMsg?.id &&
    !streaming &&
    !inlineEdit &&
    !(canPickGreeting && m.id === chat.messages[0]?.id);

  const bgs = castBgListOf(theme, ensemble);
  const hasBg = bgs.length > 0;
  const movingBg = bgs.some(b => b.animated || isVideo(b.image));
  const paint = chatAppearance(theme, { hasBackground: hasBg, moving: movingBg });
  const chatVars = { "--nv-chat-edge": paint.composerBorder, "--nv-chat-panel": paint.composerBg, "--nv-chat-control": paint.controlBg, "--nv-chat-blur": paint.composerBlur };
  /* Look → Skin in chats off ("dark" / "light"): the chat's own parts (header,
     messages, message box) wear Nova's plain look under any skin, on a solid
     black or white page; the sheets and the phone opened from here keep the
     skin. The colours are named again on each part, so they resolve against
     Nova's own tokens there rather than the skin's. */
  const plainSurface = plain ? { "data-theme": plain } : null;
  const plainVars = plain ? chatVars : null;
  const { userBubbleBg, aiBubbleBg, userBubbleFg, aiBubbleFg, composerBg, composerBlur,
    composerBorder, bubbleBorder, bubbleSheen, glassEdge } = paint;
  const chipBlur = {};

  /* Look & feel, editable without leaving the scene */
  const saveTheme = (next) => {
    if (isUni && universe) {
      update({ universes: data.universes.map((u) => (u.id === universe.id ? { ...u, theme: next } : u)) });
    } else if (character) {
      update({ characters: data.characters.map((c) => (c.id === character.id ? { ...c, theme: next } : c)) });
    }
  };

  /* ---------- what the rows are given ----------

     Rows are memoised (chat/MessageRow.jsx), so everything handed to them
     has to keep its identity until it really changes: the look as one
     object, and every action through one object that never changes. */

  /* A message's depth only matters to display scripts limited to a depth
     range. Past the deepest limit any rule sets, every depth renders the
     same, so it is capped there — otherwise each new message would change
     the depth of every bubble above it and re-render them all. */
  const deepestRule = useMemo(() => {
    let max = -1;
    for (const r of display) {
      if (r.minDepth != null) max = Math.max(max, r.minDepth);
      if (r.maxDepth != null) max = Math.max(max, r.maxDepth);
    }
    return max;
  }, [display]);
  const depthFor = (d) => (deepestRule < 0 ? 0 : Math.min(d, deepestRule + 1));

  const blurChips = false;
  const look = useMemo(
    () => ({ userBubbleBg, aiBubbleBg, userBubbleFg, aiBubbleFg, bubbleBorder, bubbleSheen, hasBg, blurChips, display }),
    /* the pictures beside each speaker are looked up from these, so a
       change of avatar has to reach the rows through here */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userBubbleBg, aiBubbleBg, userBubbleFg, aiBubbleFg, bubbleBorder, bubbleSheen, hasBg, blurChips, display, character, universe, sc.cast, data.characters]
  );
  const composerLook = useMemo(
    () => ({ composerBg, composerBorder, composerBlur, glassEdge }),
    [composerBg, composerBorder, composerBlur, glassEdge]
  );

  const rowActions = useStableActions({
    longPress: (m) => longPress(() => setMenuMsg(m)),
    tap: (m, e) => bubbleTap(m)(e),
    openMenu: (m) => setMenuMsg(m),
    saveEdit: saveInlineEdit,
    cancelEdit: () => setInlineEdit(null),
    toggleTranslate,
    preview: (url) => setLightboxUrl(url),
    pickGreeting,
    showGreetings: () => setShowGreetings(true),
    swipeBack,
    swipeForward,
    regenerate: (m) => withForkWarning(m, "Regenerate", () => doRegenerate(m)),
    regenNote: (m) => setRegenMsg({ msg: m, text: "" }),
    continueMsg: (m) => continueMessage(m),
    edit: (m) => startEdit(m),
    continueStory: () => continueScene(),
    askDelete: (m) => doDelete(m),
  });

  const composerActions = useStableActions({
    send,
    /* typing is stepping in: the scene stops playing on its own */
    typing: () => { stream.set({ stopChain: true }); },
    resetSendAs: () => setSendAs({ type: "user", id: null, name: "", lock: false }),
    openStyle: () => setShowStyle(true),
    openScope: () => setShowScope(true),
    openNote: () => setChatSettings("note"),
    openPhone: () => (phoneLevel === "off" ? setPhoneOffMenu(true) : setShowPhone(true)),
    openModel: () => setShowModelPick(true),
    openMenu: () => setShowComposerMenu(true),
    stop: stopAll,
    continueScene,
  });

  return (
    <div className="nv-chat-root fixed inset-0 flex flex-col bg-zinc-950 z-40 nv-safe-x" data-moving={movingBg ? "1" : undefined} data-editing={inlineEdit ? "1" : undefined}
      data-plain={plain || undefined}
      style={chatVars}>

      {/* full-screen character backdrop — sits behind header, messages, and composer */}
      <ChatBackdrop list={bgs} seconds={theme.bgSeconds} desktopOnly={!!theme.bgDesktopOnly} />
      {!hasBg && !plain && <div aria-hidden className="absolute inset-0 pointer-events-none"><Texture /></div>}
      {/* header */}
      <div
        className={`nv-chat-header relative flex items-center gap-3 px-3 sm:px-5 z-10 ${hasBg ? "" : "nv-chat-head"} ${plain ? "nv-plain" : ""}`}
        {...plainSurface}
        style={{
          ...plainVars,
          paddingTop: "calc(0.625rem + var(--sa-t))",
          paddingBottom: "0.625rem",
          background: "transparent",
        }}
      >
        <Button variant="icon" icon={ChevronLeft} onClick={goBack} className="-ml-2 rounded-full [--nv-btn-icon:22px]" style={hasBg ? { filter: "none" } : {}} aria-label="Go back" />
        {onToggleList && (
          <Button variant="icon" icon={PanelLeft} onClick={onToggleList} className="rounded-full" style={hasBg ? { filter: "none" } : {}} aria-label={listOpen ? "Hide chats" : "Show chats"} aria-expanded={!!listOpen} title="Chats" />
        )}
        {isUni && !headerAvatar ? (
          <div className="nv-hair w-9 h-9 rounded-full flex items-center justify-center shrink-0">
            <Globe size={15} strokeWidth={1.5} className="text-zinc-500" />
          </div>
        ) : castPeople.length > 1 ? (
          /* several of them: one picture, each in turn */
          <span data-chat-avatar="1" className="shrink-0 rounded-full">
            <CyclingAvatar people={castPeople.map((c) => ({ name: c.name, src: c.avatar }))} size="w-9 h-9" />
          </span>
        ) : (
          /* the picture a view transition carries in from the card you
             tapped (App.jsx navigate) */
          <span data-chat-avatar="1" className="shrink-0 rounded-full">
            <Pic src={headerAvatar} name={title || "?"} size="w-9 h-9" />
          </span>
        )}
        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <p className="text-[15px] font-semibold tracking-tight text-zinc-100 truncate leading-tight">
            {headTitle || "Chat"}
          </p>
        </div>
        {/* this chat's look and its memory, in one sheet. It breathes in the
            accent while a memory or scene note is being written. */}
        <button
          onClick={() => setChatSettings("general")}
          className={`w-10 h-10 -mr-1.5 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-[var(--nv-control)]  shrink-0 ${noteBusy ? "nv-breathe" : ""}`}
          style={{ ...(hasBg ? { filter: "none" } : {}), ...(noteBusy ? { color: "var(--acc)" } : {}) }}
          aria-label="Chat settings"
          title={noteBusy ? `Updating ${noteBusy === "memory" ? "the story so far" : "the scene notes"}…` : "Chat settings"}
        >
          <Cog size={19} />
        </button>
      </div>


      {/* messages, over this character's backdrop */}
      <div className={`nv-chat-list flex-1 relative overflow-hidden ${plain ? "nv-plain" : ""}`} {...plainSurface} style={plainVars}>
        <div
          ref={scrollerRef}
          className="nv-chat-messages absolute inset-0 overflow-y-auto px-1 sm:px-6 py-6"
        >
          <div className="max-w-3xl lg:max-w-5xl mx-auto space-y-6">
            {chat.messages.map((m, mi) => {
              /* a reply getting a new version is replaced by the stream */
              if (m.id === swipingId && streaming) return null;
              const av = avatarFor(m);
              const isLast = m.id === lastMsg?.id;
              const greetHere = canPickGreeting && mi === 0;
              return (
                <MessageRow
                  key={m.id}
                  m={m}
                  depth={depthFor(chat.messages.length - 1 - mi)}
                  look={look}
                  avSrc={av.src}
                  avName={av.name}
                  avPeople={av.people}
                  label={av.label || ((m.role === "assistant" || m.role === "system") && m.speaker ? m.speaker : av.name)}
                  editing={inlineEdit?.id === m.id ? inlineEdit : null}
                  anyEditing={!!inlineEdit}
                  isLast={isLast}
                  busy={isLast && streaming}
                  swipeable={canSwipe(m)}
                  highlight={highlightMsgId === m.id}
                  translation={translations[m.id]}
                  speaking={speakingMsgId === m.id}
                  greetIdx={greetHere ? greetIdx : 0}
                  greetCount={greetHere ? greets.length : 0}
                  greetLabel={greetHere ? greetLabel(greets[greetIdx], greetIdx) : ""}
                  continuing={continuingId === m.id}
                  when={whenOf(m)}
                  store={stream}
                  actions={rowActions}
                />
              );
            })}

            {phoneGap != null && phoneGap >= 15 && (
              <p className="py-2 text-center text-[11px] text-zinc-500" data-testid="phone-time-gap">{spanLabel(phoneGap)} later</p>
            )}

            {/* the reply arriving, in one bubble */}
            {streaming && !paused && !continuingId && (
              <StreamingBubble
                store={stream}
                look={look}
                streamSpeaker={streamSpeaker}
                title={title}
                isUni={isUni}
                universe={universe}
                character={character}
                isThinking={isThinking}
                thinkOpen={thinkOpen}
                onToggleThink={() => setThinkOpen((o) => !o)}
              />
            )}

            {error === "no-key" && (
              <div className="flex flex-col items-center gap-2 py-3 text-center">
                <div className="flex items-center gap-2">
                  <Zap size={13} className="text-zinc-100" />
                  <p className="text-xs text-zinc-400">
                    {(data.settings.providers || []).length ? `Add your ${providerOf(data.settings).name} key in Settings → Providers to get replies.` : "Add a provider in Settings → Providers to get replies."}
                  </p>
                </div>
                <Button size="sm" selected onClick={goSettings} style={{ color: "var(--acc)" }}>
                  Open Settings
                </Button>
              </div>
            )}

            {error === "no-model" && (
              <div className="flex flex-col items-center gap-2 py-3 text-center">
                <p className="text-xs text-zinc-400">Pick a model for {providerOf(data.settings).name} to get replies.</p>
                <Button size="sm" selected onClick={() => { setError(null); setShowModelPick(true); }} style={{ color: "var(--acc)" }}>
                  Pick a model
                </Button>
              </div>
            )}

            {error && error !== "no-key" && error !== "no-model" && (
              <div className="flex flex-col items-center gap-2 py-3 text-center">
                <p className="text-xs text-zinc-100 max-w-sm">{error}</p>
                <Button size="sm" onClick={retry}>
                  Try again
                </Button>
              </div>
            )}
            {notice && <p className="text-center text-xs text-zinc-400 py-2" role="status">{notice}</p>}
            <p className="sr-only" aria-live="polite">{replyDone}</p>
          </div>
        </div>
      </div>

      {/* composer */}
      <div
        className={`nv-chat-dock relative px-4 pt-2 z-10 ${plain ? "nv-plain" : ""}`}
        {...plainSurface}
        style={{ ...plainVars, background: "transparent" }}
      >
        <div className="max-w-2xl lg:max-w-4xl mx-auto">
          {/* Nova Scope: who is in this story, above the message box. A
              chip picks who leads the next reply; a universe offers its
              characters and the narration this way even with Scope off. */}
          {(scopeActive || isUni) && (
            <ScopeStrip
              scope={sc}
              active={scopeActive}
              leads={leadChips}
              lead={lead}
              characters={data.characters}
              suggestions={scopeActive && sc.mode === "manual" ? castCandidates : []}
              describing={describing}
              scanning={scopeActive && scanning}
              playing={chainOn}
              chipBlur={chipBlur}
              world={world}
              onOpenWorld={() => setShowWorld(true)}
              onAdd={addToScope}
              onLead={toggleLead}
              onStepIn={stopAll}
            />
          )}

          {/* The message box is the same surface as a bubble as far as the eye
              is concerned, so it takes the same opacity rather than the two
              hardcoded values it used to carry. The blur stays tied to having
              a background, since blurring a flat colour does nothing. */}
          {/* your quick replies, when you have any (+ → Quick replies) */}
          <QuickRepliesStrip
            replies={data.settings.quickReplies}
            onTrigger={handleQuickReply}
            onOpenManager={() => setShowQrManager(true)}
            disabled={streaming}
            impersonating={impersonating}
          />

          <Composer
            ref={composerRef}
            actions={composerActions}
            busy={streaming || chainOn || impersonating}
            scopeActive={scopeActive}
            canContinue={chat.messages.length > 0}
            impersonating={impersonating}
            sendAs={sendAs}
            scope={sc}
            styleName={styleName}
            styleColor={styleColor}
            styleOn={styleOn}
            noteOn={noteOn}
            modelName={modelName}
            modelFull={endpoint.full}
            modelOn={endpoint.picked}
            look={composerLook}
            phoneUnread={phoneUnread}
            phoneOn={phoneLevel !== "off"}
          />
        </div>
      </div>


      {/* Lightbox modal overlay */}
      {/* the persona's phone; drawn before the lightbox so a picture
          opened from its Gallery shows over it */}
      {phoneOffMenu && (
        <ActionMenu
          title="Phone"
          preview={<p className="text-sm text-zinc-400">The phone is off for this chat. Everything on it is kept.</p>}
          actions={[{ label: "Turn phone on", icon: Smartphone, primary: true, run: turnPhoneOn }]}
          onClose={() => setPhoneOffMenu(false)}
        />
      )}
      {showPhone && phoneLevel !== "off" && (
        <Phone
          chat={chat}
          data={data}
          persona={persona}
          userName={userName}
          character={character}
          ensemble={ensemble}
          universe={universe}
          onHandset={(fn) => patchChatWith((c) => ({ ...c, handset: fn(handsetOf(c), c) }))}
          onSettings={(patch) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }))}
          tick={phoneTick}
          onPreview={setLightboxUrl}
          onClose={() => setShowPhone(false)}
        />
      )}

      {lightboxUrl && <ImageLightbox src={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

      {/* The arrows are quick but blind — they change the opening without
          showing you what you are moving to. This sheet is the other half:
          every scenario with its text, so you can read before you commit. */}
      {showGreetings && (
        <Modal title="Where this starts" onClose={() => setShowGreetings(false)}>
          <div className="space-y-2">
            {greets.map((g, i) => {
              const on = i === greetIdx;
              return (
                <button
                  key={g.id}
                  onClick={() => { pickGreeting(i); setShowGreetings(false); }}
                  style={on ? selStyle(true) : {}}
                  className={`w-full text-left px-3.5 py-3 rounded-xl border  ${
                    on ? "" : "border-zinc-800 bg-[var(--nv-control)] hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-zinc-100 flex-1 min-w-0 truncate">{greetLabel(g, i)}</p>
                    {on && <Check size={15} style={{ color: "var(--acc)" }} className="shrink-0" />}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed line-clamp-3">{g.text}</p>
                </button>
              );
            })}
          </div>
        </Modal>
      )}

      {showScope && (
        <ScopeSheet
          scope={sc}
          kind={isUni ? "universe" : "card"}
          leads={leads}
          characters={data.characters}
          suggestions={castCandidates}
          describing={describing}
          sceneOn={data.settings.sceneEvery > 0}
          scanning={scanning}
          newChats={data.settings.scopeDefault || "off"}
          onNewChats={(mode) => update((d) => ({ ...d, settings: { ...d.settings, scopeDefault: mode } }))}
          onClose={() => setShowScope(false)}
          /* switching on from off reads the card again */
          onChange={(patch) => patchScope((x) => ({
            ...x, ...patch,
            ...(patch.mode && patch.mode !== "off" && x.mode === "off" ? { cardScanned: false } : {}),
          }))}
          onAdd={addToScope}
          onAddCharacter={(c) =>
            patchScope((x) => (x.cast.some((m) => m.characterId === c.id) ? x : {
              ...x,
              /* linked: the whole card is sent, so no description is kept */
              cast: [...x.cast, castMember({ id: uid(), name: c.name, characterId: c.id })],
            }))
          }
          onEdit={(id, patch) => patchScope((x) => ({ ...x, cast: x.cast.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))}
          onRemove={(m) => patchScope((x) => ({
            ...x,
            cast: x.cast.filter((c) => c.id !== m.id),
            dismissed: m.characterId ? x.dismissed : [...x.dismissed, m.name],
          }))}
          onRedescribe={(m) => {
            if (scopeBusy.current) return;
            scopeBusy.current = true;
            patchScope((x) => ({ ...x, cast: x.cast.map((c) => (c.id === m.id ? { ...c, description: "" } : c)) }));
            describeMember({ ...m, description: "" }, chat.messages).finally(() => { scopeBusy.current = false; });
          }}
        />
      )}

      {showWorld && isUni && (
        <WorldSheet
          universe={universe}
          chat={chat}
          lead={lead}
          busy={worldBusy}
          /* a row sets that person as the next reply's lead (never unsets) */
          onLead={(c) => { if (lead?.id !== c.id) toggleLead({ id: c.id, name: c.name }); setShowWorld(false); }}
          onNarrate={() => toggleLead({ id: "narrator", name: "Narrator", narrator: true })}
          onGo={goTo}
          onClose={() => setShowWorld(false)}
        />
      )}

      {/* per-message context menu */}
      {menuMsg && (
        <ActionMenu
          title="Message"
          preview={menuPreview(menuMsg)}
          onClose={() => setMenuMsg(null)}
          actions={menuActions(menuMsg)}
        />
      )}

      {/* regenerate with a note */}
      {regenMsg && (
        <Modal title="Regenerate with a note" onClose={() => setRegenMsg(null)}>
          <div className="space-y-3">
              <TextArea
              rows={3}
              autoFocus
              value={regenMsg.text}
              onChange={(e) => setRegenMsg({ ...regenMsg, text: e.target.value })}
              placeholder="e.g. shorter, she gets angry, describe the room..."
            />
            {belowCount(regenMsg.msg) > 0 && (
              <p className="text-[11px] text-zinc-100">Not the last message — the {belowCount(regenMsg.msg)} below it will be deleted.</p>
            )}
            <AccBtn
              disabled={!regenMsg.text.trim()}
              onClick={() => {
                const { msg, text } = regenMsg;
                setRegenMsg(null);
                doRegenerate(msg, text.trim());
              }}
              className="w-full py-2.5"
            >
              Regenerate
            </AccBtn>
          </div>
        </Modal>
      )}

      {/* generic confirmation */}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="text-sm text-zinc-300 leading-relaxed">{confirm.body}</p>
          <div className="flex items-center gap-2 mt-5">
            <Button onClick={() => setConfirm(null)} className="flex-1">
              Cancel
            </Button>
            <Button variant="primary" onClick={() => { const run = confirm.run; setConfirm(null); run(); }} className="flex-1">
              Continue
            </Button>
          </div>
        </Modal>
      )}

      {chatSettings && (
        <Modal title="Chat settings" onClose={() => setChatSettings(null)} wide fixed>
          {/* the same tab bar as Settings: icon over label, the open one lit.
              Seven tabs are more than a phone fits, so the row scrolls. */}
          <ScrollTabs
            aria-label="Chat settings sections"
            data-noswipe
            className="gap-2 pb-3 mb-3 border-b border-[var(--nv-line)]"
          >
            {[
              ["general", "Persona", User], ["look", "Look", Palette],
              ["memory", "Memory", Brain], ["note", "Quick tweaks", SlidersHorizontal],
              ["bookmarks", "Bookmarks", BookMarked], ["art", "Scene art", ImageIcon],
              ["tokens", "Tokens", Gauge], ["export", "Export", Download],
            ].map(([id, label, Icon]) => {
              const on = chatSettings === id;
              return (
                <button
                  key={id}
                  /* each tab opens at its top */
                  onClick={(e) => { e.currentTarget.closest(".nv-sheet-body")?.scrollTo?.({ top: 0 }); setChatSettings(id); }}
                  aria-pressed={on}
                  className={`flex flex-row items-center justify-center gap-2 px-3.5 py-2 min-h-[44px] shrink-0 whitespace-nowrap rounded-xl border text-xs font-medium ${on ? "" : "border-transparent text-zinc-500 hover:text-zinc-100"}`}
                  style={on ? { ...selStyle(true), color: "var(--acc)" } : {}}
                >
                  <Icon size={17} /><span>{label}</span>
                </button>
              );
            })}
          </ScrollTabs>
          <div key={chatSettings} className="nv-page">
          {chatSettings === "general" && (
            <PersonaTab
              personas={data.personas}
              current={chat.personaId || ""}
              username={data.username || "You"}
              onPick={(id) => patchChat({ personaId: id })}
              /* the Create tab's persona form, over this sheet (App.jsx);
                 saving or closing it comes back here */
              onEdit={(p) => onEdit?.("personas", p)}
              onNew={() => onEdit?.("personas", null, (saved) => patchChat({ personaId: saved.id }))}
              onRemove={(p) => removeWithUndo({ data, update, type: "personas", item: p })}
            />
          )}
          {chatSettings === "bookmarks" && (
            <div className="p-4 rounded-3xl nv-glass space-y-3">
              <p className="text-sm text-zinc-400">Save checkpoints, jump back, or branch your story.</p>
              <AccBtn className="w-full px-4 py-3" onClick={() => { setChatSettings(null); setBookmarkTarget(null); setShowBookmarks(true); }}>Open bookmarks ({chat.bookmarks?.length || 0})</AccBtn>
            </div>
          )}
          {chatSettings === "art" && (
            <div className="p-4 rounded-3xl nv-glass space-y-3">
              <p className="text-sm text-zinc-400">Generate a picture of the scene to send or use as a backdrop.</p>
              <AccBtn className="w-full px-4 py-3" onClick={() => { setChatSettings(null); openImageGen(); }}>Picture the scene</AccBtn>
            </div>
          )}
          {chatSettings === "export" && (
            <div className="p-4 rounded-3xl nv-glass space-y-3">
              <p className="text-sm text-zinc-400">Save this chat as SillyTavern .jsonl, ready to import into Nova or SillyTavern.</p>
              <AccBtn className="w-full px-4 py-3" onClick={exportChat}>Export chat</AccBtn>
            </div>
          )}
          {chatSettings === "look" ? (
            <ThemeSection
              theme={isUni ? universe?.theme : character?.theme}
              onChange={saveTheme}
            />
          ) : chatSettings === "memory" ? (
            <MemoryPanel
              chat={chat}
              settings={data.settings}
              books={books}
              allBooks={data.lorebooks || []}
              onToggleBook={(id) =>
                patchChatWith((c) => {
                  const ids = c.lorebookIds || [];
                  return { ...c, lorebookIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] };
                })
              }
              busy={noteBusy}
              onSave={(kind, text) =>
                patchChatWith((c) => {
                  const note = c[kind] || {};
                  const msgs = c.messages;
                  /* A hand-written note needs an anchor to count as current. The
                     story so far starts covering from the first message; the
                     scene is as of the newest. */
                  const anchor = msgs.some((m) => m.id === note.lastId)
                    ? note.lastId
                    : (kind === "memory" ? msgs[0] : msgs[msgs.length - 1])?.id;
                  if (!text.trim()) return { ...c, [kind]: null };
                  return {
                    ...c,
                    [kind]: kind === "memory"
                      ? { summary: text.trim(), lastId: anchor, at: Date.now() }
                      : { text: text.trim(), lastId: anchor, at: Date.now() },
                  };
                })
              }
              onUpdate={(kind) =>
                runNotes(chat.messages, kind === "memory" ? { forceMemory: true } : { forceScene: true })
              }
            />
          ) : chatSettings === "note" ? (
            <NotesTab
              text={chat.authorsNote?.text || ""}
              presets={data.settings.authorNotePresets}
              onPresets={(next) => update((d) => ({ ...d, settings: { ...d.settings, authorNotePresets: typeof next === "function" ? next(d.settings.authorNotePresets || []) : next } }))}
              onText={(text) => patchChatWith((c) => ({ ...c, authorsNote: { ...(c.authorsNote || DEFAULT_AUTHORS_NOTE), text } }))}
            />
          ) : (
            chatSettings === "tokens" && (tokenBreakdown ? <TokenBreakdownView breakdown={tokenBreakdown} historyBudget={tokenMax} /> : <p className="p-4 text-sm text-zinc-500">Token usage is unavailable for this chat right now.</p>)
          )}
          </div>
        </Modal>
      )}

      {overlap.length > 0 && !showStyle && (
        <MemoryConflict
          styleName={styleName}
          conflicts={overlap}
          onKeep={() => setConflictAsked(overlapKey)}
          onApply={(parts, everywhere) => {
            setConflictAsked(overlapKey);
            /* every chat: Nova's own switched off in settings; this chat only: on the chat */
            const mine = everywhere ? {} : Object.fromEntries(parts.map((k) => [k, true]));
            update((d) => ({
              ...d,
              ...(everywhere ? { settings: memoryOffEverywhere(d.settings, parts) } : null),
              chats: d.chats.map((c) => (c.id === chatId ? { ...c, memoryOff: { ...(c.memoryOff || {}), ...mine, asked: overlapKey } } : c)),
            }));
          }}
        />
      )}

      {showStyle && (
        <Modal title="Reply style" onClose={() => setShowStyle(false)}>
          <StyleChips
            settings={data.settings}
            onChange={(next, closes = true) => { update({ settings: next }); if (closes) setShowStyle(false); }}
          />
        </Modal>
      )}

      {showModelPick && (
        <ModelPicker
          settings={data.settings}
          onChange={(patch) => update({ settings: { ...data.settings, ...patch } })}
          onClose={() => setShowModelPick(false)}
          onProviders={() => { setShowModelPick(false); goSettings(); }}
        />
      )}

      {showComposerMenu && (
        <ActionMenu
          title="Message"
          onClose={() => setShowComposerMenu(false)}
          actions={[
            { icon: ImageIcon, label: "Attach a picture", primary: true, run: () => composerRef.current?.pickImage() },
            { icon: Wand2, label: "Write my reply", primary: true, run: () => impersonateUser() },
            {
              icon: User, label: "Send as…",
              sub: sendAs.type === "user" ? `you, as ${userName}` : `${sendAs.name}${sendAs.lock ? " (kept)" : ""}`,
              run: () => setShowSendAs(true),
            },
            {
              icon: Zap, label: "Quick replies",
              sub: data.settings.quickReplies?.length ? `${data.settings.quickReplies.length} above the message box` : "one-tap messages and actions",
              run: () => setShowQrManager(true),
            },
          ]}
        />
      )}

      {/* Send As selector modal */}
      {showSendAs && (
        <SendAsModal
          current={sendAs}
          userName={userName}
          characters={isUni ? universe?.characters || [] : character ? [character, ...ensemble] : []}
          /* a linked member is already among the characters */
          cast={sc.cast.filter((m) => !ensemble.some((c) => c.id === m.characterId))}
          onSelect={(opt) => setSendAs(opt)}
          onClose={() => setShowSendAs(false)}
        />
      )}

      {/* Quick Replies manager modal */}
      {showQrManager && (
        <QuickRepliesManager
          replies={data.settings.quickReplies || []}
          onChange={(next) => update((prev) => ({
            ...prev,
            settings: { ...prev.settings, quickReplies: typeof next === "function" ? next(prev.settings.quickReplies || []) : next },
          }))}
          onClose={() => setShowQrManager(false)}
        />
      )}

      {/* Bookmarks & Checkpoints modal */}
      {showBookmarks && (
        <BookmarksModal
          chat={chat}
          characterName={charLabel}
          targetMessage={bookmarkTarget}
          onClose={() => {
            setShowBookmarks(false);
            setBookmarkTarget(null);
          }}
          onJump={handleJump}
          onBranch={handleBranch}
          onAddBookmark={handleAddBookmark}
          onDeleteBookmark={handleDeleteBookmark}
        />
      )}

      {imageGenOpen && (
        <ImageGenModal
          open={imageGenOpen}
          onClose={() => setImageGenOpen(false)}
          initialPrompt={imageGenPrompt}
          settings={data.settings}
          onSendToChat={handleSendImageToChat}
          onSetBackdrop={handleSetBackdrop}
          onSaveSettings={handleSaveImageGenSettings}
        />
      )}
    </div>
  );
}

function ImageLightbox({ src, onClose }) {
  const root = useRef(null);
  useBackLayer(onClose, () => root.current);
  return <div ref={root} className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 nv-fade" onClick={onClose} data-testid="image-lightbox">
    <div className="nv-pop relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
      <img src={src} alt="Enlarged preview" className="max-w-full max-h-[85vh] rounded-2xl object-contain border border-[var(--nv-edge-ink)]" />
      <Button type="button" variant="icon" icon={X} onClick={onClose} className="absolute top-3 right-3 rounded-full bg-[var(--nv-control)] text-white border border-[var(--nv-edge-ink)] [--nv-btn-icon:18px]" aria-label="Close preview" title="Close preview" />
    </div>
  </div>;
}

/* ---------- the Memory sheet ----------

   Both notes, readable and editable: a summary that got a name wrong is
   fixed by hand rather than by arguing with it in the chat. */
function NoteSection({ title, status, error, children }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
        <span className="text-[11px] text-zinc-500 truncate">{status}</span>
      </div>
      {children}
      {error && <p className="text-[11px] text-zinc-100">Last update failed: {error}</p>}
    </section>
  );
}

function NoteButtons({ canSave, onSave, onUpdate, updating, canUpdate, onClear }) {
  return (
    <div className="flex items-center gap-2">
      <AccBtn
        onClick={onSave}
        disabled={!canSave}
        className="px-3 py-1.5 rounded-lg text-xs"
      >
        Save
      </AccBtn>
      <Button size="sm" onClick={onUpdate} disabled={!canUpdate} aria-busy={updating || undefined}>
        {updating ? "Updating…" : "Update now"}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} className="ml-auto text-zinc-500 hover:text-zinc-100">
        Clear
      </Button>
    </div>
  );
}

function MemoryPanel({ chat, settings, busy, onSave, onUpdate, books, allBooks, onToggleBook }) {
  const memory = chat.memory;
  const scene = chat.scene;
  const msgs = chat.messages;
  const [mem, setMem] = useState(activeSummary(msgs, memory));
  const [sc, setSc] = useState(scene?.text || "");
  /* While a field is being edited, a background update does not replace it. */
  const [memDirty, setMemDirty] = useState(false);
  const [scDirty, setScDirty] = useState(false);
  const memNow = activeSummary(msgs, memory);
  const scNow = scene?.text || "";
  useEffect(() => { if (!memDirty) setMem(memNow); }, [memNow, memDirty]);
  useEffect(() => { if (!scDirty) setSc(scNow); }, [scNow, scDirty]);

  const covered = memoryCovered(msgs, memory);
  const memOn = settings.memoryOn !== false;
  const sceneOn = settings.sceneEvery > 0;

  return (
      <div className="space-y-6">
        <NoteSection
          title="Story so far"
          status={!memOn ? "off in Settings" : covered ? `covers the first ${covered} message${covered === 1 ? "" : "s"}` : "nothing summarised yet"}
          error={memory?.error}
        >
          <TextArea
            rows={7}
            value={mem}
            onChange={(e) => { setMemDirty(true); setMem(e.target.value); }}
            placeholder="Written automatically once old messages start leaving the conversation window. You can also write it yourself."
          />
          <NoteButtons
            canSave={memDirty}
            onSave={() => { onSave("memory", mem); setMemDirty(false); }}
            onUpdate={() => onUpdate("memory")}
            updating={busy === "memory"}
            canUpdate={!busy && msgs.length > 4}
            onClear={() => { onSave("memory", ""); setMemDirty(false); }}
          />
        </NoteSection>

        <NoteSection
          title="Scene"
          status={!sceneOn ? "off in Settings" : `updated every ${settings.sceneEvery} replies`}
          error={scene?.error}
        >
          <TextArea
            rows={7}
            value={sc}
            onChange={(e) => { setScDirty(true); setSc(e.target.value); }}
            placeholder={"Time: …\nLocation: …\nPresent: …"}
          />
          <NoteButtons
            canSave={scDirty}
            onSave={() => { onSave("scene", sc); setScDirty(false); }}
            onUpdate={() => onUpdate("scene")}
            updating={busy === "scene"}
            canUpdate={!busy && msgs.length > 0}
            onClear={() => { onSave("scene", ""); setScDirty(false); }}
          />
        </NoteSection>

        <LoreSection chat={chat} settings={settings} books={books} allBooks={allBooks} onToggleBook={onToggleBook} />
      </div>
  );
}

/* Which lorebooks this chat uses, and what they would send right now. */
function LoreSection({ chat, settings, books, allBooks, onToggleBook }) {
  const on = settings.loreOn !== false;
  const attached = new Set(chat.lorebookIds || []);
  const embedded = books.filter((b) => !allBooks.some((x) => x.id === b.id));
  const lore = on
    ? selectLore(books, chat.messages, { depth: settings.loreDepth || DEFAULT_SCAN_DEPTH, budget: settings.loreBudget || DEFAULT_LORE_BUDGET })
    : { constant: [], triggered: [] };
  const active = [...lore.constant, ...lore.triggered];

  return (
    <NoteSection title="Lorebooks" status={!on ? "off in Settings" : active.length ? `${active.length} entr${active.length === 1 ? "y" : "ies"} active now` : "nothing active now"}>
      <div className="space-y-1.5">
        {embedded.map((b) => (
          <div key={b.id} className="flex items-center gap-3 px-3 py-2 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)]">
            <BookMarked size={14} className="text-zinc-500 shrink-0" />
            <span className="text-sm text-zinc-200 flex-1 min-w-0 truncate">{b.name}</span>
            <span className="text-[10px] text-zinc-500 shrink-0">from the card</span>
          </div>
        ))}
        {allBooks.map((b) => {
          const sel = attached.has(b.id);
          return (
            <button
              key={b.id}
              onClick={() => onToggleBook(b.id)}
              style={sel ? selStyle(true) : {}}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border text-left  ${sel ? "" : "border-zinc-800 bg-[var(--nv-control)] hover:border-zinc-600"}`}
            >
              <BookMarked size={14} className="shrink-0" style={{ color: sel ? "var(--acc)" : "var(--nv-ink)" }} />
              <span className="text-sm text-zinc-200 flex-1 min-w-0 truncate">{b.name}</span>
              <span className="text-[10px] text-zinc-500 shrink-0">{b.entries.length}</span>
              {sel && <Check size={14} style={{ color: "var(--acc)" }} className="shrink-0" />}
            </button>
          );
        })}
        {!embedded.length && !allBooks.length && (
          <p className="text-[11px] text-zinc-600">No lorebooks yet. Make or import one under Create → Your Lorebooks.</p>
        )}
      </div>
      {active.length > 0 && (
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          Active: {active.map((e) => entryLabel(e)).join(" · ")}
        </p>
      )}
    </NoteSection>
  );
}

/* What one request is made of, estimated from the text (tokens.js). The
   history is measured against its allowance (Settings → Replies), the only
   budget Nova itself enforces; the model's own window is larger. */
const TOKEN_PARTS = [
  { key: "systemTokens", label: "Instructions", sub: "your prompt, reply style and Nova's notes", color: "var(--nv-ink)", opacity: 0.28 },
  { key: "cardTokens", label: "Card", sub: "who you are talking to, and your persona", color: "var(--nv-ink)", opacity: 0.4 },
  { key: "loreTokens", label: "Lore", sub: "lorebook entries in play now", color: "var(--nv-ink)", opacity: 0.52 },
  { key: "noteTokens", label: "Quick tweaks", sub: "", color: "var(--nv-ink)", opacity: 0.64 },
  { key: "memoryTokens", label: "Memory", sub: "the story so far and scene notes", color: "var(--nv-ink)", opacity: 0.78 },
  { key: "historyTokens", label: "Conversation", sub: "the messages resent each turn", color: "var(--acc)", opacity: 1 },
];

function TokenBreakdownView({ breakdown, historyBudget }) {
  const parts = TOKEN_PARTS.map((p) => ({ ...p, tokens: breakdown[p.key] || 0 }));
  const sum = parts.reduce((n, p) => n + p.tokens, 0) || 1;
  const histPct = Math.min(100, Math.round((breakdown.historyTokens / (historyBudget || 1)) * 100));
  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-[var(--nv-control)] border border-[var(--nv-line)] space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-zinc-400">Each request, about</span>
          <span className="text-lg font-medium tabular-nums text-zinc-100">{formatTokens(breakdown.totalTokens)} tokens</span>
        </div>
        <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-[var(--nv-control)]" aria-label="Token usage by part">
          {parts.map((p) => p.tokens > 0 && (
            <div key={p.key} className="h-full" style={{ width: `${(p.tokens / sum) * 100}%`, background: p.color, opacity: p.opacity }} title={`${p.label}: ${formatTokens(p.tokens)}`} />
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">
          Conversation: {formatTokens(breakdown.historyTokens)} of its {formatTokens(historyBudget)} allowance ({histPct}%). Estimates from the text; pictures and provider formatting are not counted.
        </p>
      </div>
      <div className="space-y-1.5">
        {parts.map((p) => (
          <div key={p.key} className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[var(--nv-control)] border border-[var(--nv-line)]">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color, opacity: p.opacity }} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-zinc-200">{p.label}</p>
              {p.sub && <p className="text-[11px] text-zinc-500 truncate">{p.sub}</p>}
            </div>
            <span className="text-xs tabular-nums text-zinc-300 shrink-0">{formatTokens(p.tokens)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

