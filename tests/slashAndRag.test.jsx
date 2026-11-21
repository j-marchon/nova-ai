// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { emptyData } from "../src/lib/data.js";
import { buildApiMessages } from "../src/lib/prompt.js";
import {
  isSlashCommand,
  parseSlashCommand,
  suggestSlashCommands,
  executeSlashCommand,
  getHelpText,
  parseSendAsArgs,
  SLASH_COMMANDS,
} from "../src/lib/slash.js";
import {
  tokenize,
  stem,
  indexMessages,
  searchRelevantContext,
} from "../src/lib/rag.js";
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

/* ============================================================
   1. Slash Commands Parser & Registry Tests
   ============================================================ */
describe("Slash Commands Parser & Registry", () => {
  it("identifies slash commands correctly", () => {
    expect(isSlashCommand("/help")).toBe(true);
    expect(isSlashCommand("/roll 1d20+5")).toBe(true);
    expect(isSlashCommand("/sendas Guard Halt!")).toBe(true);
    expect(isSlashCommand("/note tone: dark")).toBe(true);
    expect(isSlashCommand("  /think on  ")).toBe(true);

    expect(isSlashCommand("")).toBe(false);
    expect(isSlashCommand("hello /help")).toBe(false);
    expect(isSlashCommand("/")).toBe(false);
    expect(isSlashCommand("// comment")).toBe(false);
    expect(isSlashCommand(null)).toBe(false);
    expect(isSlashCommand(123)).toBe(false);
  });

  it("parses slash command names and arguments cleanly", () => {
    expect(parseSlashCommand("/help")).toEqual({
      name: "help",
      args: "",
      argList: [],
      raw: "/help",
    });

    expect(parseSlashCommand("/roll 2d6+3")).toEqual({
      name: "roll",
      args: "2d6+3",
      argList: ["2d6+3"],
      raw: "/roll 2d6+3",
    });

    expect(parseSlashCommand('/sendas "Innkeeper Jack" Welcome traveler!')).toEqual({
      name: "sendas",
      args: '"Innkeeper Jack" Welcome traveler!',
      argList: ['"Innkeeper', 'Jack"', "Welcome", "traveler!"],
      raw: '/sendas "Innkeeper Jack" Welcome traveler!',
    });

    expect(parseSlashCommand("/setvar gold 100")).toEqual({
      name: "setvar",
      args: "gold 100",
      argList: ["gold", "100"],
      raw: "/setvar gold 100",
    });
  });

  it("parses sendas speaker and message arguments", () => {
    expect(parseSendAsArgs('"Captain Drake" Prepare the cannons!')).toEqual({
      speaker: "Captain Drake",
      message: "Prepare the cannons!",
    });

    expect(parseSendAsArgs("Guard Halt, who goes there?")).toEqual({
      speaker: "Guard",
      message: "Halt, who goes there?",
    });

    expect(parseSendAsArgs("")).toBeNull();
  });

  it("suggests slash commands by prefix for interactive autocomplete", () => {
    const all = suggestSlashCommands("");
    expect(all.length).toBe(SLASH_COMMANDS.length);

    const rollHits = suggestSlashCommands("ro");
    expect(rollHits.length).toBeGreaterThan(0);
    expect(rollHits[0].name).toBe("roll");

    const slashPrefixed = suggestSlashCommands("/th");
    expect(slashPrefixed.some((c) => c.name === "think")).toBe(true);

    const varHits = suggestSlashCommands("var");
    expect(varHits.some((c) => c.name === "setvar")).toBe(true);
    expect(varHits.some((c) => c.name === "getvar")).toBe(true);
  });

  it("provides comprehensive help text", () => {
    const help = getHelpText();
    expect(help).toContain("/help");
    expect(help).toContain("/roll");
    expect(help).toContain("/sendas");
    expect(help).toContain("/impersonate");
    expect(help).toContain("/continue");
    expect(help).toContain("/note");
    expect(help).toContain("/setvar");
    expect(help).toContain("/getvar");
    expect(help).toContain("/think");
    expect(help).toContain("/clear");
    expect(help).toContain("/branch");
  });
});

/* ============================================================
   2. Built-in Slash Commands Execution Tests
   ============================================================ */
describe("Slash Commands Execution", () => {
  it("executes /help command", () => {
    const onSystemMessage = vi.fn();
    const res = executeSlashCommand({ name: "help", args: "" }, { onSystemMessage });

    expect(res.handled).toBe(true);
    expect(res.action).toBe("help");
    expect(onSystemMessage).toHaveBeenCalledTimes(1);
    expect(onSystemMessage.mock.calls[0][0]).toContain("/help");
  });

  it("executes /roll command with valid dice", () => {
    const onSystemMessage = vi.fn();
    const res = executeSlashCommand({ name: "roll", args: "1d20+5" }, { onSystemMessage });

    expect(res.handled).toBe(true);
    expect(res.success).toBe(true);
    expect(Number(res.result)).toBeGreaterThanOrEqual(6);
    expect(Number(res.result)).toBeLessThanOrEqual(25);
    expect(onSystemMessage).toHaveBeenCalledTimes(1);
    expect(onSystemMessage.mock.calls[0][0]).toContain("Rolled 1d20+5");
  });

  it("executes /roll with invalid dice and returns error message", () => {
    const onSystemMessage = vi.fn();
    const res = executeSlashCommand({ name: "roll", args: "invalid" }, { onSystemMessage });

    expect(res.handled).toBe(true);
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(onSystemMessage).toHaveBeenCalledTimes(1);
  });

  it("executes /sendas command", () => {
    const onSendAs = vi.fn();
    const res = executeSlashCommand(
      { name: "sendas", args: '"Old Wizard" Beware the shadows.' },
      { onSendAs }
    );

    expect(res.handled).toBe(true);
    expect(res.success).toBe(true);
    expect(onSendAs).toHaveBeenCalledWith("Old Wizard", "Beware the shadows.");
  });

  it("executes /note command to update Author's Note", () => {
    const onUpdateNote = vi.fn();
    const onSystemMessage = vi.fn();
    const res = executeSlashCommand(
      { name: "note", args: "Speak in riddles and metaphors." },
      { onUpdateNote, onSystemMessage }
    );

    expect(res.handled).toBe(true);
    expect(onUpdateNote).toHaveBeenCalledWith("Speak in riddles and metaphors.");
    expect(onSystemMessage).toHaveBeenCalledTimes(1);
  });

  it("executes /setvar and /getvar commands", () => {
    const vars = {};
    const onSetVar = vi.fn((k, v) => {
      vars[k] = v;
    });
    const onSystemMessage = vi.fn();

    // Set variable
    const setRes = executeSlashCommand(
      { name: "setvar", args: "affinity 85" },
      { vars, onSetVar, onSystemMessage }
    );
    expect(setRes.handled).toBe(true);
    expect(setRes.success).toBe(true);
    expect(onSetVar).toHaveBeenCalledWith("affinity", "85");
    expect(vars.affinity).toBe("85");

    // Get variable
    const getRes = executeSlashCommand(
      { name: "getvar", args: "affinity" },
      { vars, onSystemMessage }
    );
    expect(getRes.handled).toBe(true);
    expect(getRes.value).toBe("85");

    // Get unset variable
    const getUnset = executeSlashCommand(
      { name: "getvar", args: "nonexistent" },
      { vars, onSystemMessage }
    );
    expect(getUnset.value).toBeUndefined();
  });

  it("executes /think command to toggle model thinking", () => {
    const onToggleThinking = vi.fn();
    const onSystemMessage = vi.fn();

    executeSlashCommand({ name: "think", args: "on" }, { onToggleThinking, onSystemMessage });
    expect(onToggleThinking).toHaveBeenCalledWith(true);

    executeSlashCommand({ name: "think", args: "off" }, { onToggleThinking, onSystemMessage });
    expect(onToggleThinking).toHaveBeenCalledWith(false);

    executeSlashCommand({ name: "think", args: "" }, { thinking: false, onToggleThinking, onSystemMessage });
    expect(onToggleThinking).toHaveBeenCalledWith(true);
  });

  it("executes /branch and /clear commands", () => {
    const onBranch = vi.fn();
    const onClear = vi.fn();
    const onSystemMessage = vi.fn();

    executeSlashCommand({ name: "branch", args: "Checkpoint A" }, { onBranch, onSystemMessage });
    expect(onBranch).toHaveBeenCalledWith("Checkpoint A");

    executeSlashCommand({ name: "clear", args: "" }, { onClear });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("executes /impersonate and /continue commands", () => {
    const onImpersonate = vi.fn();
    const onContinue = vi.fn();

    executeSlashCommand({ name: "impersonate", args: "hesitate before answering" }, { onImpersonate });
    expect(onImpersonate).toHaveBeenCalledWith("hesitate before answering");

    executeSlashCommand({ name: "continue", args: "" }, { onContinue });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================
   3. Vector Memory & Semantic Search (RAG) Tests
   ============================================================ */
describe("Vector Memory & Semantic Search (rag.js)", () => {
  it("tokenizes and stems text while filtering stopwords", () => {
    expect(stem("castles")).toBe("castle");
    expect(stem("swords")).toBe("sword");
    expect(stem("running")).toBe("run");
    expect(stem("quickly")).toBe("quick");

    const tokens = tokenize("The ancient castles and shining swords were guarded by dragons!");
    expect(tokens).toContain("ancient");
    expect(tokens).toContain("castle");
    expect(tokens).toContain("sword");
    expect(tokens).toContain("dragon");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("and");
  });

  it("indexes messages and searches relevant context based on TF-IDF cosine similarity", () => {
    const messages = [
      { id: "m1", role: "assistant", content: "We explored the ancient underground crypt beneath the cemetery." },
      { id: "m2", role: "user", content: "I bought three apples and some bread from the village baker." },
      { id: "m3", role: "assistant", content: "The wizard spoke of an enchanted silver blade hidden in the mountain caves." },
      { id: "m4", role: "user", content: "What was the weather like this morning?" },
      { id: "m5", role: "assistant", content: "The heavy iron door of the crypt was locked with a rusted padlock." },
    ];

    const hits = searchRelevantContext("Tell me about the crypt and underground cemetery", messages, {
      topK: 2,
      threshold: 0.15,
    });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((m) => m.id === "m1" || m.id === "m5")).toBe(true);
    expect(hits.some((m) => m.id === "m2")).toBe(false);
  });

  it("matches words, not meanings: no built-in synonym lists", () => {
    const messages = [
      { id: "m1", role: "assistant", content: "The knight forged a magnificent weapon in the castle armory." },
      { id: "m2", role: "user", content: "Let's sit down and drink some tea." },
    ];
    expect(searchRelevantContext("Where is my sword or sharp blade?", messages, { topK: 1, threshold: 0.1 })).toEqual([]);
    expect(searchRelevantContext("Show me the weapon", messages, { topK: 1, threshold: 0.1 })[0].id).toBe("m1");
  });
});

/* ============================================================
   4. Prompt Assembly Integration with Recalled Context
   ============================================================ */
describe("Prompt Assembly RAG Integration", () => {
  const mira = { id: "c1", name: "Mira", description: "A thief." };
  const settings = { ...emptyData.settings, apiKey: "k" };

  it("appends explicit recalledContext into prompt as [Recalled Context: ...]", () => {
    const history = [
      { id: "m1", role: "user", content: "Do you remember the secret key?" },
    ];

    const recalled = "Mira earlier slipped the copper key into her left boot.";
    const msgs = buildApiMessages({
      character: mira,
      username: "Player",
      history,
      settings,
      recalledContext: recalled,
    });

    const recalledMsg = msgs.find((m) => m.content.includes("Recalled Context"));
    expect(recalledMsg).toBeDefined();
    expect(recalledMsg.content).toContain("[Recalled Context:\nMira earlier slipped the copper key into her left boot.]");
  });

  /* a long chat on a small allowance, so the oldest messages are no longer resent */
  const longChat = () => [
    { id: "m1", role: "assistant", content: "I hid the royal emerald inside the hollow gargoyle statue." },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, role: i % 2 ? "assistant" : "user", content: `We walk on through the busy market street, step ${i}.` })),
    { id: "q", role: "user", content: "Wait, where did you leave the hidden emerald again?" },
  ];

  it("recalls a matching message that has left the resent window when Recall is on", () => {
    const msgs = buildApiMessages({
      character: mira,
      username: "Player",
      history: longChat(),
      settings: { ...settings, ragOn: true, historyTokens: 100 },
    });
    expect(msgs.some((m) => m.content.includes("hollow gargoyle statue") && !m.content.includes("Recalled Context"))).toBe(false);
    const recalledMsg = msgs.find((m) => m.content.includes("Recalled Context"));
    expect(recalledMsg).toBeDefined();
    expect(recalledMsg.content).toContain("gargoyle");
  });

  it("recalls nothing that is still being resent, or with Recall off", () => {
    const short = [
      { id: "m1", role: "assistant", content: "I hid the royal emerald inside the hollow gargoyle statue." },
      { id: "q", role: "user", content: "Wait, where did you leave the hidden emerald again?" },
    ];
    const on = buildApiMessages({ character: mira, username: "Player", history: short, settings: { ...settings, ragOn: true } });
    expect(on.some((m) => m.content.includes("Recalled Context"))).toBe(false);
    const off = buildApiMessages({ character: mira, username: "Player", history: longChat(), settings: { ...settings, historyTokens: 100 } });
    expect(off.some((m) => m.content.includes("Recalled Context"))).toBe(false);
  });
});

/* ============================================================
   5. Interactive UI in ChatPage: Autocomplete & Command Execution
   ============================================================ */
describe("ChatPage Slash Commands UI Integration", () => {
  const mira = { id: "c1", name: "Mira", description: "A thief." };
  const initialChat = {
    id: "chat-slash-test",
    kind: "character",
    characterId: "c1",
    personaId: "",
    messages: [
      { id: "m1", role: "assistant", content: "Greetings! Ready for adventure?", at: Date.now() },
    ],
    authorsNote: {
      text: "Initial note",
      depth: 3,
      interval: 1,
      role: "system",
    },
    vars: { testVar: "initial" },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("shows slash command autocomplete popup when typing '/'", async () => {
    let currentData = {
      ...emptyData,
      characters: [mira],
      chats: [initialChat],
    };

    function TestApp() {
      const [data, setData] = useState(currentData);
      return (
        <ChatPage
          data={data}
          chatId="chat-slash-test"
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

    await mount(<TestApp />);
    await flush();

    const textarea = host.querySelector("textarea");
    expect(textarea).not.toBeNull();

    // Type "/" to trigger autocomplete
    await type(textarea, "/");

    // The autocomplete popup should appear
    const popup = host.querySelector('[role="listbox"]');
    expect(popup).not.toBeNull();
    expect(popup.textContent).toContain("/roll");
    expect(popup.textContent).toContain("/help");

    // Narrow down to "/ro"
    await type(textarea, "/ro");
    expect(popup.textContent).toContain("/roll");
    expect(popup.textContent).not.toContain("/think");
  });

  it("intercepts sending slash commands and executes them locally without calling API", async () => {
    let currentData = {
      ...emptyData,
      characters: [mira],
      chats: [initialChat],
    };

    function TestApp() {
      const [data, setData] = useState(currentData);
      return (
        <ChatPage
          data={data}
          chatId="chat-slash-test"
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

    await mount(<TestApp />);
    await flush();

    const textarea = host.querySelector("textarea");

    // Type and send /roll 1d20+5
    await type(textarea, "/roll 1d20+5");

    // Press enter on textarea to send
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();

    // Verify system bubble with roll result was added
    expect(host.textContent).toContain("Rolled 1d20+5");

    // Now test /note command via input
    await type(textarea, "/note Speak quietly.");
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();

    // Author's note updated
    expect(currentData.chats[0].authorsNote.text).toBe("Speak quietly.");
    expect(host.textContent).toContain("Author's Note updated");
  });
});
