/* Claude, through the Claude Code CLI on this computer.

   The Bridge never touches Claude's sign-in itself: it runs the official
   `claude` program the user is signed in to, in print mode, and reads its
   stream. Nova's system prompt replaces Claude Code's own (a file, so a long
   one fits any command line), every tool is off, no settings, hooks, MCP
   servers or CLAUDE.md are loaded, and nothing is saved to the user's
   Claude Code history. The conversation goes in on stdin.

   The user is warned in the Bridge window before connecting: Anthropic's
   terms only cover a Pro/Max plan inside Claude Code and claude.ai, so
   using it from another app can get the account limited or banned. */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const WIN = process.platform === "win32";
/* model aliases the CLI itself resolves to the newest of each family */
export const CLAUDE_MODELS = [
  { id: "opus", name: "Claude Opus" },
  { id: "sonnet", name: "Claude Sonnet" },
  { id: "haiku", name: "Claude Haiku" },
];
const MODEL_OK = /^[a-z0-9][a-z0-9.\-[\]]{0,63}$/i;
const MAX_AT_ONCE = 2;
let running = 0;

/* A GUI-launched Bridge often has a short PATH (no ~/.local/bin), so the
   usual install places are tried too. On Windows only a real .exe: a .cmd
   shim would need a shell, and a shell would parse the arguments. */
export function claudeBinary(env = process.env) {
  if (env.NOVA_BRIDGE_CLAUDE_BIN && fs.existsSync(env.NOVA_BRIDGE_CLAUDE_BIN)) return env.NOVA_BRIDGE_CLAUDE_BIN;
  const home = os.homedir();
  const names = WIN ? ["claude.exe"] : ["claude"];
  const dirs = [
    ...String(env.PATH || env.Path || "").split(path.delimiter),
    path.join(home, ".local", "bin"),
    path.join(home, ".claude", "local"),
    ...(WIN
      ? [path.join(env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Programs", "claude"), path.join(env.LOCALAPPDATA || "", "AnthropicClaude")]
      : ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"]),
  ].filter(Boolean);
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      try { if (fs.statSync(file).isFile()) return file; } catch {}
    }
  }
  return null;
}

/* The CLI refuses to start inside another Claude Code session, and must not
   pick up a session's settings: those variables are left out. */
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) delete env[k];
  return env;
}

function run(args, { input, signal, timeout = 0, onLine } = {}) {
  const bin = claudeBinary();
  if (!bin) return Promise.reject(Object.assign(new Error("Claude Code is not installed on this computer."), { status: 503 }));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: scratch(), env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "", err = "", buf = "", done = false;
    const finish = (fn) => { if (!done) { done = true; clearTimeout(timer); signal?.removeEventListener?.("abort", stop); fn(); } };
    const stop = () => { try { child.kill(); } catch {} finish(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))); };
    const timer = timeout ? setTimeout(() => { try { child.kill(); } catch {} finish(() => reject(new Error("Claude Code did not answer."))); }, timeout) : null;
    if (signal?.aborted) return stop();
    signal?.addEventListener?.("abort", stop, { once: true });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      if (!onLine) { out += c; return; }
      buf += c;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) if (line.trim()) onLine(line);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c) => { if (err.length < 4000) err += c; });
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", (code) => {
      if (onLine && buf.trim()) onLine(buf);
      finish(() => resolve({ code, out, err }));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

/* an empty folder to run in, so no project's CLAUDE.md or settings apply */
let scratchDir = null;
function scratch() {
  if (scratchDir && fs.existsSync(scratchDir)) return scratchDir;
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-bridge-claude-"));
  return scratchDir;
}

let statusCache = null;
/* { installed, loggedIn, plan, email }; cached for a minute */
export async function claudeStatus({ fresh = false } = {}) {
  if (!fresh && statusCache && Date.now() - statusCache.at < 60000) return statusCache.value;
  let value;
  if (!claudeBinary()) value = { installed: false, loggedIn: false };
  else {
    try {
      const { out } = await run(["auth", "status"], { timeout: 15000 });
      const s = JSON.parse(out);
      value = { installed: true, loggedIn: !!s.loggedIn && s.authMethod === "claude.ai", plan: s.subscriptionType || s.planTier || "", email: s.email || "" };
    } catch {
      value = { installed: true, loggedIn: false };
    }
  }
  statusCache = { at: Date.now(), value };
  return value;
}

/* Claude Code's own sign-in: it opens the browser and waits for claude.ai
   to send the code back. Resolves once it has finished. */
let login = null;
/* `onUrl` gets the sign-in address Claude Code prints, for when the browser
   it opens does not come up */
export function claudeLogin({ onUrl } = {}) {
  if (login) return login;
  login = run(["auth", "login", "--claudeai"], {
    timeout: 10 * 60000,
    onLine(line) {
      const url = line.match(/https:\/\/claude\.(ai|com)\/\S+/)?.[0];
      if (url) onUrl?.(url);
    },
  })
    .then(async ({ code, err }) => {
      const s = await claudeStatus({ fresh: true });
      if (!s.loggedIn) throw new Error(code ? (err.trim().split("\n").pop() || "Claude sign-in did not finish.") : "Claude sign-in did not finish.");
      return s;
    })
    .finally(() => { login = null; });
  return login;
}

/* One reply. `system` and `prompt` are plain text; `emit` gets
   { content } / { reasoning } / { usage, finishReason } as they arrive. */
export async function claudeChat({ system, prompt, model, signal, emit, open }) {
  if (!MODEL_OK.test(model)) throw Object.assign(new Error(`Unknown Claude model: ${model}`), { status: 400 });
  if (running >= MAX_AT_ONCE) throw Object.assign(new Error("Claude is already writing two replies. Try again in a moment."), { status: 429 });
  running++;
  const sysFile = path.join(scratch(), `system-${crypto.randomUUID()}.txt`);
  fs.writeFileSync(sysFile, system || "You are a helpful assistant.", { mode: 0o600 });
  let opened = false, failed = null, usage = null, finishReason = null, finished = false;
  try {
    const { code, err } = await run([
      "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      "--model", model, "--system-prompt-file", sysFile,
      "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
    ], {
      input: prompt,
      signal,
      onLine(line) {
        let d;
        try { d = JSON.parse(line); } catch { return; }
        if (d.type === "stream_event") {
          const e = d.event || {};
          if (e.type === "content_block_delta") {
            if (!opened) { opened = true; open(); }
            if (e.delta?.type === "text_delta" && e.delta.text) emit({ content: e.delta.text });
            else if (e.delta?.type === "thinking_delta" && e.delta.thinking) emit({ reasoning: e.delta.thinking });
          } else if (e.type === "message_delta" && e.delta?.stop_reason) {
            finishReason = e.delta.stop_reason === "max_tokens" ? "length" : "stop";
          }
        } else if (d.type === "result") {
          finished = true;
          if (d.is_error || d.subtype !== "success") failed = String(d.result || d.error || "Claude could not answer.").slice(0, 300);
          const u = d.usage || {};
          usage = { prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), completion_tokens: u.output_tokens || 0 };
        }
      },
    });
    if (failed) throw Object.assign(new Error(failed), { status: /limit|quota/i.test(failed) ? 429 : 502 });
    /* it stopped without saying it was done: a reply cut off, not a short one */
    if (!finished) throw Object.assign(new Error(err.trim().split("\n").pop() || "Claude Code stopped before finishing."), { status: 502 });
    if (!opened) open();
    emit({ usage, finishReason: finishReason || "stop" });
  } finally {
    running--;
    fs.rmSync(sysFile, { force: true });
  }
}
