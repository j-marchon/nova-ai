// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import {
  ASPECT_RATIOS,
  DEFAULT_NEGATIVE_PROMPT,
  IMAGE_PROVIDERS,
  buildSceneVisualPrompt,
  generateImage,
  generateImageAIHorde,
  generateImageComfyUI,
  generateImageOpenAI,
  generateImageSDWebUI,
  resolveDimensions,
} from "../src/lib/imageGen.js";
import { DEFAULT_IMAGE_GEN, emptyData, normalizeData } from "../src/lib/data.js";
import { ImageGenModal } from "../src/components/ImageGenModal.jsx";
import { activity, clearActivity, startActivity } from "../src/lib/activity.js";
import { SLASH_COMMANDS, executeSlashCommand, isSlashCommand, parseSlashCommand } from "../src/lib/slash.js";

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
  clearActivity();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

describe("Image Generation schema & defaults", () => {
  it("defines DEFAULT_IMAGE_GEN with correct defaults", () => {
    expect(DEFAULT_IMAGE_GEN).toEqual({
      provider: "ai_horde",
      apiKey: "",
      endpoint: "",
      model: "",
      aspectRatio: "portrait",
      negativePrompt: "blurry, low quality, distorted, extra limbs, bad anatomy, deformed, watermark, signature",
    });
  });

  it("normalizes settings without imageGen by adding defaults", () => {
    const raw = { settings: {} };
    const normalized = normalizeData(raw);
    expect(normalized.settings.imageGen).toEqual(DEFAULT_IMAGE_GEN);
  });

  it("resolves aspect ratio dimensions properly", () => {
    expect(resolveDimensions("portrait")).toEqual({ width: 512, height: 768, openAiSize: "1024x1792" });
    expect(resolveDimensions("square")).toEqual({ width: 512, height: 512, openAiSize: "1024x1024" });
    expect(resolveDimensions("landscape")).toEqual({ width: 768, height: 432, openAiSize: "1792x1024" });
    // Fallback to portrait
    expect(resolveDimensions("unknown")).toEqual({ width: 512, height: 768, openAiSize: "1024x1792" });
  });
});

describe("buildSceneVisualPrompt", () => {
  it("handles empty or missing parameters gracefully", () => {
    const prompt = buildSceneVisualPrompt();
    expect(prompt).toContain("masterpiece");
    expect(prompt).toContain("atmospheric lighting");
  });

  it("extracts character appearance and structured attributes", () => {
    const character = {
      name: "Seraphina",
      description: "Hair: raven black\nEyes: violet\nClothing: silver gothic gown\nA skilled enchantress.",
    };
    const prompt = buildSceneVisualPrompt({ character });
    expect(prompt).toContain("raven black hair");
    expect(prompt).toContain("violet eyes");
    expect(prompt).toContain("silver gothic gown");
    expect(prompt).toContain("masterpiece");
  });

  it("extracts Appearance(...) style format from description", () => {
    const character = {
      name: "Kaelen",
      description: 'Appearance("tall cybernetic warrior, glowing cyan optics, armored exoskeleton")',
    };
    const prompt = buildSceneVisualPrompt({ character });
    expect(prompt).toContain("tall cybernetic warrior, glowing cyan optics, armored exoskeleton");
  });

  it("extracts scene location, time, weather and character state from tracker", () => {
    const character = { name: "Lyra", description: "A wandering bard." };
    const scene = `[Day 4 | midnight | ancient overgrown shrine | heavy thunderstorm, 14°C]
[Lyra: soaking wet hooded cloak, clutching a wooden lute, shivering]
[User: standing watch with a lantern]`;
    const prompt = buildSceneVisualPrompt({ character, scene });

    expect(prompt).toContain("location: ancient overgrown shrine");
    expect(prompt).toContain("midnight, heavy thunderstorm, 14°C");
    expect(prompt).toContain("soaking wet hooded cloak, clutching a wooden lute, shivering");
  });

  it("extracts universe details and narrative action in asterisks", () => {
    const universe = {
      name: "Aethelgard",
      description: "A dark gothic fantasy realm engulfed in eternal twilight.",
    };
    const messageText = '*She draws her obsidian blade and glares toward the foggy gate.* "We are not alone."';
    const prompt = buildSceneVisualPrompt({ universe, messageText });

    expect(prompt).toContain("world of Aethelgard");
    expect(prompt).toContain("A dark gothic fantasy realm engulfed in eternal twilight");
    expect(prompt).toContain("She draws her obsidian blade and glares toward the foggy gate.");
  });
});

describe("generateImage backends", () => {
  it("registers and finishes a default image job and caps its running progress", async () => {
    const seen = [];
    const unsubscribe = activity.subscribe(() => seen.push(...activity.get().map(({ status, percent }) => ({ status, percent }))));
    const onProgress = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: "image" }] }), { status: 200 })));
    try {
      expect(await generateImage({ provider: "openai", apiKey: "test-key", prompt: "A room", onProgress })).toBe("data:image/png;base64,image");
      expect(seen).toContainEqual({ status: "running", percent: null });
      expect(seen.filter((job) => job.status === "running").every((job) => job.percent === null || job.percent <= 95)).toBe(true);
      expect(activity.get()[0]).toMatchObject({ kind: "Model request", phase: "Generating image", status: "done", percent: 100 });
      expect(onProgress).toHaveBeenCalledWith(1);
    } finally { unsubscribe(); }
  });

  it("uses a supplied image handle without finishing its owner's job", async () => {
    const handle = startActivity({ kind: "Scene art", owner: { chatId: "c1" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ images: ["image"] }), { status: 200 })));
    await generateImage({ provider: "sd_webui", prompt: "A room", activity: handle });
    expect(activity.get()).toHaveLength(1);
    expect(activity.get()[0]).toMatchObject({ status: "running", percent: 95, owner: { chatId: "c1" } });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty("activity");
  });

  it.each(["openai", "sd_webui", "ai_horde", "comfyui"])("passes merged cancellation to the %s submission", async (provider) => {
    const handle = startActivity();
    const caller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const done = generateImage({ provider, prompt: "A room", apiKey: "test-key", activity: handle, signal: caller.signal });
    const rejected = expect(done).rejects.toMatchObject({ name: "AbortError" });
    handle.cancel();
    await rejected;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(caller.signal.aborted).toBe(false);
  });

  it.each([generateImageAIHorde, generateImageComfyUI])("cancels a polling wait in %s before another fetch", async (generate) => {
    const caller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "job", prompt_id: "job" }) })));
    const done = generate({ prompt: "A room", signal: caller.signal, pollInterval: 10000 });
    const rejected = expect(done).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    caller.abort();
    await rejected;
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([true, false])("reports Horde wait-time progress (submission estimate: %s)", async (submissionEstimate) => {
    const caller = new AbortController();
    const onProgress = vi.fn();
    const remaining = [20, 10, 0];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      expect(init.signal).toBe(caller.signal);
      if (url.endsWith("/generate/async")) return { ok: true, json: async () => ({ id: "job", ...(submissionEstimate ? { wait_time: 20 } : {}) }) };
      if (url.includes("/generate/check/")) {
        const wait_time = remaining.shift();
        return { ok: true, json: async () => ({ wait_time, done: wait_time === 0 }) };
      }
      return { ok: true, json: async () => ({ generations: [{ img: "image" }] }) };
    }));
    expect(await generateImageAIHorde({ prompt: "A room", pollInterval: 1, signal: caller.signal, onProgress })).toBe("data:image/webp;base64,image");
    expect(onProgress.mock.calls.map(([percent]) => percent)).toEqual([0, 0.5, 0.95, 1]);
  });

  it("passes signal and progress through Comfy history polling", async () => {
    const caller = new AbortController();
    const onProgress = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      expect(init.signal).toBe(caller.signal);
      return { ok: true, json: async () => url.endsWith("/prompt") ? { prompt_id: "job" } : { job: { outputs: { "9": { images: [{ filename: "scene.png" }] } } } } };
    }));
    expect(await generateImageComfyUI({ prompt: "A room", pollInterval: 1, signal: caller.signal, onProgress })).toContain("filename=scene.png");
    expect(onProgress.mock.calls.map(([percent]) => percent)).toEqual([0, 1]);
  });

  it("generates image via AI Horde successfully", async () => {
    const fakeBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/generate/async")) {
        return {
          ok: true,
          json: async () => ({ id: "horde-task-123" }),
        };
      }
      if (u.includes("/generate/check/")) {
        return {
          ok: true,
          json: async () => ({ done: true, wait_time: 0 }),
        };
      }
      if (u.includes("/generate/status/")) {
        return {
          ok: true,
          json: async () => ({
            done: true,
            generations: [{ img: fakeBase64 }],
          }),
        };
      }
      throw new Error(`Unexpected url: ${u}`);
    });

    const result = await generateImage({
      provider: "ai_horde",
      prompt: "A beautiful celestial garden",
      pollInterval: 1,
    });

    expect(result).toBe(`data:image/webp;base64,${fakeBase64}`);
  });

  it("generates image via OpenAI DALL-E successfully", async () => {
    const fakeData = "data:image/png;base64,mockOpenAiImage";

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      expect(init.headers.Authorization).toBe("Bearer sk-test-key-123");
      expect(body.prompt).toBe("A majestic dragon flying over snowy peaks");
      expect(body.size).toBe("1024x1792"); // Portrait
      return {
        ok: true,
        json: async () => ({
          data: [{ b64_json: "mockOpenAiImage" }],
        }),
      };
    });

    const result = await generateImage({
      provider: "openai",
      apiKey: "sk-test-key-123",
      prompt: "A majestic dragon flying over snowy peaks",
      width: 512,
      height: 768,
    });

    expect(result).toBe(fakeData);
  });

  it("throws when OpenAI API key is missing", async () => {
    await expect(
      generateImage({
        provider: "openai",
        apiKey: "",
        prompt: "A castle",
      })
    ).rejects.toThrow("OpenAI API key is required");
  });

  it("generates image via SD WebUI successfully", async () => {
    const fakeBase64 = "sdWebUiRawBase64";

    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      expect(url).toBe("http://127.0.0.1:7860/sdapi/v1/txt2img");
      const body = JSON.parse(init.body);
      expect(body.prompt).toBe("cyberpunk street with rain reflections");
      expect(body.steps).toBe(20);
      return {
        ok: true,
        json: async () => ({
          images: [fakeBase64],
        }),
      };
    });

    const result = await generateImage({
      provider: "sd_webui",
      prompt: "cyberpunk street with rain reflections",
      endpoint: "http://127.0.0.1:7860",
    });

    expect(result).toBe(`data:image/png;base64,${fakeBase64}`);
  });

  it("generates image via ComfyUI successfully", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/prompt")) {
        return {
          ok: true,
          json: async () => ({ prompt_id: "comfy-job-456" }),
        };
      }
      if (u.includes("/history/comfy-job-456")) {
        return {
          ok: true,
          json: async () => ({
            "comfy-job-456": {
              outputs: {
                "9": {
                  images: [{ filename: "Nova_0001.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected url: ${u}`);
    });

    const result = await generateImage({
      provider: "comfyui",
      prompt: "fantasy castle",
      endpoint: "http://127.0.0.1:8188",
      pollInterval: 1,
    });

    expect(result).toBe("http://127.0.0.1:8188/view?filename=Nova_0001.png&subfolder=&type=output");
  });

  it("throws on unsupported provider", async () => {
    await expect(
      generateImage({
        provider: "unsupported_xyz",
        prompt: "test",
      })
    ).rejects.toThrow("Unsupported image generation provider: unsupported_xyz");
  });
});

describe("ImageGenModal UI component", () => {
  it("renders modal when open and displays prefilled prompt", async () => {
    await mount(
      <ImageGenModal
        open={true}
        onClose={vi.fn()}
        initialPrompt="A serene mountain lake at sunrise"
        settings={emptyData.settings}
      />
    );

    expect(document.body.textContent).toContain("Visualize Scene");
    expect(host.textContent).toContain("Provider");
    expect(host.querySelector("select").value).toBe("ai_horde");
    expect(host.textContent).toContain("Aspect Ratio");

    const textarea = host.querySelector("textarea");
    expect(textarea).toBeDefined();
    expect(textarea.value).toBe("A serene mountain lake at sunrise");
  });

  it("generates image on button click and provides action buttons", async () => {
    const mockImageUri = "data:image/png;base64,generatedArtwork123";

    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/generate/async")) return { ok: true, json: async () => ({ id: "task-1" }) };
      if (u.includes("/generate/check/")) return { ok: true, json: async () => ({ done: true }) };
      if (u.includes("/generate/status/")) {
        return { ok: true, json: async () => ({ generations: [{ img: mockImageUri }] }) };
      }
      return { ok: false, status: 404 };
    });

    const onSendToChat = vi.fn();
    const onSetBackdrop = vi.fn();
    const onClose = vi.fn();

    await mount(
      <ImageGenModal
        open={true}
        onClose={onClose}
        initialPrompt="Steampunk workshop filled with brass gears"
        settings={emptyData.settings}
        onSendToChat={onSendToChat}
        onSetBackdrop={onSetBackdrop}
      />
    );

    // Find Generate button
    const buttons = Array.from(host.querySelectorAll("button"));
    const genBtn = buttons.find((b) => b.textContent.includes("Generate Art"));
    expect(genBtn).toBeDefined();

    await act(async () => {
      genBtn.click();
    });

    await flush();

    // Verify generated image preview rendered
    const img = host.querySelector('img[alt="Generated scene"]');
    expect(img).toBeDefined();
    expect(img.getAttribute("src")).toBe(mockImageUri);

    // Verify action buttons appear
    const sendBtn = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Send to Chat")
    );
    expect(sendBtn).toBeDefined();

    await act(async () => {
      sendBtn.click();
    });

    expect(onSendToChat).toHaveBeenCalledWith(mockImageUri, "Steampunk workshop filled with brass gears");
    expect(onClose).toHaveBeenCalled();
  });

  it("displays error message if generation fails", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Horde service is currently down",
    }));

    await mount(
      <ImageGenModal
        open={true}
        onClose={vi.fn()}
        initialPrompt="A dark enchanted forest"
        settings={emptyData.settings}
      />
    );

    const buttons = Array.from(host.querySelectorAll("button"));
    const genBtn = buttons.find((b) => b.textContent.includes("Generate Art"));

    await act(async () => {
      genBtn.click();
    });

    await flush();

    expect(host.textContent).toContain("AI Horde request failed");
  });
});

describe("Slash commands /imagine and /visualize", () => {
  it("registers /imagine and /visualize in SLASH_COMMANDS list", () => {
    const imagineCmd = SLASH_COMMANDS.find((c) => c.name === "imagine");
    const visualizeCmd = SLASH_COMMANDS.find((c) => c.name === "visualize");

    expect(imagineCmd).toBeDefined();
    expect(imagineCmd.syntax).toBe("/imagine <prompt>");
    expect(visualizeCmd).toBeDefined();
    expect(visualizeCmd.syntax).toBe("/visualize [prompt]");
  });

  it("detects and parses /imagine command", () => {
    expect(isSlashCommand("/imagine a neon rain-slicked alleyway")).toBe(true);
    const parsed = parseSlashCommand("/imagine a neon rain-slicked alleyway");
    expect(parsed.name).toBe("imagine");
    expect(parsed.args).toBe("a neon rain-slicked alleyway");
  });

  it("executes /imagine and calls onImagine handler", () => {
    const onImagine = vi.fn();
    const parsed = parseSlashCommand("/imagine a starry night over gothic towers");

    const result = executeSlashCommand(parsed, { onImagine });
    expect(result.handled).toBe(true);
    expect(result.action).toBe("imagine");
    expect(onImagine).toHaveBeenCalledWith("a starry night over gothic towers");
  });

  it("executes /visualize with optional prompt", () => {
    const onImagine = vi.fn();
    const parsed = parseSlashCommand("/visualize");

    const result = executeSlashCommand(parsed, { onImagine });
    expect(result.handled).toBe(true);
    expect(result.action).toBe("imagine");
    expect(onImagine).toHaveBeenCalledWith("");
  });
});

describe("ChatPage Image Generation Integration", () => {
  const testCharacter = {
    id: "c1",
    name: "Elena",
    description: "Hair: silver\nEyes: emerald\nClothing: white wizard robe",
  };

  const initialChat = {
    id: "chat-img-1",
    kind: "character",
    characterId: "c1",
    personaId: "",
    messages: [
      { id: "m1", role: "assistant", content: "Welcome to the academy.", at: Date.now() },
      {
        id: "m2",
        role: "system",
        content: "*Visualized Scene: ancient library with glowing runes*",
        image: "data:image/png;base64,mockLibraryScene",
        speaker: "Scene Art",
        at: Date.now() + 1,
      },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("opens ImageGenModal from the chat's ⋮ menu with a prompt from the card", async () => {
    let currentData = {
      ...emptyData,
      characters: [testCharacter],
      chats: [initialChat],
    };

    function TestApp() {
      const [data, setData] = useState(currentData);
      return (
        <ChatPage
          data={data}
          chatId="chat-img-1"
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

    // Verify chat bubble rendered the image
    const chatImg = host.querySelector('img[src="data:image/png;base64,mockLibraryScene"]');
    expect(chatImg).toBeDefined();

    // the chat's ⋮ menu, then Picture the scene
    await act(async () => host.querySelector('button[aria-label="Chat settings"]').click());
    await flush();
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Scene art").click());
    await flush();
    const vizRow = [...host.querySelectorAll("button")].find((b) => b.textContent.includes("Picture the scene"));
    expect(vizRow).toBeDefined();
    await act(async () => vizRow.click());
    await flush();

    // Verify modal is open and prefilled with extracted character appearance
    expect(document.body.textContent).toContain("Visualize Scene");
    expect(document.body.textContent).toContain("Scene Visual Prompt");
    const promptInput = document.body.querySelector('textarea[placeholder*="Describe the character"]');
    expect(promptInput).toBeDefined();
    expect(promptInput.value).toContain("silver hair");
    expect(promptInput.value).toContain("emerald eyes");
  });

  it("triggers image generation modal via /imagine slash command", async () => {
    let currentData = {
      ...emptyData,
      characters: [testCharacter],
      chats: [initialChat],
    };

    function TestApp() {
      const [data, setData] = useState(currentData);
      return (
        <ChatPage
          data={data}
          chatId="chat-img-1"
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

    // Type /imagine custom prompt into composer
    const composerTextarea = host.querySelector("textarea");
    await type(composerTextarea, "/imagine magical clocktower in the clouds");

    const sendButton = host.querySelector('button[aria-label="Send"]');
    expect(sendButton).toBeDefined();

    await act(async () => {
      sendButton.click();
    });
    await flush();

    // Verify modal opened with the custom prompt from /imagine
    const modalPrompt = document.body.querySelector('textarea[placeholder*="Describe the character"]');
    expect(modalPrompt).toBeDefined();
    expect(modalPrompt.value).toBe("magical clocktower in the clouds");
  });
});

 it("uses the configured provider key and model through the image modal", async () => {
   const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), { status: 200 }));
   vi.stubGlobal("fetch", fetch);
   await mount(<ImageGenModal open onClose={() => {}} initialPrompt="A room" settings={{ providers: [{ preset: "openai", key: "saved-key" }], imageGen: { provider: "openai", model: "dall-e-3" } }} />);
   await act(async () => Array.from(host.querySelectorAll("button")).find((b) => b.textContent.includes("Generate Art")).click());
   await flush();
   expect(fetch).toHaveBeenCalled();
   expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer saved-key");
   expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe("dall-e-3");
   expect(host.querySelector('img[alt="Generated scene"]')).toBeTruthy();
   vi.unstubAllGlobals();
 });
