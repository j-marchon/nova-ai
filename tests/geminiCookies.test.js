import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserSignInError, chromiumCandidates, cookieParams, chromiumCookies, firefoxCookies, firefoxRoots, forgetGeminiBrowser, learnProblem, getGeminiCookies, learnGeminiModels, promptOf, sessionMessageOf, slugOf } from "../bridge/gemini-cookies.mjs";

/* a test must never find, and open, a real browser on this machine */
process.env.NOVA_BRIDGE_BROWSER = "/nonexistent/browser";
const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-chromium.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "nova-cookies-test-"));
const fake = { name: "Fake Chrome", path: process.execPath, args: [FAKE] };
const COOKIES = [
  { name: "__Secure-1PSID", value: "psid-value", domain: ".google.com" },
  { name: "__Secure-1PSIDTS", value: "psidts-value", domain: ".google.com" },
  { name: "NID", value: "nid-value", domain: "gemini.google.com" },
  { name: "other", value: "not-google", domain: ".example.com" },
];

afterEach(() => {
  for (const k of ["FAKE_COOKIES", "FAKE_DELAY", "FAKE_EXIT_AFTER", "FAKE_LEARN"]) delete process.env[k];
});

/* a Firefox profile folder with the cookies the given rows describe */
function firefoxProfile(root, name, rows) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "cookies.sqlite"));
  db.exec("CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, lastAccessed INTEGER)");
  const ins = db.prepare("INSERT INTO moz_cookies VALUES (?, ?, ?, ?)");
  for (const r of rows) ins.run(...r);
  db.close();
}

describe("Firefox", () => {
  it("reads Google's cookies from the profile that is signed in, the latest used when several are", async () => {
    const root = tmp();
    firefoxProfile(root, "old.default", [["__Secure-1PSID", "old-psid", ".google.com", 100], ["__Secure-1PSIDTS", "old-ts", ".google.com", 100]]);
    firefoxProfile(root, "new.default-release", [
      ["__Secure-1PSID", "new-psid", ".google.com", 900],
      ["__Secure-1PSIDTS", "new-ts", ".google.com", 900],
      ["NID", "nid", "gemini.google.com", 800],
      ["tracker", "x", ".example.com", 999],
      ["empty", "", ".google.com", 999],
    ]);
    firefoxProfile(root, "signed-out", [["NID", "nid", ".google.com", 5000]]);
    const r = await firefoxCookies({ roots: [root, path.join(root, "missing")] });
    expect(r).toEqual({ cookies: { "__Secure-1PSID": "new-psid", "__Secure-1PSIDTS": "new-ts", NID: "nid" }, authuser: 0, from: "Firefox" });
  });

  it("finds nothing when no profile has a Google sign-in", async () => {
    const root = tmp();
    firefoxProfile(root, "a", [["NID", "n", ".google.com", 1]]);
    expect(await firefoxCookies({ roots: [root] })).toBeNull();
    expect(await firefoxCookies({ roots: [path.join(root, "nowhere")] })).toBeNull();
  });

  it("knows where Firefox keeps profiles on each system", () => {
    expect(firefoxRoots({ platform: "linux", home: "/h" })).toContain("/h/.mozilla/firefox");
    expect(firefoxRoots({ platform: "linux", home: "/h" })).toContain("/h/snap/firefox/common/.mozilla/firefox");
    expect(firefoxRoots({ platform: "win32", home: "C:\\Users\\a", env: { APPDATA: "C:\\Users\\a\\AppData\\Roaming" } })[0]).toMatch(/Mozilla.Firefox.Profiles$/);
    expect(firefoxRoots({ platform: "darwin", home: "/Users/a" })[0]).toBe("/Users/a/Library/Application Support/Firefox/Profiles");
  });
});

describe("Chrome-family browsers", () => {
  it("lists where to look, or takes the path it is given", () => {
    expect(chromiumCandidates({ env: { NOVA_BRIDGE_BROWSER: "/opt/b" }, platform: "linux" })).toEqual([{ name: "your browser", path: "/opt/b" }]);
    expect(chromiumCandidates({ env: { LOCALAPPDATA: "C:\\L" }, platform: "win32" }).map((c) => c.name)).toEqual(["Chrome", "Edge", "Brave", "Chromium"]);
    expect(chromiumCandidates({ env: { PATH: "/usr/bin" }, platform: "linux" }).some((c) => c.path === "/usr/bin/brave-browser")).toBe(true);
  });

  it("waits for the sign-in, takes Google's cookies over DevTools and closes the browser", async () => {
    process.env.FAKE_COOKIES = JSON.stringify(COOKIES);
    process.env.FAKE_DELAY = "700";
    const profileDir = path.join(tmp(), "profile");
    const status = [];
    const r = await chromiumCookies({ profileDir, exe: fake, onStatus: (s) => status.push(s) });
    expect(r).toEqual({ cookies: { "__Secure-1PSID": "psid-value", "__Secure-1PSIDTS": "psidts-value", NID: "nid-value" }, authuser: 0, from: "Fake Chrome" });
    expect(status[0]).toMatch(/Opening Fake Chrome/);
  });

  it("says so when the browser is closed before anyone signed in", async () => {
    process.env.FAKE_COOKIES = "[]";
    process.env.FAKE_EXIT_AFTER = "400";
    await expect(chromiumCookies({ profileDir: path.join(tmp(), "p"), exe: fake })).rejects.toThrow(/closed before you signed in|closed/);
  });

  it("says so when there is no browser", async () => {
    await expect(chromiumCookies({ profileDir: path.join(tmp(), "p") })).rejects.toThrow(/No Chrome, Edge, Brave or Chromium found/);
  });
});

describe("getGeminiCookies", () => {
  it.runIf(process.platform === "linux")("opens Gemini in Firefox when the Linux Bridge needs a sign-in", async () => {
    const dir = tmp();
    const args = path.join(dir, "args");
    fs.writeFileSync(path.join(dir, "firefox"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${args}"\n`, { mode: 0o700 });
    vi.stubEnv("PATH", dir);
    vi.stubEnv("NOVA_BRIDGE_BROWSER", "");
    try {
      const result = await getGeminiCookies({ interactive: true, prefer: "auto", roots: [dir] });
      expect(result.retryMessage).toMatch(/select Sign in again/);
      await vi.waitFor(() => expect(fs.readFileSync(args, "utf8").trim().split("\n")).toEqual(["--new-tab", "https://gemini.google.com/app"]));
    } finally {
      vi.unstubAllEnvs();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses Firefox when it has a sign-in, without opening any browser", async () => {
    const root = tmp();
    firefoxProfile(root, "p", [["__Secure-1PSID", "ff-psid", ".google.com", 1]]);
    const status = [];
    const r = await getGeminiCookies({ profileDir: path.join(tmp(), "p"), roots: [root], exe: { name: "never", path: "/nonexistent" }, onStatus: (s) => status.push(s) });
    expect(r.cookies["__Secure-1PSID"]).toBe("ff-psid");
    expect(status).toEqual(["Using the Google sign-in found in Firefox."]);
  });

  it("falls back to the browser window when Firefox has none", async () => {
    process.env.FAKE_COOKIES = JSON.stringify(COOKIES);
    const r = await getGeminiCookies({ profileDir: path.join(tmp(), "p"), roots: [tmp()], exe: fake });
    expect(r.from).toBe("Fake Chrome");
  });

  it("can be told which browser to use, or none", async () => {
    await expect(getGeminiCookies({ prefer: "none" })).rejects.toBeInstanceOf(BrowserSignInError);
    await expect(getGeminiCookies({ prefer: "firefox", roots: [tmp()] })).rejects.toThrow(/No Google sign-in found in Firefox/);
    process.env.FAKE_COOKIES = JSON.stringify(COOKIES);
    const root = tmp();
    firefoxProfile(root, "p", [["__Secure-1PSID", "ff-psid", ".google.com", 1]]);
    expect((await getGeminiCookies({ prefer: "chromium", profileDir: path.join(tmp(), "p"), roots: [root], exe: fake })).from).toBe("Fake Chrome");
  });

  it("forgets the saved browser profile", async () => {
    const dir = path.join(tmp(), "profile");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "Cookies"), "x");
    await forgetGeminiBrowser(dir);
    expect(fs.existsSync(dir)).toBe(false);
    await forgetGeminiBrowser(path.join(tmp(), "never-existed"));
  });
});

describe("Learn models", () => {
  it("reads the model header and the typed name from each message, once per model", async () => {
    process.env.FAKE_LEARN = JSON.stringify([
      { prompt: "Gemini 4 Argon", header: '[1,null,null,null,"95a4c0abcba24364",null,null,0,[4]]' },
      { prompt: "Gemini 4 Flash", header: "[1,null,null,null,\"0123456789abcdef\",null,null,0,[4]]" },
      { prompt: "Gemini 4 Argon", header: '[1,null,null,null,"95a4c0abcba24364",null,null,0,[4]]' },
      { prompt: "no model picked" },
      { prompt: "elsewhere", header: "[1]", url: "https://gemini.google.com/other" },
    ]);
    process.env.FAKE_EXIT_AFTER = "1200";
    const got = [];
    const names = await learnGeminiModels({ profileDir: path.join(tmp(), "p"), exe: fake, onModel: (m) => got.push(m) });
    expect(got).toEqual([
      { name: "Gemini 4 Argon", slug: "gemini-4-argon", header: '[1,null,null,null,"95a4c0abcba24364",null,null,0,[4]]' },
      { name: "Gemini 4 Flash", slug: "gemini-4-flash", header: '[1,null,null,null,"0123456789abcdef",null,null,0,[4]]' },
    ]);
    expect(names).toEqual(["Gemini 4 Argon", "Gemini 4 Flash"]);
  });

  it("opens Gemini already signed in, with the saved cookies, instead of showing Google's sign-in", async () => {
    process.env.FAKE_LEARN = JSON.stringify([{ prompt: "Gemini 4 Argon", header: "feedfacefeedface" }]);
    process.env.FAKE_EXIT_AFTER = "1000";
    const profileDir = path.join(tmp(), "p");
    const got = [];
    await learnGeminiModels({
      profileDir,
      exe: fake,
      cookies: { "__Secure-1PSID": "psid-value", "__Secure-1PSIDTS": "ts-value", NID: "nid", "__Host-GAPS": "accounts-only" },
      onModel: (m) => got.push(m),
    });
    const set = JSON.parse(fs.readFileSync(path.join(profileDir, "set-cookies.json"), "utf8")).cookies;
    expect(set.map((c) => c.name)).toEqual(["__Secure-1PSID", "__Secure-1PSIDTS", "NID"]);
    expect(set[0]).toEqual({ name: "__Secure-1PSID", value: "psid-value", domain: ".google.com", path: "/", secure: true, sameSite: "None" });
    expect(fs.readFileSync(path.join(profileDir, "navigations.log"), "utf8").trim()).toBe("https://gemini.google.com/app");
    expect(got.map((m) => m.slug)).toEqual(["gemini-4-argon"]);
  });

  it("does not touch cookies or navigate when it has none (the browser starts on Gemini itself)", async () => {
    process.env.FAKE_LEARN = "[]";
    process.env.FAKE_EXIT_AFTER = "600";
    const profileDir = path.join(tmp(), "p");
    await learnGeminiModels({ profileDir, exe: fake });
    expect(fs.existsSync(path.join(profileDir, "set-cookies.json"))).toBe(false);
    expect(fs.existsSync(path.join(profileDir, "navigations.log"))).toBe(false);
    expect(cookieParams({})).toEqual([]);
  });

  it("finds the model header among the headers really sent, and asks for a body the event left out", async () => {
    process.env.FAKE_LEARN = JSON.stringify([
      { prompt: "Gemini 4 Argon", header: "[1,null,null,null,\"95a4c0abcba24364\"]", extraInfo: true },
      { prompt: "Gemini 4 Flash", header: "[1,null,null,null,\"0123456789abcdef\"]", noBody: true },
    ]);
    process.env.FAKE_EXIT_AFTER = "800";
    const got = [];
    const names = await learnGeminiModels({ profileDir: path.join(tmp(), "p"), exe: fake, onModel: (m) => got.push(m) });
    expect(got.map((m) => [m.slug, m.header])).toEqual([
      ["gemini-4-argon", "[1,null,null,null,\"95a4c0abcba24364\"]"],
      ["gemini-4-flash", "[1,null,null,null,\"0123456789abcdef\"]"],
    ]);
    expect([...names]).toEqual(["Gemini 4 Argon", "Gemini 4 Flash"]);
    expect(names.problem).toBeUndefined();
  });

  it("reads the newer web app's processSession messages, whole or split in two", async () => {
    process.env.FAKE_LEARN = JSON.stringify([
      { session: "combined", prompt: "Gemini 4 Argon", model: "95a4c0abcba24364" },
      { session: "split", prompt: "Gemini Flash Lite", model: "cf41b0e0dd7d53e5" },
    ]);
    process.env.FAKE_EXIT_AFTER = "800";
    const got = [];
    const names = await learnGeminiModels({ profileDir: path.join(tmp(), "p"), exe: fake, onModel: (m) => got.push(m) });
    expect(got).toEqual([
      { name: "Gemini 4 Argon", slug: "gemini-4-argon", header: "95a4c0abcba24364" },
      { name: "Gemini Flash Lite", slug: "gemini-flash-lite", header: "cf41b0e0dd7d53e5" },
    ]);
    expect([...names]).toEqual(["Gemini 4 Argon", "Gemini Flash Lite"]);
  });

  it("ignores processSession traffic that is not a message", () => {
    expect(sessionMessageOf("count=0")).toBeNull();
    expect(sessionMessageOf("count=1&ofs=0&req0___data__=%%%")).toBeNull();
  });

  it("says why nothing was learned", async () => {
    process.env.FAKE_LEARN = JSON.stringify([{ prompt: "Gemini 4 Argon", ext: { "X-Goog-Ext-1234-Jspb": "[2]" } }]);
    process.env.FAKE_EXIT_AFTER = "600";
    const names = await learnGeminiModels({ profileDir: path.join(tmp(), "p"), exe: fake });
    expect(names).toHaveLength(0);
    expect(names.problem).toMatch(/none carried a model.*x-goog-ext-1234-jspb/);
    expect(learnProblem([])).toMatch(/No Gemini messages were seen/);
    expect(learnProblem([{ header: true, prompt: false, extNames: [] }])).toMatch(/could not read the message text/);
  });

  it("makes slugs and prompts the way the bridge expects", () => {
    expect(slugOf("Gemini 4 Argon!")).toBe("gemini-4-argon");
    expect(slugOf("  ..x.. ")).toBe("x");
    expect(promptOf(`f.req=${encodeURIComponent(JSON.stringify([null, JSON.stringify([["hello", 0]])]))}&at=t`)).toBe("hello");
    expect(promptOf("nonsense")).toBeNull();
  });
});
