import { describe, expect, it } from "vitest";
import { b64ToBytes, bytesToB64, cardFields, characterFromCard, pngTextChunks, pngWithText, utf8 } from "../src/lib/cards.js";

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

  it("reads and replaces the card chunk in a PNG", () => {
    const value = bytesToB64(utf8.encode(JSON.stringify(v2)));
    const once = pngWithText(PNG, "chara", value);
    const twice = pngWithText(once, "chara", value);
    expect(pngTextChunks(twice).chara).toBe(value);
    expect(twice.length).toBe(once.length);
  });
});
