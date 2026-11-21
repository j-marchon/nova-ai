/* ---------- Interactive Slash Commands Engine ----------
   Command interpreter for Nova roleplay and chat.
   Parses and executes commands starting with "/" such as /help, /roll,
   /sendas, /impersonate, /continue, /note, /setvar, /getvar, /think, /clear, /branch. */

import { rollDice } from "./macros.js";

export const SLASH_COMMANDS = [
  {
    name: "help",
    syntax: "/help",
    description: "List available commands and descriptions",
  },
  {
    name: "roll",
    syntax: "/roll <dice>",
    description: "Roll dice (e.g. /roll 1d20+5, /roll 2d6, /roll d100)",
  },
  {
    name: "sendas",
    syntax: "/sendas <speaker> <message>",
    description: "Send message as a specific speaker",
  },
  {
    name: "impersonate",
    syntax: "/impersonate [guidance]",
    description: "Generate the next reply as your persona",
  },
  {
    name: "continue",
    syntax: "/continue",
    description: "Continue scene or assistant reply",
  },
  {
    name: "note",
    syntax: "/note <text> | /note load <name>",
    description: "Update the chat's Author's Note, or load a saved preset by name",
  },
  {
    name: "setvar",
    syntax: "/setvar <name> <val>",
    description: "Set a chat variable",
  },
  {
    name: "getvar",
    syntax: "/getvar <name>",
    description: "Get value of a chat variable",
  },
  {
    name: "think",
    syntax: "/think <on|off>",
    description: "Toggle model thinking visibility",
  },
  {
    name: "clear",
    syntax: "/clear",
    description: "Clear conversation messages after confirmation",
  },
  {
    name: "branch",
    syntax: "/branch <name>",
    description: "Create a story branch checkpoint with given name",
  },
  {
    name: "imagine",
    syntax: "/imagine <prompt>",
    description: "Generate scene artwork using image generation backends",
  },
  {
    name: "visualize",
    syntax: "/visualize [prompt]",
    description: "Visualize the current scene or character appearance",
  },
];

/* Returns true if the input text starts with a slash command */
export function isSlashCommand(text) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  return t.startsWith("/") && t.length > 1 && !t.startsWith("//");
}

/* Parses text into command name, args string, and arg array */
export function parseSlashCommand(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) {
    return {
      name: "",
      args: "",
      argList: [],
      raw: text,
    };
  }
  const name = match[1].toLowerCase();
  const args = (match[2] ?? "").trim();
  const argList = args ? args.split(/\s+/) : [];
  return {
    name,
    args,
    argList,
    raw: text,
  };
}

/* Parse arguments for /sendas: speaker (optionally quoted) and message */
export function parseSendAsArgs(args) {
  const s = String(args ?? "").trim();
  if (!s) return null;
  const match = s.match(/^"([^"]+)"\s+([\s\S]+)$/) || s.match(/^'([^']+)'\s+([\s\S]+)$/) || s.match(/^(\S+)\s+([\s\S]+)$/);
  if (!match) return null;
  return {
    speaker: match[1].trim(),
    message: match[2].trim(),
  };
}

/* Returns matching command suggestions for autocomplete */
export function suggestSlashCommands(prefix) {
  const raw = String(prefix ?? "").trim();
  const p = raw.startsWith("/") ? raw.slice(1).toLowerCase() : raw.toLowerCase();
  if (!p) return SLASH_COMMANDS;

  const starts = [];
  const contains = [];

  for (const cmd of SLASH_COMMANDS) {
    if (cmd.name.startsWith(p)) {
      starts.push(cmd);
    } else if (cmd.name.includes(p) || cmd.description.toLowerCase().includes(p)) {
      contains.push(cmd);
    }
  }

  return [...starts, ...contains];
}

/* Formatted help text for system info display */
export function getHelpText() {
  return [
    "Available slash commands:",
    "• /help — List all available commands",
    "• /roll <dice> — Roll dice (e.g. /roll 1d20+5, /roll 2d6, /roll d100)",
    "• /sendas <speaker> <message> — Send a message as a specific speaker",
    "• /impersonate [guidance] — Generate the next reply as your persona",
    "• /continue — Continue scene or assistant reply",
    "• /note <text> — Update the chat's Author's Note",
    "• /setvar <name> <val> — Set a chat variable",
    "• /getvar <name> — Get value of a chat variable",
    "• /think <on|off> — Toggle model thinking visibility",
    "• /clear — Clear conversation messages",
    "• /branch <name> — Create a story branch checkpoint",
  ].join("\n");
}

/* Executes a parsed slash command against the provided context */
export function executeSlashCommand({ name, args, argList }, context = {}) {
  const cmd = String(name || "").toLowerCase();

  switch (cmd) {
    case "help": {
      const text = getHelpText();
      if (context.onSystemMessage) context.onSystemMessage(text);
      return { handled: true, action: "help", message: text };
    }

    case "roll": {
      const spec = args || "1d20";
      const rollRes = rollDice(spec);
      if (!rollRes) {
        const err = `Invalid dice expression "${spec}". Example: /roll 1d20+5, /roll 2d6, /roll d100`;
        if (context.onSystemMessage) context.onSystemMessage(err);
        return { handled: true, action: "roll", error: err, success: false };
      }
      const msg = `🎲 Rolled ${spec}: **${rollRes}**`;
      if (context.onSystemMessage) context.onSystemMessage(msg);
      return { handled: true, action: "roll", spec, result: rollRes, message: msg, success: true };
    }

    case "sendas": {
      const parsed = parseSendAsArgs(args);
      if (!parsed) {
        const err = `Usage: /sendas <speaker> <message>`;
        if (context.onSystemMessage) context.onSystemMessage(err);
        return { handled: true, action: "sendas", error: err, success: false };
      }
      if (context.onSendAs) context.onSendAs(parsed.speaker, parsed.message);
      return { handled: true, action: "sendas", speaker: parsed.speaker, message: parsed.message, success: true };
    }

    case "impersonate": {
      if (context.onImpersonate) context.onImpersonate(args);
      return { handled: true, action: "impersonate", prompt: args };
    }

    case "continue": {
      if (context.onContinue) context.onContinue();
      return { handled: true, action: "continue" };
    }

    case "note": {
      const load = args.match(/^load(?:\s+([\s\S]*))?$/i);
      if (load) {
        const want = (load[1] || "").trim().toLowerCase();
        const presets = Array.isArray(context.notePresets) ? context.notePresets : [];
        const hit = want && (presets.find((x) => x.name.toLowerCase() === want) || presets.find((x) => x.name.toLowerCase().startsWith(want)));
        if (!hit) {
          const err = !presets.length
            ? "No saved author's note presets."
            : want ? `No preset named "${load[1].trim()}". Saved: ${presets.map((x) => x.name).join(", ")}.` : "Usage: /note load <name>";
          if (context.onSystemMessage) context.onSystemMessage(err);
          return { handled: true, action: "note", error: err, success: false };
        }
        if (context.onLoadNotePreset) context.onLoadNotePreset(hit);
        const done = `Author's Note loaded: "${hit.name}"`;
        if (context.onSystemMessage) context.onSystemMessage(done);
        return { handled: true, action: "note", preset: hit, message: done };
      }
      if (context.onUpdateNote) context.onUpdateNote(args);
      const msg = args ? `Author's Note updated: "${args}"` : "Author's Note cleared.";
      if (context.onSystemMessage) context.onSystemMessage(msg);
      return { handled: true, action: "note", text: args, message: msg };
    }

    case "setvar": {
      const match = args.match(/^(\S+)\s+([\s\S]*)$/);
      if (!match) {
        const err = `Usage: /setvar <name> <val>`;
        if (context.onSystemMessage) context.onSystemMessage(err);
        return { handled: true, action: "setvar", error: err, success: false };
      }
      const varName = match[1];
      const varVal = match[2];
      if (context.onSetVar) context.onSetVar(varName, varVal);
      if (context.vars) context.vars[varName] = varVal;
      const msg = `Variable \`${varName}\` set to: "${varVal}"`;
      if (context.onSystemMessage) context.onSystemMessage(msg);
      return { handled: true, action: "setvar", name: varName, value: varVal, message: msg, success: true };
    }

    case "getvar": {
      const varName = args.trim();
      if (!varName) {
        const err = `Usage: /getvar <name>`;
        if (context.onSystemMessage) context.onSystemMessage(err);
        return { handled: true, action: "getvar", error: err, success: false };
      }
      const val = context.vars ? context.vars[varName] : undefined;
      const msg = val !== undefined ? `Variable \`${varName}\` = "${val}"` : `Variable \`${varName}\` is not set.`;
      if (context.onSystemMessage) context.onSystemMessage(msg);
      return { handled: true, action: "getvar", name: varName, value: val, message: msg, success: true };
    }

    case "think": {
      const arg = args.toLowerCase().trim();
      let next;
      if (arg === "on") next = true;
      else if (arg === "off") next = false;
      else next = !context.thinking;

      if (context.onToggleThinking) context.onToggleThinking(next);
      const msg = `Model thinking visibility set to: ${next ? "ON" : "OFF"}`;
      if (context.onSystemMessage) context.onSystemMessage(msg);
      return { handled: true, action: "think", value: next, message: msg };
    }

    case "clear": {
      if (context.onClear) context.onClear();
      return { handled: true, action: "clear" };
    }

    case "branch": {
      const branchName = args.trim() || `Branch ${Date.now()}`;
      if (context.onBranch) context.onBranch(branchName);
      const msg = `Created story branch checkpoint: "${branchName}"`;
      if (context.onSystemMessage) context.onSystemMessage(msg);
      return { handled: true, action: "branch", name: branchName, message: msg };
    }

    case "imagine":
    case "visualize": {
      if (context.onImagine) context.onImagine(args);
      return { handled: true, action: "imagine", prompt: args };
    }

    default: {
      const err = `Unknown command: "/${name}". Type /help to see available commands.`;
      if (context.onSystemMessage) context.onSystemMessage(err);
      return { handled: false, error: err };
    }
  }
}
