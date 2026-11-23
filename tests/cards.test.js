import { describe, expect, it } from "vitest";
import { b64ToBytes, bytesToB64, cardFields, characterCardJson, characterFromCard, pngTextChunks, pngWithText, utf8 } from "../src/lib/cards.js";

import { DESCRIPTION, PERSONALITY, dialogueEntries, dialogueText, profileSections, profileText } from "../src/lib/characterTemplate.js";

/* the smallest valid PNG: 1x1, one IDAT, IEND */
const PNG = b64ToBytes(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
);

describe("character cards", () => {
  const v2 = {
    spec: "chara_card_v2",
    data: {
      name: "Mira",
      description: "<BOT> is a thief.",
      first_mes: "Hi <USER>.",
      alternate_greetings: ["Second."],
      system_prompt: "{{original}} Run a heist.",
      post_history_instructions: "Stay sarcastic.",
      mes_example: "<START>\n{{char}}: Hm.",
    },
  };

  it("keeps the card's own instructions", () => {
    const ch = characterFromCard(cardFields(v2), "", null, "");
    expect(ch.systemPrompt).toBe("{{original}} Run a heist.");
    expect(ch.postHistoryInstructions).toBe("Stay sarcastic.");
    expect(ch.description).toBe("{{char}} is a thief.");
    expect(ch.greetings.map((g) => g.text)).toEqual(["Hi {{user}}.", "Second."]);
  });

  it("opens the builder's Markdown in the corresponding advanced fields", () => {
    const desc = "# {{char}}'s Profile\n\nPrivate note.\n\n**Appearance:**\nOil on his cuff.\n\n**How I Operate:**\n\n*The Way I Talk:* Slowly.";
    const drives = "## My Personality & What Drives Me\n\n*   **Likes:**\n    - Clocks\n    - Rain\n\n*   **Goals:**\n*   **Short-Term:** Get home.\n*   **Long-Term:** Stay there.";
    expect(profileSections(DESCRIPTION, desc)).toEqual({ notes: "Private note.", appearance: "Oil on his cuff.", talk: "Slowly." });
    const personality = { likes: ["Clocks", "Rain"], shortGoals: "Get home.", longGoals: "Stay there." };
    expect(profileSections(PERSONALITY, drives)).toEqual(personality);
    expect(profileSections(PERSONALITY, profileText(PERSONALITY, personality))).toEqual(personality);
    expect(profileSections(PERSONALITY, "Old freeform personality.")).toEqual({ notes: "Old freeform personality." });
  });

  it("round-trips playable fields, dialogue boundaries, and imported metadata through V2 JSON", () => {
    const dialogue = ["Only on Tuesdays.", "{{user}}: Why?\n{{char}}: It's my day off."];
    const imported = { ...v2.data, personality: "Old freeform text.", scenario: "The ferry is late.",
      tags: ["harbor"], creator: "AJ", character_version: "2b", mes_example: dialogueText(dialogue) };
    const ch = characterFromCard(cardFields(imported), "", null, "");
    ch.tagline = "The last crossing";
    ch.greetings[0].label = "Night";
    const exported = characterCardJson(ch);
    expect(exported.data).toMatchObject({ personality: imported.personality, scenario: imported.scenario, tags: ["harbor"],
      creator: "AJ", character_version: "2b", mes_example: imported.mes_example, alternate_greetings: ["Second."] });
    expect(dialogueEntries(ch.exampleDialogs)).toEqual(dialogue);
    const reopened = characterFromCard(cardFields(exported), "", null, "");
    expect(reopened.tagline).toBe(ch.tagline);
    expect(reopened.greetings[0].label).toBe("Night");
  });

  it("reads and replaces the card chunk in a PNG", () => {
    const value = bytesToB64(utf8.encode(JSON.stringify(v2)));
    const once = pngWithText(PNG, "chara", value);
    const twice = pngWithText(once, "chara", value);
    expect(pngTextChunks(twice).chara).toBe(value);
    expect(twice.length).toBe(once.length);
  });
});
