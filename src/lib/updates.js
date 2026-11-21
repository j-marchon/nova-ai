/* ---------- Check for updates (Settings → You) ----------

   Off unless the user turns it on: Nova makes no request of its own until
   then. When on, it asks GitHub's public API once a day which release of
   Nova is the newest, and says so when it is newer than this one. Only
   that one anonymous request is made; nothing about the user or library
   is sent. */

/* the public repository Nova's releases are published in */
export const RELEASES_REPO = "j-marchon/nova-releases";
export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases/latest`;
const API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
const DAY = 24 * 60 * 60 * 1000;
const KEY = "nova-update-check";

/* "v1.2.3" or "1.2" -> [1, 2, 3]; null if it is not a version */
export function parseVersion(text) {
  const m = String(text || "").trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null;
}

/* whether `latest` is a newer version than `current` */
export function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/* how a version reads in the app: "1.0" for 1.0.0, "1.0.1" as it is */
export const shortVersion = (v) => String(v || "").replace(/^v/i, "").replace(/^(\d+\.\d+)\.0$/, "$1");

function readSaved() {
  try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
}
function save(value) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* private mode */ }
}

/* Ask GitHub now. Resolves to { latest, url, newer, at }; throws when it
   cannot be reached or answers with something else. */
export async function checkForUpdate(current, { fetchImpl = fetch, now = Date.now() } = {}) {
  const res = await fetchImpl(API, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(res.status === 404 ? "No release is published yet." : `GitHub answered ${res.status}.`);
  const body = await res.json();
  const latest = String(body?.tag_name || "");
  if (!parseVersion(latest)) throw new Error("GitHub's answer had no version in it.");
  const url = /^https:\/\/github\.com\//.test(body?.html_url || "") ? body.html_url : RELEASES_PAGE;
  const result = { latest: shortVersion(latest), url, newer: isNewer(latest, current), at: now };
  save(result);
  return result;
}

/* The last answer, if any. */
export const lastCheck = () => readSaved();

/* The daily check, for when the app opens: asks only when it is on and the
   last answer is a day old. Resolves to the answer (fresh or saved), or
   null; never throws. */
export async function dailyUpdateCheck(enabled, current, opts = {}) {
  if (!enabled) return null;
  const now = opts.now ?? Date.now();
  const saved = readSaved();
  if (saved && now - saved.at < DAY && now >= saved.at) return { ...saved, newer: isNewer(saved.latest, current) };
  try { return await checkForUpdate(current, { ...opts, now }); } catch { return null; }
}
