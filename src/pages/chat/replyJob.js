import { activeModel, completeText, hasKey, servedElsewhere, sourceOf, streamChat } from "../../lib/api.js";
import { DEFAULT_HISTORY_TOKENS } from "../../lib/data.js";
import { addHappening, cleanNote, withChatMemory, memoryCovered, memoryDue, parseWorldNote, sceneDue, sceneRequest, sceneWindow, summaryRequest, visibleLog, worldSceneRequest } from "../../lib/memory.js";
import { anchorOf } from "../../lib/anchor.js";
import { phoneAccounts, phoneNote } from "../../lib/phone.js";
import { messageStamp } from "../../lib/phoneClock.js";
import { phoneReplyStarting, requestPhone } from "./phoneJob.js";
import { bannedHits, bannedList, buildApiMessages } from "../../lib/prompt.js";
import { chatBooks } from "../../lib/lore.js";
import { NOT_A_PERSON, cardScanRequest, castMember, describeRequest, ensembleOf, ensembleTitle, newFromCard, parseCardCast, scopeCandidates, scopeNote, scopeOf, takeContinue } from "../../lib/scope.js";
import { addSwipe, editMessage } from "../../lib/swipes.js";
import { hideNotes, joinContinuation, stripTracker, trimToSentence } from "../../lib/text.js";
import { uid } from "../../lib/util.js";
import { genParams } from "../../lib/styles.js";
import { applyRegex } from "../../lib/tavern.js";
import { activity, activityModelLabel, dismissActivity, runActivity, startActivity } from "../../lib/activity.js";
import { createStreamStore } from "./streamStore.js";

const replies = new Map();
export const waitForReply = chatId => replies.get(chatId) || Promise.resolve();

const running = (key) => activity.get().find(j => j.status === "running" && j.dedupeKey === key);
const sideLabels = { memory: "Memory Summary", scene: "Scene Notes", describe: "Scope · Describe", scan: "Scope · Card Scan", phone: "Phone" };

/* the island's words for the chat's pre-flight error codes */
const FAIL_TEXT = { "no-key": "Add a provider key in Settings", "no-model": "Choose a model in Settings" };

/* What "Try again" keeps on the chat: the history as an anchor (the id of
   its last message and its length) and messages in opts by id, never a copy
   of the chat, since the record is saved and backed up. */
const MESSAGE_OPTS = ["message", "swipeOf"];
export function retryRecord({ kind, opts, history } = {}) {
  const kept = {};
  for (const [k, v] of Object.entries(opts || {})) kept[k] = MESSAGE_OPTS.includes(k) && v?.id ? { id: v.id } : v;
  return { kind, opts: kept, ...(Array.isArray(history) ? { anchorId: history.at(-1)?.id ?? null, length: history.length } : {}) };
}

/* A record (saved, from an older build with a full history, or the failed
   job's live stream) read against the chat as it is now. `fresh` is false
   when the messages it answered are no longer the chat's. */
export function retryRun(record, messages = []) {
  if (!record) return null;
  if (Array.isArray(record.history)) {
    return { kind: record.kind, opts: record.opts || {}, history: record.history, fresh: record.history.every((m, i) => messages[i]?.id === m.id) };
  }
  const opts = { ...(record.opts || {}) };
  for (const k of MESSAGE_OPTS) if (opts[k]?.id) opts[k] = messages.find(m => m.id === opts[k].id) || opts[k];
  if (typeof record.length !== "number") return { kind: record.kind, opts, history: undefined, fresh: true };
  const history = messages.slice(0, record.length);
  const fresh = history.length === record.length && (history.at(-1)?.id ?? null) === (record.anchorId ?? null);
  return { kind: record.kind, opts, history, fresh };
}

export function startReply({ getData, update, chatId, kind = "generate", history, opts = {} }) {
  if (replies.has(chatId)) return replies.get(chatId);
  const chat = getData().chats.find(c => c.id === chatId);
  if (!chat) return Promise.resolve();
  /* a new attempt replaces this chat's earlier failed replies on the island */
  for (const j of activity.get()) if (j.kind === "reply" && j.status === "error" && j.owner?.chatId === chatId) dismissActivity(j.id);
  /* the phone never holds a reply up: on a local endpoint its batch steps
     aside and runs again after (phoneJob.js) */
  phoneReplyStarting(chatId, getData().settings);
  const stream = createStreamStore();
  stream.set({ kind, opts, history, chainOn: false });
  const label = kind === "continue" ? "Continue" : kind === "impersonate" ? "Impersonate" : chat.kind === "universe" ? "Universe Reply" : "Character Reply";
  const promise = runActivity({ kind: "reply", label, owner: { chatId }, dedupeKey: `reply:${chatId}`, stream, model: activityModelLabel(getData().settings) }, async handle => {
    const job = chatWork({ getData, update, chatId, stream, handle });
    if (kind === "continue") await job.continueMessage(opts.message);
    else if (kind === "impersonate") {
      await job.impersonateUser(opts.guidance);
      const result = { draft: stream.get().draft || "" };
      // Cancel removes its activity immediately; retain the partial draft for a remount.
      if (handle.signal.aborted && result.draft) startActivity({ kind: "reply", label, owner: { chatId }, stream }).done(result);
      else if (!handle.signal.aborted) return result;
    }
    else await job.generate(history || chat.messages, opts);
  }).catch(() => {}).finally(() => replies.delete(chatId));
  replies.set(chatId, promise);
  return promise;
}

export function startChatSide({ getData, update, chatId, kind, messages, opts = {}, member }) {
  if (!getData().chats.some(c => c.id === chatId)) return Promise.resolve();
  const work = chatWork({ getData, update, chatId });
  if (kind === "scan") return work.scanCard();
  if (kind === "describe") return work.describeMember(member, messages);
  /* the phone on demand (phoneJob.js queue): an answer to the persona's
     pending actions, else a refresh */
  if (kind === "phone") {
    const h = getData().chats.find(c => c.id === chatId)?.handset;
    requestPhone(chatId, { mode: h?.tick?.pending ? "respond" : "refresh" }, { getData, update });
    return Promise.resolve();
  }
  return work.runNotes(messages, opts);
}

function chatWork({ getData, update, chatId, stream = createStreamStore(), handle }) {
  const data = getData(), chat = data.chats.find(c => c.id === chatId);
  const chatRef = { get current() { return getData().chats.find(c => c.id === chatId) || chat; } };
  const isUni = chat.kind === "universe";
  const universe = isUni ? data.universes.find(c => c.id === chat.universeId) : null;
  const character = !isUni ? data.characters.find(c => c.id === chat.characterId) : null;
  /* your other characters in this chat's Scope cast, sent as whole cards */
  const ensemble = character ? ensembleOf(chat, data.characters) : [];
  const persona = data.personas.find(p => p.id === chat.personaId);
  const userName = persona?.name || data.username || "You";
  const charLabel = isUni ? universe?.name : ensemble.length ? ensembleTitle([character, ...ensemble]) : character?.name;
  const books = chatBooks({ chat, character, ensemble, universe, lorebooks: data.lorebooks });
  const leads = isUni ? universe?.characters || [] : character ? [character] : [];
  const notCast = isUni ? [...leads, universe?.name, ...(universe?.locations || []).map(l => l.name)] : leads;
  const scopeActive = scopeOf(chat).mode !== "off";
  /* this chat's own memory switches over the app's (memory.js) */
  const mine = withChatMemory(data.settings, chat);
  const scopeSettings = scopeActive && !(mine.sceneEvery > 0) && !chat.memoryOff?.scene ? { ...mine, sceneEvery: 2 } : mine;
  /* who leads the next reply, picked from the cast strip for one reply:
     { name, characterId? } or { narrator: true } */
  const pickedLead = stream.get().opts?.lead || null;
  const varsRef = { current: null }, thinkAcc = { current: "" };
  const notesRef = { current: false }, scopeBusy = { current: false };
  const patchChatWith = fn => update(d => ({ ...d, chats: d.chats.map(c => c.id === chatId ? fn(c) : c) }));
  const saveReply = async (fn, signal) => {
    const saved = await new Promise(resolve => update(d => {
      const current = d.chats.find(c => c.id === chatId);
      const next = current && fn(current);
      resolve(next && next !== current ? next.messages : null);
      return next && next !== current ? { ...d, chats: d.chats.map(c => c.id === chatId ? next : c) } : d;
    }));
    if (!saved) return;
    /* the phone does not move on by itself: Sync to chat brings it up */
    if (!signal.aborted) void runNotes(saved);
  };
  const setError = lastError => {
    patchChatWith(c => ({ ...c, lastError, lastErrorRetry: lastError ? retryRecord(stream.get()) : null }));
    if (lastError) handle?.fail(new Error(FAIL_TEXT[lastError] || lastError));
  };
  const setIsThinking = isThinking => stream.set({ isThinking });
  const setStreamSpeaker = streamSpeaker => stream.set({ streamSpeaker });
  const setSwipingId = swipingId => stream.set({ swipingId });
  const setContinuingId = continuingId => stream.set({ continuingId });
  /* the name and picture a reply led by someone streams under */
  const leadCard = (name, characterId) =>
    (characterId && data.characters.find(c => c.id === characterId)) ||
    universe?.characters?.find(c => c.name === name) ||
    { name, avatar: scopeOf(chat).cast.find(c => c.name === name)?.avatar || null };
  let sideCanceled = false;
  const sideCall = (kind, fn, describing) => {
    if (sideCanceled || handle?.signal.aborted) return Promise.resolve();
    const key = `${kind}:${chatId}`;
    if (running(key)) return Promise.resolve();
    const sideStream = createStreamStore();
    if (describing) sideStream.set({ describing });
    return runActivity({ kind, stream: sideStream, label: sideLabels[kind], owner: { chatId }, dedupeKey: key, model: activityModelLabel(data.settings), quiet: true }, async handle => {
      const canceled = () => { sideCanceled = true; };
      handle.signal.addEventListener("abort", canceled, { once: true });
      try { await fn(handle); }
      finally { handle.signal.removeEventListener("abort", canceled); }
    });
  };
  const recordSpend = (res, { side = false } = {}) => {
    update((d) => {
      const led = { spent: 0, replies: 0, tokensIn: 0, tokensOut: 0, lastTtft: null, lastTtfb: null, ttfbAvg: null, byModel: {}, ...(d.ledger || {}) };
      const model = res.servedBy || activeModel(d.settings);
      const cost = res.cost || 0;
      return {
        ...d,
        ledger: {
          ...led,
          spent: led.spent + cost,
          /* memory and scene notes cost money but are not replies */
          replies: led.replies + (side ? 0 : 1),
          tokensIn: led.tokensIn + (res.tokensIn || 0),
          tokensOut: led.tokensOut + (res.tokensOut || 0),
          lastTtft: side ? led.lastTtft : res.ttft ?? led.lastTtft,
          lastTtfb: res.ttfb ?? led.lastTtfb,
          /* A rolling mean rather than the last value, because queue time is
             noisy enough that any single reply proves nothing. Ten samples is
             roughly one scene, which is the smallest honest comparison between
             one setting and another. */
          ttfbAvg: res.ttfb == null ? led.ttfbAvg
            : led.ttfbAvg == null ? res.ttfb
            : Math.round(led.ttfbAvg + (res.ttfb - led.ttfbAvg) / 10),
          lastModel: model,
          byModel: { ...led.byModel, [model]: (led.byModel[model] || 0) + cost },
        },
      };
    });
  };

  const generate = async (history, { instruction, continueScene, swipeOf, scopeStep = 0 } = {}) => {
    if (!hasKey(data.settings)) { setError("no-key"); return; }
    if (!activeModel(data.settings)) { setError("no-model"); return; }
    /* Scope, as of this request: who is in the scene and how it plays */
    const live = scopeOf(chatRef.current);
    const scoping = live.mode !== "off";
    let cont = false;

    /* Who leads: a new version keeps whoever the reply it replaces was
       written under; otherwise your pick from the cast strip, for this one
       reply (a scene playing on by itself leads itself). Nobody picked is
       the model's own choice. */
    const lead = swipeOf?.speaker && swipeOf.speaker !== character?.name
      ? { name: swipeOf.speaker, ...(swipeOf.speakerId ? { characterId: swipeOf.speakerId } : {}) }
      : !swipeOf && !scopeStep ? pickedLead : null;
    /* the reply is saved, and streams, under the name of whoever led it */
    const leadName = lead?.name && lead.name !== character?.name ? lead.name : null;

    setError(null);
    stream.set({ text: "", think: "", swipingId: null, continuingId: null, paused: false });
    setIsThinking(false);
    thinkAcc.current = "";
    setStreamSpeaker(leadName ? leadCard(leadName, lead.characterId) : null);
    if (swipeOf) setSwipingId(swipeOf.id);
    let acc = "";
    const controller = { signal: handle.signal };

    /* one-off instruction, never saved into the chat */
    const bits = [];
    if (continueScene) bits.push("Continue the scene naturally from where it left off, without repeating what was already said");
    if (instruction) bits.push(`Instruction for the next reply: ${instruction}`);
    /* With Scope on the lead is said in its note; without it (a universe
       with Scope off) it is a one-off instruction. */
    if (!scoping && lead?.narrator) bits.push("Reply with world narration only in this message, no character dialogue");
    else if (!scoping && leadName) bits.push(`Reply only as ${leadName} in this message`);
    /* The trailing reminder is unconditional: it is the one rule that must
       survive every mode, and a one-off instruction is exactly where a model
       is most likely to forget it. */
    const extra = bits.length ? `(${bits.join(". ")}. Never speak or act for ${userName}.)` : null;

    /* Painting on every token meant a React render per token â€” up to a hundred
       a second, each one re-rendering the whole conversation. Coalescing onto
       one animation frame keeps the text arriving smoothly and leaves the main
       thread free, which is very noticeable on a phone. */
    /* A model that echoed the scene tracker has it cut back out. Only when
       one was sent: a prompt's own header line in the same [a | b | c]
       shape (SillyTavern presets have one) is not an echo. */
    const trackerSent = ((scoping ? scopeSettings : mine).sceneEvery > 0 || isUni) && chat.scene?.text?.trim();
    const scrub = (s) => (trackerSent ? stripTracker(s, chat.scene.text) : s);

    let raf = 0;
    const paint = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const t = scrub(acc);
        stream.set({ text: scoping ? takeContinue(t).text : t, think: thinkAcc.current });
      });
    };
    const stopPainting = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

    /* Thinking only needs to be announced once, so this is a single state
       change per request rather than anything paced. */
    let announced = false;
    const announceThinking = (t) => {
      if (typeof t === "string") { thinkAcc.current += t; paint(); }
      if (announced) return;
      announced = true;
      setIsThinking(true);
    };

    /* `via` is the model that actually wrote the reply, kept only when it is
       not the one selected, so a substitute is never mistaken for the style
       being ignored. */
    const save = async (text, via) => {
      /* a preset's scripts that rewrite the reply as it is saved */
      const rewrite = genParams(scoping ? scopeSettings : mine).saved;
      if (rewrite?.length) text = applyRegex(text, rewrite, "assistant", 0, { user: userName, char: leadName || character?.name || universe?.name });
      const reply = { id: uid(), role: "assistant", content: text, at: Date.now(),
        ...(leadName ? { speaker: leadName, ...(lead.characterId ? { speakerId: lead.characterId } : {}) } : {}),
        ...(via ? { via } : {}) };
      const anchor = history.at(-1)?.id;
      await saveReply(c => {
        if (swipeOf && !c.messages.some(m => m.id === swipeOf.id)) return c;
        if (swipeOf) return { ...c, updatedAt: Date.now(), messages: c.messages.map(m => m.id === swipeOf.id ? addSwipe(m, text, via) : m) };
        const at = anchor ? c.messages.findIndex(m => m.id === anchor) : -1;
        if (anchor && at < 0) return c;
        /* the in-world minute on the phone's clock, once the phone is set up */
        const wt = messageStamp(c, "assistant");
        const saved = wt === null ? reply : { ...reply, wt };
        return { ...c, updatedAt: Date.now(), messages: [...c.messages.slice(0, at + 1), saved, ...c.messages.slice(at + 1)] };
      }, controller.signal);
    };

    /* The ban list. A reply that uses a banned phrase is rewritten once,
       automatically, with the phrases it used named in a one-off note; if the
       rewrite still has some, whichever version has fewer is kept. One retry
       and no more, because each one is a full request. With the list empty
       this is a single pass, exactly as before. */
    const banned = bannedList(data.settings.bannedPhrases);

    /* The chat's SillyTavern variables (macros.js), which an imported
       preset's dice and trackers set as the prompt is built. A ban-list
       retry starts from the same ones, so a turn is never counted twice.
       The ref carries the newest set into the next turn of a play-on run,
       which starts before the saved chat reaches this closure. */
    const varsBase = varsRef.current?.id === chatId ? varsRef.current.vars : chat.vars || {};
    let best = null;

    try {
      for (let attempt = 0; attempt < (banned.length ? 2 : 1); attempt++) {
        let turnExtra = extra;
        if (attempt) {
          acc = "";
          stream.set({ text: "" });
          const note = `Do not use these phrases: ${best.hits.map((h) => `"${h}"`).join(", ")}`;
          turnExtra = extra ? extra.replace(/\)$/, ` ${note}.)`) : `(${note}.)`;
        }
        /* the chat's variables, fresh for each attempt (see varsBase) */
        const vars = { ...varsBase };
        const messages = buildApiMessages({
          character, universe, ensemble, persona,
          memory: chat.memory, scene: chat.scene, lorebooks: books,
          authorsNote: chat.authorsNote,
          username: data.username, history, settings: scoping ? scopeSettings : mine, extra: turnExtra,
          scope: scoping
            ? scopeNote({ scope: live, character, universe, ensemble, userName, step: scopeStep, lead })
            : null,
          vars,
          ...ambientOf(history),
        });
        if (!attempt && JSON.stringify(vars) !== JSON.stringify(varsBase)) {
          varsRef.current = { id: chatId, vars };
          patchChatWith((c) => ({ ...c, vars }));
        }
        const res = await streamChat({
          settings: data.settings,
          activity: handle,
          messages,
          signal: controller.signal,
          /* The pin is per conversation, so it is the chat's own id. */
          sessionId: chatId,
          onToken: (t) => { acc += t; paint(); },
          onReasoning: announceThinking,
        });
        /* Log what that reply actually cost and how long it took to start.
           The charge is OpenRouter's own figure from the response, not an
           estimate from a price table, so it accounts for caching and
           whichever provider served it. A retry is logged as its own reply. */
        if (res && (res.cost != null || res.ttft != null || res.ttfb != null)) recordSpend(res);

        /* a model that echoed the scene tracker has it cut back out */
        let text = scrub(acc);
        /* the scene's own signal to keep playing, taken out of the reply */
        if (scoping) {
          const t = takeContinue(text);
          text = t.text;
          cont = t.cont;
        }
        /* a reply that is nothing but hidden notes shows as an empty bubble */
        if (!hideNotes(text)) {
          /* a failed retry still leaves the first version to keep */
          if (best) break;
          /* An empty reply used to be saved as a "â€¦" bubble, which looked like
             the character had answered with nothing. It is a failure, so say
             so and leave the Try again button in place. */
          setError(
            /content_filter|safety/i.test(res?.finishReason || "")
              ? "The provider's safety filter blocked this reply. Try again, or steer the scene another way."
              : res?.sawThinking
              ? "The model spent its whole reply on thinking and wrote nothing. Turn Model thinking off in Reply style, or pick another model."
              : "The model returned an empty reply. Try again, or pick another model."
          );
          return;
        }
        /* stopped by the token cap, so it ends mid-word. Providers spell this
           finish reason at least three ways. */
        const capped = /length|max_?tokens/i.test(res?.finishReason || "");
        const final = capped ? trimToSentence(text) : text;
        const asked = activeModel(data.settings);
        const via = sourceOf(data.settings) === "openrouter" && servedElsewhere(asked, res?.servedBy) ? res.servedBy : null;
        const hits = bannedHits(final, banned);
        if (!best || hits.length < best.hits.length) best = { text: final, via, hits };
        if (!hits.length) break;
      }
      if (best) await save(best.text, best.via);
    } catch (e) {
      if (e.name === "AbortError") {
        /* stopped during a rewrite: the finished first version beats half of
           the second */
        if (best) await save(best.text, best.via);
        else {
          const t = takeContinue(scrub(acc)).text;
          if (t) await save(t);
        }
        /* stopping ends a scene that was playing by itself */
        cont = false;
      } else if (best) {
        await save(best.text, best.via);
      } else if (e.message === "Failed to fetch") {
        setError("Could not reach OpenRouter. Check your connection.");
      } else {
        setError(e.message || "The API call failed.");
      }
    } finally {
      stopPainting();
      setIsThinking(false);
    }
    if (scoping && live.carry && cont && !swipeOf && scopeStep + 1 < live.turns && !handle.signal.aborted && !stream.get().stopChain) {
      stream.set({ chainOn: true, paused: true, text: "", think: "" });
      await new Promise(resolve => setTimeout(resolve, 900));
      if (!handle.signal.aborted && !stream.get().stopChain) await generate(chatRef.current.messages, { continueScene: true, scopeStep: scopeStep + 1 });
      stream.set({ chainOn: false });
    }
  };
  const noteNames = { userName, charName: charLabel || "the character" };

  const writeMemory = (messages, from, to, previous) => sideCall("memory", async activity => {
    try {
      const req = summaryRequest({ previous, messages: messages.slice(from, to), ...noteNames });
      const res = await completeText({ settings: data.settings, stream: true, activity, signal: activity.signal, ...req, maxTokens: 1200 });
      if (activity.signal.aborted) return;
      if (res.cost != null || res.tokensIn != null) recordSpend(res, { side: true });
      const summary = cleanNote(res.text);
      if (!summary) throw new Error("The model returned an empty summary.");
      const lastId = messages[to - 1].id;
      patchChatWith((c) =>
        c.messages.some((m) => m.id === lastId) ? { ...c, memory: { summary, lastId, at: Date.now() } } : c
      );
      return true;
    } catch (e) {
      activity.fail(e);
      if (activity.signal.aborted) return;
      patchChatWith((c) => ({ ...c, memory: { ...(c.memory || {}), error: e.message || "The summary failed." } }));
      return false;
    }
 });

  /* A universe's tracker is the world tracker (memory.js): the scene plus
     where everyone else is and one thing going on off-screen, which joins
     the world log in the same update. */
  const writeScene = (messages) => sideCall("scene", async activity => {
    try {
      const prev = chatRef.current?.scene;
      const base = { previous: prev?.text?.trim() || "", messages: sceneWindow(messages, prev), ...noteNames };
      const req = isUni
        ? worldSceneRequest({ ...base, worldName: universe?.name, characters: universe?.characters, locations: universe?.locations })
        : sceneRequest(base);
      const res = await completeText({ settings: data.settings, stream: true, activity, signal: activity.signal, ...req, maxTokens: isUni ? 700 : 600 });
      if (activity.signal.aborted) return;
      if (res.cost != null || res.tokensIn != null) recordSpend(res, { side: true });
      const text = cleanNote(res.text);
      if (!text) throw new Error("The model returned empty notes.");
      const last = messages[messages.length - 1];
      const lastId = last.id;
      const happening = isUni ? parseWorldNote(text).happening : "";
      const anchor = anchorOf(last);
      patchChatWith((c) => {
        if (!c.messages.some((m) => m.id === lastId)) return c;
        const next = { ...c, scene: { text, lastId, at: Date.now() } };
        const world = happening ? addHappening(c.world, happening, anchor, uid(), c.messages) : c.world;
        if (world !== c.world) next.world = world;
        return next;
      });
      return true;
    } catch (e) {
      activity.fail(e);
      if (activity.signal.aborted) return;
      patchChatWith((c) => ({ ...c, scene: { ...(c.scene || {}), error: e.message || "The scene update failed." } }));
      return false;
    }
 });

  const runNotes = async (messages, { forceMemory = false, forceScene = false } = {}) => {
    if (notesRef.current || !messages.length) return;
    const s = withChatMemory(data.settings, chatRef.current);
    const current = chatRef.current;
    let mem = s.memoryOn !== false ? memoryDue(messages, s.historyTokens || DEFAULT_HISTORY_TOKENS, current?.memory) : null;
    if (forceMemory) {
      /* "Update now": everything but the last few exchanges, which are still
         in the window word for word anyway */
      const from = memoryCovered(messages, current?.memory);
      const to = Math.max(mem?.to || 0, messages.length - 4);
      mem = to > from ? { from, to, previous: from ? current.memory.summary.trim() : "" } : null;
    }
    /* Scope needs to know where everyone is, so it keeps the tracker going
       even where scene tracking is switched off */
    const every = isUni ? 2 : scopeActive && !(s.sceneEvery > 0) ? 2 : s.sceneEvery;
    const scene = forceScene || sceneDue(messages, current?.scene, every);
    if (!mem && !scene) { runScope(messages); return; }
    notesRef.current = true;
    try {
      if (mem) await writeMemory(messages, mem.from, mem.to, mem.previous);
      if (scene) await writeScene(messages);
    } finally {
      notesRef.current = false;
    }
    runScope(messages);
  };

  /* ---------- Scope: the cast keeping itself up to date ----------

     After each reply, in the background and one at a time: in auto mode the
     next person who has come up often enough joins, then anyone in the cast
     without a description gets one, written from what the story has shown of
     them. A name that turns out not to be a person is dismissed for good. */
  const patchScope = (fn) => patchChatWith((c) => ({ ...c, scope: fn(scopeOf(c)) }));

  const describeMember = (member, messages) => sideCall("describe", async activity => {
    try {
      const req = describeRequest({ name: member.name, messages, charName: charLabel || "the character", userName });
      const res = await completeText({ settings: data.settings, stream: true, activity, signal: activity.signal, ...req, maxTokens: 300 });
      if (activity.signal.aborted) return;
      if (res.cost != null || res.tokensIn != null) recordSpend(res, { side: true });
      const text = cleanNote(res.text);
      if (text.includes(NOT_A_PERSON)) {
        patchScope((x) => ({ ...x, cast: x.cast.filter((c) => c.id !== member.id), dismissed: [...x.dismissed, member.name] }));
      } else if (text) {
        patchScope((x) => ({ ...x, cast: x.cast.map((c) => (c.id === member.id && !c.description ? { ...c, description: text } : c)) }));
      }
    } catch (e) {
      activity.fail(e);
      /* left without a description; it is tried again after the next reply */
    }
  }, member.name);

  const runScope = async (messages) => {
    if (sideCanceled || handle?.signal.aborted) return;
    const current = chatRef.current;
    const live = scopeOf(current);
    if (scopeBusy.current || live.mode === "off" || !hasKey(data.settings)) return;
    scopeBusy.current = true;
    try {
      let next = null;
      if (live.mode === "auto") {
        const name = scopeCandidates({ ...current, messages }, notCast, userName)[0];
        if (name) {
          next = castMember({ id: uid(), name, auto: true });
          patchScope((x) => (x.cast.some((c) => c.name === name) ? x : { ...x, cast: [...x.cast, next] }));
        }
      }
      const todo = next || live.cast.find((c) => !c.description?.trim() && !c.characterId);
      if (todo) await describeMember(todo, messages);
    } finally {
      scopeBusy.current = false;
    }
  };

  /* ---------- Scope: the people the card already names ----------

     The card (with any linked members' cards), or the universe. Read once
     whenever Scope is on and it has not been read for this chat yet: as a chat starts with Scope on, or the moment it is switched
     on mid-chat. Everyone found joins with the card's own description. A
     failed read is left unmarked, so it is tried again next time. */
  const scanRef = { current: false };
  const scanCard = () => sideCall("scan", async activity => {
    if (scopeOf(chatRef.current).cardScanned || scanRef.current || !(character || universe) || !hasKey(data.settings)) return;
    scanRef.current = true;
    try {
      const req = cardScanRequest({ character, universe, ensemble, userName });
      const res = await completeText({ settings: data.settings, stream: true, activity, signal: activity.signal, ...req, maxTokens: 1200 });
      if (activity.signal.aborted) return;
      if (res.cost != null || res.tokensIn != null) recordSpend(res, { side: true });
      const found = parseCardCast(res.text);
      patchScope((x) => ({
        ...x,
        cardScanned: true,
        cast: [
          ...x.cast,
          ...newFromCard(found, x, notCast, userName).map((f) => ({ ...castMember({ id: uid(), name: f.name, description: f.description, auto: true }), fromCard: true })),
        ],
      }));
    } catch (e) {
      activity.fail(e);
      /* not marked: tried again the next time the chat opens or Scope is switched on */
    } finally {
      scanRef.current = false;
    }
 });
  const impersonateUser = async (customPrompt) => {
    if (!hasKey(data.settings)) { setError("no-key"); return; }
    if (!activeModel(data.settings)) { setError("no-model"); return; }

    const userGuidance = (typeof customPrompt === "string" ? customPrompt : "").trim();
    setError(null);
    stream.set({ draft: "" });

    const controller = { signal: handle.signal };

    const history = chatRef.current.messages;
    const persona = data.personas.find((p) => p.id === chat.personaId) || null;

    const instruction = userGuidance
      ? `Write the next message strictly from the perspective of ${userName}, staying fully in character and advancing the scene. Follow this intent or outline: "${userGuidance}". Output only ${userName}'s dialogue and narration, no conversational commentary or prefix.`
      : `Write the next message strictly from the perspective of ${userName}, staying fully in character and advancing the scene naturally. Output only ${userName}'s dialogue and narration, no conversational commentary or prefix.`;

    const msgs = buildApiMessages({
      character,
      universe,
      ensemble,
      persona,
      username: userName,
      history,
      settings: mine,
      extra: instruction,
      mode: "impersonate",
      direction: userGuidance,
      memory: chatRef.current.memory,
      scene: chatRef.current.scene,
      lorebooks: books,
      authorsNote: chatRef.current?.authorsNote || chat.authorsNote,
      vars: { ...(chatRef.current.vars || {}) },
      ...ambientOf(history),
    });

    let acc = "";
    /* one paint of the box per frame, not per token */
    let raf = 0;
    try {
      const res = await streamChat({
        settings: data.settings,
        activity: handle,
        messages: msgs,
        signal: controller.signal,
        onToken: (tok) => {
          acc += tok;
          if (!raf) raf = requestAnimationFrame(() => { raf = 0; stream.set({ draft: acc }); });
        },
      });
      if (res.cost != null || res.tokensIn != null) recordSpend(res);
      let cleaned = acc.trim();
      if (cleaned.startsWith(`${userName}:`)) cleaned = cleaned.slice(userName.length + 1).trim();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      stream.set({ draft: cleaned });
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e?.message || "Impersonation failed");
      }
    } finally {
      if (raf) cancelAnimationFrame(raf);
      if (controller.signal.aborted) stream.set({ draft: acc });
    }
  };

  const continueMessage = async (msg) => {
    msg = chatRef.current.messages.find(m => m.id === msg?.id);
    if (msg?.role !== "assistant") return;
    if (!hasKey(data.settings)) { setError("no-key"); return; }
    if (!activeModel(data.settings)) { setError("no-model"); return; }
    const i = chat.messages.findIndex(m => m.id === msg.id);
    if (i < 0) return;
    setError(null);

    const controller = { signal: handle.signal };
    const original = msg.content;
    const saveMore = more => saveReply(c => c.messages.some(m => m.id === msg.id) ? { ...c, updatedAt: Date.now(), messages: c.messages.map(m => m.id === msg.id ? editMessage(m, joinContinuation(original, more)) : m) } : c, controller.signal);

    setContinuingId(msg.id);
    stream.set({ text: "", think: "" });
    setIsThinking(false);
    thinkAcc.current = "";

    let acc = "";
    let raf = 0;
    const paint = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        /* the row shows the stream itself (chat/MessageRow.jsx); the chat is
           written once, when the continuation ends */
        stream.set({ text: acc });
      });
    };
    const stopPainting = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };

    try {
      const vars = { ...(varsRef.current?.id === chatId ? varsRef.current.vars : chat.vars || {}) };
      const scoping = scopeOf(chatRef.current).mode !== "off";
      const messages = buildApiMessages({
        character, universe, ensemble, persona,
        memory: chat.memory, scene: chat.scene, lorebooks: books,
        authorsNote: chat.authorsNote,
        username: data.username,
        history: chatRef.current.messages.slice(0, i + 1),
        settings: scoping ? scopeSettings : data.settings,
        mode: "continue",
        extra: "[Continue your last message from exactly where it stopped. Do not repeat anything already written; write only the new text.]",
        vars,
        ...ambientOf(chatRef.current.messages.slice(0, i + 1)),
      });
      const res = await streamChat({
        settings: data.settings,
        activity: handle,
        messages,
        signal: controller.signal,
        sessionId: chatId,
        onToken: (t) => { acc += t; paint(); },
        onReasoning: (t) => { if (typeof t === "string") thinkAcc.current += t; setIsThinking(true); },
      });
      if (res && (res.cost != null || res.ttft != null || res.ttfb != null)) recordSpend(res);
      stopPainting();
      await saveMore(acc);
    } catch (e) {
      stopPainting();
      if (e.name === "AbortError") {
        if (acc) await saveMore(acc);
      } else {
        setError(e.message === "Failed to fetch" ? "Could not reach the API. Check your connection." : e.message || "Continuation failed.");
      }
    } finally {
      stopPainting();
      setContinuingId(null);
      setIsThinking(false);
    }
  };


  /* ---------- ambient context for a reply ----------

     A universe's visible world log and the phone's recent activity, read
     against the messages the reply answers, so a version being replaced
     (and anything anchored to it) is not part of it. */
  const accountsOf = (c) => phoneAccounts({ chat: c, character, ensemble: ensembleOf(c, data.characters), universe, userName });
  const ambientOf = (history) => {
    const c = { ...chatRef.current, messages: Array.isArray(history) ? history : chatRef.current.messages };
    return {
      world: isUni ? visibleLog(c) : undefined,
      phone: phoneNote(c, { userName, nameOf: accountsOf(c).nameOf }) || undefined,
    };
  };

  return { generate, continueMessage, impersonateUser, runNotes, describeMember, scanCard };
}
