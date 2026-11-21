import { describe, expect, it } from "vitest";
import { castBgListOf } from "../src/lib/data.js";

describe("Nova Scope backdrops", () => {
  const host = { theme: { bgs: [{ image: "host-1.png" }, { image: "shared.png" }], bgSeconds: 9 } };
  const other = { theme: { bgs: [{ image: "other-1.webm", animated: true }, { image: "shared.png" }] } };
  const third = { theme: { bg: { image: "third-bg.png" } } };

  it("merges the host's pictures with every linked card's, each once, host first", () => {
    const list = castBgListOf(host.theme, [other, third]).map((b) => b.image);
    expect(list).toEqual(["host-1.png", "shared.png", "other-1.webm", "third-bg.png"]);
  });

  it("keeps the host's own list when no cards are linked", () => {
    expect(castBgListOf(host.theme, []).map((b) => b.image)).toEqual(["host-1.png", "shared.png"]);
  });

  it("ignores cards with no pictures", () => {
    expect(castBgListOf({}, [{ theme: {} }, {}]).length).toBe(0);
  });
});
