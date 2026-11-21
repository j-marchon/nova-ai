import { describe, expect, it, vi } from "vitest";
import { emptyData } from "../src/lib/data.js";

/* the Bridge keeps whatever body it is sent; here it is a variable */
let stored = null;
vi.mock("../src/lib/api.js", async (original) => ({
  ...await original(),
  endpointFor: () => ({ url: "http://bridge", key: "k" }),
  sendTo: vi.fn(async (_ep, _s, path, init = {}) => {
    if (path === "/sync" && init.method === "PUT") {
      stored = await init.body.text();
      return new Response(JSON.stringify({ rev: 1 }), { status: 200 });
    }
    if (path === "/sync/data") return new Response(stored, { status: 200, headers: { "X-Nova-Rev": "1" } });
    return new Response("{}", { status: 404 });
  }),
}));

const { syncGet, syncSend } = await import("../src/lib/sync.js");
const settings = { providers: [{ id: "b", preset: "nova-bridge" }], activeProvider: "b" };

describe("Sync carries skins", () => {
  it("sends the skins with the library and gets them back", async () => {
    const skins = [{ id: "aero", name: "Aero", version: "1.0.0", zip: "UEsFBg==" }];
    await syncSend(settings, structuredClone(emptyData), { version: "3.2.4", skins });
    expect(JSON.parse(stored).skins).toEqual(skins);
    const got = await syncGet(settings);
    expect(got.rev).toBe(1);
    expect(got.skins).toEqual(skins);
  });

  it("a device with no skins sends none", async () => {
    await syncSend(settings, structuredClone(emptyData), { version: "3.2.4", skins: [] });
    expect(JSON.parse(stored)).not.toHaveProperty("skins");
    expect((await syncGet(settings)).skins).toEqual([]);
  });
});
