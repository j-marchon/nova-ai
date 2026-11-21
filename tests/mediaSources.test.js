import { describe, expect, it } from "vitest";
import { imageChoices, resolveImageBackend } from "../src/lib/imageGen.js";
import { canSpeak, speechChoices, speechOptions } from "../src/lib/tts.js";

const bridge = { id: "b1", preset: "nova-bridge", name: "Nova Bridge", base: "http://192.168.1.5:5005/v1", key: "dev-token" };
const openai = { id: "o1", preset: "openai", name: "OpenAI", base: "https://api.openai.com/v1", key: "sk-test" };
const router = { id: "r1", preset: "openrouter", name: "OpenRouter", base: "https://openrouter.ai/api/v1", key: "x" };

describe("where pictures come from", () => {
  it("offers saved Bridge and OpenAI providers first, then the services", () => {
    const ids = imageChoices({ providers: [router, bridge, openai] }).map((c) => c.id);
    expect(ids).toEqual(["saved:b1", "saved:o1", "ai_horde", "sd_webui", "comfyui"]);
  });

  it("reuses a saved provider's address and key", () => {
    const settings = { providers: [bridge, openai], imageGen: { provider: "saved:b1" } };
    expect(resolveImageBackend(settings)).toEqual({ provider: "openai", apiKey: "dev-token", endpoint: bridge.base, model: undefined, bridge: true });
    expect(resolveImageBackend(settings, { provider: "saved:o1", model: "gpt-image-1" })).toMatchObject({ apiKey: "sk-test", endpoint: openai.base, model: "gpt-image-1", bridge: false });
  });

  it("refuses a removed provider and an OpenAI choice with no key", () => {
    expect(resolveImageBackend({ providers: [] }, { provider: "saved:b1" })).toBeNull();
    expect(resolveImageBackend({ providers: [{ ...openai, key: "" }] }, { provider: "saved:o1" })).toBeNull();
    expect(resolveImageBackend({ providers: [] }, { provider: "openai" })).toBeNull();
  });

  it("keeps older settings working", () => {
    expect(resolveImageBackend({ providers: [openai] }, { provider: "openai" })).toMatchObject({ provider: "openai", apiKey: "sk-test" });
    expect(resolveImageBackend({}, { provider: "sd_webui", endpoint: "http://pc:7860" })).toMatchObject({ provider: "sd_webui", endpoint: "http://pc:7860" });
  });
});

describe("where the voice comes from", () => {
  it("offers the device, saved OpenAI keys and a custom address; never the Bridge", () => {
    expect(speechChoices([bridge, openai]).map((c) => c.id)).toEqual(["system", "saved:o1", "custom"]);
  });

  it("builds an OpenAI speech request from a saved provider", () => {
    const o = speechOptions({ source: "saved:o1", voice: "nova", rate: 1.2 }, [openai]);
    expect(o).toMatchObject({ endpoint: "https://api.openai.com/v1/audio/speech", apiKey: "sk-test", model: "gpt-4o-mini-tts", voiceName: "nova", rate: 1.2 });
  });

  it("treats an older endpoint-only setup as custom, and a removed provider as unavailable", () => {
    expect(speechOptions({ endpoint: "https://x/v1/audio/speech", apiKey: "k" })).toMatchObject({ endpoint: "https://x/v1/audio/speech", apiKey: "k", model: "tts-1" });
    expect(canSpeak({ source: "saved:gone" }, [])).toBe(false);
    expect(speechOptions({ source: "system" }).endpoint).toBeUndefined();
  });
});
