// @vitest-environment jsdom
/* Before/after timings for the src/lib speed-ups: `npx vitest bench --run`.
   "old" is the copy in tests/legacy/, "new" is src/lib. Inputs come from
   tests/legacy/gen.js, the same ones libPerf.test.js checks for equality. */
import { bench, describe } from "vitest";
import { selectLore } from "../src/lib/lore.js";
import { searchRelevantContext } from "../src/lib/rag.js";
import { displayHtml } from "../src/lib/html.js";
import { breakdownTokens, estimateTokens } from "../src/lib/tokens.js";
import { tavernRegex } from "../src/lib/tavern.js";
import * as oldLore from "./legacy/lore.js";
import * as oldRag from "./legacy/rag.js";
import * as oldHtml from "./legacy/html.js";
import * as oldTokens from "./legacy/tokens.js";
import { history, lorebooks, scopeReplies } from "./legacy/gen.js";

const HISTORY = history(1000);
const BOOKS = lorebooks(300);
const REPLIES = scopeReplies(80);
const OPTS = { time: 1500 };

describe("selectLore, 300 entries over a 1,000-message chat", () => {
  bench("old", () => { oldLore.selectLore(BOOKS, HISTORY, { depth: 10, budget: 3000 }); }, OPTS);
  bench("new", () => { selectLore(BOOKS, HISTORY, { depth: 10, budget: 3000 }); }, OPTS);
});

describe("recall over 900 older messages", () => {
  const older = HISTORY.slice(0, 900);
  const query = HISTORY[999].content;
  bench("old", () => { oldRag.searchRelevantContext(query, older); }, OPTS);
  bench("new", () => { searchRelevantContext(query, older); }, OPTS);
});

describe("displayHtml, 60 bubbles redrawn", () => {
  const rules = tavernRegex([
    { scriptName: "Color", findRegex: "/<(pink|teal)>([\"“][^\"”]+[\"”])<\\/\\1>/gi", replaceString: "<span style=\"color:$1;\">$2</span>", placement: [2], markdownOnly: true },
  ], "display");
  const texts = [...REPLIES.slice(0, 20), ...HISTORY.slice(0, 40).map((m) => m.content)];
  bench("old", () => { for (const t of texts) oldHtml.displayHtml(t, rules, "assistant", 0); }, OPTS);
  bench("new", () => { for (const t of texts) displayHtml(t, rules, "assistant", 0); }, OPTS);
});

describe("estimateTokens, 1,000 messages", () => {
  const texts = HISTORY.map((m) => m.content);
  bench("old", () => { for (const t of texts) oldTokens.estimateTokens(t); }, OPTS);
  bench("new", () => { for (const t of texts) estimateTokens(t); }, OPTS);
});

describe("breakdownTokens, 1,000 messages and 300 lore entries", () => {
  const args = {
    character: { name: "Mira", description: "A smuggler.", personality: "Dry.", exampleDialogs: "<START>\n{{char}}: Quiet." },
    persona: { name: "Rowan", description: "A courier." },
    lorebooks: BOOKS,
    authorsNote: { text: "Keep it tense.", interval: 1 },
    memory: { summary: "Earlier, they crossed the Old Road.", lastId: "m400" },
    scene: { text: "Night, the Lantern Guild hall." },
    history: HISTORY,
    maxTokens: 16000,
    settings: { historyTokens: 12000, loreDepth: 6, loreBudget: 3000 },
  };
  bench("old", () => { oldTokens.breakdownTokens(args); }, OPTS);
  bench("new", () => { breakdownTokens(args); }, OPTS);
});
