// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { IDBFactory } from "fake-indexeddb";
import {
  ADVANCED_TUNING,
  DEFAULT_ADVANCED_SAMPLERS,
  genParams,
  normalizeAdvancedSamplers,
  readSampler,
  styleDefaults,
  styleTuning,
  tuningKey,
} from "../src/lib/styles.js";
import {
  attachAdvancedSamplers,
  samplerBody,
} from "../src/lib/api.js";
import { emptyData } from "../src/lib/data.js";
import { AdvancedSamplersSection } from "../src/components/StylePicker.jsx";
import { ChatPage } from "../src/pages/ChatPage.jsx";
import { resetStorageForTests } from "../src/lib/storage.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root, host;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetStorageForTests();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
  globalThis.cancelAnimationFrame = (t) => clearTimeout(t);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const mount = async (el) => {
  await act(async () => root.render(el));
};

const flush = async () => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
};

describe("Advanced Samplers Normalization in styles.js", () => {
  it("defines DEFAULT_ADVANCED_SAMPLERS with expected defaults and ranges", () => {
    expect(DEFAULT_ADVANCED_SAMPLERS).toEqual({
      dry_multiplier: 0,
      dry_base: 1.75,
      dry_allowed_length: 2,
      dry_sequence_breakers: ["\n", ":", '"', "*"],
      top_a: 0,
      mirostat_mode: 0,
      mirostat_tau: 5.0,
      mirostat_eta: 0.1,
      cfg_scale: 1.0,
      dynatemp_min: 0,
      dynatemp_max: 0,
      dynatemp_exponent: 1.0,
    });

    /* they live in each model's fine tuning, not at the top of settings */
    expect(emptyData.settings.dry_multiplier).toBeUndefined();
  });

  it("normalizeAdvancedSamplers returns defaults for empty inputs", () => {
    const res = normalizeAdvancedSamplers({});
    expect(res).toEqual(DEFAULT_ADVANCED_SAMPLERS);
  });

  it("normalizeAdvancedSamplers parses and clamps in-bound and out-of-bound values", () => {
    const valid = normalizeAdvancedSamplers({
      dry_multiplier: 1.25,
      dry_base: 2.5,
      dry_allowed_length: 4,
      dry_sequence_breakers: ["\n", "."],
      top_a: 0.65,
      mirostat_mode: 2,
      mirostat_tau: 4.0,
      mirostat_eta: 0.25,
      cfg_scale: 2.2,
      dynatemp_min: 0.4,
      dynatemp_max: 1.6,
      dynatemp_exponent: 1.5,
    });
    expect(valid.dry_multiplier).toBe(1.25);
    expect(valid.dry_base).toBe(2.5);
    expect(valid.dry_allowed_length).toBe(4);
    expect(valid.dry_sequence_breakers).toEqual(["\n", "."]);
    expect(valid.top_a).toBe(0.65);
    expect(valid.mirostat_mode).toBe(2);
    expect(valid.mirostat_tau).toBe(4.0);
    expect(valid.mirostat_eta).toBe(0.25);
    expect(valid.cfg_scale).toBe(2.2);
    expect(valid.dynatemp_min).toBe(0.4);
    expect(valid.dynatemp_max).toBe(1.6);
    expect(valid.dynatemp_exponent).toBe(1.5);

    // Clamping out-of-range values
    const clamped = normalizeAdvancedSamplers({
      dry_multiplier: 5.0, // max 2.0
      top_a: -0.5, // min 0
      mirostat_mode: 9, // invalid mode, resets to 0
      cfg_scale: 0.5, // min 1.0
      dynatemp_min: -1.0, // min 0
      dynatemp_max: 8.0, // max 2.0
      dynatemp_exponent: 0, // min 0.1
    });
    expect(clamped.dry_multiplier).toBe(2.0);
    expect(clamped.top_a).toBe(0);
    expect(clamped.mirostat_mode).toBe(0);
    expect(clamped.cfg_scale).toBe(1.0);
    expect(clamped.dynatemp_min).toBe(0);
    expect(clamped.dynatemp_max).toBe(2.0);
    expect(clamped.dynatemp_exponent).toBe(0.1);
  });

  it("genParams sends no advanced sampler with fine tuning off, stray top-level fields included", () => {
    const s = {
      ...emptyData.settings,
      stylePreset: "neutral",
      dry_multiplier: 0.7,
      top_a: 0.85,
      mirostat_mode: 1,
      cfg_scale: 1.5,
    };
    const params = genParams(s);
    expect(params.dry_multiplier).toBe(0);
    expect(params.top_a).toBe(0);
    expect(params.mirostat_mode).toBe(0);
    expect(params.cfg_scale).toBe(1);
  });

  it("genParams normalizes advanced samplers when fine tuning is on", () => {
    const s = {
      ...emptyData.settings,
      stylePreset: "neutral",
    };
    const key = tuningKey(s);
    s.modelTuning = {
      [key]: {
        neutral: {
          on: true,
          temperature: 0.8,
          dry_multiplier: 1.1,
          top_a: 0.4,
          mirostat_mode: 2,
          mirostat_tau: 6.0,
          mirostat_eta: 0.2,
        },
      },
    };
    const params = genParams(s);
    expect(params.tuned).toBeDefined();
    expect(params.tuned.dry_multiplier).toBe(1.1);
    expect(params.tuned.top_a).toBe(0.4);
    expect(params.tuned.mirostat_mode).toBe(2);
    expect(params.tuned.mirostat_tau).toBe(6.0);
    expect(params.tuned.mirostat_eta).toBe(0.2);
  });

  it("readSampler extracts DRY and advanced fields from community presets", () => {
    const raw = {
      temp: 0.9,
      dry_multiplier: 0.85,
      dryBase: 1.8,
      dry_allowed_length: 3,
      top_a: 0.7,
      mirostat_mode: 2,
      tau: 4.5,
      eta: 0.15,
      cfg_scale: 1.8,
      dynatemp_min: 0.2,
      dynatemp_max: 1.4,
      dry_sequence_breakers: ["\n", '"', "*"],
    };
    const parsed = readSampler(raw);
    expect(parsed).toBeDefined();
    expect(parsed.dry_multiplier).toBe(0.85);
    expect(parsed.dry_base).toBe(1.8);
    expect(parsed.dry_allowed_length).toBe(3);
    expect(parsed.top_a).toBe(0.7);
    expect(parsed.mirostat_mode).toBe(2);
    expect(parsed.mirostat_tau).toBe(4.5);
    expect(parsed.mirostat_eta).toBe(0.15);
    expect(parsed.cfg_scale).toBe(1.8);
    expect(parsed.dynatemp_min).toBe(0.2);
    expect(parsed.dynatemp_max).toBe(1.4);
    expect(parsed.dry_sequence_breakers).toEqual(["\n", '"', "*"]);
  });
});

describe("Payload Forwarding in api.js", () => {
  const openRouterEp = {
    src: "openrouter",
    base: "https://openrouter.ai/api/v1",
    preset: { id: "openrouter", samplers: "full" },
  };

  const basicEp = {
    src: "groq",
    base: "https://api.groq.com/openai/v1",
    preset: { id: "groq", samplers: "basic" },
  };

  const googleEp = {
    src: "google",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    preset: { id: "google", samplers: "basic" },
  };

  const codexEp = {
    src: "nova-bridge",
    base: "http://localhost:5005/v1",
    preset: { id: "nova-bridge", samplers: "basic" },
  };

  it("forwards advanced samplers to OpenRouter when defined (> 0 or active)", () => {
    const style = {
      temperature: 0.9,
      max_tokens: 800,
      dry_multiplier: 0.8,
      dry_base: 1.75,
      dry_allowed_length: 2,
      dry_sequence_breakers: ["\n", ":", '"', "*"],
      top_a: 0.65,
      mirostat_mode: 2,
      mirostat_tau: 4.8,
      mirostat_eta: 0.12,
      cfg_scale: 1.5,
      dynatemp_min: 0.3,
      dynatemp_max: 1.3,
      dynatemp_exponent: 1.1,
    };

    const body = samplerBody(style, openRouterEp);
    expect(body.dry_multiplier).toBe(0.8);
    expect(body.dry_base).toBe(1.75);
    expect(body.dry_allowed_length).toBe(2);
    expect(body.dry_sequence_breakers).toEqual(["\n", ":", '"', "*"]);
    expect(body.top_a).toBe(0.65);
    expect(body.mirostat_mode).toBe(2);
    expect(body.mirostat_tau).toBe(4.8);
    expect(body.mirostat_eta).toBe(0.12);
    expect(body.cfg_scale).toBe(1.5);
    expect(body.dynatemp_min).toBe(0.3);
    expect(body.dynatemp_max).toBe(1.3);
    expect(body.dynatemp_exponent).toBe(1.1);
  });

  it("omits advanced samplers from OpenRouter when values are 0 or inactive", () => {
    const style = {
      temperature: 0.9,
      max_tokens: 800,
      dry_multiplier: 0,
      top_a: 0,
      mirostat_mode: 0,
      cfg_scale: 1.0,
      dynatemp_min: 0,
      dynatemp_max: 0,
      dynatemp_exponent: 1.0,
    };

    const body = samplerBody(style, openRouterEp);
    expect(body.dry_multiplier).toBeUndefined();
    expect(body.top_a).toBeUndefined();
    expect(body.mirostat_mode).toBeUndefined();
    expect(body.cfg_scale).toBeUndefined();
    expect(body.dynatemp_min).toBeUndefined();
    expect(body.dynatemp_max).toBeUndefined();
  });

  it("silently omits advanced samplers for basic endpoints like Groq", () => {
    const style = {
      temperature: 0.9,
      max_tokens: 800,
      dry_multiplier: 0.8,
      top_a: 0.7,
      mirostat_mode: 2,
      cfg_scale: 2.0,
    };

    const body = samplerBody(style, basicEp);
    expect(body.dry_multiplier).toBeUndefined();
    expect(body.top_a).toBeUndefined();
    expect(body.mirostat_mode).toBeUndefined();
    expect(body.cfg_scale).toBeUndefined();
  });

  it("silently omits advanced samplers for Google AI Studio", () => {
    const style = {
      temperature: 0.9,
      max_tokens: 800,
      dry_multiplier: 0.8,
      top_a: 0.7,
    };

    const body = samplerBody(style, googleEp);
    expect(body.dry_multiplier).toBeUndefined();
    expect(body.top_a).toBeUndefined();
  });

  it("silently omits advanced samplers for Codex endpoints", () => {
    const style = {
      temperature: 0.9,
      max_tokens: 800,
      dry_multiplier: 0.8,
      top_a: 0.7,
    };

    const body = {};
    attachAdvancedSamplers(body, style, codexEp, "openai/gpt-4.1");
    expect(body.dry_multiplier).toBeUndefined();
    expect(body.top_a).toBeUndefined();
  });

  it("attachAdvancedSamplers adds active samplers to completeText body for OpenRouter", () => {
    const style = {
      dry_multiplier: 0.9,
      top_a: 0.5,
    };
    const body = { model: "meta-llama/llama-3.3-70b-instruct" };
    attachAdvancedSamplers(body, style, openRouterEp, body.model);
    expect(body.dry_multiplier).toBe(0.9);
    expect(body.top_a).toBe(0.5);
  });
});

describe("AdvancedSamplersSection UI Component", () => {
  it("renders expandable section and responds to toggling and inputs", async () => {
    const onChange = vi.fn();
    const values = {
      dry_multiplier: 0.5,
      dry_base: 1.75,
      dry_allowed_length: 2,
      top_a: 0.3,
      mirostat_mode: 0,
      cfg_scale: 1.0,
      dynatemp_min: 0,
      dynatemp_max: 0,
    };

    await mount(
      <AdvancedSamplersSection values={values} onChange={onChange} />
    );

    // Initial state: rendered with active label since dry_multiplier > 0
    expect(host.textContent).toContain("Advanced Samplers (DRY, Mirostat, CFG)");
    expect(host.textContent).toContain("active");

    // Click button to expand
    const toggleBtn = host.querySelector('button[aria-expanded]');
    expect(toggleBtn).toBeDefined();
    await act(async () => {
      toggleBtn.click();
    });

    // Sub-sections now visible
    expect(host.textContent).toContain("DRY Repetition Penalty");
    expect(host.textContent).toContain("Top-A Sampling");
    expect(host.textContent).toContain("Mirostat");
    expect(host.textContent).toContain("Classifier-Free Guidance");
    expect(host.textContent).toContain("Dynamic Temperature");

    // Sliders exist for the parameters
    const rangeInputs = host.querySelectorAll('input[type="range"]');
    expect(rangeInputs.length).toBeGreaterThan(5);
  });
});

describe("Continue Infill Generation in ChatPage", () => {
  const char = { id: "c1", name: "Elena", description: "An archivist", greetings: [{ id: "g1", text: "Welcome." }] };
  const initialChat = {
    id: "k1",
    kind: "character",
    characterId: "c1",
    createdAt: 100,
    updatedAt: 100,
    messages: [
      { id: "m0", role: "assistant", content: "Welcome." },
      { id: "m1", role: "user", content: "Tell me about the ancient tome." },
      { id: "m2", role: "assistant", content: "The tome was bound in weathered leather, its pages glowing faintly with" },
    ],
  };

  const testData = {
    ...emptyData,
    settings: {
      ...emptyData.settings,
      apiKey: "test-key",
      activeProvider: "openrouter",
      providers: [
        { id: "openrouter", preset: "openrouter", key: "test-key", model: "test-model" },
      ],
    },
    characters: [char],
    chats: [initialChat],
  };

  it("renders Continue button on the latest assistant message and appends streamed tokens directly to m.content", async () => {
    const capturedRequests = [];

    // Mock fetch to simulate SSE stream for streamChat, and json completion for runNotes
    const frames = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: " arcane sigils from a forgotten era." } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ];

    vi.stubGlobal("fetch", vi.fn((url, init) => {
      const parsedBody = init?.body ? JSON.parse(init.body) : {};
      capturedRequests.push(parsedBody);

      if (parsedBody.stream === false) {
        return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "Updated scene notes." } }] }), { status: 200 }));
      }

      const stream = new ReadableStream({
        start(c) {
          for (const f of frames) c.enqueue(new TextEncoder().encode(f));
          c.close();
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    }));

    let currentData = testData;
    const update = (patchOrFn) => {
      currentData = typeof patchOrFn === "function" ? patchOrFn(currentData) : { ...currentData, ...patchOrFn };
    };

    await mount(<ChatPage data={currentData} chatId="k1" update={update} onBack={() => {}} />);
    await flush();

    // Verify Continue button is present on the latest message
    const continueBtn = host.querySelector('button[aria-label="Continue this reply"]');
    expect(continueBtn).toBeDefined();
    expect(continueBtn).not.toBeNull();

    // Click Continue
    await act(async () => {
      continueBtn.click();
    });
    await flush();

    // Find the streamChat request
    const streamReq = capturedRequests.find((r) => r.stream === true);
    expect(streamReq).toBeDefined();
    const lastPromptMsg = streamReq.messages[streamReq.messages.length - 1];
    expect(lastPromptMsg.content).toContain("Continue your last message from exactly where it stopped");

    // Verify streamed tokens were appended directly to m2 without creating a new turn
    const chat = currentData.chats[0];
    expect(chat.messages.length).toBe(3); // NO new turn added!
    expect(chat.messages[2].id).toBe("m2");
    expect(chat.messages[2].content).toBe(
      "The tome was bound in weathered leather, its pages glowing faintly with arcane sigils from a forgotten era."
    );
  });
});
