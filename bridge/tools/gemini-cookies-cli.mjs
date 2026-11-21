#!/usr/bin/env node
/* gemini-cookies.mjs — fetch the Gemini app sign-in from your own browser, for
   scripts (geminiProbe.cmd / geminiProbe.sh) and for checking by hand.

     node bridge/tools/gemini-cookies-cli.mjs --out <file> [--browser auto|firefox|chromium]
         Writes the cookies to <file> (0600) as JSON. `auto` (the default) uses a
         Google sign-in found in Firefox, else opens Chrome / Edge / Brave on its
         own saved profile for you to sign in (see gemini-cookies.mjs).
     node bridge/tools/gemini-cookies-cli.mjs --forget
         Deletes that saved browser profile.

   Exit code 0 = done, 1 = failed. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { forgetGeminiBrowser, getGeminiCookies } from "../gemini-cookies.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
/* the same place the Bridge uses, so a sign-in made in either is shared */
const profileDir = `${process.env.NOVA_BRIDGE_AUTH_FILE || path.join(ROOT, ".nova-bridge-auth.json")}.browser`;
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

if (process.argv.includes("--forget")) {
  await forgetGeminiBrowser(profileDir);
  console.log("Saved browser sign-in cleared.");
  process.exit(0);
}

const out = arg("--out");
if (!out) {
  console.error("Usage: node bridge/tools/gemini-cookies-cli.mjs --out <file> [--browser auto|firefox|chromium]   |   --forget");
  process.exit(1);
}
try {
  const { cookies, authuser, from } = await getGeminiCookies({ profileDir, prefer: arg("--browser") || undefined, onStatus: (m) => console.log(m) });
  /* a flat { name: value } object; an "authuser" entry picks another Google account */
  fs.writeFileSync(out, JSON.stringify({ ...cookies, ...(authuser ? { authuser: String(authuser) } : {}) }), { mode: 0o600 });
  console.log(`Got the Google sign-in from ${from} (${Object.keys(cookies).length} cookies).`);
} catch (e) {
  console.error(e.message || String(e));
  process.exit(1);
}
