// @vitest-environment jsdom
/* Task 4A · chat: background reply jobs under navigation, remounts,
   concurrent chats, provider errors and the Scope play-on chain. The model is
   replaced by hand-driven streams so each test decides when tokens land. */
import React, { Profiler, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { ChatDataSource } from "../src/pages/chat/appData.jsx";
import { emptyData } from "../src/lib/data.js";
import { activity, cancelWhere, clearActivity, dismissActivity, startActivity } from "../src/lib/activity.js";
import { retryRecord, retryRun, startReply, waitForReply } from "../src/pages/chat/replyJob.js";

const mocks = vi.hoisted(() => ({ streams: [], sides: [] }));
vi.mock("../src/lib/api.js", async original => ({ ...await original(),
  streamChat: vi.fn(args => new Promise((resolve, reject) => {
    const request = { ...args, finish: (text = "") => { if (text) args.onToken(text); resolve({}); }, fail: message => reject(new Error(message)) };
    mocks.streams.push(request);
    args.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
  })),
  completeText: vi.fn(args => new Promise(resolve => mocks.sides.push({ ...args, finish: text => resolve({ text }) }))),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let data, host, root, visible;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
const wait = async ms => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); await flush(); };
const getData = () => data;
const update = patch => { data = typeof patch === "function" ? patch(data) : { ...data, ...patch }; render(); };
const render = () => root.render(<><ChatDataSource data={data} />{visible && <ChatPage data={data} chatId={visible} update={update} goBack={() => {}} goSettings={() => {}} />}</>);
const show = async id => { visible = id; await act(async () => render()); await flush(); };
const run = (chatId = "a", options = {}) => startReply({ getData, update, chatId, ...options });
const button = label => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === label || b.getAttribute("aria-label") === label);
const click = async label => { const el = button(label); expect(el, label).toBeTruthy(); await act(async () => el.click()); await flush(); };
const type = async text => { const el = host.querySelector("textarea"); await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, text); el.dispatchEvent(new Event("input", { bubbles: true })); }); };
const chatOf = id => data.chats.find(c => c.id === id);
const contents = id => chatOf(id).messages.map(m => m.content);
const replyJobs = () => activity.get().filter(j => j.kind === "reply");
const runningReply = chatId => replyJobs().find(j => j.status === "running" && j.owner.chatId === chatId);
const sent = request => request.messages.map(m => typeof m.content === "string" ? m.content : JSON.stringify(m.content)).join("\n");
const patchChat = (id, fn) => { data = { ...data, chats: data.chats.map(c => c.id === id ? fn(c) : c) }; };

beforeEach(async () => {
  clearActivity(); vi.clearAllMocks(); mocks.streams.length = 0; mocks.sides.length = 0;
  vi.stubGlobal("requestAnimationFrame", fn => setTimeout(fn, 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  data = structuredClone(emptyData); data.username = "Ana"; data.settings.providers[0].key = "test"; data.settings.providers[0].model = "test-model"; data.settings.sceneEvery = 0;
  data.characters = [{ id: "c", name: "Mira", greetings: [] }, { id: "d", name: "Tobin", greetings: [] }];
  data.universes = [{ id: "u", name: "Vale", story: "A valley.", characters: [{ id: "uc", name: "Rook" }], locations: [] }];
  data.chats = ["a", "b"].map(id => ({ id, kind: "character", characterId: "c", messages: [{ id: `${id}-g`, role: "assistant", content: `Hello ${id}.` }, { id: `${id}-u`, role: "user", content: `Question ${id}` }] }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await show("a");
});
afterEach(async () => {
  await act(async () => { cancelWhere(() => true); await Promise.all(data.chats.map(c => waitForReply(c.id))); root.unmount(); clearActivity(); });
  host.remove(); vi.unstubAllGlobals();
});

describe("navigate away and back during a stream", () => {
  it("keeps painting new tokens after several remounts and saves exactly one reply", async () => {
    await act(async () => { void run(); mocks.streams[0].onToken("One"); }); await flush();
    for (const word of [" two", " three"]) {
      await show(null); await show("b"); await show("a");
      await act(async () => mocks.streams[0].onToken(word)); await flush();
    }
    expect(host.textContent).toContain("One two three");
    await act(async () => mocks.streams[0].finish(" four")); await flush();
    expect(contents("a")).toEqual(["Hello a.", "Question a", "One two three four"]);
    expect(mocks.streams).toHaveLength(1);
  });

  it("finishes while the chat is closed and the saved reply shows on return without a stream bubble", async () => {
    await act(async () => { void run(); mocks.streams[0].onToken("Half"); }); await show(null);
    await act(async () => mocks.streams[0].finish(" done.")); await flush();
    expect(runningReply("a")).toBeUndefined();
    await show("a");
    expect(host.textContent.match(/Half done\./g)).toHaveLength(1);
    expect(button("Stop generating")).toBeUndefined();
  });

  it("Stop after a remount with no tokens streamed saves nothing", async () => {
    await act(async () => { void run(); }); await show(null); await show("a");
    await click("Stop generating"); await act(async () => waitForReply("a"));
    expect(contents("a")).toEqual(["Hello a.", "Question a"]);
    expect(runningReply("a")).toBeUndefined();
  });

  it("dedupes a second start for the same chat into the running job", async () => {
    let first, second;
    await act(async () => { first = run(); second = run(); }); await flush();
    expect(second).toBe(first);
    expect(mocks.streams).toHaveLength(1);
    expect(replyJobs().filter(j => j.status === "running")).toHaveLength(1);
    await act(async () => mocks.streams[0].finish("Only one")); await flush();
    expect(contents("a").filter(t => t === "Only one")).toHaveLength(1);
  });
});

describe("send after return", () => {
  it("a composer send after an off-screen completion appends after the new reply", async () => {
    await act(async () => { void run(); }); await show(null);
    await act(async () => mocks.streams[0].finish("Answer one")); await flush();
    await show("a"); await type("Follow up"); await click("Send");
    await act(async () => mocks.streams[1].finish("Answer two")); await flush();
    expect(contents("a")).toEqual(["Hello a.", "Question a", "Answer one", "Follow up", "Answer two"]);
    expect(sent(mocks.streams[1])).toContain("Answer one");
  });

  it("inserts a late reply after its anchor while keeping messages added during the stream", async () => {
    await act(async () => { void run(); }); await show(null);
    patchChat("a", c => ({ ...c, messages: [...c.messages, { id: "x1", role: "user", content: "Extra 1" }, { id: "x2", role: "user", content: "Extra 2" }] }));
    await act(async () => mocks.streams[0].finish("Late reply")); await show("a");
    expect(contents("a")).toEqual(["Hello a.", "Question a", "Late reply", "Extra 1", "Extra 2"]);
  });

  it("keeps an edit made to an earlier message while the reply streamed", async () => {
    await act(async () => { void run(); }); await show(null);
    patchChat("a", c => ({ ...c, messages: c.messages.map(m => m.id === "a-g" ? { ...m, content: "Edited greeting." } : m) }));
    await act(async () => mocks.streams[0].finish("Reply")); await flush();
    expect(contents("a")).toEqual(["Edited greeting.", "Question a", "Reply"]);
  });
});

describe("swipe, continue and impersonate across remounts", () => {
  it("a swipe that finishes off-screen adds a version instead of a new message", async () => {
    const target = { id: "a-r", role: "assistant", content: "First version" };
    patchChat("a", c => ({ ...c, messages: [...c.messages, target] })); await show("a");
    await act(async () => { void run("a", { history: chatOf("a").messages.slice(0, 2), opts: { swipeOf: target } }); }); await show(null);
    await act(async () => mocks.streams[0].finish("Second version")); await show("a");
    const msg = chatOf("a").messages.at(-1);
    expect(chatOf("a").messages).toHaveLength(3);
    expect(msg).toMatchObject({ id: "a-r", content: "Second version", swipeIdx: 1 });
    expect(msg.swipes.map(s => s.text)).toEqual(["First version", "Second version"]);
  });

  it("a swipe whose target was deleted mid-stream saves nothing", async () => {
    const target = { id: "a-r", role: "assistant", content: "First version" };
    patchChat("a", c => ({ ...c, messages: [...c.messages, target] })); await show("a");
    await act(async () => { void run("a", { history: chatOf("a").messages.slice(0, 2), opts: { swipeOf: target } }); }); await show(null);
    patchChat("a", c => ({ ...c, messages: c.messages.filter(m => m.id !== "a-r") }));
    await act(async () => mocks.streams[0].finish("Orphan version")); await show("a");
    expect(contents("a")).toEqual(["Hello a.", "Question a"]);
  });

  it("Continue started before leaving joins the text onto the same bubble on return", async () => {
    const message = chatOf("a").messages[0];
    await act(async () => { void run("a", { kind: "continue", opts: { message } }); mocks.streams[0].onToken(" And more"); }); await flush();
    await show(null); await show("a");
    expect(runningReply("a").stream.get().kind).toBe("continue");
    await act(async () => mocks.streams[0].finish(" words.")); await flush();
    expect(chatOf("a").messages).toHaveLength(2);
    expect(chatOf("a").messages[0].content).toBe("Hello a. And more words.");
  });

  it("stopping a Continue after a remount keeps the partial continuation", async () => {
    const message = chatOf("a").messages[0];
    await act(async () => { void run("a", { kind: "continue", opts: { message } }); mocks.streams[0].onToken(" Partial"); }); await flush();
    await show(null); await show("a"); await click("Stop generating"); await act(async () => waitForReply("a"));
    expect(chatOf("a").messages[0].content).toBe("Hello a. Partial");
    expect(chatOf("a").messages).toHaveLength(2);
  });

  it("an impersonation that finishes off-screen lands in the composer, not in the chat", async () => {
    await act(async () => { void run("a", { kind: "impersonate", opts: { guidance: "" } }); }); await show(null);
    await act(async () => mocks.streams[0].finish("Ana: I open the door.")); await flush();
    await show("a");
    expect(host.querySelector("textarea").value).toBe("I open the door.");
    expect(chatOf("a").messages).toHaveLength(2);
    expect(replyJobs().some(j => j.result?.draft !== undefined)).toBe(false);
  });

  it("an impersonation canceled while away keeps its partial draft for the remount", async () => {
    await act(async () => { void run("a", { kind: "impersonate", opts: { guidance: "" } }); mocks.streams[0].onToken("I hesit"); }); await flush();
    await show(null);
    await act(async () => { cancelWhere(j => j.owner.chatId === "a"); await waitForReply("a"); }); await flush();
    await show("a");
    expect(host.querySelector("textarea").value).toBe("I hesit");
    expect(chatOf("a").messages).toHaveLength(2);
  });

  it("labels jobs by kind and chat type", async () => {
    /* several of your characters: a character chat with Scope, no label of its own */
    data.chats.push({ id: "g", kind: "character", characterId: "c", scope: { mode: "manual", cardScanned: true, cast: [{ id: "x", name: "Tobin", characterId: "d", description: "" }] }, messages: [{ id: "g-u", role: "user", content: "Hi all" }] });
    data.chats.push({ id: "w", kind: "universe", universeId: "u", messages: [{ id: "w-u", role: "user", content: "Hi world" }] });
    const message = chatOf("b").messages[0];
    await act(async () => { void run("a"); void run("b", { kind: "continue", opts: { message } }); void run("g"); void run("w"); }); await flush();
    const labels = Object.fromEntries(replyJobs().map(j => [j.owner.chatId, j.label]));
    expect(labels).toEqual({ a: "Character Reply", b: "Continue", g: "Character Reply", w: "Universe Reply" });
  });
});

describe("who leads a reply", () => {
  const ensemble = () => ({ id: "g", kind: "character", characterId: "c", scope: { mode: "manual", carry: false, cardScanned: true, cast: [{ id: "x", name: "Tobin", characterId: "d", description: "" }] }, messages: [{ id: "g-u", role: "user", content: "Hi all" }] });

  it("sends the lead in the Scope note, saves the reply under them, and keeps them on a new version", async () => {
    data.chats.push(ensemble());
    await act(async () => { void run("g", { history: chatOf("g").messages, opts: { lead: { id: "x", name: "Tobin", characterId: "d" } } }); }); await flush();
    expect(sent(mocks.streams[0])).toContain("[Character: Tobin]");
    expect(sent(mocks.streams[0])).toContain("- Tobin leads this reply");
    expect(sent(mocks.streams[0])).not.toContain("Reply only as");
    await act(async () => mocks.streams[0].finish("**Tobin:** Hey.\n\n**Mira:** Hi.")); await act(async () => waitForReply("g")); await flush();
    const reply = chatOf("g").messages.at(-1);
    expect(reply).toMatchObject({ speaker: "Tobin", speakerId: "d", content: "**Tobin:** Hey.\n\n**Mira:** Hi." });
    await act(async () => { void run("g", { history: chatOf("g").messages.slice(0, -1), opts: { swipeOf: reply } }); }); await flush();
    expect(sent(mocks.streams[1])).toContain("- Tobin leads this reply");
  });

  it("asks a universe with Scope off for one character, or for narration only", async () => {
    data.chats.push({ id: "w", kind: "universe", universeId: "u", messages: [{ id: "w-u", role: "user", content: "Hi world" }] });
    await act(async () => { void run("w", { opts: { lead: { id: "uc", name: "Rook" } } }); }); await flush();
    expect(sent(mocks.streams[0])).toContain("Reply only as Rook in this message");
    await act(async () => mocks.streams[0].finish("Hm.")); await act(async () => waitForReply("w")); await flush();
    expect(chatOf("w").messages.at(-1).speaker).toBe("Rook");
    await act(async () => { void run("w", { opts: { lead: { id: "narrator", narrator: true } } }); }); await flush();
    expect(sent(mocks.streams[1])).toContain("world narration only");
  });
});

describe("two chats at once", () => {
  it("Stop in one chat leaves the other chat's reply running", async () => {
    await act(async () => { void run("a"); void run("b"); mocks.streams[0].onToken("A part"); mocks.streams[1].onToken("B part"); }); await flush();
    await click("Stop generating"); await act(async () => waitForReply("a"));
    expect(runningReply("a")).toBeUndefined();
    expect(runningReply("b")).toBeTruthy();
    await act(async () => mocks.streams[1].finish(" whole")); await flush();
    expect(chatOf("a").messages.at(-1).content).toBe("A part");
    expect(chatOf("b").messages.at(-1).content).toBe("B part whole");
  });

  it("chat b shows only its own stream while a streams in the background", async () => {
    await act(async () => { void run("a"); mocks.streams[0].onToken("Secret of a"); }); await flush();
    await show("b");
    expect(host.textContent).not.toContain("Secret of a");
    expect(button("Stop generating")).toBeUndefined();
    await type("Hello from b"); await click("Send");
    expect(mocks.streams).toHaveLength(2);
    await act(async () => { mocks.streams[1].finish("Reply b"); mocks.streams[0].finish(" done"); }); await flush();
    expect(contents("a")).toEqual(["Hello a.", "Question a", "Secret of a done"]);
    expect(contents("b")).toEqual(["Hello b.", "Question b", "Hello from b", "Reply b"]);
  });

  it("an error in one chat does not mark the other", async () => {
    await act(async () => { void run("a"); void run("b"); }); await flush();
    await act(async () => { mocks.streams[0].fail("A broke"); mocks.streams[1].finish("B fine"); }); await flush();
    expect(chatOf("a").lastError).toBe("A broke");
    expect(chatOf("b").lastError ?? null).toBeNull();
    expect(contents("b").at(-1)).toBe("B fine");
  });
});

describe("provider errors after a remount", () => {
  it("a failed Continue keeps its error across a dismissal and the original text is unchanged", async () => {
    const message = chatOf("a").messages[0];
    await act(async () => { void run("a", { kind: "continue", opts: { message } }); }); await show(null);
    await act(async () => mocks.streams[0].fail("Rate limited")); await flush();
    await act(async () => dismissActivity(replyJobs().find(j => j.status === "error").id));
    await show("a");
    expect(host.textContent).toContain("Rate limited");
    expect(chatOf("a").messages[0].content).toBe("Hello a.");
    expect(chatOf("a").lastErrorRetry).toMatchObject({ kind: "continue" });
  });

  it("Try again after a remount succeeds and clears the stored error", async () => {
    await act(async () => { void run(); }); await show(null);
    await act(async () => mocks.streams[0].fail("Overloaded")); await show("b"); await show("a");
    await click("Try again");
    await act(async () => mocks.streams[1].finish("Recovered")); await flush();
    expect(contents("a")).toEqual(["Hello a.", "Question a", "Recovered"]);
    expect(chatOf("a").lastError).toBeNull();
    expect(host.textContent).not.toContain("Overloaded");
  });

  it("Try again on a failed swipe after a remount writes a new version, not a new reply", async () => {
    const target = { id: "a-r", role: "assistant", content: "First version" };
    patchChat("a", c => ({ ...c, messages: [...c.messages, target] })); await show("a");
    await act(async () => { void run("a", { history: chatOf("a").messages.slice(0, 2), opts: { swipeOf: target } }); }); await show(null);
    await act(async () => mocks.streams[0].fail("Timeout")); await show("a");
    await click("Try again");
    await act(async () => mocks.streams[1].finish("Retried version")); await flush();
    expect(chatOf("a").messages).toHaveLength(3);
    expect(chatOf("a").messages[2].swipes.map(s => s.text)).toEqual(["First version", "Retried version"]);
  });

  it("a missing key is stored on the chat without a network call and shows the settings prompt", async () => {
    data.settings.providers[0].key = ""; await show("a");
    await act(async () => { await run(); }); await show(null); await show("a");
    expect(mocks.streams).toHaveLength(0);
    expect(chatOf("a").lastError).toBe("no-key");
    expect(button("Open Settings")).toBeTruthy();
  });

  it("a network failure is reported in plain words", async () => {
    await act(async () => { void run(); }); await act(async () => mocks.streams[0].fail("Failed to fetch")); await flush();
    expect(chatOf("a").lastError).toBe("Could not reach OpenRouter. Check your connection.");
  });
});

describe("Scope play-on chain", () => {
  const playOn = (turns = 3) => patchChat("a", c => ({ ...c, scope: { mode: "manual", carry: true, turns, cardScanned: true, cast: [] } }));

  it("plays the next turn on its own with a continue-scene instruction", async () => {
    playOn(); await show("a");
    await act(async () => { void run(); mocks.streams[0].finish("Turn one. [[continue]]"); }); await flush();
    await wait(950);
    expect(mocks.streams).toHaveLength(2);
    expect(sent(mocks.streams[1])).toContain("Continue the scene naturally");
    await act(async () => mocks.streams[1].finish("Turn two.")); await flush();
    expect(contents("a")).toEqual(["Hello a.", "Question a", "Turn one.", "Turn two."]);
    expect(runningReply("a")).toBeUndefined();
  });

  it("stops at the turn limit even when the model keeps asking to continue", async () => {
    playOn(2); await show("a");
    await act(async () => { void run(); mocks.streams[0].finish("One. [[continue]]"); }); await flush();
    await wait(950);
    await act(async () => mocks.streams[1].finish("Two. [[continue]]")); await flush();
    await wait(950);
    expect(mocks.streams).toHaveLength(2);
    expect(contents("a").slice(2)).toEqual(["One.", "Two."]);
  });

  it("Step in during the pause ends the chain", async () => {
    playOn(); await show("a");
    await act(async () => { void run(); mocks.streams[0].finish("One. [[continue]]"); }); await flush();
    await click("Step in"); await wait(950);
    expect(mocks.streams).toHaveLength(1);
    expect(runningReply("a")).toBeUndefined();
    expect(contents("a").at(-1)).toBe("One.");
  });

  it("typing in the composer during the pause ends the chain", async () => {
    playOn(); await show("a");
    await act(async () => { void run(); mocks.streams[0].finish("One. [[continue]]"); }); await flush();
    await type("I interrupt"); await wait(950);
    expect(mocks.streams).toHaveLength(1);
    expect(host.querySelector("textarea").value).toBe("I interrupt");
  });

  it("keeps playing while the chat is closed, and stopping the chat from outside ends it", async () => {
    playOn(4); await show("a");
    await act(async () => { void run(); mocks.streams[0].finish("One. [[continue]]"); }); await show(null);
    await wait(950);
    expect(mocks.streams).toHaveLength(2);
    await act(async () => mocks.streams[1].finish("Two. [[continue]]")); await flush();
    await act(async () => { cancelWhere(j => j.owner.chatId === "a"); }); await wait(950);
    expect(mocks.streams).toHaveLength(2);
    await show("a");
    expect(contents("a").slice(2)).toEqual(["One.", "Two."]);
    expect(button("Step in")).toBeUndefined();
  });

  it("a message sent while a Scope reply streams stops and keeps that reply, then goes straight after it", async () => {
    patchChat("a", c => ({ ...c, scope: { mode: "manual", carry: false, turns: 3, cardScanned: true, cast: [] } })); await show("a");
    await act(async () => { void run(); mocks.streams[0].onToken("Cut short"); }); await flush();
    await type("Wait!"); await click("Send"); await flush();
    expect(mocks.streams).toHaveLength(2);
    await act(async () => mocks.streams[1].finish("Answer to wait")); await flush();
    expect(contents("a")).toEqual(["Hello a.", "Question a", "Cut short", "Wait!", "Answer to wait"]);
  });

  it("a chain in one chat is not stopped by Stop in another", async () => {
    playOn(); await show("a");
    await act(async () => { void run("a"); mocks.streams[0].finish("One. [[continue]]"); }); await flush();
    await show("b");
    await act(async () => { void run("b"); }); await flush();
    await click("Stop generating"); await wait(950);
    expect(mocks.streams.filter(s => s.sessionId === "a")).toHaveLength(2);
  });
});

describe("4B review fixes", () => {
  it("Try again clears the failed reply from the island, so a success leaves no red pill", async () => {
    await act(async () => { void run(); }); await act(async () => mocks.streams[0].fail("Overloaded")); await flush();
    expect(replyJobs().map(j => j.status)).toEqual(["error"]);
    await click("Try again");
    expect(replyJobs().map(j => j.status)).toEqual(["running"]);
    await act(async () => mocks.streams[1].finish("Recovered")); await flush();
    expect(replyJobs().some(j => j.status === "error")).toBe(false);
  });

  it("a new reply in another chat leaves that chat's failure alone", async () => {
    await act(async () => { void run("a"); }); await act(async () => mocks.streams[0].fail("A broke")); await flush();
    await act(async () => { void run("b"); }); await flush();
    expect(replyJobs().find(j => j.owner.chatId === "a")?.status).toBe("error");
  });

  it("the saved retry keeps an anchor, not a copy of the chat", async () => {
    const target = { id: "a-r", role: "assistant", content: "First version", speakerId: "x" };
    patchChat("a", c => ({ ...c, messages: [...c.messages, target] })); await show("a");
    await act(async () => { void run("a", { history: chatOf("a").messages.slice(0, 2), opts: { swipeOf: target, instruction: "Shorter" } }); });
    await act(async () => mocks.streams[0].fail("Timeout")); await flush();
    const saved = chatOf("a").lastErrorRetry;
    expect(saved).toEqual({ kind: "generate", opts: { swipeOf: { id: "a-r" }, instruction: "Shorter" }, anchorId: "a-u", length: 2 });
    expect(JSON.stringify(saved)).not.toContain("Hello a.");
    /* rebuilt from the chat as it is now */
    const back = retryRun(saved, chatOf("a").messages);
    expect(back).toMatchObject({ kind: "generate", fresh: true, opts: { instruction: "Shorter", swipeOf: target } });
    expect(back.history.map(m => m.id)).toEqual(["a-g", "a-u"]);
    expect(retryRun(saved, [{ id: "a-g" }, { id: "other" }]).fresh).toBe(false);
    expect(retryRun(saved, [{ id: "a-g" }]).fresh).toBe(false);
  });

  it("retry records hold messages by id and read an older full-history record", () => {
    const message = { id: "m1", role: "assistant", content: "Long text" };
    expect(retryRecord({ kind: "continue", opts: { message } })).toEqual({ kind: "continue", opts: { message: { id: "m1" } } });
    expect(retryRun({ kind: "continue", opts: { message: { id: "m1" } } }, [{ ...message, content: "Edited" }]).opts.message.content).toBe("Edited");
    const old = { kind: "generate", opts: {}, history: [{ id: "a" }, { id: "b" }] };
    expect(retryRun(old, [{ id: "a" }, { id: "b" }, { id: "c" }]).fresh).toBe(true);
    expect(retryRun(old, [{ id: "a" }]).fresh).toBe(false);
  });

  it.each([["no-key", "Add a provider key in Settings"], ["no-model", "Choose a model in Settings"]])("the island says %s in words", async (code, words) => {
    if (code === "no-key") data.settings.providers[0].key = ""; else data.settings.providers[0].model = "";
    await show("a");
    await act(async () => { await run(); }); await flush();
    expect(chatOf("a").lastError).toBe(code);
    expect(replyJobs().find(j => j.status === "error")?.error).toBe(words);
  });

  it("percent and phase patches on a streaming reply do not re-render the chat view", async () => {
    let renders = 0;
    await act(async () => { void run(); }); await flush();
    await act(async () => root.render(
      <Profiler id="chat" onRender={() => { renders++; }}>
        <ChatDataSource data={data} /><ChatPage data={data} chatId="a" update={update} goBack={() => {}} goSettings={() => {}} />
      </Profiler>,
    ));
    await flush();
    const h = startActivity({ dedupeKey: "reply:a" });
    expect(h.id).toBe(runningReply("a").id);
    renders = 0;
    for (const pct of [10, 30, 60]) { await act(async () => { h.progress(pct); h.phase(`Phase ${pct}`); }); await wait(300); }
    expect(runningReply("a").percent).toBe(60);
    expect(renders).toBe(0);
  });
});
