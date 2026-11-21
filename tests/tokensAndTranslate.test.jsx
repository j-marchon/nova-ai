// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  breakdownTokens,
  calculateCardTokens,
  estimateTokens,
  formatTokens,
  formatTokenUsage,
} from "../src/lib/tokens.js";
import {
  clearTranslationCache,
  getLanguageName,
  getTranslationCache,
  SUPPORTED_LANGUAGES,
  translateText,
} from "../src/lib/translate.js";
import { emptyData } from "../src/lib/data.js";
import { ChatPage } from "../src/pages/ChatPage.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host;

beforeEach(() => {
  clearTranslationCache();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearTranslationCache();
  vi.restoreAllMocks();
});

const mount = async (el) => {
  await act(async () => root.render(el));
};

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

describe("Token Estimator (estimateTokens)", () => {
  it("returns 0 for empty or falsy inputs", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it("accurately estimates basic English prose", () => {
    const text = "Hello world! This is a simple test sentence.";
    const count = estimateTokens(text);
    expect(count).toBeGreaterThan(5);
    expect(count).toBeLessThan(15);
  });

  it("handles punctuation, quotes, and contractions properly", () => {
    const text = '"Don\'t worry," she whispered. "It\'s all right!"';
    const count = estimateTokens(text);
    expect(count).toBeGreaterThan(8);
  });

  it("handles CJK characters and multilingual text", () => {
    const zh = "你好，世界！";
    const zhTokens = estimateTokens(zh);
    expect(zhTokens).toBeGreaterThanOrEqual(4);

    const ja = "こんにちは世界";
    const jaTokens = estimateTokens(ja);
    expect(jaTokens).toBeGreaterThanOrEqual(4);
  });
});

describe("Token Formatter helpers", () => {
  it("formats token counts into readable strings", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1400)).toBe("1.4k");
    expect(formatTokens(8000)).toBe("8.0k");
    expect(formatTokens(32000)).toBe("32.0k");
    expect(formatTokens(1500000)).toBe("1.5M");
  });

  it("formats token usage with percentage and capacity", () => {
    expect(formatTokenUsage(1400, 8000)).toBe("1.4k / 8.0k (18%)");
    expect(formatTokenUsage(2400, 32000)).toBe("2.4k / 32.0k (8%)");
    expect(formatTokenUsage(0, 8000)).toBe("0 / 8.0k (0%)");
  });
});

describe("Token Breakdown (breakdownTokens)", () => {
  it("counts expanded universe macros and extra character fields without mutating chat variables", () => {
    const vars = { place: "a very distant and beautiful harbor" };
    const universe = { name: "Vale", story: "{{setvar::who::Ana}}{{getvar::who}} visits {{getvar::place}}.", rules: "{{user}} obeys {{char}}.", locations: [{ name: "{{user}}'s dock", description: "{{getvar::place}}" }], characters: [{ name: "Elder", description: "{{char}} greets {{user}}.", personality: "{{char}} is kind.", secret: "{{getvar::who}} knows {{getvar::place}}." }] };
    const expanded = { name: "Vale", story: "Ana visits a very distant and beautiful harbor.", rules: "Ana obeys Vale.", locations: [{ name: "Ana's dock", description: "a very distant and beautiful harbor" }], characters: [{ name: "Elder", description: "Elder greets Ana.", personality: "Elder is kind.", secret: "Ana knows a very distant and beautiful harbor." }] };
    const args = { universe, username: "Ana", vars };
    expect(calculateCardTokens(args)).toBe(calculateCardTokens({ universe: expanded, username: "Ana" }));
    expect(breakdownTokens(args).cardTokens).toBe(calculateCardTokens(args));
    expect(vars).toEqual({ place: "a very distant and beautiful harbor" });
  });
  const sampleCharacter = {
    name: "Aria",
    description: "A mysterious moon mage wandering the celestial dunes.",
    personality: "Calm, observant, poetic.",
    scenario: "Encountering the traveler under the starlight.",
    exampleDialogs: "<START>\n{{char}}: Look at the stars above.",
    systemPrompt: "Speak in poetic metaphors.",
    postHistoryInstructions: "Always maintain an aura of mystery.",
  };

  const sampleHistory = [
    { id: "m1", role: "assistant", content: "The desert wind carries whispers of ancient stars." },
    { id: "m2", role: "user", content: "Who are you to speak for the stars?" },
    { id: "m3", role: "assistant", content: "I am Aria, a guardian of celestial forgotten lore." },
  ];

  it("calculates token breakdown with character card and history", () => {
    const result = breakdownTokens({
      character: sampleCharacter,
      persona: { name: "Traveler", description: "A curious adventurer." },
      history: sampleHistory,
      maxTokens: 8000,
    });

    expect(result.systemTokens).toBeGreaterThan(0);
    expect(result.cardTokens).toBeGreaterThan(0);
    expect(result.historyTokens).toBeGreaterThan(0);
    expect(result.loreTokens).toBe(0);
    expect(result.noteTokens).toBe(0);
    expect(result.memoryTokens).toBe(0);

    expect(result.totalTokens).toBeGreaterThan(result.historyTokens);
    expect(result.remainingTokens).toBe(8000 - result.totalTokens);
    expect(result.percentUsed).toBe(Math.round((result.totalTokens / 8000) * 100));
  });

  it("calculates loreTokens for active lorebook entries", () => {
    const lorebooks = [
      {
        id: "lb1",
        entries: [
          {
            id: "e1",
            keys: ["celestial"],
            content: "Celestial dunes are composed of glowing stardust fallen from comets.",
            constant: false,
          },
          {
            id: "e2",
            keys: ["magic"],
            content: "Magic here resonates with lunar phases.",
            constant: true,
          },
        ],
      },
    ];

    const result = breakdownTokens({
      character: sampleCharacter,
      lorebooks,
      history: sampleHistory,
      maxTokens: 8000,
    });

    expect(result.loreTokens).toBeGreaterThan(0);
  });

  it("calculates noteTokens for active Author's Note", () => {
    const resultActive = breakdownTokens({
      character: sampleCharacter,
      authorsNote: { text: "Focus on tension and cosmic mystery.", interval: 1, depth: 3 },
      history: sampleHistory,
      maxTokens: 8000,
    });

    expect(resultActive.noteTokens).toBeGreaterThan(0);

    const resultInactive = breakdownTokens({
      character: sampleCharacter,
      authorsNote: { text: "Focus on tension and cosmic mystery.", interval: 2, depth: 3 },
      history: sampleHistory, // length 3, 3 % 2 !== 0 -> inactive
      maxTokens: 8000,
    });

    expect(resultInactive.noteTokens).toBe(0);
  });

  it("calculates memoryTokens for summary and scene tracker", () => {
    const result = breakdownTokens({
      character: sampleCharacter,
      memory: { summary: "Earlier they crossed the sea of glass together." },
      scene: { text: "Location: Oasis of Echoes. Present: Aria, Traveler." },
      history: sampleHistory,
      maxTokens: 8000,
    });

    expect(result.memoryTokens).toBeGreaterThan(0);
  });

  it("supports universe mode with story, locations, and characters", () => {
    const universe = {
      name: "Solaris Prime",
      story: "A vast orbital megacity orbiting a blue supergiant.",
      rules: "Oxygen is traded like currency.",
      locations: [{ name: "Upper Spire", description: "Home of oligarchs" }],
      characters: [{ name: "Vex", description: "A rogue technician" }],
    };

    const result = breakdownTokens({
      universe,
      history: sampleHistory,
      maxTokens: 16000,
    });

    expect(result.systemTokens).toBeGreaterThan(0);
    expect(result.cardTokens).toBeGreaterThan(0);
    expect(result.remainingTokens).toBe(16000 - result.totalTokens);
  });
});

describe("Auto-Translation Layer (translateText)", () => {
  it("translates text using mock Google Translate API response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        [["Hello friend, welcome to the grove.", "Hola amigo, bienvenido a la arboleda."]],
        null,
        "es",
      ],
    });

    const res = await translateText("Hola amigo, bienvenido a la arboleda.", {
      targetLang: "en",
      sourceLang: "auto",
      fetchFn: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(res.text).toBe("Hello friend, welcome to the grove.");
    expect(res.translatedText).toBe("Hello friend, welcome to the grove.");
    expect(res.sourceLang).toBe("es");
    expect(res.targetLang).toBe("en");
  });

  it("caches translations in memory to prevent re-fetching", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [[["Bonjour monde", "Hello world"]], null, "en"],
    });

    const text = "Hello world";
    const res1 = await translateText(text, { targetLang: "fr", fetchFn: mockFetch });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(res1.translatedText).toBe("Bonjour monde");

    // Second call with same text and targetLang
    const res2 = await translateText(text, { targetLang: "fr", fetchFn: mockFetch });
    expect(mockFetch).toHaveBeenCalledTimes(1); // Fetch NOT called again
    expect(res2.translatedText).toBe("Bonjour monde");

    // Verify cache has entry
    expect(getTranslationCache().size).toBeGreaterThan(0);
  });

  it("handles empty or whitespace text without network request", async () => {
    const mockFetch = vi.fn();
    const resEmpty = await translateText("", { targetLang: "es", fetchFn: mockFetch });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(resEmpty.translatedText).toBe("");

    const resWhitespace = await translateText("   ", { targetLang: "es", fetchFn: mockFetch });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(resWhitespace.translatedText).toBe("   ");
  });

  it("returns original text immediately when source and target languages match", async () => {
    const mockFetch = vi.fn();
    const res = await translateText("Good morning!", {
      sourceLang: "en",
      targetLang: "en",
      fetchFn: mockFetch,
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.translatedText).toBe("Good morning!");
  });

  it("falls back to LibreTranslate when Google Translate endpoint fails", async () => {
    const mockFetch = vi.fn().mockImplementation((url) => {
      if (typeof url === "string" && url.includes("translate.googleapis.com")) {
        return Promise.resolve({ ok: false, status: 503 });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          translatedText: "Guten Tag!",
          detectedLanguage: { language: "en" },
        }),
      });
    });

    const res = await translateText("Good day!", {
      targetLang: "de",
      sourceLang: "auto",
      fetchFn: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(res.translatedText).toBe("Guten Tag!");
  });

  it("exports supported languages and language name helper", () => {
    expect(Array.isArray(SUPPORTED_LANGUAGES)).toBe(true);
    expect(getLanguageName("es")).toBe("Spanish");
    expect(getLanguageName("fr")).toBe("French");
    expect(getLanguageName("en")).toBe("English");
  });
});

describe("UI Integration: Token Pill and Breakdown Sheet in ChatPage", () => {
  const mira = {
    id: "c-mira",
    name: "Mira",
    description: "A cunning rogue with dark braided hair.",
    personality: "Sharp-tongued, observant.",
  };

  const initialChat = {
    id: "chat-test",
    characterId: "c-mira",
    messages: [
      { id: "m1", role: "assistant", content: "Watch your step in these shadows." },
      { id: "m2", role: "user", content: "I know my way around the dark." },
    ],
    updatedAt: Date.now(),
  };

  it("opens the token breakdown from the chat's ⋮ menu", async () => {
    const data = {
      ...emptyData,
      characters: [mira],
      chats: [initialChat],
      settings: { ...emptyData.settings, historyTokens: 8000 },
    };

    await mount(
      <ChatPage
        data={data}
        chatId="chat-test"
        update={() => {}}
        goBack={() => {}}
        goSettings={() => {}}
      />
    );
    await flush();

    await act(async () => host.querySelector("button[aria-label='Chat settings']").click());
    await flush();
    const row = [...host.querySelectorAll("button")].find((b) => b.textContent === "Tokens");
    expect(row).toBeDefined();
    await act(async () => row.click());
    await flush();

    expect(host.textContent).toContain("Each request, about");
    expect(host.textContent).toContain("Instructions");
    expect(host.textContent).toContain("Card");
    expect(host.textContent).toContain("Conversation");
    expect(host.textContent).toContain("of its 8.0k allowance");
    expect(host.querySelector("div[aria-label='Token usage by part']")).not.toBeNull();
  });

  it("provides Tokens tab in Chat settings modal", async () => {
    const data = {
      ...emptyData,
      characters: [mira],
      chats: [initialChat],
      settings: { ...emptyData.settings, historyTokens: 8000 },
    };

    await mount(
      <ChatPage
        data={data}
        chatId="chat-test"
        update={() => {}}
        goBack={() => {}}
        goSettings={() => {}}
      />
    );
    await flush();

    // Open chat settings via cog
    const cogBtn = host.querySelector("button[aria-label='Chat settings']");
    expect(cogBtn).not.toBeNull();

    await act(async () => {
      cogBtn.click();
    });
    await flush();

    // Find the Tokens tab in Segmented
    const tokensTab = [...host.querySelectorAll("button[aria-pressed]")].find((r) =>
      r.textContent.includes("Tokens")
    );
    expect(tokensTab).toBeDefined();

    await act(async () => {
      tokensTab.click();
    });
    await flush();

    expect(host.textContent).toContain("Each request, about");
    expect(host.textContent).toContain("Instructions");
  });
});

describe("UI Integration: Per-message translation in ChatPage", () => {
  const mira = {
    id: "c-mira",
    name: "Mira",
    description: "A rogue.",
  };

  const initialChat = {
    id: "chat-test",
    characterId: "c-mira",
    messages: [
      { id: "m1", role: "assistant", content: "Hola amigo, ¿cómo estás hoy?" },
    ],
    updatedAt: Date.now(),
  };

  it("adds Translate action in message options menu", async () => {
    const data = {
      ...emptyData,
      characters: [mira],
      chats: [initialChat],
    };

    await mount(
      <ChatPage
        data={data}
        chatId="chat-test"
        update={() => {}}
        goBack={() => {}}
        goSettings={() => {}}
      />
    );
    await flush();

    // Open message options menu
    const menuBtn = host.querySelector(".nv-msg");
    expect(menuBtn).not.toBeNull();

    await act(async () => {
      menuBtn.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    await flush();

    // Check Translate option exists in menu
    const translateOption = [...host.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Translate")
    );
    expect(translateOption).toBeDefined();
  });

  it("toggles translation and displays translated text with indicator tag", async () => {
    // Mock global fetch for translation
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        [["Hello friend, how are you today?", "Hola amigo, ¿cómo estás hoy?"]],
        null,
        "es",
      ],
    });

    try {
      const data = {
        ...emptyData,
        characters: [mira],
        chats: [initialChat],
      };

      await mount(
        <ChatPage
          data={data}
          chatId="chat-test"
          update={() => {}}
          goBack={() => {}}
          goSettings={() => {}}
        />
      );
      await flush();

      // Translate, from the message's menu
      await act(async () => host.querySelector(".nv-msg").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
      await flush();
      const translateBtn = [...host.querySelectorAll("button")].find((b) => b.textContent === "Translate");
      expect(translateBtn).toBeDefined();

      await act(async () => {
        translateBtn.click();
      });
      await flush();

      // Check translation indicator and translated text are displayed
      expect(host.textContent).toContain("[Translated: es → en]");
      expect(host.textContent).toContain("Hello friend, how are you today?");

      // Toggle off translation
      const hideBtn = host.querySelector("button[aria-label='Hide translation']");
      expect(hideBtn).not.toBeNull();

      await act(async () => {
        hideBtn.click();
      });
      await flush();

      expect(host.textContent).not.toContain("[Translated: es → en]");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

 it("estimates the assembled custom prompt without mutating chat variables", async () => {
   const { buildApiMessages } = await import("../src/lib/prompt.js");
   const { MSG_OVERHEAD } = await import("../src/lib/window.js");
   const options = { character: { name: "Mira" }, history: [], settings: { ...emptyData.settings, stylePreset: "custom", customStyleId: "x", customStyles: [{ id: "x", text: "A custom instruction." }] }, vars: { count: "1" } };
   const messages = buildApiMessages(options);
   expect(breakdownTokens(options).totalTokens).toBe(messages.reduce((n, m) => n + estimateTokens(m.content) + MSG_OVERHEAD, 0));
   expect(options.vars).toEqual({ count: "1" });
 });
