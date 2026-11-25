// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, bootUpdateCheck, isNewer, parseVersion, shortVersion, RELEASES_REPO, installUpdate } from "../src/lib/updates.js";

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

  it("makes no request while it is off, and asks on every launch when on", async () => {
    expect(await bootUpdateCheck(false, "1.0.0", { fetchImpl: reply({ tag_name: "v2.0.0" }) })).toBe(null);
    expect(reply.urls).toHaveLength(0);
    const a = await bootUpdateCheck(true, "1.0.0", { fetchImpl: reply({ tag_name: "v1.0.0" }) });
    expect(a.newer).toBe(false);
    const b = await bootUpdateCheck(true, "1.0.0", { fetchImpl: reply({ tag_name: "v1.0.1" }) });
    expect(b.newer).toBe(true);
    expect(reply.urls).toHaveLength(2);
  });

  it("never throws, and falls back to the last answer offline", async () => {
    const boom = async () => { throw new Error("offline"); };
    expect(await bootUpdateCheck(true, "1.0.0", { fetchImpl: boom })).toBe(null);
    await bootUpdateCheck(true, "1.0.0", { fetchImpl: reply({ tag_name: "v1.0.1" }) });
    expect((await bootUpdateCheck(true, "1.0.0", { fetchImpl: boom }))?.latest).toBe("1.0.1");
  });
});

describe("Update button", () => {
  afterEach(() => { delete window.novaDesktop; delete window.Capacitor; vi.restoreAllMocks(); });
  it("keeps only the release's own APK", async () => {
    const assets = [{ browser_download_url: "https://evil.example/Nova.apk" }, { browser_download_url: `https://github.com/${RELEASES_REPO}/releases/download/v1.3.0/Nova-1.3.0.apk` }];
    const r = await checkForUpdate("1.0.0", { fetchImpl: reply({ tag_name: "v1.3.0", assets }) });
    expect(r.apk).toBe(`https://github.com/${RELEASES_REPO}/releases/download/v1.3.0/Nova-1.3.0.apk`);
  });
  it("installs on the desktop, sends the portable .exe to the page, and hands Android its APK", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    window.novaDesktop = { update: vi.fn().mockResolvedValue({ installing: true }) };
    expect(await installUpdate({ url: "u" })).toBeUndefined();
    window.novaDesktop.update.mockResolvedValue({ manual: true });
    expect(await installUpdate({ url: "u" })).toMatch(/download page/);
    expect(open).toHaveBeenCalledWith("u", "_blank", "noopener,noreferrer");
    delete window.novaDesktop;
    const NovaUpdate = { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }), install: vi.fn().mockResolvedValue({}) };
    window.Capacitor = { isNativePlatform: () => true, Plugins: { NovaUpdate } };
    expect(await installUpdate({ url: "u", apk: "a.apk" })).toMatch(/Install/);
    expect(NovaUpdate.install).toHaveBeenCalledWith({ url: "a.apk" });
  });
});
