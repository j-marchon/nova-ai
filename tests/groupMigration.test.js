/* Group chats from before 3.2 become character chats with Nova Scope
   (data.js fromGroupChat): in saved data, in an old backup, and in an
   exported chat file. */
import { describe, expect, it } from "vitest";
import { emptyData, fromGroupChat, normalizeData } from "../src/lib/data.js";
import { makeBackup, readBackup } from "../src/lib/backup.js";
import { chatFromImport, chatToJsonl, readChatJsonl } from "../src/lib/chatFile.js";

const mira = { id: "c1", name: "Mira" };
const tom = { id: "c2", name: "Tom" };
const ivy = { id: "c3", name: "Ivy" };

const group = (extra = {}) => ({
  id: "g", kind: "group", memberIds: ["c1", "c2", "c3"], name: "The Crew", personaId: "",
  theme: { aiBubble: "#123456" }, createdAt: 1, updatedAt: 2,
  messages: [
    { id: "m1", role: "assistant", content: "Evening.", speaker: "Mira", speakerId: "c1" },
    { id: "m2", role: "user", content: "Hi both." },
    { id: "m3", role: "assistant", content: "Hey.", speaker: "Tom", speakerId: "c2" },
  ],
  ...extra,
});

const library = (chats, characters = [mira, tom, ivy]) => ({ ...JSON.parse(JSON.stringify(emptyData)), characters, chats });

describe("a group chat from before 3.2", () => {
  it("becomes a character chat hosted by its first member, the others linked in the Scope cast", () => {
    const [c] = normalizeData(library([group()])).chats;
    expect(c.kind).toBe("character");
    expect(c.characterId).toBe("c1");
    expect(c.title).toBe("The Crew");
    expect(c.scope.mode).toBe("manual");
    expect(c.scope.cast.map((m) => [m.name, m.characterId, m.description])).toEqual([["Tom", "c2", ""], ["Ivy", "c3", ""]]);
    for (const k of ["memberIds", "name", "theme"]) expect(c).not.toHaveProperty(k);
    /* who said what is kept */
    expect(c.messages.map((m) => [m.speaker, m.speakerId])).toEqual([["Mira", "c1"], [undefined, undefined], ["Tom", "c2"]]);
  });

  it("keeps the cast and Scope mode it had, without linking anyone twice", () => {
    const scope = { mode: "auto", carry: false, cardScanned: true, cast: [{ id: "r", name: "Rook", description: "A guard." }, { id: "t", name: "Tom", characterId: "c2", description: "" }, { id: "h", name: "Mira", characterId: "c1", description: "" }] };
    const [c] = normalizeData(library([group({ scope })])).chats;
    expect(c.scope.mode).toBe("auto");
    expect(c.scope.carry).toBe(false);
    expect(c.scope.cardScanned).toBe(true);
    expect(c.scope.cast.map((m) => m.name)).toEqual(["Ivy", "Rook", "Tom"]);
  });

  it("skips members whose card is gone, and is named after the members without a name", () => {
    const [c] = normalizeData(library([group({ name: "", memberIds: ["gone", "c2", "c3"] })])).chats;
    expect(c.characterId).toBe("c2");
    expect(c.scope.cast.map((m) => m.characterId)).toEqual(["c3"]);
    expect(c.title).toBe("Tom, Ivy");
    /* nobody left at all: still a chat, with the first id, as any chat whose card was deleted */
    const [lone] = normalizeData(library([group({ memberIds: ["gone"] })], [])).chats;
    expect(lone).toMatchObject({ kind: "character", characterId: "gone", title: "The Crew" });
    const [empty] = normalizeData(library([group({ memberIds: "broken", name: undefined })])).chats;
    expect(empty).toMatchObject({ kind: "character", characterId: "" });
  });

  it("keeps a title the chat already had", () => {
    expect(fromGroupChat(group({ title: "Branch" }), [mira, tom]).title).toBe("Branch");
  });

  it("changes nothing the second time", () => {
    const once = normalizeData(library([group(), { id: "k", kind: "character", characterId: "c1", messages: [] }]));
    expect(normalizeData(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(fromGroupChat(once.chats[0], [mira])).toBe(once.chats[0]);
  });

  it("imports from an old backup", () => {
    const old = library([group()]);
    const { state } = readBackup(makeBackup(old, "3.1.0"));
    expect(state.chats[0]).toMatchObject({ kind: "character", characterId: "c1", title: "The Crew" });
    expect(state.chats[0].scope.cast.map((m) => m.characterId)).toEqual(["c2", "c3"]);
  });

  it("imports from an exported chat file, finding its cards from who spoke", () => {
    const file = chatToJsonl(group(), { user: "Ana", char: "The Crew" });
    const parsed = readChatJsonl(file);
    expect(parsed.kind).toBe("group");
    const c = chatFromImport(parsed, [mira, tom, ivy]);
    expect(c).toMatchObject({ kind: "character", characterId: "c1", title: "The Crew" });
    expect(c.scope.cast.map((m) => m.characterId)).toEqual(["c2"]);
    expect(c.messages.map((m) => m.speaker)).toEqual(["Mira", undefined, "Tom"]);
    expect(chatFromImport(parsed, [ivy])).toBeNull();
  });
});
