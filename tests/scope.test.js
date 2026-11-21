import { describe, expect, it } from "vitest";
import {
  CONTINUE_MARK, NOT_A_PERSON, cardCastText, cardScanRequest, describeRequest, dropCharacter, ensembleOf, ensembleTitle, linkedCards, newFromCard, parseCardCast, findSideCharacters, scopeCandidates, scopeNote, scopeOf, takeContinue,
} from "../src/lib/scope.js";

const msg = (content, role = "assistant") => ({ role, content });

describe("Scope input limits", () => {
  it("retains 20 cast entries and names up to 60 characters", () => {
    const rows = [{ name: "A".repeat(61) }, { name: "B".repeat(60) }, ...Array.from({ length: 24 }, (_, i) => ({ name: `Person ${i}` }))];
    const cast = parseCardCast(JSON.stringify(rows));
    expect(cast).toHaveLength(20);
    expect(cast[0].name).toHaveLength(60);
    expect(cast.at(-1).name).toBe("Person 18");
    expect(cast.some(c => c.name.length > 60)).toBe(false);
  });
  it("scans up to 24000 characters of character and universe cards", () => {
    for (const card of [{ description: "x".repeat(25000) }, { story: "x".repeat(25000) }]) {
      expect(cardCastText(card)).toHaveLength(24000);
      expect(cardCastText(card, { limit: 120 })).toHaveLength(120);
    }
  });
});

describe("finding side characters", () => {
  it("finds names mentioned mid-sentence, not words that only start sentences", () => {
    const found = findSideCharacters([
      msg("*Mira glances at the door.* Then Elena walks in, shaking rain off her coat."),
      msg("The bartender nods at Elena. Outside, Marcus is still waiting in the car."),
      msg("Then the lights flicker. Marcus honks twice."),
    ], ["Mira", "Ana"]);
    expect(found).toContain("Elena");
    expect(found).toContain("Marcus");
    expect(found).not.toContain("Then");
    expect(found).not.toContain("Mira");
  });

  it("ignores days, titles and one-off mentions", () => {
    const found = findSideCharacters([
      msg("We leave on Monday, said the Captain. Ask Doctor Reyes."),
      msg("By Monday the Captain had changed his mind."),
    ], []);
    expect(found).toEqual([]);
  });

  it("waits for the threshold before offering anyone", () => {
    const two = [msg("He looks at Elena."), msg("Elena shrugs.")];
    expect(findSideCharacters(two, [], { threshold: 3 })).toEqual([]);
    expect(findSideCharacters([...two, msg("Then he asks Elena again.")], [], { threshold: 3 })).toEqual(["Elena"]);
  });

  it("does not offer anyone already in the cast or dismissed", () => {
    const chat = {
      scope: { mode: "manual", threshold: 2, cast: [{ id: "a", name: "Elena" }], dismissed: ["Harbor"] },
      messages: [msg("He waves at Elena and Tobias near the Harbor."), msg("Tobias laughs at Elena by the Harbor.")],
    };
    expect(scopeCandidates(chat, { name: "Mira" }, "Ana")).toEqual(["Tobias"]);
  });
});

describe("scope settings", () => {
  it("is off for a chat that never had it", () => {
    expect(scopeOf({}).mode).toBe("off");
    expect(scopeOf({ scope: { mode: "weird" } }).mode).toBe("off");
    expect(scopeOf({ scope: { mode: "auto" } }).cast).toEqual([]);
  });
});

describe("the scope prompt", () => {
  const scope = scopeOf({ scope: { mode: "auto", carry: true, cast: [{ id: "a", name: "Elena", description: "The bartender." }] } });

  it("lists the cast, keeps people where they are, and keeps the user out", () => {
    const n = scopeNote({ scope, character: { name: "Mira" }, userName: "Ana" });
    expect(n).toContain("Elena: The bartender.");
    expect(n).toContain("physically present");
    expect(n).toContain("Nobody butts in");
    expect(n).toContain("Never write Ana's words");
    expect(n).toContain(CONTINUE_MARK);
  });

  it("says nothing about playing on when that is off", () => {
    const n = scopeNote({ scope: { ...scope, carry: false }, character: { name: "Mira" }, userName: "Ana" });
    expect(n).not.toContain(CONTINUE_MARK);
  });

  it("takes the continue mark out of a reply", () => {
    expect(takeContinue("Fine.\n[[continue]]")).toEqual({ text: "Fine.", cont: true });
    expect(takeContinue("Fine.")).toEqual({ text: "Fine.", cont: false });
  });

  it("asks for a description that can say the name is not a person", () => {
    const r = describeRequest({ name: "Elena", messages: [msg("Elena pours a drink."), msg("Nothing here.")], charName: "Mira", userName: "Ana" });
    expect(r.user).toContain("Elena pours a drink.");
    expect(r.user).not.toContain("Nothing here.");
    expect(r.system).toContain(NOT_A_PERSON);
  });
});

describe("Scope with several of your characters, and in universes", () => {
  const scope = { mode: "auto", carry: true, turns: 3, cast: [{ id: "t", name: "Tom", characterId: "tom", description: "" }, { id: "r", name: "Rook", description: "A guard." }] };
  const tom = { id: "tom", name: "Tom", description: "A smith." };
  it("lists linked members as having their card above, and voices them with the host", () => {
    const n = scopeNote({ scope, character: { id: "mira", name: "Mira" }, ensemble: [tom], userName: "Ana" });
    expect(n).toContain("You voice Mira, Tom and everyone else in the scene.");
    expect(scopeNote({ scope, character: { name: "Mira" }, userName: "Ana" })).toContain("[Nova Scope. You voice Mira and everyone else in the scene. The other people");
    expect(n).toContain("- Tom (card above)");
    expect(n).not.toContain("A smith.");
    expect(n).toContain("- Rook: A guard.");
    expect(n).toContain("begin each one's part with **Name:** on its own line");
    expect(n).not.toContain("Each part holds only that person");
    expect(n).not.toContain("turns of their own");
    expect(n).toContain(CONTINUE_MARK);
  });
  it("names who leads this reply, once, and leaves the others free to react", () => {
    const n = scopeNote({ scope, character: { name: "Mira" }, ensemble: [tom], userName: "Ana", lead: { name: "Tom" } });
    expect(n).toContain("- Tom leads this reply");
    expect(n).toContain("Others who are present may react");
    expect(scopeNote({ scope, character: { name: "Mira" }, userName: "Ana" })).not.toContain("leads this reply");
    expect(scopeNote({ scope, universe: { name: "Vale" }, userName: "Ana", lead: { narrator: true } })).toContain("world narration only");
  });
  it("tells a universe about its side characters", () => {
    const n = scopeNote({ scope, universe: { name: "Vale" }, userName: "Ana" });
    expect(n).toContain("You voice the world of Vale");
    expect(n).toContain("Narration that belongs to nobody in particular needs no label");
  });
  it("reads a universe, or the host with every linked card, for the cast, never offering a lead", () => {
    const u = { name: "Vale", story: "Old Brannoc keeps the inn.", characters: [{ name: "Elder", description: "Leads the village." }] };
    const r = cardScanRequest({ universe: u, userName: "Ana" });
    expect(r.user).toContain("Old Brannoc keeps the inn.");
    expect(r.system).toContain("other than Elder");
    const g = cardScanRequest({ character: { name: "Mira", description: "Sister of Tobias." }, ensemble: [tom], userName: "Ana" });
    expect(g.user).toContain("=== Mira ===");
    expect(g.user).toContain("=== Tom ===");
    expect(g.system).toContain("other than Mira and Tom");
    expect(newFromCard([{ name: "Tom" }, { name: "Tobias" }], { cast: [], dismissed: [] }, ["Mira", "Tom"], "Ana").map((f) => f.name)).toEqual(["Tobias"]);
    expect(scopeCandidates({ messages: [msg("Then Tom and Brannoc talk."), msg("Later Brannoc and Tom leave."), msg("So Brannoc waits.")] }, ["Mira", "Tom"], "Ana")).toEqual(["Brannoc"]);
  });
});

describe("linked members", () => {
  const mira = { id: "mira", name: "Mira", tagline: "Night-market trader.", description: "Runs the market." };
  const tom = { id: "tom", name: "Tom", description: "A smith." };
  const ivy = { id: "ivy", name: "Ivy" };
  const library = [mira, tom, ivy];
  const cast = [
    { id: "a", name: "Tom", characterId: "tom", description: "" },
    { id: "b", name: "Rook", description: "A guard." },
    { id: "c", name: "Ghost", characterId: "gone", description: "Was here." },
    { id: "d", name: "Tom again", characterId: "tom", description: "" },
    { id: "e", name: "Ivy", characterId: "ivy", description: "" },
    { id: "f", name: "Mira", characterId: "mira", description: "" },
  ];

  it("gives the live cards in cast order, once each, never a deleted one or the host", () => {
    expect(linkedCards({ cast }, library, "mira")).toEqual([tom, ivy]);
    expect(linkedCards({ cast }, [mira], "mira")).toEqual([]);
    expect(linkedCards({}, library)).toEqual([]);
  });

  it("sends them only with Scope on, and never in a universe", () => {
    const chat = { kind: "character", characterId: "mira", scope: { mode: "manual", cast } };
    expect(ensembleOf(chat, library)).toEqual([tom, ivy]);
    expect(ensembleOf({ ...chat, scope: { ...chat.scope, mode: "off" } }, library)).toEqual([]);
    expect(ensembleOf({ ...chat, kind: "universe" }, library)).toEqual([]);
  });

  it("names a chat after its people", () => {
    expect(ensembleTitle([mira])).toBe("Mira");
    expect(ensembleTitle([mira, tom, ivy])).toBe("Mira, Tom, Ivy");
    expect(ensembleTitle([mira, tom, ivy, { name: "Rook" }])).toBe("Mira, Tom +2");
    expect(ensembleTitle([])).toBe("");
  });

  describe("when a card is deleted", () => {
    const chat = {
      id: "c1", kind: "character", characterId: "mira", greetingId: "g1",
      scope: { mode: "manual", cast: [{ id: "a", name: "Tom", characterId: "tom", description: "" }, { id: "b", name: "Rook", description: "A guard." }] },
      messages: [
        { id: "m1", role: "assistant", content: "Hello." },
        { id: "m2", role: "user", content: "Hi." },
        { id: "m3", role: "assistant", content: "Hm.", speaker: "Tom", speakerId: "tom" },
      ],
    };

    it("hands the chat to the next linked character when the host goes", () => {
      const next = dropCharacter(chat, "mira", library);
      expect(next.characterId).toBe("tom");
      expect(next.greetingId).toBe("");
      expect(next.scope.cast.some((m) => m.characterId === "tom")).toBe(false);
      /* the old host stays on as a side character, and keeps its replies */
      const was = next.scope.cast.find((m) => m.name === "Mira");
      expect(was.characterId).toBeUndefined();
      expect(was.description).toBe("Night-market trader. Runs the market.");
      expect(next.messages[0].speaker).toBe("Mira");
      expect(next.messages[2]).toBe(chat.messages[2]);
      expect(next.scope.cast.find((m) => m.name === "Rook").description).toBe("A guard.");
    });

    it("unlinks a member whose card goes, keeping a snapshot of it", () => {
      const next = dropCharacter(chat, "tom", library);
      expect(next.characterId).toBe("mira");
      const t = next.scope.cast.find((m) => m.id === "a");
      expect(t.characterId).toBeUndefined();
      expect(t.description).toBe("A smith.");
      expect(next.messages).toBe(chat.messages);
    });

    it("deletes only a chat with no character left, and leaves other chats alone", () => {
      expect(dropCharacter({ ...chat, scope: { mode: "manual", cast: [] } }, "mira", library)).toBeNull();
      expect(dropCharacter(chat, "mira", [mira])).toBeNull();
      expect(dropCharacter(chat, "ivy", library)).toBe(chat);
      const uni = { kind: "universe", universeId: "u" };
      expect(dropCharacter(uni, "mira", library)).toBe(uni);
    });
  });
});

describe("reading the card for its cast", () => {
  const mira = {
    name: "Mira", description: "Mira runs the night market with her brother Tobias.",
    greetings: [{ text: "Elena waves from the bar, {{user}}." }],
    lorebook: { entries: [{ keys: ["Vale"], content: "Captain Vale hunts thieves.", enabled: true }] },
  };
  it("sends everything on the card that can name someone", () => {
    const r = cardScanRequest({ character: mira, userName: "Ana" });
    expect(r.user).toContain("brother Tobias");
    expect(r.user).toContain("Elena waves");
    expect(r.user).toContain("Captain Vale");
    expect(r.system).toContain("JSON array");
  });
  it("reads the list leniently", () => {
    expect(parseCardCast('```json\n[{"name":"Tobias","description":"Her brother."}]\n```')).toEqual([{ name: "Tobias", description: "Her brother." }]);
    expect(parseCardCast('{"people":[{"name":"Elena"}]}')).toEqual([{ name: "Elena", description: "" }]);
    expect(parseCardCast("nobody here")).toEqual([]);
  });
  it("adds only people who are new, never the card's character or the user", () => {
    const scope = scopeOf({ scope: { mode: "auto", cast: [{ id: "a", name: "Elena" }], dismissed: ["Vale"] } });
    const found = [{ name: "Mira" }, { name: "Ana" }, { name: "Elena" }, { name: "Vale" }, { name: "Tobias" }, { name: "{{user}}" }];
    expect(newFromCard(found, scope, mira, "Ana").map((f) => f.name)).toEqual(["Tobias"]);
  });
});

describe("who speaks in a reply", () => {
  it("reads the **Name:** labels in order, each once", async () => {
    const { replySpeakers } = await import("../src/lib/scope.js");
    expect(replySpeakers("**Mira:** Hi.\n\n**Tom:** Hey.\n**Mira:** Again.")).toEqual(["Mira", "Tom"]);
    expect(replySpeakers("Just Mira talking, **bold:** in the middle")).toEqual([]);
    expect(replySpeakers("")).toEqual([]);
  });
});
