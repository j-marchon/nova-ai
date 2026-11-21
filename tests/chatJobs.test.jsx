// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { ChatDataSource } from "../src/pages/chat/appData.jsx";
import { emptyData } from "../src/lib/data.js";
import { activity, cancelWhere, clearActivity, dismissActivity } from "../src/lib/activity.js";
import { startReply, waitForReply } from "../src/pages/chat/replyJob.js";

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
const getData = () => data;
const update = patch => { data = typeof patch === "function" ? patch(data) : { ...data, ...patch }; render(); };
const render = () => root.render(<><ChatDataSource data={data} />{visible && <ChatPage data={data} chatId={visible} update={update} goBack={() => {}} goSettings={() => {}} />}</>);
const show = async id => { visible = id; await act(async () => render()); await flush(); };
const run = (chatId = "a", options = {}) => startReply({ getData, update, chatId, ...options });
const button = label => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === label || b.getAttribute("aria-label") === label);
const click = async label => { const el = button(label); expect(el, label).toBeTruthy(); await act(async () => el.click()); await flush(); };
const type = async text => { const el = host.querySelector("textarea"); await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(el, text); el.dispatchEvent(new Event("input", { bubbles: true })); }); };
beforeEach(async () => {
  clearActivity(); vi.clearAllMocks(); mocks.streams.length = 0; mocks.sides.length = 0;
  vi.stubGlobal("requestAnimationFrame", fn => setTimeout(fn, 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  data = structuredClone(emptyData); data.username = "Ana"; data.settings.providers[0].key = "test"; data.settings.providers[0].model = "test-model"; data.settings.sceneEvery = 0;
  data.characters = [{ id: "c", name: "Mira", greetings: [] }];
  data.chats = ["a", "b"].map(id => ({ id, kind: "character", characterId: "c", messages: [{ id: `${id}-g`, role: "assistant", content: `Hello ${id}.` }, { id: `${id}-u`, role: "user", content: `Question ${id}` }] }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); await show("a");
});
afterEach(async () => {
  await act(async () => { cancelWhere(() => true); await Promise.all(data.chats.map(c => waitForReply(c.id))); root.unmount(); clearActivity(); });
  host.remove(); vi.unstubAllGlobals();
});

it("resumes the bubble after navigating away and back, and Stop saves the partial reply", async () => {
  await act(async () => { void run(); mocks.streams[0].onToken("Still writing"); }); await flush();
  await show(null); await show("a"); expect(host.textContent).toContain("Still writing");
  await click("Stop generating"); expect(data.chats[0].messages.at(-1).content).toBe("Still writing");
  expect(activity.get().some(j => j.status === "running" && j.kind === "reply")).toBe(false);
});
it("sends after returning without losing concurrent messages or the stopped reply", async () => {
  await act(async () => { void run(); mocks.streams[0].onToken("Partial"); }); await show(null);
  data = { ...data, chats: data.chats.map(c => c.id === "a" ? { ...c, messages: [...c.messages, { id: "concurrent", role: "user", content: "Concurrent" }] } : c) };
  await show("a"); await click("Stop generating"); await type("Next question"); await click("Send");
  await act(async () => { mocks.streams[1].finish("Next reply"); }); await flush();
  expect(data.chats[0].messages.map(m => m.content)).toEqual(["Hello a.", "Question a", "Partial", "Concurrent", "Next question", "Next reply"]);
});
it("keeps two simultaneous chat jobs isolated", async () => {
  await act(async () => { void run("a"); void run("b"); }); await show("b");
  await act(async () => { mocks.streams[1].finish("For b"); mocks.streams[0].finish("For a"); }); await flush();
  expect(data.chats.map(c => c.messages.at(-1).content)).toEqual(["For a", "For b"]);
});
it("scans the card only once across a remount while scanning and after completion", async () => {
  data.chats[0] = { ...data.chats[0], scope: { mode: "manual", cast: [] } }; await show("a");
  expect(mocks.sides).toHaveLength(1); await show(null); await show("a"); expect(mocks.sides).toHaveLength(1);
  await act(async () => mocks.sides[0].finish("[]")); await flush(); await show(null); await show("a");
  expect(data.chats[0].scope.cardScanned).toBe(true); expect(mocks.sides).toHaveLength(1);
});
it("shows an off-screen failure after remounting", async () => {
  await act(async () => { void run(); }); await show(null);
  await act(async () => mocks.streams[0].fail("Provider unavailable")); await show("a");
  expect(host.textContent).toContain("Provider unavailable"); expect(button("Try again")).toBeTruthy();
});
it("saves an off-screen reply when it lands", async () => {
  await act(async () => { void run(); }); await show(null);
  await act(async () => mocks.streams[0].finish("Off-screen reply")); await flush();
  expect(data.chats[0].messages.at(-1).content).toBe("Off-screen reply");
});
it("persists a user send before the reply streams", async () => {
  await type("New message"); await click("Send");
  expect(data.chats[0].messages.at(-1).content).toBe("New message");
  await act(async () => mocks.streams[0].finish("Answer")); await flush();
  expect(data.chats[0].messages.map(m => m.content).slice(-2)).toEqual(["New message", "Answer"]);
});
it.each(["continue", "impersonate"])("Try again preserves a failed %s job and its options after remount", async kind => {
  const message = data.chats[0].messages[0];
  await act(async () => { void run("a", { kind, opts: kind === "continue" ? { message } : { guidance: "Ask about the key" } }); });
  await show(null); await act(async () => mocks.streams[0].fail("Retry me")); await show("a"); await click("Try again");
  expect(mocks.streams).toHaveLength(2);
  const job = activity.get().find(j => j.status === "running" && j.kind === "reply"); expect(job.stream.get().kind).toBe(kind);
  await act(async () => mocks.streams[1].finish(kind === "continue" ? "More." : "Ana: Where is the key?")); await flush();
  if (kind === "continue") { expect(data.chats[0].messages).toHaveLength(2); expect(data.chats[0].messages[0].content).toContain("More."); }
  else { expect(mocks.streams[1].messages.map(m => m.content).join(" ")).toContain("Ask about the key"); expect(host.querySelector("textarea").value).toBe("Where is the key?"); expect(data.chats[0].messages).toHaveLength(2); }
});
it("retries Continue using the target's current text after an edit between attempts", async () => {
  const message = data.chats[0].messages[0];
  await act(async () => { void run("a", { kind: "continue", opts: { message } }); });
  await act(async () => mocks.streams[0].fail("Retry me")); await flush();
  await act(async () => update(d => ({ ...d, chats: d.chats.map(c => c.id === "a" ? { ...c, messages: c.messages.map(m => m.id === message.id ? { ...m, content: "Edited reply." } : m) } : c) })));
  await click("Try again");
  expect(mocks.streams[1].messages.map(m => m.content).join(" ")).toContain("Edited reply.");
  await act(async () => mocks.streams[1].finish("More.")); await flush();
  expect(data.chats[0].messages[0].content).toBe("Edited reply. More.");
  expect(data.chats[0].lastError).toBeNull(); expect(data.chats[0].lastErrorRetry).toBeNull();
});
it.each(["continue", "impersonate"])("retains failed %s retry options after island dismissal and remount", async kind => {
  const message = data.chats[0].messages[0];
  await act(async () => { void run("a", { kind, opts: kind === "continue" ? { message } : { guidance: "Ask about the key" } }); });
  await act(async () => mocks.streams[0].fail("Dismiss me")); await flush();
  await act(async () => dismissActivity(activity.get().find(j => j.kind === "reply" && j.status === "error").id));
  expect(activity.get().some(j => j.kind === "reply")).toBe(false);
  await show(null); await show("a"); await click("Try again");
  expect(activity.get().find(j => j.kind === "reply" && j.status === "running").stream.get().kind).toBe(kind);
  await act(async () => mocks.streams[1].finish(kind === "continue" ? "More." : "Ana: Where is the key?")); await flush();
  expect(data.chats[0].messages).toHaveLength(2);
  if (kind === "continue") expect(data.chats[0].messages[0].content).toBe("Hello a. More.");
  else {
    expect(mocks.streams[1].messages.map(m => m.content).join(" ")).toContain("Ask about the key");
    expect(host.querySelector("textarea").value).toBe("Where is the key?");
  }
});
it("hides the streaming bubble during Scope play-on pauses", async () => {
  data.chats[0] = { ...data.chats[0], scope: { mode: "manual", carry: true, turns: 2, cardScanned: true, cast: [] } }; await show("a");
  await act(async () => { void run(); mocks.streams[0].finish("Unique saved reply. [[continue]]"); }); await flush();
  const job = activity.get().find(j => j.kind === "reply" && j.status === "running"); expect(job.stream.get().paused).toBe(true);
  expect(host.textContent.match(/Unique saved reply/g)).toHaveLength(1);
  await click("Step in");
});
