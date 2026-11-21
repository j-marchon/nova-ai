// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { QuickRepliesStrip, SendAsModal } from "../src/components/QuickReplies.jsx";
import { buildApiMessages } from "../src/lib/prompt.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const mount = async (el) => {
  await act(async () => root.render(el));
};

describe("Send As & Quick Replies data schema", () => {
  it("starts with no quick replies and drops the old on/off switch", () => {
    expect(emptyData.settings.quickReplies).toEqual([]);

    const normalized = normalizeData({ settings: { quickRepliesOn: true } });
    expect(normalized.settings.quickRepliesOn).toBeUndefined();
    expect(normalized.settings.quickReplies).toEqual([]);
  });
});

describe("Prompt assembly with Send As and Narrator roles", () => {
  const mira = { id: "c1", name: "Mira", description: "A thief.", personality: "wry" };
  const settings = { ...emptyData.settings, apiKey: "k" };

  it("converts system/narrator messages into safe user messages with Narrator prefix", () => {
    const history = [
      { id: "m1", role: "system", content: "Night falls upon the forest.", speaker: "Narrator" },
      { id: "m2", role: "assistant", content: "Did you hear that branch snap?" },
    ];
    const msgs = buildApiMessages({ character: mira, username: "Player", history, settings });
    const narratorMsg = msgs.find((m) => m.content.includes("Night falls"));
    expect(narratorMsg).toBeDefined();
    expect(narratorMsg.role).toBe("user");
    expect(narratorMsg.content).toBe("[Narrator: Night falls upon the forest.]");
  });

  it("labels assistant messages from side characters so the model knows who spoke", () => {
    const history = [
      { id: "m1", role: "assistant", content: "Halt! Who goes there?", speaker: "Town Guard" },
    ];
    const msgs = buildApiMessages({ character: mira, username: "Player", history, settings });
    const guardMsg = msgs.find((m) => m.content.includes("Halt!"));
    expect(guardMsg).toBeDefined();
    expect(guardMsg.content).toBe("Town Guard: Halt! Who goes there?");
  });
});

describe("QuickRepliesStrip component", () => {
  it("renders chips and triggers callback when clicked", async () => {
    const onTrigger = vi.fn();
    const onOpenManager = vi.fn();
    const testReplies = [
      { id: "1", label: "*Nods*", text: "*Nods slowly.*", mode: "send" },
      { id: "2", label: "Check bag", text: "I check my bag.", mode: "insert" },
    ];

    await mount(
      <QuickRepliesStrip
        replies={testReplies}
        onTrigger={onTrigger}
        onOpenManager={onOpenManager}
      />
    );

    expect(host.textContent).toContain("*Nods*");
    expect(host.textContent).toContain("Check bag");

    const nodBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent.includes("*Nods*"));
    expect(nodBtn).toBeDefined();
    act(() => nodBtn.click());
    expect(onTrigger).toHaveBeenCalledWith(testReplies[0]);

    const plusBtn = host.querySelector("button[aria-label='Manage Quick Replies']");
    expect(plusBtn).toBeDefined();
    act(() => plusBtn.click());
    expect(onOpenManager).toHaveBeenCalled();
  });
});

describe("SendAsModal component", () => {
  it("allows selecting different authors including Character, Cast, and Narrator", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const characters = [{ id: "c1", name: "Mira", avatar: null }];
    const cast = [{ id: "s1", name: "Elena", avatar: null }];

    await mount(
      <SendAsModal
        current={{ type: "user", id: null, name: "" }}
        userName="Player"
        characters={characters}
        cast={cast}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    expect(host.textContent).toContain("Player");
    expect(host.textContent).toContain("Mira");
    expect(host.textContent).toContain("Elena");
    expect(host.textContent).toContain("Narrator / System");

    // Click Mira button
    const miraBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent.includes("Mira"));
    expect(miraBtn).toBeDefined();
    act(() => miraBtn.click());

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: "character", id: "c1", name: "Mira" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("allows selecting Narrator", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    await mount(
      <SendAsModal
        current={{ type: "user", id: null, name: "" }}
        userName="Player"
        characters={[]}
        cast={[]}
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    const narratorBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent.includes("Narrator / System"));
    expect(narratorBtn).toBeDefined();
    act(() => narratorBtn.click());

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: "system", name: "Narrator" }));
  });
});
