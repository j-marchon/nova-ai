// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import { emptyData, normalizeData } from "../src/lib/data.js";
import {
  supportsVision,
  formatOpenAIMessages,
  toAnthropicMessages,
  streamChat,
} from "../src/lib/api.js";
import { clearActivity, startActivity } from "../src/lib/activity.js";
import { buildApiMessages } from "../src/lib/prompt.js";
import { toGoogleCodeAssistPayload } from "../src/lib/subBridge.js";
import { ChatPage, MessageImages } from "../src/pages/ChatPage.jsx";
import { resetStorageForTests } from "../src/lib/storage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

Object.assign(HTMLMediaElement.prototype, { play: () => Promise.resolve(), pause() {}, load() {} });

const SAMPLE_BASE64_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SAMPLE_BASE64_JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const REMOTE_URL = "https://example.com/scenery.jpg";

let root, host, requests, replyNo;

function fakeFetch(url, init = {}) {
  const body = init.body ? JSON.parse(init.body) : {};
  requests.push(body);
  replyNo += 1;
  const text = `Reply ${replyNo}.`;
  if (body.stream === false) {
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: `Note ${replyNo}` } }], usage: {} }), { status: 200 }));
  }
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const stream = new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(new TextEncoder().encode(f));
      c.close();
    },
  });
  return Promise.resolve(new Response(stream, { status: 200 }));
}

const flush = async () => {
  for (let i = 0; i < 12; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  requests = [];
  replyNo = 0;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  clearActivity();
  vi.unstubAllGlobals();
});

const mount = async (el) => {
  await act(async () => root.render(el));
  await flush();
};

const click = async (el) => {
  expect(el, "element to click").toBeTruthy();
  await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await flush();
};

const type = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
};

function Harness({ initial, render }) {
  const [data, setData] = useState(initial);
  return render({
    data,
    update: (patchOrFn) => setData((prev) => (typeof patchOrFn === "function" ? patchOrFn(prev) : { ...prev, ...patchOrFn })),
  });
}

describe("Data Model & Normalization (m.images)", () => {
  it("normalizes and preserves messages with images in chat", () => {
    const rawData = {
      ...emptyData,
      chats: [
        {
          id: "c1",
          messages: [
            {
              id: "m1",
              role: "user",
              content: "Look at this blueprint",
              images: [
                { id: "img-1", url: SAMPLE_BASE64_PNG, name: "blueprint.png", mimeType: "image/png" },
                SAMPLE_BASE64_JPEG,
              ],
            },
            {
              id: "m2",
              role: "assistant",
              content: "I see the details.",
            },
          ],
        },
      ],
    };

    const normalized = normalizeData(rawData);
    const msg = normalized.chats[0].messages[0];
    expect(msg.images).toBeDefined();
    expect(msg.images.length).toBe(2);
    expect(msg.images[0].name).toBe("blueprint.png");
    expect(msg.images[0].url).toBe(SAMPLE_BASE64_PNG);
    expect(msg.images[1]).toBe(SAMPLE_BASE64_JPEG);
  });
});

describe("Vision model support detection (supportsVision)", () => {
  it("recognizes vision-capable models", () => {
    expect(supportsVision("openai/gpt-4o")).toBe(true);
    expect(supportsVision("gpt-4-turbo")).toBe(true);
    expect(supportsVision("anthropic/claude-3-5-sonnet-20241022")).toBe(true);
    expect(supportsVision("claude-3-opus")).toBe(true);
    expect(supportsVision("google/gemini-1.5-pro")).toBe(true);
    expect(supportsVision("gemini-2.0-flash-exp")).toBe(true);
    expect(supportsVision("qwen/qwen-2.5-vl-72b-instruct")).toBe(true);
    expect(supportsVision("mistralai/pixtral-12b")).toBe(true);
  });

  it("identifies non-vision models", () => {
    expect(supportsVision("nvidia/nemotron-3-super-120b-a12b:free")).toBe(false);
    expect(supportsVision("meta-llama/llama-3-8b-instruct")).toBe(false);
    expect(supportsVision("mistralai/mistral-7b-instruct")).toBe(false);
    expect(supportsVision("deepseek/deepseek-chat")).toBe(false);
  });
});

describe("OpenAI / OpenRouter Multimodal Payloads", () => {
  it("keeps the activity handle out of a request with image content", async () => {
    const settings = structuredClone(emptyData.settings);
    settings.providers[0].key = "test-key";
    settings.providers[0].model = "gpt-4o";
    await streamChat({ settings, messages: [{ role: "user", content: "Describe this", images: [{ url: SAMPLE_BASE64_PNG }] }], activity: startActivity({ kind: "Vision reply" }) });
    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("activity");
    expect(requests[0].messages[0].content).toContainEqual({ type: "image_url", image_url: { url: SAMPLE_BASE64_PNG } });
  });

  it("formats message content as array with text and image_url parts when vision is supported", () => {
    const messages = [
      {
        role: "user",
        content: "What is depicted here?",
        images: [
          { id: "1", url: SAMPLE_BASE64_PNG, name: "test.png", mimeType: "image/png" },
          REMOTE_URL,
        ],
      },
      {
        role: "assistant",
        content: "A single pixel.",
      },
    ];

    const formatted = formatOpenAIMessages(messages, "gpt-4o");
    expect(Array.isArray(formatted[0].content)).toBe(true);
    expect(formatted[0].content[0]).toEqual({ type: "text", text: "What is depicted here?" });
    expect(formatted[0].content[1]).toEqual({ type: "image_url", image_url: { url: SAMPLE_BASE64_PNG } });
    expect(formatted[0].content[2]).toEqual({ type: "image_url", image_url: { url: REMOTE_URL } });

    // Assistant message without images remains plain text string
    expect(formatted[1].content).toBe("A single pixel.");
  });

  it("falls back to clean text [Attached image: name] for non-vision models", () => {
    const messages = [
      {
        role: "user",
        content: "Inspect this drawing",
        images: [
          { id: "1", url: SAMPLE_BASE64_PNG, name: "map.png", mimeType: "image/png" },
          { id: "2", url: SAMPLE_BASE64_JPEG, name: "seal.jpg", mimeType: "image/jpeg" },
        ],
      },
    ];

    const formatted = formatOpenAIMessages(messages, "nvidia/nemotron-3-super-120b-a12b:free");
    expect(typeof formatted[0].content).toBe("string");
    expect(formatted[0].content).toContain("Inspect this drawing");
    expect(formatted[0].content).toContain("[Attached image: map.png]");
    expect(formatted[0].content).toContain("[Attached image: seal.jpg]");
  });
});

describe("Anthropic Multimodal Payloads", () => {
  it("formats base64 images into Anthropic image source blocks and remote URLs as fallback text", () => {
    const messages = [
      {
        role: "user",
        content: "Can you analyze this artifact?",
        images: [
          { id: "1", url: SAMPLE_BASE64_PNG, name: "artifact.png", mimeType: "image/png" },
          REMOTE_URL,
        ],
      },
    ];

    const formatted = toAnthropicMessages(messages, "claude-3-5-sonnet-20241022").messages;
    expect(Array.isArray(formatted[0].content)).toBe(true);
    expect(formatted[0].content[0]).toEqual({ type: "text", text: "Can you analyze this artifact?" });
    expect(formatted[0].content[1].type).toBe("image");
    expect(formatted[0].content[1].source.type).toBe("base64");
    expect(formatted[0].content[1].source.media_type).toBe("image/png");
    expect(formatted[0].content[1].source.data).toBe(SAMPLE_BASE64_PNG.split(",")[1]);
    expect(formatted[0].content[2]).toEqual({ type: "text", text: "[Image attached]" });
  });

  it("handles toAnthropicMessages conversation structuring and turn merging with image blocks", () => {
    const messages = [
      { role: "system", content: "You are an archaeologist." },
      {
        role: "user",
        content: "First image",
        images: [{ url: SAMPLE_BASE64_PNG }],
      },
      {
        role: "user",
        content: "Second note",
      },
    ];

    const conv = toAnthropicMessages(messages, "claude-3-5-sonnet");
    expect(conv.system).toBe("You are an archaeologist.");
    // Consecutive user turns are merged into a single user turn with combined content blocks
    expect(conv.messages.length).toBe(1);
    expect(conv.messages[0].role).toBe("user");
    expect(Array.isArray(conv.messages[0].content)).toBe(true);
    expect(conv.messages[0].content.some((b) => b.type === "image")).toBe(true);
  });
});

describe("Google Code Assist (Nova Bridge) Multimodal Payloads", () => {
  it("supports toGoogleCodeAssistPayload in subBridge with inlineData", () => {
    const messages = [
      { role: "system", content: "You are a guide." },
      {
        role: "user",
        content: "Check this map",
        images: [{ url: SAMPLE_BASE64_PNG, name: "map.png" }],
      },
    ];

    const payload = toGoogleCodeAssistPayload(messages, "gemini-2.5-pro");
    const userTurn = payload.request.contents.find((c) => c.role === "user");
    expect(userTurn).toBeDefined();
    expect(userTurn.parts.some((p) => p.inlineData && p.inlineData.mimeType === "image/png")).toBe(true);
  });
});

describe("Prompt compilation (buildApiMessages)", () => {
  it("keeps a message's pictures, which go out as OpenAI content parts", () => {
    const history = [
      {
        id: "m1",
        role: "user",
        content: "Look at this sketch",
        images: [{ id: "i1", url: SAMPLE_BASE64_PNG, name: "sketch.png" }],
      },
    ];
    const character = { id: "c1", name: "Artist", description: "An artist." };
    const settings = { ...emptyData.settings, apiKey: "key", activeProvider: "openrouter" };

    // Default buildApiMessages preserves images property
    const rawMsgs = buildApiMessages({ character, username: "User", history, settings });
    const userMsg = rawMsgs.find((m) => m.images && m.images.length > 0);
    expect(userMsg).toBeDefined();
    expect(userMsg.images[0].name).toBe("sketch.png");

    // streamChat formats them for the wire
    const formattedMsgs = formatOpenAIMessages(rawMsgs, "gpt-4o");
    const formattedUserMsg = formattedMsgs.find((m) => Array.isArray(m.content));
    expect(formattedUserMsg).toBeDefined();
    expect(formattedUserMsg.content[1].type).toBe("image_url");
  });
});

describe("MessageImages component", () => {
  it("renders single image preview with tap-to-preview callback", async () => {
    const onPreview = vi.fn();
    const images = [{ id: "1", url: SAMPLE_BASE64_PNG, name: "flower.png" }];

    await mount(<MessageImages images={images} onPreview={onPreview} />);
    const img = host.querySelector("img");
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe(SAMPLE_BASE64_PNG);
    expect(img.getAttribute("alt")).toBe("flower.png");

    const btn = host.querySelector("button");
    await click(btn);
    expect(onPreview).toHaveBeenCalledWith(SAMPLE_BASE64_PNG);
  });

  it("renders multiple images in a responsive grid", async () => {
    const onPreview = vi.fn();
    const images = [
      { id: "1", url: SAMPLE_BASE64_PNG, name: "pic1.png" },
      { id: "2", url: SAMPLE_BASE64_JPEG, name: "pic2.jpg" },
    ];

    await mount(<MessageImages images={images} onPreview={onPreview} />);
    const imgs = host.querySelectorAll("img");
    expect(imgs.length).toBe(2);

    const buttons = host.querySelectorAll("button");
    await click(buttons[1]);
    expect(onPreview).toHaveBeenCalledWith(SAMPLE_BASE64_JPEG);
  });
});

describe("ChatPage UI: Attach Image, Draft Strip, Sending, and Lightbox", () => {
  const mira = {
    id: "c1",
    name: "Mira",
    description: "A rogue.",
    greetings: [{ id: "g1", label: "", text: "Greetings." }],
    firstMessage: "Greetings.",
  };

  const seedChat = () => {
    const d = JSON.parse(JSON.stringify(emptyData));
    d.username = "Player";
    d.settings.providers[0].key = "test-key";
    d.settings.providers[0].model = "gpt-4o";
    d.characters = [mira];
    d.chats = [
      {
        id: "chat-1",
        kind: "character",
        characterId: "c1",
        messages: [{ id: "m0", role: "assistant", content: "Greetings." }],
      },
    ];
    return d;
  };

  it("offers Attach a picture in the composer's + menu", async () => {
    await mount(
      <Harness
        initial={seedChat()}
        render={({ data, update }) => (
          <ChatPage data={data} chatId="chat-1" update={update} goBack={() => {}} goSettings={() => {}} />
        )}
      />
    );

    await click(host.querySelector('[aria-label="More options"]'));
    const attachRow = [...document.body.querySelectorAll("button")].find((b) => b.textContent.includes("Attach a picture"));
    expect(attachRow).toBeDefined();
    const fileInput = host.querySelector('input[type="file"][accept="image/*"]');
    expect(fileInput).not.toBeNull();
  });

  it("shows draft thumbnail strip when image is selected and allows removing it", async () => {
    await mount(
      <Harness
        initial={seedChat()}
        render={({ data, update }) => (
          <ChatPage data={data} chatId="chat-1" update={update} goBack={() => {}} goSettings={() => {}} />
        )}
      />
    );

    const fileInput = host.querySelector('input[type="file"][accept="image/*"]');

    // Simulate FileReader data url reading
    const file = new File(["dummy"], "portrait.png", { type: "image/png" });
    const originalFileReader = globalThis.FileReader;
    class MockFileReader {
      readAsDataURL() {
        setTimeout(() => {
          this.onload?.({ target: { result: SAMPLE_BASE64_PNG } });
        }, 10);
      }
    }
    globalThis.FileReader = MockFileReader;

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [file],
        writable: true,
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();

    globalThis.FileReader = originalFileReader;

    // Check draft strip is rendered
    const draftStrip = host.querySelector('[data-testid="draft-images-strip"]');
    expect(draftStrip).not.toBeNull();
    expect(draftStrip.querySelectorAll("img").length).toBe(1);

    // Click remove image button
    const removeBtn = draftStrip.querySelector('[aria-label="Remove image"]');
    expect(removeBtn).not.toBeNull();
    await click(removeBtn);

    // Strip should disappear after removing image
    expect(host.querySelector('[data-testid="draft-images-strip"]')).toBeNull();
  });

  it("sends message with attached image, renders in bubble, and opens lightbox on click", async () => {
    await mount(
      <Harness
        initial={seedChat()}
        render={({ data, update }) => (
          <ChatPage data={data} chatId="chat-1" update={update} goBack={() => {}} goSettings={() => {}} />
        )}
      />
    );

    const fileInput = host.querySelector('input[type="file"][accept="image/*"]');
    const file = new File(["dummy"], "artifact.png", { type: "image/png" });
    const originalFileReader = globalThis.FileReader;
    class MockFileReader {
      readAsDataURL() {
        setTimeout(() => {
          this.onload?.({ target: { result: SAMPLE_BASE64_PNG } });
        }, 10);
      }
    }
    globalThis.FileReader = MockFileReader;

    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [file],
        writable: true,
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    globalThis.FileReader = originalFileReader;

    // Type a caption in the composer
    await type(host.querySelector("textarea"), "Check out this finding");

    // Click send
    const sendBtn = host.querySelector('[aria-label="Send"]');
    expect(sendBtn).not.toBeNull();
    await click(sendBtn);

    // Verify reply came in and user message has image
    expect(host.textContent).toContain("Reply 1.");
    expect(host.textContent).toContain("Check out this finding");

    // Message bubble should render the attached image
    const msgImages = host.querySelectorAll(".nv-bubble img");
    expect(msgImages.length).toBeGreaterThan(0);

    // Click the image button inside the user bubble to open lightbox
    const imgBtn = host.querySelector('.nv-bubble button[aria-label="View artifact.png"]') ||
                   host.querySelector('.nv-bubble button[aria-label="View Image"]');
    expect(imgBtn).not.toBeNull();
    await click(imgBtn);

    // Lightbox modal should be visible
    const lightbox = host.querySelector('[data-testid="image-lightbox"]');
    expect(lightbox).not.toBeNull();
    const enlargedImg = lightbox.querySelector("img");
    expect(enlargedImg.getAttribute("src")).toBe(SAMPLE_BASE64_PNG);

    // Close lightbox
    const closeBtn = lightbox.querySelector('[aria-label="Close preview"]');
    expect(closeBtn).not.toBeNull();
    await click(closeBtn);

    // Lightbox should now be closed
    expect(host.querySelector('[data-testid="image-lightbox"]')).toBeNull();
  });
});
