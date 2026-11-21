// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { cleanTextForSpeech, getVoices, isSpeaking, speak, stopSpeech } from "../src/lib/tts.js";
import { DEFAULT_VOICE_SETTINGS, emptyData } from "../src/lib/data.js";
import { VoiceSection } from "../src/components/VoiceSection.jsx";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { SettingsPage } from "../src/pages/SettingsPage.jsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  stopSpeech();
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
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

describe("cleanTextForSpeech text filter", () => {
  it("strips thoughts in <think> tags", () => {
    const input = "<think>I should greet them politely.</think> Hello traveler!";
    const output = cleanTextForSpeech(input);
    expect(output).toBe("Hello traveler!");
  });

  it("strips other reasoning tags like <thought> and <reasoning>", () => {
    const input = "<thought>Calculating reply</thought> Here is the answer.";
    const output = cleanTextForSpeech(input);
    expect(output).toBe("Here is the answer.");
  });

  it("strips unclosed streaming thinking tag at tail", () => {
    const input = "Started text. <think>still thinking unfinished";
    const output = cleanTextForSpeech(input);
    expect(output).toBe("Started text.");
  });

  it("strips hidden HTML comments and notes", () => {
    const input = "<!-- tracker notes: loc=tavern --> Good evening.";
    const output = cleanTextForSpeech(input);
    expect(output).toBe("Good evening.");
  });

  it("strips markdown asterisks in narration mode so TTS does not say 'asterisk'", () => {
    const input = "*sighs softly* I have been waiting for you. *smiles*";
    const output = cleanTextForSpeech(input, { dialogueOnly: false });
    expect(output).toBe("sighs softly I have been waiting for you. smiles");
    expect(output).not.toContain("*");
  });

  it("strips leaked scene trackers", () => {
    const input = "[ Scene Tracker: Castle Gate | Night | Rain ]\nWho goes there?";
    const output = cleanTextForSpeech(input);
    expect(output).toBe("Who goes there?");
  });

  it("extracts text in quotes when dialogueOnly is true", () => {
    const input = '"Hello there," said Mira.';
    const output = cleanTextForSpeech(input, { dialogueOnly: true });
    expect(output).toBe("Hello there");
  });

  it("extracts curly quotes in dialogueOnly mode", () => {
    const input = '“We must hurry,” she whispered.';
    const output = cleanTextForSpeech(input, { dialogueOnly: true });
    expect(output).toBe("We must hurry");
  });

  it("concatenates multiple quotes in dialogueOnly mode", () => {
    const input = '"Wait for me!" he called out. "I am coming too."';
    const output = cleanTextForSpeech(input, { dialogueOnly: true });
    expect(output).toBe("Wait for me! I am coming too.");
  });

  it("falls back to stripping *action* blocks in dialogueOnly mode when no quotes exist", () => {
    const input = "*leans forward* Welcome to the guild, adventurer. *pours tea*";
    const output = cleanTextForSpeech(input, { dialogueOnly: true });
    expect(output).toBe("Welcome to the guild, adventurer.");
  });
});

describe("TTS speech synthesis engine", () => {
  let mockVoices;
  let mockUtteranceInstance;
  let mockSpeakFn;
  let mockCancelFn;

  beforeEach(() => {
    mockVoices = [
      { name: "Nova Voice 1", lang: "en-US", voiceURI: "nova-1" },
      { name: "Nova Voice 2", lang: "en-GB", voiceURI: "nova-2" },
    ];

    class MockSpeechSynthesisUtterance {
      constructor(text) {
        this.text = text;
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.voice = null;
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
        mockUtteranceInstance = this;
      }
    }

    mockSpeakFn = vi.fn((utter) => {
      window.speechSynthesis.speaking = true;
      setTimeout(() => {
        utter.onstart?.();
      }, 0);
    });

    mockCancelFn = vi.fn(() => {
      window.speechSynthesis.speaking = false;
      if (mockUtteranceInstance?.onend) {
        mockUtteranceInstance.onend();
      }
    });

    window.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    window.speechSynthesis = {
      speaking: false,
      paused: false,
      getVoices: vi.fn(() => mockVoices),
      speak: mockSpeakFn,
      cancel: mockCancelFn,
      pause: vi.fn(),
      resume: vi.fn(),
    };
  });

  it("getVoices returns available voices from speechSynthesis", () => {
    const voices = getVoices();
    expect(voices).toHaveLength(2);
    expect(voices[0].name).toBe("Nova Voice 1");
  });

  it("speak sets utterance parameters and starts playback", async () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();

    speak("Hello world", {
      voiceName: "Nova Voice 2",
      rate: 1.2,
      pitch: 1.1,
      volume: 0.9,
      onStart,
      onEnd,
    });

    expect(mockSpeakFn).toHaveBeenCalled();
    expect(mockUtteranceInstance).toBeDefined();
    expect(mockUtteranceInstance.text).toBe("Hello world");
    expect(mockUtteranceInstance.rate).toBe(1.2);
    expect(mockUtteranceInstance.pitch).toBe(1.1);
    expect(mockUtteranceInstance.volume).toBe(0.9);
    expect(mockUtteranceInstance.voice?.name).toBe("Nova Voice 2");

    await flush();
    expect(onStart).toHaveBeenCalled();

    // End speech
    act(() => {
      mockUtteranceInstance.onend?.();
    });
    expect(onEnd).toHaveBeenCalled();
  });

  it("stopSpeech cancels synthesis and resets speaking state", () => {
    speak("Testing stop");
    stopSpeech();
    expect(mockCancelFn).toHaveBeenCalled();
  });
});

describe("VoiceSection component", () => {
  beforeEach(() => {
    window.speechSynthesis = {
      speaking: false,
      getVoices: vi.fn(() => [
        { name: "Voice A", lang: "en-US", voiceURI: "va" },
        { name: "Voice B", lang: "fr-FR", voiceURI: "vb" },
      ]),
      speak: vi.fn(),
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });

  it("renders voice selector, rate slider, pitch slider, and dialogue-only toggle", async () => {
    const onChange = vi.fn();
    const settings = {
      voice: "Voice A",
      rate: 1.0,
      pitch: 1.0,
      dialogueOnly: false,
    };

    await mount(<VoiceSection voiceSettings={settings} onChange={onChange} />);

    expect(host.textContent).toContain("Voice");
    expect(host.textContent).toContain("Speech rate");
    expect(host.textContent).toContain("Speech pitch");
    expect(host.textContent).toContain("Dialogue only");

    // Toggle dialogue only
    const toggleBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Dialogue only")
    );
    expect(toggleBtn).toBeDefined();
    act(() => toggleBtn.click());
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ dialogueOnly: true })
    );

    // Change voice (the first select picks where the voice comes from)
    const select = host.querySelectorAll("select")[1];
    expect(select).toBeDefined();
    act(() => {
      select.value = "Voice B";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ voice: "Voice B" })
    );
  });
});

describe("ChatPage Voice Integration", () => {
  const mira = { id: "c1", name: "Mira", description: "A witty rogue." };
  const initialChat = {
    id: "chat-voice-test",
    kind: "character",
    characterId: "c1",
    personaId: "",
    messages: [
      { id: "m1", role: "assistant", content: '"Careful where you step," warned Mira.', at: Date.now() },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  let mockUtter;
  let mockSpeak;
  let mockCancel;

  beforeEach(() => {
    mockSpeak = vi.fn((utter) => {
      mockUtter = utter;
      window.speechSynthesis.speaking = true;
      setTimeout(() => {
        act(() => utter.onstart?.());
      }, 0);
    });
    mockCancel = vi.fn(() => {
      window.speechSynthesis.speaking = false;
      act(() => mockUtter?.onend?.());
    });

    class MockSpeechSynthesisUtterance {
      constructor(text) {
        this.text = text;
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
      }
    }

    class MockSpeechRec {
      constructor() {
        this.start = vi.fn(() => this.onstart?.());
        this.stop = vi.fn(() => this.onend?.());
      }
    }

    window.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    window.speechSynthesis = {
      speaking: false,
      getVoices: () => [{ name: "Mock Voice", lang: "en-US" }],
      speak: mockSpeak,
      cancel: mockCancel,
    };
    window.SpeechRecognition = MockSpeechRec;
  });

  function TestChatHost() {
    const [data, setData] = useState({
      ...emptyData,
      characters: [mira],
      chats: [initialChat],
      settings: {
        ...emptyData.settings,
        voice: { ...DEFAULT_VOICE_SETTINGS },
      },
    });

    return (
      <ChatPage
        data={data}
        chatId="chat-voice-test"
        update={(patch) => {
          setData((prev) => (typeof patch === "function" ? patch(prev) : { ...prev, ...patch }));
        }}
        goBack={() => {}}
        goSettings={() => {}}
      />
    );
  }

  /* the open message menu's row by its exact label */
  const menuRow = (label) => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent.trim() === label);
  const openMessageMenu = async () => {
    await act(async () => host.querySelector(".nv-msg").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
    await flush();
  };

  it("reads a reply aloud from its menu and stops it from there", async () => {
    await mount(<TestChatHost />);
    await flush();

    await openMessageMenu();
    const read = menuRow("Read aloud");
    expect(read).toBeDefined();
    await act(async () => read.click());
    await flush();

    expect(mockSpeak).toHaveBeenCalled();
    expect(mockUtter.text).toContain("Careful where you step");

    await openMessageMenu();
    const stop = menuRow("Stop reading");
    expect(stop).toBeDefined();
    await act(async () => stop.click());
    await flush();

    expect(mockCancel).toHaveBeenCalled();
  });

  it("offers no Read aloud where nothing can speak", async () => {
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
    await mount(<TestChatHost />);
    await flush();
    await openMessageMenu();
    expect(menuRow("Read aloud")).toBeUndefined();
  });

  it("shows no mic even where the browser supports dictation", async () => {
    await mount(<TestChatHost />);
    await flush();
    expect(host.querySelector("button[aria-label='Dictate']")).toBeNull();
  });

  it("keeps voice settings in Settings → Replies, not in each chat", async () => {
    let data = { ...emptyData, settings: { ...emptyData.settings, voice: { ...DEFAULT_VOICE_SETTINGS } } };
    function SettingsHost() {
      const [d, setD] = useState(data);
      return <SettingsPage data={d} update={(patch) => setD((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }))} />;
    }
    await mount(<SettingsHost />);
    await flush();
    const replies = Array.from(host.querySelectorAll("button")).find((b) => b.textContent.trim() === "Replies");
    await act(async () => replies.click());
    await flush();

    expect(host.textContent).toContain("Read aloud");
    expect(host.textContent).toContain("Speech rate");
    expect(host.textContent).toContain("Dialogue only");
    expect(host.textContent).toContain("Translate into");
  });
});
