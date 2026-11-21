// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  EMOTIONS,
  EMOTION_KEYS,
  detectEmotion,
  hasSprites,
  spriteForCharacter,
} from "../src/lib/sprites.js";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { EmotionSpritesEditor } from "../src/components/forms.jsx";
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

describe("Emotion Sprites Engine (src/lib/sprites.js)", () => {
  it("defines all standard emotion categories", () => {
    expect(EMOTION_KEYS).toEqual([
      "neutral",
      "joy",
      "anger",
      "sadness",
      "surprise",
      "fear",
      "blush",
      "smug",
    ]);
    expect(EMOTIONS).toHaveLength(8);
  });

  describe("detectEmotion", () => {
    it("detects joy from smiles and laughter action cues", () => {
      expect(detectEmotion("*smiles warmly* It is wonderful to meet you.")).toBe("joy");
      expect(detectEmotion("*giggles cheerfully* That was so funny!")).toBe("joy");
      expect(detectEmotion("*beaming with delight*")).toBe("joy");
    });

    it("detects anger from fury, glares, and scowls", () => {
      expect(detectEmotion("*glares with fury* How dare you speak to me like that!")).toBe("anger");
      expect(detectEmotion("*clenches teeth furiously and growls*")).toBe("anger");
      expect(detectEmotion("*scowls angrily*")).toBe("anger");
    });

    it("detects sadness from crying and tears", () => {
      expect(detectEmotion("*tears stream down her face* Why did you leave me?")).toBe("sadness");
      expect(detectEmotion("*sobs softly in despair*")).toBe("sadness");
      expect(detectEmotion("*weeps heartbrokenly*")).toBe("sadness");
    });

    it("detects blush from blushing, shy, and flustered actions", () => {
      expect(detectEmotion("*blushes deeply and stammers* I-it's not like that!")).toBe("blush");
      expect(detectEmotion("*cheeks turned red, looking away shyly*")).toBe("blush");
      expect(detectEmotion("*averts her gaze, flustered*")).toBe("blush");
    });

    it("detects surprise from gasps and shock", () => {
      expect(detectEmotion("*gasps in shock* You can't be serious!")).toBe("surprise");
      expect(detectEmotion("*eyes widened in astonishment*")).toBe("surprise");
      expect(detectEmotion("*stunned in disbelief*")).toBe("surprise");
    });

    it("detects fear from trembling and terror", () => {
      expect(detectEmotion("*trembles in fear and cowers* Please don't hurt me...")).toBe("fear");
      expect(detectEmotion("*shudders in terror, petrified*")).toBe("fear");
      expect(detectEmotion("*shrank back, panicked*")).toBe("fear");
    });

    it("detects smug from smirks, cockiness, and teasing", () => {
      expect(detectEmotion("*smirks playfully* Did you really think you could beat me?")).toBe("smug");
      expect(detectEmotion("*arched an eyebrow smugly with a sly chuckle*")).toBe("smug");
      expect(detectEmotion("*snickers cockily*")).toBe("smug");
    });

    it("prioritizes the concluding asterisk action over earlier text", () => {
      const text = "*She was nervous at first.* Hello. *Then she smirks playfully.*";
      expect(detectEmotion(text)).toBe("smug");
    });

    it("falls back to dialogue heuristics when no asterisks are present", () => {
      expect(detectEmotion("Haha, that is wonderful! So happy!")).toBe("joy");
      expect(detectEmotion("Shut up! I hate you, damn it!")).toBe("anger");
      expect(detectEmotion("What?! No way! Whoa!")).toBe("surprise");
    });

    it("falls back to neutral for ordinary dialogue or empty text", () => {
      expect(detectEmotion("The library is open from 9 AM to 5 PM.")).toBe("neutral");
      expect(detectEmotion("")).toBe("neutral");
      expect(detectEmotion(null)).toBe("neutral");
      expect(detectEmotion(undefined)).toBe("neutral");
    });
  });

  describe("spriteForCharacter", () => {
    const charWithSprites = {
      id: "char-1",
      name: "Seraphina",
      avatar: "data:image/png;base64,defaultAvatar",
      sprites: {
        neutral: "https://example.com/seraphina-neutral.png",
        joy: "https://example.com/seraphina-joy.png",
        anger: "https://example.com/seraphina-anger.png",
        blush: "https://example.com/seraphina-blush.png",
      },
    };

    it("returns specific emotion sprite if available", () => {
      expect(spriteForCharacter(charWithSprites, "joy")).toBe("https://example.com/seraphina-joy.png");
      expect(spriteForCharacter(charWithSprites, "anger")).toBe("https://example.com/seraphina-anger.png");
      expect(spriteForCharacter(charWithSprites, "blush")).toBe("https://example.com/seraphina-blush.png");
    });

    it("falls back to neutral sprite when requested emotion is missing", () => {
      expect(spriteForCharacter(charWithSprites, "fear")).toBe("https://example.com/seraphina-neutral.png");
      expect(spriteForCharacter(charWithSprites, "smug")).toBe("https://example.com/seraphina-neutral.png");
    });

    it("falls back to avatar if neutral sprite is not defined", () => {
      const charNoNeutral = {
        name: "Aria",
        avatar: "https://example.com/aria-avatar.png",
        sprites: { joy: "https://example.com/aria-joy.png" },
      };
      expect(spriteForCharacter(charNoNeutral, "sadness")).toBe("https://example.com/aria-avatar.png");
    });

    it("returns empty string if character is missing or has no sprites or avatar", () => {
      expect(spriteForCharacter(null, "joy")).toBe("");
      expect(spriteForCharacter({}, "joy")).toBe("");
    });

    it("hasSprites correctly identifies characters with custom sprites", () => {
      expect(hasSprites(charWithSprites)).toBe(true);
      expect(hasSprites({ name: "Bob", avatar: "img.png" })).toBe(false);
      expect(hasSprites({ name: "Bob", sprites: {} })).toBe(false);
      expect(hasSprites(null)).toBe(false);
    });
  });
});

describe("Character Card Normalization & EmotionSpritesEditor", () => {
  it("normalizes characters ensuring sprites object exists", () => {
    const normalized = normalizeData({
      characters: [{ id: "c1", name: "Elena" }],
    });
    expect(normalized.characters[0].sprites).toEqual({});
  });

  it("renders EmotionSpritesEditor and updates sprite URLs", async () => {
    const onSpritesChange = vi.fn();
    const initialSprites = {
      neutral: "https://example.com/neutral.png",
    };

    await mount(
      <EmotionSpritesEditor sprites={initialSprites} onChange={onSpritesChange} />
    );

    // Should render input for Joy sprite
    const joyInput = host.querySelector('input[aria-label="Joy sprite URL"]');
    expect(joyInput).not.toBeNull();

    // Type a URL for joy sprite
    await type(joyInput, "https://example.com/joy.png");

    expect(onSpritesChange).toHaveBeenCalledWith({
      neutral: "https://example.com/neutral.png",
      joy: "https://example.com/joy.png",
    });
  });
});
