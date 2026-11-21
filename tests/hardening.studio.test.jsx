// @vitest-environment jsdom
/* Card Studio: the inline dropdown in every create form. Writes straight
   into the form with an Undo, one part at a time once there is content,
   the detail level reaches the request, jobs survive closing and are offered
   on reopen, JSON repair and continue still work, and the writer picker is
   there on every provider. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { AiFill, AI_SCHEMAS, cardSystem, cardUser } from "../src/components/AiFill.jsx";
import { CharacterForm, PersonaForm, UniverseForm } from "../src/components/forms.jsx";
import { activity, clearActivity, startActivity } from "../src/lib/activity.js";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { PROVIDERS, newProvider } from "../src/lib/providers.js";
import { resetStorageForTests } from "../src/lib/storage.js";
import { writerModelOf, writerModelPatch } from "../src/lib/api.js";
import { clearToasts, toasts } from "../src/lib/toast.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host, requests;

const KINDS = ["characters", "personas", "universes"];
const FORMS = { characters: CharacterForm, personas: PersonaForm, universes: UniverseForm };

const sse = (text, finish = "stop") => {
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  return new Response(new ReadableStream({ start(c) { for (const f of frames) c.enqueue(new TextEncoder().encode(f)); c.close(); } }), { status: 200 });
};

/* handler(body, n, init) -> { reply, finish } | Response | Promise<Response> */
const route = (handler) => vi.fn((url, init = {}) => {
  if (/\/models(\?|$)/.test(String(url))) return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  const body = init.body ? JSON.parse(init.body) : {};
  requests.push(body);
  const out = handler(body, requests.length, init);
  if (out instanceof Response || out instanceof Promise) return Promise.resolve(out);
  const text = typeof out.reply === "string" ? out.reply : JSON.stringify(out.reply);
  return Promise.resolve(sse(text, out.finish || "stop"));
});

/* a request that waits until released, and rejects on abort like fetch does */
const held = () => {
  const gate = {};
  gate.handler = (body, n, init) => new Promise((resolve, reject) => {
    gate.release = (reply, finish) => resolve(sse(typeof reply === "string" ? reply : JSON.stringify(reply), finish));
    init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    gate.signal = init.signal;
  });
  return gate;
};

const flush = async () => {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async (el) => { await act(async () => root.render(el)); await flush(); };
const click = async (el) => {
  expect(el, "element to click").toBeTruthy();
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await flush();
};
const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const buttons = () => [...document.querySelectorAll("button")];
const button = (pred) => buttons().find((b) => (typeof pred === "string" ? b.textContent.trim() === pred : pred(b.textContent.trim())));
const toggle = () => buttons().find((b) => b.textContent.trim().startsWith("Card studio"));
const panel = () => document.querySelector('section[aria-label^="Card studio · "]');
const briefBox = () => panel()?.querySelector("textarea");
const body = () => document.body.textContent;
const inputs = () => [...document.querySelectorAll("input")];
const areas = () => [...document.querySelectorAll("textarea")];
const cardJobs = (kind) => activity.get().filter((j) => j.owner?.cardKind && (!kind || j.owner.cardKind === kind));
const lastToast = () => toasts.get().at(-1);

const settingsFor = (preset = "openrouter", extra = {}) => {
  const s = structuredClone(emptyData.settings);
  s.providers = [newProvider(preset, { key: "sk-test", model: "test-model", ...(preset === "custom" || preset === "nova-bridge" ? { base: "http://localhost:1234/v1" } : {}) })];
  s.activeProvider = s.providers[0].id;
  return Object.assign(s, extra);
};

const sample = {
  characters: { name: "Edda", tagline: "Keeps the light", description: "A keeper.", greetings: [{ label: "Fog", text: "*Fog.* Who's there?" }], exampleDialogs: "{{user}}: Hi\n{{char}}: No." },
  personas: { name: "Ana", description: "A correspondent." },
  universes: { name: "Vale", tagline: "A valley", story: "Long ago.", rules: "No magic.", greetings: [{ label: "Dawn", text: "*Mist.*" }], characters: [{ name: "Elder", description: "Old.", personality: "Kind" }], locations: [{ name: "Mill", description: "Loud." }] },
};

const form = (kind, { key, ...props } = {}) => {
  const Form = FORMS[kind];
  return <Form key={key} initial={null} existingCharacters={[]} settings={settingsFor()} onSave={() => {}} onSettings={() => {}} onClose={() => {}} {...props} />;
};

const writeNew = async (text = "A keeper of forgotten stories.") => {
  if (!panel()) await click(toggle());
  await type(briefBox(), text);
  await click(button((t) => t.startsWith("Write the ")));
  await flush();
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  clearActivity();
  clearToasts();
  requests = [];
  vi.stubGlobal("fetch", route(() => ({ reply: sample.characters })));
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); clearActivity(); clearToasts(); });
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the dropdown", () => {
  it("expands and collapses in place, with no full-screen studio or steps", async () => {
    await mount(form("characters"));
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(panel()).toBeNull();
    await click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(panel()).toBeTruthy();
    expect(briefBox().placeholder).toBe(AI_SCHEMAS.characters.placeholder);
    expect(body()).not.toMatch(/1\. Idea|2\. Write|Use card/);
    /* an empty form has no part selector */
    expect(panel().querySelector('[aria-label="Part to write"]')).toBeNull();
    await click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(panel()).toBeNull();
  });

  it("keeps Write disabled until there is a brief, and warns without a key", async () => {
    await mount(form("characters"));
    await click(toggle());
    expect(button("Write the character").disabled).toBe(true);
    await type(briefBox(), "Someone.");
    expect(button("Write the character").disabled).toBe(false);

    const noKey = settingsFor();
    noKey.providers[0].key = "";
    await mount(form("characters", { key: "nokey", settings: noKey }));
    await click(toggle());
    await type(briefBox(), "Someone.");
    expect(body()).toContain("Add a provider and key in Settings first.");
    expect(button("Write the character").disabled).toBe(true);
  });

  it("restores the saved brief and detail, and saves both per kind", async () => {
    const onSettings = vi.fn();
    const s = settingsFor("openrouter", { cardStudio: { characters: { brief: "Saved brief.", detail: "high", params: { stale: 1 } }, personas: { brief: "Other." } } });
    await mount(form("characters", { settings: s, onSettings }));
    await click(toggle());
    expect(briefBox().value).toBe("Saved brief.");
    expect(button("High").getAttribute("aria-checked")).toBe("true");
    await click(button("Low"));
    expect(onSettings).toHaveBeenLastCalledWith({ cardStudio: { characters: { brief: "Saved brief.", detail: "low" }, personas: { brief: "Other." } } });
    await click(button("Write the character"));
    expect(onSettings).toHaveBeenCalledWith({ cardStudio: { characters: { brief: "Saved brief.", detail: "low" }, personas: { brief: "Other." } } });
  });
});

describe("writing into the form", () => {
  it.each(KINDS)("%s: writes from the brief straight into the form, with an Undo", async (kind) => {
    vi.stubGlobal("fetch", route(() => ({ reply: sample[kind] })));
    await mount(form(kind));
    await writeNew("  Brief with spaces.  ");
    expect(requests).toHaveLength(1);
    expect(requests[0].messages.at(-1).content).toContain("<brief>\nBrief with spaces.\n</brief>");
    expect(requests[0].messages[0].content).toContain("Output contract");
    /* applied, panel collapsed, job consumed */
    expect(inputs().some((i) => i.value === sample[kind].name)).toBe(true);
    expect(panel()).toBeNull();
    expect(cardJobs()).toHaveLength(0);
    expect(lastToast().text).toBe("Card written");
    await act(async () => lastToast().undo());
    await flush();
    expect(inputs().some((i) => i.value === sample[kind].name)).toBe(false);
  });

  it("sends the chosen detail level as budget and effort", async () => {
    vi.stubGlobal("fetch", route(() => ({ reply: sample.personas })));
    for (const [level, max] of [["Low", 3000 + 2000], ["Medium", 8000 + 4000], ["High", 16000 + 8000]]) {
      requests.length = 0;
      clearActivity();
      await mount(form("personas", { key: level }));
      await click(toggle());
      await click(button(level));
      await writeNew();
      expect(requests[0].max_tokens, level).toBe(max);
      expect(requests[0].reasoning, level).toEqual({ effort: level.toLowerCase() });
      expect(requests[0].messages[0].content).toContain(`Detail level: ${level}`);
    }
  });

  it("with thinking off, asks for a <plan> block and gives it room, and strips it from the reply", async () => {
    vi.stubGlobal("fetch", route(() => ({ reply: '<plan>Brief wants {a keeper}. Plan: name, then description.</plan>\n{"name":"Ana","description":"A correspondent."}' })));
    await mount(form("personas", { settings: settingsFor("openrouter", { writerThinking: false }) }));
    await writeNew();
    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0].content).toContain("<plan>");
    expect(requests[0].reasoning).toEqual({ enabled: false });
    expect(requests[0].max_tokens).toBe(8000 + 1500);
    expect(inputs().some((i) => i.value === "Ana")).toBe(true);
  });

  it("an edit made while the job runs is restored by Undo after a whole-card write", async () => {
    const gate = held();
    vi.stubGlobal("fetch", route(gate.handler));
    await mount(form("personas"));
    await writeNew();
    const name = inputs().find((i) => i.placeholder === "What characters should call you");
    await type(name, "Typed meanwhile");
    await act(async () => gate.release(sample.personas));
    await flush();
    expect(name.value).toBe("Ana");
    await act(async () => lastToast().undo());
    await flush();
    expect(name.value).toBe("Typed meanwhile");
  });

  it("rewrites only the chosen part, with the brief as its note", async () => {
    vi.stubGlobal("fetch", route(() => ({ reply: { tagline: "Darker." } })));
    const initial = { id: "edda", name: "Edda", tagline: "Old", description: "A keeper.", greetings: [{ id: "g", label: "", text: "Hello." }], exampleDialogs: "" };
    let saved;
    await mount(form("characters", { initial, onSave: (c) => { saved = c; } }));
    await click(toggle());
    expect(panel().textContent).toContain("What to change");
    await click(panel().querySelector('[aria-label="Part to write"]').querySelector("button:nth-child(3)"));
    expect(button("Rewrite tagline")).toBeTruthy();
    await type(briefBox(), "much darker");
    await click(button("Rewrite tagline"));
    expect(requests).toHaveLength(1);
    const sent = requests[0].messages.at(-1).content;
    expect(sent).toContain("<brief>\nmuch darker\n</brief>");
    expect(sent.split("The current")[0]).not.toContain('"Old"');
    expect(sent).toContain('"name": "Edda"');
    expect(lastToast().text).toBe("Tagline rewritten");
    await click(button("Save"));
    expect(saved).toMatchObject({ name: "Edda", tagline: "Darker.", description: "A keeper." });
    expect(saved.greetings[0].text).toBe("Hello.");
  });

  it("a part rewrite changes only that field even when the user edits others meanwhile", async () => {
    const gate = held();
    vi.stubGlobal("fetch", route(gate.handler));
    await mount(form("personas", { initial: { id: "p", name: "Edda", description: "Original." } }));
    await click(toggle());
    await click(button("Description"));
    await click(button("Rewrite description"));
    const name = inputs().find((i) => i.placeholder === "What characters should call you");
    await type(name, "Edda Renamed");
    await act(async () => gate.release({ description: "Rewritten." }));
    await flush();
    expect(name.value).toBe("Edda Renamed");
    expect(areas().some((t) => t.value === "Rewritten.")).toBe(true);
    await act(async () => lastToast().undo());
    await flush();
    expect(areas().some((t) => t.value === "Original.")).toBe(true);
    expect(name.value).toBe("Edda Renamed");
  });

  it("reports a part the model did not return and keeps the form unchanged", async () => {
    vi.stubGlobal("fetch", route(() => ({ reply: { somethingElse: "x" } })));
    await mount(form("personas", { initial: { id: "p", name: "Edda", description: "Kept." } }));
    await click(toggle());
    await click(button("Description"));
    await click(button("Rewrite description"));
    expect(body()).toContain("The model did not return that part. Try again.");
    expect(areas().some((t) => t.value === "Kept.")).toBe(true);
  });

  it("rewrites the whole card with no brief, sending the card in hand", async () => {
    vi.stubGlobal("fetch", route(() => ({ reply: sample.personas })));
    await mount(form("personas", { initial: { id: "p", name: "Edda", description: "A keeper." } }));
    await click(toggle());
    await click(button("Rewrite"));
    expect(requests[0].messages.at(-1).content).toContain("<current_card>");
    expect(requests[0].messages.at(-1).content).toContain('"name": "Edda"');
  });

  it("asks once for required fields the model left out, then merges them", async () => {
    vi.stubGlobal("fetch", route((b, n) => ({ reply: n === 1 ? { name: "Ana" } : { description: "Filled in." } })));
    await mount(form("personas"));
    await writeNew();
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1).content).toContain('Write the missing keys: "description"');
    expect(areas().some((t) => t.value === "Filled in.")).toBe(true);
  });

  it("shows the universe warning after a result with more than ten characters", async () => {
    const characters = Array.from({ length: 11 }, (_, i) => ({ name: `C${i}`, description: "x", personality: "y" }));
    vi.stubGlobal("fetch", route(() => ({ reply: { ...sample.universes, characters } })));
    await mount(form("universes"));
    await writeNew();
    expect(body()).toContain("Every character and place is sent with every reply");
  });

  it("does not warn about a universe at exactly ten characters and ten places", async () => {
    const ten = (p) => Array.from({ length: 10 }, (_, i) => ({ name: `${p} ${i}`, description: "d", personality: "p" }));
    vi.stubGlobal("fetch", route(() => ({ reply: { ...sample.universes, characters: ten("C"), locations: ten("L") } })));
    await mount(form("universes"));
    await writeNew();
    expect(body()).not.toContain("Every character and place is sent with every reply");
  });
});

describe("JSON repair and continue", () => {
  it("parses a reply with a thinking preamble and prose around a fence without any repair call", async () => {
    const reply = '<think>Plan: {name}</think>Here you go:\n```json\n{"name":"Edda","description":"Fine."}\n```\nHope it helps }';
    vi.stubGlobal("fetch", route(() => ({ reply })));
    await mount(form("personas"));
    await writeNew();
    expect(requests).toHaveLength(1);
    expect(inputs().some((i) => i.value === "Edda")).toBe(true);
  });

  it("sends the broken text, without its thinking, to the repair call", async () => {
    vi.stubGlobal("fetch", route((b, n) => ({ reply: n === 1 ? "<think>secret plan</think>{name: Edda,, oops" : { name: "Edda", description: "Fixed." } })));
    await mount(form("personas"));
    await writeNew();
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[0].content).toContain("You repair broken JSON");
    expect(requests[1].messages.at(-1).content).toContain("{name: Edda,, oops");
    expect(requests[1].messages.at(-1).content).not.toContain("secret plan");
    expect(areas().some((t) => t.value === "Fixed.")).toBe(true);
  });

  it("shows Fixing format… while the repair runs, and Stop aborts it without an error", async () => {
    const gate = held();
    vi.stubGlobal("fetch", route((b, n, init) => (n === 1 ? { reply: "{oops" } : gate.handler(b, n, init))));
    await mount(form("personas"));
    await writeNew();
    expect(requests).toHaveLength(2);
    expect(cardJobs("personas")[0].phase).toBe("Fixing format…");
    expect(panel().textContent).toContain("Fixing format…");
    await click(button("Stop"));
    expect(gate.signal.aborted).toBe(true);
    expect(cardJobs()).toHaveLength(0);
    expect(button("Stop")).toBeUndefined();
    expect(body()).not.toMatch(/abort|Something went wrong/i);
  });

  it("continues a truncated list rewrite once and keeps the finished list", async () => {
    const greetings = [{ label: "A", text: "One." }, { label: "B", text: "Two." }];
    vi.stubGlobal("fetch", route((b, n) => (n === 1
      ? { reply: '[{"label":"A","text":"One."},{"label":"B","te', finish: "length" }
      : { reply: { greetings } })));
    let saved;
    await mount(form("characters", { initial: { id: "e", name: "Edda", greetings: [{ id: "g", label: "Old", text: "Old." }] }, onSave: (c) => { saved = c; } }));
    await click(toggle());
    await click(button("Openings"));
    await click(button("Rewrite openings"));
    expect(requests).toHaveLength(2);
    expect(requests[1].messages.at(-1).content).toContain("Continue from where you stopped");
    await click(button("Save"));
    expect(saved.greetings.map((g) => g.text)).toEqual(["One.", "Two."]);
  });

  it("shows a provider error inline, then a retry succeeds as a new job and clears it", async () => {
    vi.stubGlobal("fetch", route((b, n) => (n === 1
      ? new Response(JSON.stringify({ error: { message: "Upstream exploded" } }), { status: 500 })
      : { reply: sample.personas })));
    await mount(form("personas"));
    await writeNew();
    const failed = cardJobs("personas")[0];
    expect(failed.status).toBe("error");
    expect(panel().textContent).toContain(failed.error);
    await click(button("Write the persona"));
    expect(requests).toHaveLength(2);
    expect(cardJobs("personas")).toHaveLength(0);
    expect(inputs().some((i) => i.value === "Ana")).toBe(true);
  });

  it("starts one job and one request when Write is clicked twice", async () => {
    const gate = held();
    vi.stubGlobal("fetch", route(gate.handler));
    await mount(form("personas"));
    await click(toggle());
    await type(briefBox(), "x");
    const write = button("Write the persona");
    await act(async () => { write.click(); write.click(); });
    await flush();
    expect(requests).toHaveLength(1);
    expect(cardJobs("personas")).toHaveLength(1);
    await act(async () => gate.release(sample.personas));
    await flush();
  });
});

describe("background jobs", () => {
  it("closing the form mid-request keeps the job; reopened it shows progress, then applies the result", async () => {
    const gate = held();
    vi.stubGlobal("fetch", route(gate.handler));
    await mount(form("personas"));
    await writeNew();
    await mount(<div key="closed" />);
    expect(gate.signal.aborted).toBe(false);
    await mount(form("personas", { key: "again" }));
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(button("Stop")).toBeTruthy();
    await act(async () => gate.release({ name: "Late", description: "Arrived." }));
    await flush();
    expect(inputs().some((i) => i.value === "Late")).toBe(true);
  });

  it("a result finished while the form was closed is offered with Use it / Discard", async () => {
    const gate = held();
    vi.stubGlobal("fetch", route(gate.handler));
    await mount(form("personas"));
    await writeNew();
    await mount(<div key="closed" />);
    await act(async () => gate.release({ name: "Late", description: "Arrived." }));
    await flush();
    expect(cardJobs("personas")[0]).toMatchObject({ status: "done" });
    await mount(form("personas", { key: "again" }));
    expect(panel().textContent).toContain("finished while this form was closed");
    expect(inputs().some((i) => i.value === "Late")).toBe(false);
    await click(button("Use it"));
    expect(inputs().some((i) => i.value === "Late")).toBe(true);
    expect(cardJobs()).toHaveLength(0);
    expect(lastToast().text).toBe("Card written");

    /* Discard drops it */
    startActivity({ owner: { cardKind: "personas" } }).done({ name: "Unwanted" });
    await mount(form("personas", { key: "third" }));
    await click(button("Discard"));
    expect(cardJobs()).toHaveLength(0);
    expect(inputs().some((i) => i.value === "Unwanted")).toBe(false);
  });

  it("a failed job does not open the panel on mount; a running or held one does, only for its kind and item", async () => {
    startActivity({ owner: { cardKind: "personas" } }).fail(new Error("Rate limited by provider"));
    await mount(form("personas"));
    expect(panel()).toBeNull();
    await click(toggle());
    expect(panel().textContent).toContain("Rate limited by provider");

    clearActivity();
    startActivity({ owner: { cardKind: "personas" } });
    await mount(form("characters", { key: "c" }));
    expect(panel()).toBeNull();
    await mount(form("personas", { key: "p" }));
    expect(panel()).toBeTruthy();
    expect(button("Stop")).toBeTruthy();
    await mount(form("personas", { key: "bob", initial: { id: "bob", name: "Bob", description: "" } }));
    expect(panel()).toBeNull();
  });

  it("marks the job focused only while the panel is open and running", async () => {
    const h = startActivity({ owner: { cardKind: "personas" } });
    await mount(form("personas"));
    expect(activity.get().find((j) => j.id === h.id).focused).toBe(true);
    await click(toggle());
    expect(activity.get().find((j) => j.id === h.id).focused).toBe(false);
  });

  it("reads the background job phase and percent", async () => {
    const h = startActivity({ owner: { cardKind: "personas" }, phase: "Fixing format…" });
    h.progress(42);
    await mount(form("personas"));
    expect(panel().textContent).toContain("Fixing format…");
    expect(panel().textContent).toContain("42%");
  });

  it("the island event opens only the form for the job's item", async () => {
    await mount(<AiFill kind="characters" itemId="bob" settings={settingsFor()} onFill={() => {}} onSettings={() => {}} />);
    await act(async () => window.dispatchEvent(new CustomEvent("nova-card-studio", { detail: { kind: "characters", itemId: null } })));
    await flush();
    expect(panel()).toBeNull();
    await act(async () => window.dispatchEvent(new CustomEvent("nova-card-studio", { detail: { kind: "characters", itemId: "bob" } })));
    await flush();
    expect(panel()).toBeTruthy();
  });

  it("AiFill opens on the island event for its own kind only", async () => {
    await mount(<AiFill kind="characters" settings={settingsFor()} onFill={() => {}} onSettings={() => {}} />);
    await act(async () => window.dispatchEvent(new CustomEvent("nova-card-studio", { detail: "universes" })));
    await flush();
    expect(panel()).toBeNull();
    await act(async () => window.dispatchEvent(new CustomEvent("nova-card-studio", { detail: "characters" })));
    await flush();
    expect(panel().getAttribute("aria-label")).toBe("Card studio · character");
  });

  it("stores the item on the job", async () => {
    const gate = held();
    vi.stubGlobal("fetch", route(gate.handler));
    await mount(form("personas", { initial: { id: "bob", name: "Bob", description: "Old." } }));
    await click(toggle());
    await click(button("Rewrite"));
    expect(cardJobs("personas")[0].owner).toEqual({ cardKind: "personas", itemId: "bob" });
    await act(async () => gate.release({ name: "Bob Rewritten", description: "New." }));
    await flush();
  });
});

describe("writer model on every provider, no Gemma", () => {
  const presets = [...PROVIDERS.map((p) => p.id), "custom"];

  it("the Written by picker is there for every provider preset", async () => {
    for (const preset of presets) {
      await mount(<AiFill key={preset} kind="personas" current={{ name: "Edda" }} settings={settingsFor(preset)} onFill={() => {}} onSettings={() => {}} />);
      await click(toggle());
      const picker = button((t) => t.startsWith("Written by"));
      expect(picker, preset).toBeTruthy();
      expect(picker.disabled, preset).toBe(false);
    }
  });

  it("sends the writer model, not the chat model, on non-OpenRouter providers", async () => {
    vi.stubGlobal("fetch", route(() => ({ reply: sample.personas })));
    for (const preset of ["groq", "custom"]) {
      clearActivity();
      requests.length = 0;
      await mount(form("personas", { key: preset, settings: settingsFor(preset, { writerModel: "vendor/writer-b" }) }));
      await click(toggle());
      expect(body()).toContain("writer-b");
      await writeNew();
      expect(requests, preset).toHaveLength(1);
      expect(requests[0].model, preset).toBe("vendor/writer-b");
    }
  });

  it("picking a model saves the writer, and the thinking switch saves writerThinking", async () => {
    const onSettings = vi.fn();
    const s = settingsFor("groq");
    s.providers[0].favorites = ["vendor/fav-model"];
    await mount(<AiFill kind="personas" current={{ name: "Edda" }} settings={s} onFill={() => {}} onSettings={onSettings} />);
    await click(toggle());
    await click(document.querySelector('[role="switch"][aria-checked="true"]'));
    expect(onSettings).toHaveBeenCalledWith({ writerThinking: false });
    await click(button((t) => t.startsWith("Written by")));
    expect(body()).toContain("Choose a model");
    await click(button("vendor/fav-model"));
    expect(onSettings).toHaveBeenCalledWith({ writerModels: { [s.providers[0].id]: "vendor/fav-model" } });
  });

  it("the writer is kept per provider, and another provider never gets that id", async () => {
    const s = settingsFor("openrouter");
    const google = newProvider("google", { key: "g-key", model: "gemini-chat" });
    s.providers.push(google);
    Object.assign(s, writerModelPatch(s, "anthropic/claude-x"));
    expect(writerModelOf(s)).toBe("anthropic/claude-x");
    const onGoogle = { ...s, activeProvider: google.id };
    expect(writerModelOf(onGoogle)).toBe("gemini-chat");
    await mount(<AiFill kind="personas" current={{ name: "Edda" }} settings={onGoogle} onFill={() => {}} onSettings={() => {}} />);
    await click(toggle());
    expect(button((t) => t.startsWith("Written by")).textContent).not.toContain("claude-x");
    Object.assign(onGoogle, writerModelPatch(onGoogle, "gemini-pro"));
    expect(writerModelOf(onGoogle)).toBe("gemini-pro");
    expect(writerModelOf(s)).toBe("anthropic/claude-x");
  });

  it("normalizeData moves an old writerModel to the OpenRouter provider's slot only", () => {
    const old = structuredClone(emptyData);
    const or = newProvider("openrouter", { key: "k" });
    const google = newProvider("google", { key: "g", model: "gemini-chat" });
    old.settings.providers = [google, or];
    old.settings.activeProvider = google.id;
    old.settings.writerModel = "anthropic/claude-x";
    delete old.settings.writerModels;
    const d = normalizeData(old);
    expect(d.settings.writerModels).toEqual({ [or.id]: "anthropic/claude-x" });
    expect(writerModelOf(d.settings)).toBe("gemini-chat");
    expect(writerModelOf({ ...d.settings, activeProvider: or.id })).toBe("anthropic/claude-x");
    const again = normalizeData({ ...d, settings: { ...d.settings, writerModels: { [google.id]: "gemini-pro", [or.id]: "google/gemma-4-31b-it:free" } } });
    expect(again.settings.writerModels).toEqual({ [google.id]: "gemini-pro" });
  });

  it("renders no Gemma text for any kind", async () => {
    for (const kind of KINDS) {
      await mount(form(kind, { key: kind }));
      await click(toggle());
      expect(body()).not.toMatch(/gemma|Same as chat/i);
      expect(cardSystem(AI_SCHEMAS[kind]) + cardUser(kind, "x")).not.toMatch(/gemma/i);
    }
  });

  it("normalizeData drops the retired Gemma writer and keeps any other writer", () => {
    const gemma = structuredClone(emptyData);
    gemma.settings.writerModel = "google/gemma-4-31b-it:free";
    expect(normalizeData(gemma).settings.writerModel).toBe("");
    const other = structuredClone(emptyData);
    other.settings.writerModel = "vendor/writer-b";
    expect(normalizeData(other).settings.writerModel).toBe("vendor/writer-b");
  });
});
