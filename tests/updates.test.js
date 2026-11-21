// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { checkForUpdate, dailyUpdateCheck, isNewer, parseVersion, shortVersion, RELEASES_REPO } from "../src/lib/updates.js";

const reply = (body, status = 200) => async (url) => {
  reply.urls.push(url);
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};
reply.urls = [];

describe("update check", () => {
  beforeEach(() => { localStorage.clear(); reply.urls = []; });

  it("reads versions and compares them", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("1.0")).toEqual([1, 0, 0]);
    expect(parseVersion("nightly")).toBe(null);
    expect(isNewer("v1.0.1", "1.0.0")).toBe(true);
    expect(isNewer("v1.0.0", "1.0.0")).toBe(false);
    expect(isNewer("v0.9.9", "1.0.0")).toBe(false);
    expect(isNewer("v1.10.0", "1.9.0")).toBe(true);
    expect(shortVersion("1.0.0")).toBe("1.0");
    expect(shortVersion("v1.0.1")).toBe("1.0.1");
  });

  it("asks the public releases repository and reports a newer release", async () => {
    const r = await checkForUpdate("1.0.0", { fetchImpl: reply({ tag_name: "v1.1.0", html_url: "https://github.com/x/y/releases/tag/v1.1.0" }) });
    expect(reply.urls[0]).toBe(`https://api.github.com/repos/${RELEASES_REPO}/releases/latest`);
    expect(r).toMatchObject({ latest: "1.1", newer: true, url: "https://github.com/x/y/releases/tag/v1.1.0" });
  });

  it("says when nothing is published", async () => {
    await expect(checkForUpdate("1.0.0", { fetchImpl: reply({}, 404) })).rejects.toThrow(/No release/);
  });

  it("makes no request while it is off, and at most one a day when on", async () => {
    expect(await dailyUpdateCheck(false, "1.0.0", { fetchImpl: reply({ tag_name: "v2.0.0" }) })).toBe(null);
    expect(reply.urls).toHaveLength(0);
    const t0 = 1_000_000_000_000;
    const a = await dailyUpdateCheck(true, "1.0.0", { fetchImpl: reply({ tag_name: "v1.0.0" }), now: t0 });
    expect(a.newer).toBe(false);
    await dailyUpdateCheck(true, "1.0.0", { fetchImpl: reply({ tag_name: "v1.0.0" }), now: t0 + 60_000 });
    expect(reply.urls).toHaveLength(1);
    await dailyUpdateCheck(true, "1.0.0", { fetchImpl: reply({ tag_name: "v1.0.1" }), now: t0 + 25 * 3600_000 });
    expect(reply.urls).toHaveLength(2);
  });

  it("never throws from the daily check", async () => {
    const boom = async () => { throw new Error("offline"); };
    expect(await dailyUpdateCheck(true, "1.0.0", { fetchImpl: boom })).toBe(null);
  });
});
