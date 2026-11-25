/* Stands in for the agy CLI: "agy models" renews the token it keeps in the
   keychain (here the file NOVA_BRIDGE_AGY_CRED names) and counts its runs. */
import fs from "node:fs";

const file = process.env.NOVA_BRIDGE_AGY_CRED;
const cred = JSON.parse(fs.readFileSync(file, "utf8"));
cred.token.access_token = "ya29.renewed";
cred.token.expiry = new Date(Date.now() + 3600e3).toISOString();
fs.writeFileSync(file, JSON.stringify(cred));
fs.appendFileSync(`${file}.runs`, `${process.argv.slice(2).join(" ")}\n`);
