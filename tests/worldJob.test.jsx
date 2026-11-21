// @vitest-environment jsdom
/* A universe's world tracker (replyJob.js runNotes / writeScene): it runs
   every two replies whatever the scene-tracking setting, and its off-screen
   "Happening" line joins the chat's world log, deduped, in the same update. */
import { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emptyData } from "../src/lib/data.js";
import { cancelWhere, clearActivity } from "../src/lib/activity.js";
import { startReply, waitForReply } from "../src/pages/chat/replyJob.js";

const mocks = vi.hoisted(() => ({ streams: [], sides: [] }));
vi.mock("../src/lib/api.js", async original => ({ ...await original(),
  streamChat: vi.fn(args => new Promise((resolve, reject) => {
    const request = { ...args, finish: (text = "") => { if (text) args.onToken(text); resolve({}); } };
    mocks.streams.push(request);
    args.signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
  })),
  completeText: vi.fn(args => new Promise(resolve => mocks.sides.push({ ...args, finish: text => resolve({ text }) }))),
}));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let data;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
const getData = () => data;
const update = patch => { data = typeof patch === "function" ? patch(data) : { ...data, ...patch }; };
const chat = () => data.chats[0];
const trackers = () => mocks.sides.filter(s => /You keep the tracker for an ongoing roleplay set in the world/.test(s.system || ""));
const sent = request => request.messages.map(m => m.content).join("\n");
const note = happening => `[Monday | evening | The Mill | rain, 9°C]\n\n[Here: Rook at the stove.]\n[Ana: wet.]\n\n[Elsewhere:\n- Lena: at the Old Bridge, waiting]\n\n[Happening: ${happening}]\n\n[IMPORTANT STRINGS: none]`;
/* you write, the world answers, and the reply is saved */
const turn = async (text, reply) => {
  data = { ...data, chats: [{ ...chat(), messages: [...chat().messages, { id: `u-${mocks.streams.length}`, role: "user", content: text }] }] };
  await act(async () => { void startReply({ getData, update, chatId: "c" }); }); await flush();
  await act(async () => mocks.streams.at(-1).finish(reply)); await flush();
};

beforeEach(() => {
  clearActivity(); vi.clearAllMocks(); mocks.streams.length = 0; mocks.sides.length = 0;
  vi.stubGlobal("requestAnimationFrame", fn => setTimeout(fn, 0)); vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  data = structuredClone(emptyData); data.username = "Ana"; data.settings.providers[0].key = "test"; data.settings.providers[0].model = "test-model";
  data.settings.sceneEvery = 0;
  data.universes = [{ id: "u", name: "Vale", story: "A valley.", characters: [{ id: "rk", name: "Rook" }, { id: "ln", name: "Lena" }], locations: [{ name: "The Mill" }, { name: "Old Bridge" }] }];
  /* Scope off, so only the tracker runs */
  data.chats = [{ id: "c", kind: "universe", universeId: "u", messages: [{ id: "g", role: "assistant", content: "Rain on the mill roof." }] }];
});
afterEach(async () => {
  await act(async () => { cancelWhere(() => true); await waitForReply("c"); clearActivity(); });
  vi.unstubAllGlobals();
});

it("runs the world tracker every two replies with scene tracking off and keeps a deduped world log", async () => {
  await turn("I knock.", "Rook opens the door.");
  expect(trackers()).toHaveLength(1);
  expect(trackers()[0].system).toContain("Rook, Lena");
  expect(trackers()[0].system).toContain("The Mill, Old Bridge");
  await act(async () => trackers()[0].finish(note("a lantern moves along the river path toward the mill."))); await flush();
  const first = chat().messages.at(-1);
  expect(chat().scene.lastId).toBe(first.id);
  expect(chat().world.log).toEqual([{ id: expect.any(String), text: "a lantern moves along the river path toward the mill.", anchor: { id: first.id, swipe: 0 } }]);

  /* the next reply sends the world tracker and the log, even with scene tracking off */
  await turn("I sit down.", "Rook pours tea.");
  expect(trackers()).toHaveLength(1);
  const prompt = sent(mocks.streams[1]);
  expect(prompt).toContain("(Private scene tracker");
  expect(prompt).toContain("[Elsewhere lately");
  expect(prompt).toContain("[How this world runs]");

  await turn("I drink.", "The lantern stops outside.");
  expect(trackers()).toHaveLength(2);
  await act(async () => trackers()[1].finish(note("A lantern moves along the river path toward the mill"))); await flush();
  expect(chat().world.log).toHaveLength(1);

  await turn("I wait.", "Silence.");
  await turn("I look out.", "Nothing.");
  expect(trackers()).toHaveLength(3);
  await act(async () => trackers()[2].finish(note("quiet"))); await flush();
  expect(chat().world.log).toHaveLength(1);

  await turn("I sleep.", "Morning.");
  await turn("I wake.", "Bells ring.");
  await act(async () => trackers()[3].finish(note("the ferry from the coast is late and people gather at the dock."))); await flush();
  expect(chat().world.log.map(e => e.text)).toEqual(["a lantern moves along the river path toward the mill.", "the ferry from the coast is late and people gather at the dock."]);
});
