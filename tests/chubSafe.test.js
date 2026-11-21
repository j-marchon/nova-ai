// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { chubSearch, isAdultHit } from "../src/lib/chub.js";

const node = (fullPath, extra = {}) => ({ fullPath, name: fullPath, topics: [], ...extra });
const answer = (nodes) => vi.fn(async () => new Response(JSON.stringify({ data: { nodes, count: nodes.length } }), { status: 200, headers: { "Content-Type": "application/json" } }));

afterEach(() => vi.unstubAllGlobals());

describe("Chub NSFW filter", () => {
  it("flags adult cards by Chub's flag or by tag", () => {
    expect(isAdultHit({ nsfw: true, topics: [] })).toBe(true);
    expect(isAdultHit({ topics: ["Fantasy", "NSFW"] })).toBe(true);
    expect(isAdultHit({ topics: ["nsfl"] })).toBe(true);
    expect(isAdultHit({ topics: ["Fantasy", "Romance"] })).toBe(false);
    expect(isAdultHit({})).toBe(false);
  });

  it("is on by default: asks Chub for no NSFW/NSFL and drops flagged cards that still arrive", async () => {
    const fetch = answer([node("a/clean"), node("a/flagged", { nsfw_image: true }), node("a/tagged", { topics: ["NSFW"] })]);
    vi.stubGlobal("fetch", fetch);
    const r = await chubSearch({ q: "x", page: 1, sort: "download_count" });
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.searchParams.get("nsfw")).toBe("false");
    expect(url.searchParams.get("nsfl")).toBe("false");
    expect(r.hits.map((h) => h.fullPath)).toEqual(["a/clean"]);
    expect(r.raw).toBe(3);
  });

  it("shows everything when turned off", async () => {
    const fetch = answer([node("a/clean"), node("a/tagged", { topics: ["NSFW"] })]);
    vi.stubGlobal("fetch", fetch);
    const r = await chubSearch({ q: "x", page: 1, sort: "download_count", safe: false });
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.searchParams.get("nsfw")).toBe("true");
    expect(r.hits).toHaveLength(2);
  });
});
