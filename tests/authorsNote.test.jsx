// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_AUTHORS_NOTE, emptyData, normalizeData } from "../src/lib/data.js";
import { buildApiMessages } from "../src/lib/prompt.js";
import { ChatPage } from "../src/pages/ChatPage.jsx";

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

const flush = async () => {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
};

describe("Author's Note schema & defaults", () => {
  it("defines DEFAULT_AUTHORS_NOTE with correct defaults", () => {
    expect(DEFAULT_AUTHORS_NOTE).toEqual({ text: "" });
  });

  it("normalizes chats without authorsNote by adding default fallback", () => {
    const raw = {
      chats: [
        { id: "chat-1", kind: "character", messages: [] },
        { id: "chat-2", kind: "group", memberIds: ["c1"], messages: [] },
      ],
    };
    const normalized = normalizeData(raw);
    expect(normalized.chats[0].authorsNote).toEqual(DEFAULT_AUTHORS_NOTE);
    expect(normalized.chats[1].authorsNote).toEqual(DEFAULT_AUTHORS_NOTE);
  });

  it("keeps a note's text and drops the old role, depth and interval", () => {
    const raw = {
      chats: [
        {
          id: "chat-1",
          authorsNote: {
            text: "Speak softly.",
            depth: 4,
            interval: 2,
            role: "system",
          },
        },
        {
          id: "chat-2",
          authorsNote: {
            text: 12345, // invalid type
            depth: "not-a-number", // invalid
            interval: -5, // invalid
          },
        },
      ],
    };
    const normalized = normalizeData(raw);
    expect(normalized.chats[0].authorsNote).toEqual({ text: "Speak softly." });
    expect(normalized.chats[1].authorsNote).toEqual({ text: "" });
  });
});

describe("Author's Note prompt assembly injection", () => {
  const mira = { id: "c1", name: "Mira", description: "A witty rogue." };
  const settings = { ...emptyData.settings, apiKey: "test-key" };
  const history = [
    { id: "m1", role: "assistant", content: "Greetings stranger." },
    { id: "m2", role: "user", content: "Hello Mira." },
    { id: "m3", role: "assistant", content: "What brings you here?" },
    { id: "m4", role: "user", content: "Looking for adventure." },
  ];

  it("does not inject note if text is empty or whitespace", () => {
    const msgsEmpty = buildApiMessages({
      character: mira,
      username: "Player",
      history,
      settings,
      authorsNote: { text: "", depth: 3, interval: 1, role: "system" },
    });
    expect(msgsEmpty.some((m) => m.content.includes("Author's note"))).toBe(false);

    const msgsWhitespace = buildApiMessages({
      character: mira,
      username: "Player",
      history,
      settings,
      authorsNote: { text: "   \n\t  ", depth: 3, interval: 1, role: "system" },
    });
    expect(msgsWhitespace.some((m) => m.content.includes("Author's note"))).toBe(false);
  });

  it("injects Author's Note at the specified depth as a safe user turn", () => {
    const note = {
      text: "Focus on tension between {{char}} and {{user}}.",
      depth: 3,
      interval: 1,
      role: "user",
    };
    const msgs = buildApiMessages({
      character: mira,
      username: "Player",
      history,
      settings,
      authorsNote: note,
    });

    const noteMsg = msgs.find((m) => m.content.includes("Author's note:"));
    expect(noteMsg).toBeDefined();
    expect(noteMsg.role).toBe("user");
    expect(noteMsg.content).toBe("[Author's note: Focus on tension between Mira and Player.]");

    // Check position: depth 3 means 3 messages up from newest message
    // msgs: [sys, m1, [Author's note], m2, m3, m4]
    const noteIdx = msgs.indexOf(noteMsg);
    const messagesAfter = msgs.length - 1 - noteIdx;
    expect(messagesAfter).toBe(3);
  });

  it("always sits three messages up as a user turn, whatever depth or role an old note stored", () => {
    for (const note of [{ text: "Tone: calm", depth: 1, interval: 1, role: "system" }, { text: "Tone: calm", depth: 0, role: "assistant" }]) {
      const msgs = buildApiMessages({ character: mira, username: "Player", history, settings, authorsNote: note });
      const idx = msgs.findIndex((m) => m.content.includes("Author's note:"));
      expect(msgs.length - 1 - idx).toBe(3);
      expect(msgs[idx].role).toBe("user");
    }
  });

  it("clamps safely after the system message when the history is short", () => {
    const shortHistory = [{ id: "m1", role: "assistant", content: "Alone here." }];
    const msgs = buildApiMessages({
      character: mira,
      username: "Player",
      history: shortHistory,
      settings,
      authorsNote: { text: "Tone: dark" },
    });

    // msgs: [sys, note, m1]
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toBe("[Author's note: Tone: dark]");
    expect(msgs[2].content).toBe("Alone here.");
  });

  it("is sent every turn, whatever interval an old note stored", () => {
    for (const h of [history, history.slice(0, 3)]) {
      const msgs = buildApiMessages({ character: mira, username: "Player", history: h, settings, authorsNote: { text: "Interval 2", interval: 2 } });
      expect(msgs.some((m) => m.content.includes("Author's note: Interval 2"))).toBe(true);
    }
  });
});

describe("Author's Note ChatPage UI", () => {
  const mira = { id: "c1", name: "Mira", description: "A thief." };
  const initialChat = {
    id: "chat-test",
    kind: "character",
    characterId: "c1",
    personaId: "",
    messages: [
      { id: "m1", role: "assistant", content: "Hello!", at: Date.now() },
    ],
    authorsNote: { text: "Be descriptive and slow-paced." },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("opens the note from the chat's Quick tweaks tab and edits it", async () => {
    let currentData = {
      ...emptyData,
      characters: [mira],
      chats: [initialChat],
    };

    function TestHost() {
      const [data, setData] = useState(currentData);
      return (
        <ChatPage
          data={data}
          chatId="chat-test"
          update={(patch) => {
            setData((prev) => {
              const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
              currentData = next;
              return next;
            });
          }}
          goBack={() => {}}
          goSettings={() => {}}
        />
      );
    }

    await mount(<TestHost />);
    await flush();

    // the ⋮ menu in the header, then its Notes tab
    await act(async () => host.querySelector("button[aria-label='Chat settings']").click());
    await flush();
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent === "Quick tweaks");
    expect(row).toBeDefined();
    await act(async () => row.click());
    await flush();

    const modalBody = document.querySelector(".nv-sheet-body");
    expect(modalBody).not.toBeNull();
    expect(modalBody.textContent).not.toContain("Placed");
    expect(modalBody.textContent).not.toContain("Sent as");
    expect(modalBody.querySelectorAll("input[type='range']")).toHaveLength(0);

    // Text area inside modal contains existing note
    const textArea = modalBody.querySelector("textarea");
    expect(textArea).not.toBeNull();
    expect(textArea.value).toBe("Be descriptive and slow-paced.");

    // Update text
    await type(textArea, "New note content");
    expect(currentData.chats[0].authorsNote.text).toBe("New note content");

    // emptying the text switches it off
    await type(modalBody.querySelector("textarea"), "");
    expect(currentData.chats[0].authorsNote.text).toBe("");
  });

  it("opens Author's Note from Quick Replies chip", async () => {
    let currentData = {
      ...emptyData,
      characters: [mira],
      chats: [initialChat],
      settings: {
        ...emptyData.settings,
        quickReplies: [{ id: "note", label: "📝 Note", mode: "action", action: "note" }],
      },
    };

    function TestHost() {
      const [data, setData] = useState(currentData);
      return (
        <ChatPage
          data={data}
          chatId="chat-test"
          update={(patch) => {
            setData((prev) => {
              const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
              currentData = next;
              return next;
            });
          }}
          goBack={() => {}}
          goSettings={() => {}}
        />
      );
    }

    await mount(<TestHost />);
    await flush();

    // Look for Note chip in quick replies strip
    const noteChip = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("📝 Note"));
    expect(noteChip).toBeDefined();

    await act(async () => {
      noteChip.click();
    });
    await flush();

    const modalBody = document.querySelector(".nv-sheet-body");
    expect(modalBody).not.toBeNull();
    expect(modalBody.querySelector("textarea").value).toBe("Be descriptive and slow-paced.");
  });

  it("allows switching between Look, Memory, and Note tabs in Chat settings", async () => {
    let currentData = {
      ...emptyData,
      characters: [mira],
      chats: [initialChat],
    };

    function TestHost() {
      const [data, setData] = useState(currentData);
      return (
        <ChatPage
          data={data}
          chatId="chat-test"
          update={(patch) => {
            setData((prev) => {
              const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
              currentData = next;
              return next;
            });
          }}
          goBack={() => {}}
          goSettings={() => {}}
        />
      );
    }

    await mount(<TestHost />);
    await flush();

    // Open chat settings via cog
    const cogBtn = host.querySelector("button[aria-label='Chat settings']");
    expect(cogBtn).not.toBeNull();

    await act(async () => {
      cogBtn.click();
    });
    await flush();

    expect(host.textContent).toContain("Chat settings");

    // the Notes tab holds the author's note
    const noteTab = [...host.querySelectorAll("button[aria-pressed]")].find((r) => r.textContent === "Quick tweaks");
    expect(noteTab).toBeDefined();

    await act(async () => {
      noteTab.click();
    });
    await flush();

    expect(host.textContent).toContain("Save preset");

    // Click Memory tab in Segmented
    const memoryTab = [...host.querySelectorAll("button[aria-pressed]")].find((r) => r.textContent.includes("Memory"));
    expect(memoryTab).toBeDefined();

    await act(async () => {
      memoryTab.click();
    });
    await flush();

    expect(host.textContent).toContain("Story so far");
  });
});
