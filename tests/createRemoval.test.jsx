// @vitest-environment jsdom
/* The Create tab deletes through the shared helper (lib/removal.js): a
   persona goes at once with an Undo toast, and its chats keep their choice. */
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CreatePage } from "../src/pages/CreatePage.jsx";
import { emptyData } from "../src/lib/data.js";
import { clearToasts, toasts } from "../src/lib/toast.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => { clearToasts(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (el) => { expect(el).toBeTruthy(); await act(async () => el.click()); await flush(); };
const button = (text) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));

it("deletes a persona from the Create tab with Undo, leaving its chats as they were", async () => {
  const box = {};
  const initial = {
    ...structuredClone(emptyData),
    personas: [{ id: "p1", name: "Edda", description: "" }, { id: "p2", name: "Bram", description: "" }],
    characters: [{ id: "c1", name: "Ada", greetings: [] }],
    chats: [{ id: "k1", kind: "character", characterId: "c1", personaId: "p1", messages: [] }],
  };
  function Host() {
    const [data, setData] = useState(initial);
    box.data = data;
    return <CreatePage data={data} update={(p) => setData((d) => (typeof p === "function" ? p(d) : { ...d, ...p }))} onEdit={() => {}} startChat={() => {}} startGroupChat={() => {}} openChat={() => {}} />;
  }
  await act(async () => root.render(<Host />));
  await flush();
  await click(button("Personas"));
  await click(host.querySelector('[aria-label="Persona options"]'));
  await click(button("Delete persona"));
  expect(box.data.personas.map((p) => p.id)).toEqual(["p2"]);
  expect(box.data.chats).toEqual(initial.chats);
  const undo = toasts.get().at(-1);
  expect(undo.text).toBe("Edda deleted");
  await act(async () => undo.undo());
  expect(box.data.personas.map((p) => p.id)).toEqual(["p1", "p2"]);
  expect(box.data.chats).toEqual(initial.chats);
});
