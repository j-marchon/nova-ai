// @vitest-environment jsdom
/* The phone's job beside replies (replyJob.js -> phoneJob.js): a saved
   reply queues nothing; the phone's own batches are quiet, one at a time per
   chat, never during a reply, and guarded by their (loose) anchor. The model is hand-driven through api.js, as in chatJobs.test.jsx;
   the queue itself is in phoneQueue.test.jsx. */
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyData } from "../src/lib/data.js";
import { activity, cancelWhere, clearActivity } from "../src/lib/activity.js";
import { startChatSide, startReply, waitForReply } from "../src/pages/chat/replyJob.js";
import { resetPhoneJobs } from "../src/pages/chat/phoneJob.js";
import { addMessage, emptyHandset } from "../src/lib/phone.js";
import { mergeBatch } from "../src/lib/phoneBatch.js";
import { addSwipe } from "../src/lib/swipes.js";

const mocks = vi.hoisted(() => ({ streams: [], sides: [] }));
vi.mock("../src/lib/api.js", async original => ({ ...await original(),
  streamChat: vi.fn(args => new Promise((resolve, reject) => {
    const request = { ...args, finish: (text = "") => { if (text) args.onToken(text); resolve({}); }, fail: message => reject(new Error(message)) };
    mocks.streams.push(request);
    args.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
  })),
  completeText: vi.fn(args => new Promise((resolve, reject) => mocks.sides.push({ ...args, finish: text => resolve({ text }), fail: m => reject(new Error(m)) }))),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let data;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
const getData = () => data;
const update = patch => { data = typeof patch === "function" ? patch(data) : { ...data, ...patch }; };
const chat = () => data.chats.find(c => c.id === "a");
const patchChat = fn => { data = { ...data, chats: data.chats.map(c => c.id === "a" ? fn(c) : c) }; };
const run = () => startReply({ getData, update, chatId: "a" });
const phoneSides = () => mocks.sides.filter(s => /run the social media|read character descriptions/.test(s.system || ""));
const phoneJobs = () => activity.get().filter(j => j.kind === "phone");
const sent = request => request.messages.map(m => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
const TICK = JSON.stringify({ posts: [{ by: "bea", text: "Fog over the harbour again." }], dms: [{ from: "mira", text: "Did you find the key?" }] });
const seeded = level => mergeBatch(emptyHandset(level), {}, { mode: "seed" });

beforeEach(() => {
  resetPhoneJobs(); clearActivity(); vi.clearAllMocks(); mocks.streams.length = 0; mocks.sides.length = 0;
  vi.stubGlobal("requestAnimationFrame", fn => setTimeout(fn, 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  data = structuredClone(emptyData); data.username = "Ana"; data.settings.providers[0].key = "test"; data.settings.providers[0].model = "test-model"; data.settings.sceneEvery = 0;
  data.characters = [{ id: "c", name: "Mira", description: "A locksmith.", greetings: [] }];
  data.chats = [{ id: "a", kind: "character", characterId: "c", handset: seeded("lively"), messages: [{ id: "g", role: "assistant", content: "Hello." }, { id: "u1", role: "user", content: "Hi Mira." }] }];
});
afterEach(async () => {
  await act(async () => { cancelWhere(() => true); await waitForReply("a"); });
  await flush();
  resetPhoneJobs(); clearActivity();
  vi.unstubAllGlobals();
});

it("a saved reply queues nothing; asked for, it runs as one quiet job labelled Phone, and the next reply hears about it", async () => {
  await act(async () => { void run(); });
  mocks.streams[0].onToken("Half a reply");
  await flush();
  expect(phoneSides()).toHaveLength(0);
  await act(async () => mocks.streams[0].finish(" and the rest.")); await flush();
  expect(phoneSides()).toHaveLength(0);
  await act(async () => { void startChatSide({ getData, update, chatId: "a", kind: "phone" }); }); await flush();
  expect(phoneSides()).toHaveLength(1);
  const job = phoneJobs().find(j => j.status === "running");
  expect(job).toMatchObject({ label: "Phone", quiet: true, owner: { chatId: "a" }, dedupeKey: "phone:a" });
  expect(phoneSides()[0].system).toContain("You run the social media on Ana's phone");
  expect(phoneSides()[0].maxTokens).toBe(900);

  await act(async () => phoneSides()[0].finish(TICK)); await flush();
  const h = chat().handset;
  expect(h.tick).toMatchObject({ n: 2, lastMsgId: chat().messages.at(-1).id, pending: false });
  expect(h.posts.map(p => [p.by, p.text])).toEqual([["npc:bea", "Fog over the harbour again."]]);
  expect(h.threads["char:c"].map(m => m.text)).toEqual(["Did you find the key?"]);

  patchChat(c => ({ ...c, messages: [...c.messages, { id: "u2", role: "user", content: "Not yet." }] }));
  await act(async () => { void run(); }); await flush();
  expect(sent(mocks.streams[1])).toContain("Did you find the key?");
});

it("never seeds a chat by itself after a reply: the phone is set up by hand", async () => {
  patchChat(c => ({ ...c, handset: emptyHandset("light") }));
  await act(async () => { void run(); mocks.streams[0].finish("Reply."); }); await flush();
  expect(phoneSides()).toHaveLength(0);
  expect(chat().handset.tick.seeded).toBe(false);
});

it("an assistant reply carries the phone's in-world minute once the phone is set up", async () => {
  patchChat(c => ({ ...c, handset: seeded("light") }));
  const before = chat().messages.filter(m => m.role === "assistant" && String(m.content || "").trim()).length;
  await act(async () => { void run(); mocks.streams[0].finish("Reply."); }); await flush();
  const reply = chat().messages.at(-1);
  expect(reply.role).toBe("assistant");
  /* the clock at 0 plus 5 minutes per earlier reply, plus this one's 5 */
  expect(reply.wt).toBe(5 * before + 5);
});

it("no wt on a reply while the phone is not set up", async () => {
  patchChat(c => ({ ...c, handset: emptyHandset("lively") }));
  await act(async () => { void run(); mocks.streams[0].finish("Reply."); }); await flush();
  expect(chat().messages.at(-1).wt).toBeUndefined();
});

it("never runs two at once for a chat, and waits for a running reply", async () => {
  patchChat(c => ({ ...c, messages: [...c.messages, { id: "r1", role: "assistant", content: "Reply." }], handset: seeded("light") }));
  await act(async () => { void run(); }); await flush();
  /* asked for while the reply streams: nothing until it is saved */
  await act(async () => { void startChatSide({ getData, update, chatId: "a", kind: "phone" }); }); await flush();
  expect(phoneSides()).toHaveLength(0);
  await act(async () => mocks.streams[0].finish("Saved.")); await flush();
  expect(phoneSides()).toHaveLength(1);
  await act(async () => { void startChatSide({ getData, update, chatId: "a", kind: "phone" }); void startChatSide({ getData, update, chatId: "a", kind: "phone" }); }); await flush();
  expect(phoneSides()).toHaveLength(1);
  expect(phoneJobs().filter(j => j.status === "running")).toHaveLength(1);
});

it("keeps a result after a swipe of its message, drops it when the message is deleted", async () => {
  const side = () => startChatSide({ getData, update, chatId: "a", kind: "phone" });
  await act(async () => { void run(); mocks.streams[0].finish("First version."); }); await flush();
  await act(async () => { void side(); }); await flush();
  expect(phoneSides()).toHaveLength(1);
  const last = chat().messages.at(-1).id;
  patchChat(c => ({ ...c, messages: c.messages.map(m => m.id === last ? addSwipe(m, "Second version.") : m) }));
  await act(async () => phoneSides()[0].finish(TICK)); await flush();
  expect(chat().handset.posts.map(p => p.text)).toEqual(["Fog over the harbour again."]);
  await act(async () => { void side(); }); await flush();
  patchChat(c => ({ ...c, messages: c.messages.filter(m => m.id !== last) }));
  await act(async () => phoneSides()[1].finish(JSON.stringify({ posts: [{ by: "bea", text: "Gone." }] }))); await flush();
  expect(chat().handset.posts.map(p => p.text)).not.toContain("Gone.");
});

it("a failure sets tick.error quietly and keeps a pending action", async () => {
  /* read and answered at once (handset.dmWait) */
  const sent = addMessage(seeded("lively"), "char:c", "Where are you?", { id: "u1", swipe: 0 });
  const w = sent.dmWait["char:c"];
  patchChat(c => ({ ...c, handset: { ...sent, dmWait: { "char:c": { ...w, due: w.sent, seen: w.sent } } } }));
  await act(async () => { void run(); mocks.streams[0].finish("Reply."); }); await flush();
  expect(phoneSides()).toHaveLength(0);
  await act(async () => { void startChatSide({ getData, update, chatId: "a", kind: "phone" }); }); await flush();
  expect(phoneSides()).toHaveLength(1);
  expect(phoneSides()[0].user).toContain("- messaged @mira: Where are you?");
  await act(async () => phoneSides()[0].fail("429 rate limited")); await flush();
  expect(chat().handset.tick.pending).toBe(true);
  expect(chat().handset.tick.error).toMatchObject({ message: "429 rate limited" });
  expect(chat().lastError).toBeFalsy();
  expect(activity.get().filter(j => j.kind === "reply" && j.status === "error")).toHaveLength(0);
});

it("does not refresh by itself with the phone off", async () => {
  patchChat(c => ({ ...c, handset: seeded("off") }));
  await act(async () => { void run(); mocks.streams[0].finish("Reply."); }); await flush();
  expect(phoneSides()).toHaveLength(0);
  expect(phoneJobs()).toHaveLength(0);
});
