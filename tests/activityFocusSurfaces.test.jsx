// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ActivityIsland } from "../src/components/ActivityIsland.jsx";
import { ImageGenModal } from "../src/components/ImageGenModal.jsx";
import { activity, clearActivity, startActivity } from "../src/lib/activity.js";
import { gsap, settleMotion } from "../src/components/motion/runtime.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host, root;
beforeEach(() => {
  clearActivity();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); clearActivity(); settleMotion(); gsap.globalTimeline.clear(); vi.unstubAllGlobals();
});
const render = async ui => { await act(async () => root.render(ui)); };

/* Image jobs are quiet: focus still applies, but the island never lists them. */
it("focuses its own image request only, and keeps it quiet on the island", async () => {
  let complete;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(resolve => { complete = resolve; })));
  const ui = open => <><ImageGenModal open={open} onClose={() => {}} initialPrompt="A room" settings={{ imageGen: { provider: "openai", apiKey: "test-key" } }}/><ActivityIsland/></>;
  await render(ui(true));
  const generate = [...host.querySelectorAll("button")].find(button => button.textContent.includes("Generate") && !button.textContent.includes("Regenerate"));
  await act(async () => generate.click());
  const imageJob = activity.get().find(j => j.kind === "image");
  expect(imageJob.focused).toBe(true);
  expect(host.querySelector(".nv-activity")).toBeNull();
  expect(imageJob.quiet).toBe(true);
  await act(async () => { startActivity({ kind: "image", label: "Another image" }); });
  expect(activity.get().find(j => j.label === "Another image").quiet).toBe(true);
  expect(host.querySelector(".nv-activity")).toBeNull();
  await render(ui(false));
  expect(activity.get().find(j => j.id === imageJob.id).focused).toBe(false);
  expect(imageJob.controller.signal.aborted).toBe(false);
  await act(async () => { complete(new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), { status: 200 })); });
  expect(activity.get().find(j => j.id === imageJob.id).status).toBe("done");
});
