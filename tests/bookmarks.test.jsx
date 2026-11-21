// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addBookmark,
  createChatBranch,
  emptyData,
  normalizeBookmark,
  normalizeData,
  removeBookmark,
} from "../src/lib/data.js";
import { BookmarksModal } from "../src/components/BookmarksModal.jsx";
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

describe("Chat Bookmarks Data Schema & Normalization", () => {
  it("normalizes chats without bookmarks by ensuring bookmarks is an empty array", () => {
    const raw = {
      chats: [
        { id: "c1", kind: "character", messages: [] },
        { id: "c2", kind: "group", memberIds: [], messages: [] },
      ],
    };
    const normalized = normalizeData(raw);
    expect(normalized.chats[0].bookmarks).toEqual([]);
    expect(normalized.chats[1].bookmarks).toEqual([]);
  });

  it("normalizes and preserves valid bookmarks while dropping invalid entries", () => {
    const raw = {
      chats: [
        {
          id: "c1",
          messages: [{ id: "m1", content: "Hello" }],
          bookmarks: [
            { id: "b1", messageId: "m1", label: "Tavern Entry", createdAt: 1000 },
            null,
            "invalid-entry",
            { messageId: "m1", label: "No ID provided" },
          ],
        },
      ],
    };
    const normalized = normalizeData(raw);
    expect(normalized.chats[0].bookmarks).toHaveLength(2);
    expect(normalized.chats[0].bookmarks[0]).toEqual({
      id: "b1",
      messageId: "m1",
      label: "Tavern Entry",
      createdAt: 1000,
    });
    expect(normalized.chats[0].bookmarks[1].messageId).toBe("m1");
    expect(normalized.chats[0].bookmarks[1].label).toBe("No ID provided");
    expect(typeof normalized.chats[0].bookmarks[1].id).toBe("string");
  });
});

describe("Bookmarks helper functions", () => {
  const sampleChat = {
    id: "chat-1",
    kind: "character",
    characterId: "char-1",
    title: "Adventure in Aethelgard",
    messages: [
      { id: "m1", role: "assistant", content: "Welcome to the tavern." },
      { id: "m2", role: "user", content: "I look around for the wizard." },
      { id: "m3", role: "assistant", content: "The wizard nods from the corner booth." },
      { id: "m4", role: "user", content: "I approach and draw my sword." },
    ],
    bookmarks: [
      { id: "bm-1", messageId: "m1", label: "Tavern Arrival", createdAt: 1000 },
    ],
  };

  it("addBookmark appends a new bookmark with unique ID and updates chat", () => {
    const updated = addBookmark(sampleChat, { messageId: "m3", label: "Meeting Wizard" });
    expect(updated.bookmarks).toHaveLength(2);
    expect(updated.bookmarks[1].messageId).toBe("m3");
    expect(updated.bookmarks[1].label).toBe("Meeting Wizard");
    expect(typeof updated.bookmarks[1].id).toBe("string");
    expect(updated.bookmarks[1].createdAt).toBeGreaterThan(0);
    expect(updated.updatedAt).toBeGreaterThan(0);
  });

  it("removeBookmark removes the target bookmark", () => {
    const updated = removeBookmark(sampleChat, "bm-1");
    expect(updated.bookmarks).toHaveLength(0);
  });
});

describe("Story Branching Logic", () => {
  const sampleChat = {
    id: "chat-main",
    kind: "character",
    characterId: "char-elena",
    title: "Elena's Journey",
    memory: { summary: "Memory up to m3", lastId: "m3" },
    scene: { text: "Scene at m4", lastId: "m4" },
    messages: [
      { id: "m1", role: "assistant", content: "The gates open." },
      { id: "m2", role: "user", content: "I choose the left path into the woods." },
      { id: "m3", role: "assistant", content: "You find a mysterious glowing shrine." },
      { id: "m4", role: "user", content: "I touch the glowing rune." },
      { id: "m5", role: "assistant", content: "The rune shatters into light!" },
    ],
    bookmarks: [
      { id: "bm-shrine", messageId: "m3", label: "The Glowing Shrine", createdAt: 2000 },
      { id: "bm-rune", messageId: "m4", label: "Rune Touched", createdAt: 3000 },
    ],
  };

  it("createChatBranch truncates messages to target message (inclusive)", () => {
    const branch = createChatBranch(sampleChat, {
      messageId: "m3",
      label: "Alternate Choice",
      characterName: "Elena",
    });

    expect(branch.id).not.toBe(sampleChat.id);
    expect(branch.messages).toHaveLength(3);
    expect(branch.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(branch.title).toBe("Elena's Journey (Branch: Alternate Choice)");
  });

  it("createChatBranch uses bookmark label and fallback title correctly", () => {
    const chatNoTitle = {
      ...sampleChat,
      title: "",
    };
    const branch = createChatBranch(chatNoTitle, {
      bookmark: sampleChat.bookmarks[0],
      characterName: "Elena",
    });

    expect(branch.title).toBe("Elena (Branch: The Glowing Shrine)");
  });

  it("createChatBranch keeps only bookmarks within truncated message history", () => {
    const branch = createChatBranch(sampleChat, {
      messageId: "m3",
      label: "Shrine Branch",
    });

    // bm-shrine was at m3 (kept), bm-rune was at m4 (truncated)
    expect(branch.bookmarks).toHaveLength(1);
    expect(branch.bookmarks[0].id).toBe("bm-shrine");
  });

  it("createChatBranch clears memory/scene if their anchor message was truncated", () => {
    const branch = createChatBranch(sampleChat, {
      messageId: "m2",
      label: "Early Branch",
    });

    // memory was anchored on m3, scene on m4 -> both should be cleared
    expect(branch.memory).toBeNull();
    expect(branch.scene).toBeNull();
  });
});

describe("BookmarksModal Component", () => {
  const sampleChat = {
    id: "c1",
    title: "Shadows of the Past",
    messages: [
      { id: "m1", role: "assistant", content: "Rain poured against the window panes.", speaker: "Kael" },
      { id: "m2", role: "user", content: "Did you find the ancient tome?" },
      { id: "m3", role: "assistant", content: "Yes, but the clasp is locked with blood magic.", speaker: "Kael" },
    ],
    bookmarks: [
      { id: "bm-1", messageId: "m1", label: "Rainy Evening", createdAt: Date.now() - 60000 },
      { id: "bm-2", messageId: "m3", label: "Tome Discovered", createdAt: Date.now() },
    ],
  };

  it("renders list of saved bookmarks with label, time, and message snippet", async () => {
    await mount(
      <BookmarksModal
        chat={sampleChat}
        characterName="Kael"
        onClose={vi.fn()}
        onJump={vi.fn()}
        onBranch={vi.fn()}
        onAddBookmark={vi.fn()}
        onDeleteBookmark={vi.fn()}
      />
    );
    await flush();

    expect(host.textContent).toContain("Saved Checkpoints (2)");
    expect(host.textContent).toContain("Rainy Evening");
    expect(host.textContent).toContain("Tome Discovered");
    expect(host.textContent).toContain("Rain poured against the window panes");
    expect(host.textContent).toContain("Yes, but the clasp is locked with blood magic");
  });

  it("allows adding a new bookmark", async () => {
    const onAdd = vi.fn();
    await mount(
      <BookmarksModal
        chat={sampleChat}
        characterName="Kael"
        onClose={vi.fn()}
        onJump={vi.fn()}
        onBranch={vi.fn()}
        onAddBookmark={onAdd}
        onDeleteBookmark={vi.fn()}
      />
    );
    await flush();

    const input = host.querySelector("input[placeholder*='Checkpoint label']");
    expect(input).not.toBeNull();
    await type(input, "Before Opening Tome");

    const addBtn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent.includes("Bookmark"));
    expect(addBtn).not.toBeUndefined();
    await act(async () => addBtn.click());
    await flush();

    expect(onAdd).toHaveBeenCalledWith({
      messageId: "m3", // latest message by default
      label: "Before Opening Tome",
    });
  });

  it("clicking Branch on a bookmark calls onBranch with target bookmark", async () => {
    const onBranch = vi.fn();
    await mount(
      <BookmarksModal
        chat={sampleChat}
        characterName="Kael"
        onClose={vi.fn()}
        onJump={vi.fn()}
        onBranch={onBranch}
        onAddBookmark={vi.fn()}
        onDeleteBookmark={vi.fn()}
      />
    );
    await flush();

    const branchBtns = Array.from(host.querySelectorAll("button")).filter((b) => b.textContent.includes("Branch"));
    expect(branchBtns.length).toBe(2);

    await act(async () => branchBtns[0].click());
    await flush();

    expect(onBranch).toHaveBeenCalledWith(sampleChat.bookmarks[0]);
  });

  it("clicking Jump calls onJump with target bookmark", async () => {
    const onJump = vi.fn();
    await mount(
      <BookmarksModal
        chat={sampleChat}
        characterName="Kael"
        onClose={vi.fn()}
        onJump={onJump}
        onBranch={vi.fn()}
        onAddBookmark={vi.fn()}
        onDeleteBookmark={vi.fn()}
      />
    );
    await flush();

    const jumpBtns = Array.from(host.querySelectorAll("button")).filter((b) => b.textContent.includes("Jump"));
    expect(jumpBtns.length).toBe(2);

    await act(async () => jumpBtns[1].click());
    await flush();

    expect(onJump).toHaveBeenCalledWith(sampleChat.bookmarks[1]);
  });

  it("clicking Delete calls onDeleteBookmark with bookmark id", async () => {
    const onDelete = vi.fn();
    await mount(
      <BookmarksModal
        chat={sampleChat}
        characterName="Kael"
        onClose={vi.fn()}
        onJump={vi.fn()}
        onBranch={vi.fn()}
        onAddBookmark={vi.fn()}
        onDeleteBookmark={onDelete}
      />
    );
    await flush();

    const deleteBtns = Array.from(host.querySelectorAll("button[aria-label='Delete bookmark']"));
    expect(deleteBtns.length).toBe(2);

    await act(async () => deleteBtns[0].click());
    await flush();

    expect(onDelete).toHaveBeenCalledWith("bm-1");
  });
});

/* the header's ⋮ menu, then one of its rows */
const fromChatMenu = async (text) => {
  await act(async () => host.querySelector("button[aria-label='Chat settings']").click());
  await flush();
  const row = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent.includes(text));
  expect(row).not.toBeUndefined();
  await act(async () => row.click());
  await flush();
  await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent.startsWith("Open bookmarks")).click());
  await flush();
};

describe("ChatPage Bookmarks & Story Branching Integration", () => {
  const initialData = {
    ...emptyData,
    characters: [{ id: "char-aria", name: "Aria", tagline: "Mage" }],
    chats: [
      {
        id: "chat-aria-1",
        kind: "character",
        characterId: "char-aria",
        messages: [
          { id: "msg-1", role: "assistant", content: "The tower bells ring midnight.", speaker: "Aria" },
          { id: "msg-2", role: "user", content: "We must flee before the guards arrive." },
          { id: "msg-3", role: "assistant", content: "Take my hand, I will cast the teleportation spell.", speaker: "Aria" },
        ],
        bookmarks: [
          { id: "bm-midnight", messageId: "msg-1", label: "Midnight Bell", createdAt: Date.now() },
        ],
      },
    ],
  };

  it("lists Bookmarks in the chat's ⋮ menu with the saved count", async () => {
    const update = vi.fn();
    await mount(
      <ChatPage
        data={initialData}
        chatId="chat-aria-1"
        update={update}
        goBack={vi.fn()}
        goSettings={vi.fn()}
      />
    );
    await flush();

    await act(async () => host.querySelector("button[aria-label='Chat settings']").click());
    await flush();
    const row = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent.includes("Bookmarks"));
    await act(async () => row.click());
    await flush();
    expect(host.textContent).toContain("Open bookmarks (1)");
  });

  it("the menu's Bookmarks row opens BookmarksModal", async () => {
    const update = vi.fn();
    await mount(
      <ChatPage
        data={initialData}
        chatId="chat-aria-1"
        update={update}
        goBack={vi.fn()}
        goSettings={vi.fn()}
      />
    );
    await flush();

    await fromChatMenu("Bookmarks");

    expect(document.body.textContent).toContain("Bookmarks & Checkpoints");
    expect(document.body.textContent).toContain("Midnight Bell");
  });

  it("branching from BookmarksModal creates a new chat in data.chats and switches to it", async () => {
    let currentData = initialData;
    const update = vi.fn((patchOrFn) => {
      currentData = typeof patchOrFn === "function" ? patchOrFn(currentData) : { ...currentData, ...patchOrFn };
    });
    const openChat = vi.fn();

    await mount(
      <ChatPage
        data={initialData}
        chatId="chat-aria-1"
        update={update}
        goBack={vi.fn()}
        goSettings={vi.fn()}
        openChat={openChat}
      />
    );
    await flush();

    // Open bookmarks modal
    await fromChatMenu("Bookmarks");

    // Click Branch on the bookmark
    const branchBtn = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent.includes("Branch"));
    expect(branchBtn).not.toBeUndefined();

    await act(async () => branchBtn.click());
    await flush();

    // Verify update was called adding the new chat to data.chats
    expect(update).toHaveBeenCalled();
    expect(currentData.chats).toHaveLength(2);

    const branchedChat = currentData.chats[1];
    expect(branchedChat.id).not.toBe("chat-aria-1");
    expect(branchedChat.messages).toHaveLength(1); // branched at msg-1
    expect(branchedChat.title).toBe("Aria (Branch: Midnight Bell)");

    // Verify openChat was called with the new chat id
    expect(openChat).toHaveBeenCalledWith(branchedChat.id);
  });

  it("shows 'Bookmark' and 'Branch from here' in the message action menu", async () => {
    await mount(
      <ChatPage
        data={initialData}
        chatId="chat-aria-1"
        update={vi.fn()}
        goBack={vi.fn()}
        goSettings={vi.fn()}
      />
    );
    await flush();

    const msgOptionsBtns = host.querySelectorAll(".nv-msg");
    expect(msgOptionsBtns.length).toBeGreaterThan(0);

    // Open menu for the second message (msg-2)
    await act(async () => msgOptionsBtns[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    await flush();

    expect(document.body.textContent).toContain("a checkpoint to jump back to");
    expect(document.body.textContent).toContain("Branch from here");
  });

  it("clicking 'Bookmark' from action menu opens BookmarksModal with that message targeted", async () => {
    await mount(
      <ChatPage
        data={initialData}
        chatId="chat-aria-1"
        update={vi.fn()}
        goBack={vi.fn()}
        goSettings={vi.fn()}
      />
    );
    await flush();

    const msgOptionsBtns = host.querySelectorAll(".nv-msg");
    // Click options on msg-2
    await act(async () => msgOptionsBtns[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    await flush();

    const bookmarkMenuOption = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent.includes("a checkpoint to jump back to")
    );
    expect(bookmarkMenuOption).not.toBeUndefined();

    await act(async () => bookmarkMenuOption.click());
    await flush();

    // Modal should be open targeting Message #2
    expect(document.body.textContent).toContain("Bookmarks & Checkpoints");
    expect(document.body.textContent).toContain("Message #2 of 3");
    expect(document.body.textContent).toContain("We must flee before the guards arrive");
  });

  it("clicking 'Branch from here' from action menu immediately branches chat up to that message", async () => {
    let currentData = initialData;
    const update = vi.fn((patchOrFn) => {
      currentData = typeof patchOrFn === "function" ? patchOrFn(currentData) : { ...currentData, ...patchOrFn };
    });
    const openChat = vi.fn();

    await mount(
      <ChatPage
        data={initialData}
        chatId="chat-aria-1"
        update={update}
        goBack={vi.fn()}
        goSettings={vi.fn()}
        openChat={openChat}
      />
    );
    await flush();

    const msgOptionsBtns = host.querySelectorAll(".nv-msg");
    // Click options on msg-2
    await act(async () => msgOptionsBtns[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    await flush();

    const branchMenuOption = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Branch from here")
    );
    expect(branchMenuOption).not.toBeUndefined();

    await act(async () => branchMenuOption.click());
    await flush();

    expect(update).toHaveBeenCalled();
    expect(currentData.chats).toHaveLength(2);

    const branchedChat = currentData.chats[1];
    expect(branchedChat.messages).toHaveLength(2); // msg-1 and msg-2
    expect(branchedChat.messages.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
    expect(openChat).toHaveBeenCalledWith(branchedChat.id);
  });

  it("jumping to a bookmark centers the message inside the chat scroller", async () => {
    await mount(
      <ChatPage
        data={initialData}
        chatId="chat-aria-1"
        update={vi.fn()}
        goBack={vi.fn()}
        goSettings={vi.fn()}
      />
    );
    await flush();

    const targetEl = host.querySelector("#msg-msg-1");
    expect(targetEl).not.toBeNull();
    const scroller = targetEl.closest(".overflow-y-auto");
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 200 });
    scroller.getBoundingClientRect = () => ({ top: 20 });
    targetEl.getBoundingClientRect = () => ({ top: 520 });
    scroller.scrollTop = 0;

    // Open bookmarks modal
    await fromChatMenu("Bookmarks");

    // Click Jump
    const jumpBtn = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Jump")
    );
    expect(jumpBtn).not.toBeUndefined();

    await act(async () => jumpBtn.click());
    await flush();

    // Wait for the timeout scroll invocation
    await new Promise((r) => setTimeout(r, 80));
    await flush();

    expect(scroller.scrollTop).toBe(400);
  });
});
