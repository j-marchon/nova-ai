#!/usr/bin/env node
/* A stand-in for the Claude Code CLI, for the Bridge's tests. `auth status`
   says it is signed in; print mode logs what it was given (model, system
   prompt, stdin, its pid) to FAKE_CLAUDE_LOG and answers from the scenario
   in FAKE_CLAUDE_SCENARIO: { deltas, stop, usage, error, hang, die }. */
import fs from "node:fs";
const args = process.argv.slice(2);
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" }));
  process.exit(0);
}
const opt = (name) => args[args.indexOf(name) + 1];
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { input += c; });
process.stdin.on("end", async () => {
  const scenario = JSON.parse(fs.readFileSync(process.env.FAKE_CLAUDE_SCENARIO, "utf8"));
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ pid: process.pid, model: opt("--model"), system: fs.readFileSync(opt("--system-prompt-file"), "utf8"), prompt: input, args }) + "\n");
  const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  out({ type: "system", subtype: "init" });
  for (const text of scenario.deltas || []) out({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  if (scenario.hang) { setInterval(() => {}, 1000); return; }
  if (scenario.die) process.exit(1);
  out({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: scenario.stop || "end_turn" } } });
  out(scenario.error
    ? { type: "result", subtype: "error", is_error: true, result: scenario.error }
    : { type: "result", subtype: "success", is_error: false, usage: scenario.usage || { input_tokens: 1, output_tokens: 1 } });
});
