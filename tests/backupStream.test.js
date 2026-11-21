import { describe, expect, it, vi } from "vitest";
import { backupParts, makeBackup, readBackup } from "../src/lib/backup.js";
import { WRITE_CHUNK, b64ToBytes, cardFields, pngTextChunks, pngWithText, bytesToB64, saveFile, textChunks, utf8, writeChunked } from "../src/lib/cards.js";
import { emptyData, normalizeData } from "../src/lib/data.js";
import { fakeFilesystem } from "./fakeFilesystem.js";

/* A library the size that used to take the app down: IMAGES pictures of
   about 300 KB each, made cheaply (one shared body, a unique head). */
const IMAGES = 200;
const BODY = "Q".repeat(300 * 1024);
const picture = (i) => `data:image/jpeg;base64,${i.toString(36).padStart(6, "0")}${BODY}`;
function library() {
  const characters = [];
  const chats = [];
  for (let i = 0; i < IMAGES; i++) {
    if (i % 2) characters.push({ id: `c${i}`, name: `Char ${i} ✨ 😀`, avatar: picture(i) });
    else chats.push({ id: `x${i}`, kind: "character", characterId: "c1", updatedAt: i, messages: [{ id: `m${i}`, role: "assistant", content: `Hello 😀 ${i}`, images: [picture(i)] }] });
  }
  const s = normalizeData({ ...structuredClone(emptyData), username: "Ana", characters, chats });
  s.settings.providers[0].key = "provider-secret";
  return s;
}

describe("streaming backups", () => {
  it("backupParts joined is makeBackup, with and without credentials", () => {
    const s = normalizeData({ ...structuredClone(emptyData), characters: [{ id: "c", name: "M", avatar: picture(1) }], chats: [{ id: "x", kind: "character", messages: [{ id: "m", content: "hi", images: [picture(2)] }] }] });
    s.settings.providers[0].key = "provider-secret";
    for (const includeCredentials of [false, true]) {
      const opts = { includeCredentials, createdAt: 1234 };
      const parts = [...backupParts(s, "3.2.0", opts)];
      expect(parts.join("")).toBe(makeBackup(s, "3.2.0", opts));
      expect(parts.join("").includes("provider-secret")).toBe(includeCredentials);
      /* the two pictures arrive as pieces of their own */
      expect(parts.filter((p) => p.includes(BODY))).toHaveLength(2);
    }
    /* the same keys, in the same order, as the single-string backup */
    expect(JSON.parse(makeBackup(s, "v", { createdAt: 5 }))).toMatchObject({ app: "nova", backup: 1, version: "v", createdAt: 5, chats: expect.any(Array), images: expect.any(Object) });
    expect(Object.keys(JSON.parse(makeBackup(s)))).toEqual(["app", "backup", "version", "createdAt", "core", "chats", "images"]);
  });

  it("writes a large library through the native writer in capped chunks and reads it back", async () => {
    const s = library();
    const fs = fakeFilesystem();
    const progress = [];
    const path = "Nova/nova-backup-test.json";
    await writeChunked(fs, path, backupParts(s, "3.2.0", { onProgress: (f) => progress.push(f) }));
    const writes = fs.calls.filter((c) => c.op === "writeFile" || c.op === "appendFile");
    const total = writes.reduce((n, c) => n + c.size, 0);
    expect(total).toBeGreaterThan(4 * WRITE_CHUNK);
    expect(writes.length).toBeGreaterThanOrEqual(Math.ceil(total / WRITE_CHUNK));
    expect(Math.max(...writes.map((c) => c.size))).toBeLessThanOrEqual(WRITE_CHUNK);
    expect(writes[0]).toMatchObject({ op: "writeFile", recursive: true, encoding: "utf8" });
    expect(writes.slice(1).every((c) => c.op === "appendFile")).toBe(true);
    /* the final name only ever appears by rename */
    expect(writes.every((c) => c.path === `${path}.part`)).toBe(true);
    expect(fs.calls.filter((c) => c.op === "rename")).toEqual([{ op: "rename", from: `${path}.part`, to: path }]);
    expect([...fs.files.keys()]).toEqual([path]);
    /* no chunk ends in half a surrogate pair */
    expect(writes.every((c) => !/[\uD800-\uDBFF]$/.test(c.data))).toBe(true);
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((f, i) => i === 0 || f >= progress[i - 1])).toBe(true);
    const { state } = readBackup(fs.files.get(path));
    expect(state.settings.providers[0].key).toBe("");
    expect(state).toEqual({ ...s, settings: { ...s.settings, providers: s.settings.providers.map((p, i) => (i ? p : { ...p, key: "" })) } });
  }, 30000);

  it("leaves neither the file nor a .part when a write fails mid-way", async () => {
    const s = library();
    const fs = fakeFilesystem({ failOn: ({ op, n }) => op === "appendFile" && n > 40 });
    const path = "Nova/nova-backup-test.json";
    await expect(writeChunked(fs, path, backupParts(s))).rejects.toThrow(/fake appendFile/);
    expect(fs.files.size).toBe(0);
    expect(fs.calls.some((c) => c.op === "rename")).toBe(false);
  }, 30000);

  it("replaces an existing file of the same name only once the new one is complete", async () => {
    const fs = fakeFilesystem({ existing: [["Nova/a.json", "old"]] });
    await writeChunked(fs, "Nova/a.json", "new");
    expect(fs.files.get("Nova/a.json")).toBe("new");
    expect(fs.files.has("Nova/a.json.part")).toBe(false);
  });

  it("splits text without breaking surrogate pairs", async () => {
    const text = "ab😀cd😀😀e".repeat(50);
    const out = [];
    for await (const c of textChunks([text.slice(0, 7), text.slice(7)], 3)) out.push(c);
    expect(out.join("")).toBe(text);
    expect(out.every((c) => c.length <= 3 && !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c))).toBe(true);
  });

  it("writes bytes as base64 chunks on 3-byte boundaries that append to the same bytes", async () => {
    const bytes = new Uint8Array(30_001).map((_, i) => (i * 7919) & 0xff);
    const fs = fakeFilesystem();
    const seen = [];
    await writeChunked(fs, "Nova/card.png", bytes, { chunk: 1024, onProgress: (f) => seen.push(f) });
    const writes = fs.calls.filter((c) => c.op === "writeFile" || c.op === "appendFile");
    expect(writes.length).toBeGreaterThan(20);
    expect(writes.every((c) => c.encoding === undefined && c.size <= 1024)).toBe(true);
    expect(writes.slice(0, -1).every((c) => !c.data.includes("="))).toBe(true);
    const back = Uint8Array.from(fs.files.get("Nova/card.png"), (ch) => ch.charCodeAt(0));
    expect(back).toEqual(bytes);
    expect(seen.at(-1)).toBe(1);
  });

  it("saveFile on the phone uses the chunked writer and still says where the file went", async () => {
    const fs = fakeFilesystem();
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => true, Plugins: { Filesystem: fs } } });
    try {
      expect(await saveFile("x.json", ["{", "\"a\":1", "}"], "application/json")).toBe("Documents/Nova/x.json");
      expect(fs.files.get("Nova/x.json")).toBe("{\"a\":1}");
      expect(await saveFile("y.json", "", "application/json", { folder: "Nova/Daily" })).toBe("Documents/Nova/Daily/y.json");
      expect(fs.files.get("Nova/Daily/y.json")).toBe("");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("PNG cards with big text chunks", () => {
  const PNG = b64ToBytes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");

  it("reads a 1 MB card chunk (a card with a large lorebook)", () => {
    const entries = Array.from({ length: 2000 }, (_, i) => ({ keys: [`k${i}`], content: `Lore ${i} ${"x".repeat(500)}`, enabled: true }));
    const card = { spec: "chara_card_v2", data: { name: "Mira", description: "d", first_mes: "hi", character_book: { name: "Mira", entries } } };
    const value = bytesToB64(utf8.encode(JSON.stringify(card)));
    expect(value.length).toBeGreaterThan(1024 * 1024);
    const png = pngWithText(PNG, "chara", value);
    const read = pngTextChunks(png).chara;
    expect(read).toBe(value);
    const fields = cardFields(JSON.parse(new TextDecoder().decode(b64ToBytes(read))));
    expect(fields.character_book.entries).toHaveLength(2000);
    /* and re-exporting replaces it rather than stacking a second */
    expect(pngWithText(png, "chara", value).length).toBe(png.length);
  });
});
