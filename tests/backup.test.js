import { describe, expect, it } from "vitest";
import { KEEP_DAILY, backupName, backupSummary, dailyBackup, dailyName, makeBackup, readBackup } from "../src/lib/backup.js";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { fakeFilesystem } from "./fakeFilesystem.js";

const img = (c) => `data:image/jpeg;base64,${c.repeat(2000)}`;

const state = () => normalizeData({
  ...JSON.parse(JSON.stringify(emptyData)),
  username: "Ana",
  characters: [{ id: "c1", name: "Mira", avatar: img("A") }],
  personas: [{ id: "p1", name: "Ana", avatar: img("A") }],
  chats: [
    { id: "x", kind: "character", characterId: "c1", messages: [{ id: "m1", role: "assistant", content: "Hi" }], updatedAt: 1 },
    { id: "y", kind: "character", characterId: "c1", messages: [], updatedAt: 2 },
  ],
});

describe("backups", () => {
  it("round-trips everything, chats in order", () => {
    const s = state();
    const { state: back, createdAt } = readBackup(makeBackup(s, "2.5.0"));
    expect(back).toEqual(s);
    expect(back.chats.map((c) => c.id)).toEqual(["x", "y"]);
    expect(typeof createdAt).toBe("number");
  });

  it("excludes nested credentials by default and preserves explicit full backups", () => {
    const s = state();
    s.settings.providers[0].key = "provider-secret";
    s.settings.voice = { apiKey: "voice-secret" };
    s.settings.imageGen = { apiKey: "image-secret" };
    s.characters[0].key = "story-key";
    const safe = makeBackup(s);
    expect(safe).toContain("story-key");
    expect(safe).not.toContain("provider-secret");
    expect(safe).not.toContain("voice-secret");
    expect(safe).not.toContain("image-secret");
    expect(s.settings.providers[0].key).toBe("provider-secret");
    expect(makeBackup(s, "", { includeCredentials: true })).toContain("provider-secret");
    expect(readBackup(makeBackup(s, "", { includeCredentials: true })).state.settings.providers[0].key).toBe("provider-secret");
  });

  it("stores a picture used twice only once", () => {
    const raw = JSON.parse(makeBackup(state()));
    expect(Object.keys(raw.images)).toHaveLength(1);
  });

  it("refuses files that are not Nova backups", () => {
    expect(() => readBackup("not json")).toThrow(/not a Nova backup/);
    expect(() => readBackup(JSON.stringify({ characters: [] }))).toThrow(/not a Nova backup/);
    expect(() => readBackup(JSON.stringify({ app: "nova", backup: 99, core: {} }))).toThrow(/newer version/);
  });

  it("names and summarises", () => {
    expect(backupName(new Date(2026, 9, 3, 7, 5))).toBe("nova-backup-2026-10-03-0705.json");
    expect(backupSummary(state())).toBe("1 character · 0 universes · 1 persona · 2 chats");
  });
});

describe("daily backups", () => {
  const fakeFs = (existing = []) => fakeFilesystem({ existing: existing.map((n) => [`Nova/Daily/${n}`, "{}"]) });

  it("writes once a day and keeps the newest seven", async () => {
    const old = Array.from({ length: 9 }, (_, i) => `nova-daily-2020-01-0${i + 1}.json`);
    const fs = fakeFs([...old, "notes.txt"]);
    const where = await dailyBackup(state(), "", fs);
    expect(where).toBe(`Documents/Nova/Daily/${dailyName()}`);
    const left = [...fs.files.keys()].map((p) => p.split("/").pop());
    expect(left).toContain(dailyName());
    expect(left).toContain("notes.txt");
    expect(left.filter((n) => n.startsWith("nova-daily-"))).toHaveLength(KEEP_DAILY);
    expect(left).not.toContain("nova-daily-2020-01-01.json");
    expect(await dailyBackup(state(), "", fs)).toBe(null);
  });

  it("does nothing outside the app", async () => {
    expect(await dailyBackup(state(), "", null)).toBe(null);
  });

  it("skips an empty app", async () => {
    const fs = fakeFs();
    expect(await dailyBackup(normalizeData({ ...JSON.parse(JSON.stringify(emptyData)) }), "", fs)).toBe(null);
    expect(fs.files.size).toBe(0);
  });

  it("does not count a leftover .part as today's backup, and removes it", async () => {
    const old = Array.from({ length: 9 }, (_, i) => `nova-daily-2020-01-0${i + 1}.json`);
    const fs = fakeFs([...old, `${dailyName()}.part`, "nova-daily-2020-02-01.json.part"]);
    fs.files.set(`Nova/Daily/${dailyName()}.part`, "{\"app\":\"nova\",\"backup\":1,\"cor");
    const where = await dailyBackup(state(), "", fs);
    expect(where).toBe(`Documents/Nova/Daily/${dailyName()}`);
    const left = [...fs.files.keys()].map((p) => p.split("/").pop());
    expect(left.some((n) => n.endsWith(".part"))).toBe(false);
    expect(left.filter((n) => n.startsWith("nova-daily-"))).toHaveLength(KEEP_DAILY);
    expect(readBackup(fs.files.get(`Nova/Daily/${dailyName()}`)).state).toEqual(state());
    /* written only under the .part name and moved into place */
    const writes = fs.calls.filter((c) => c.op === "writeFile" || c.op === "appendFile");
    expect(writes.every((c) => c.path.endsWith(".part"))).toBe(true);
    expect(fs.calls.filter((c) => c.op === "rename").map((c) => c.to)).toEqual([`Nova/Daily/${dailyName()}`]);
  });

  it("leaves no file behind when the write fails, so tomorrow's launch tries again", async () => {
    const fs = fakeFilesystem({ failOn: ({ op }) => op === "writeFile" });
    await expect(dailyBackup(state(), "", fs)).rejects.toThrow(/fake writeFile/);
    expect(fs.files.size).toBe(0);
  });
});
