import fs from "node:fs";
import crypto from "node:crypto";

/* Who may use the Bridge: devices approved in its window, each tied to the
   network it was approved on (a phone approved on the home Wi-Fi is not let
   in from anywhere else), and devices blocked there, which cannot ask again.
   Nova on this computer's desktop app is approved as it asks. */

const TTL = 5 * 60000;
const hash = token => crypto.createHash("sha256").update(token).digest("hex");
const validToken = token => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function createDeviceAccess(file, now = Date.now) {
  let approved = [];
  let blocked = [];
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    /* older files were the approved list alone */
    approved = Array.isArray(saved) ? saved : saved.approved || [];
    blocked = Array.isArray(saved) ? [] : saved.blocked || [];
    if (!Array.isArray(approved) || approved.some(d => !d.id || !/^[a-f0-9]{64}$/.test(d.hash))) throw Error("Invalid device records");
    if (!Array.isArray(blocked)) blocked = [];
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  const requests = new Map();
  const attempts = new Map();
  const prune = () => {
    for (const [id, item] of requests) if (item.expiresAt <= now()) requests.delete(id);
    for (const [ip, item] of attempts) if (item.until <= now()) attempts.delete(ip);
  };
  const persist = (nextApproved = approved, nextBlocked = blocked) => {
    fs.writeFileSync(file + ".tmp", JSON.stringify({ approved: nextApproved, blocked: nextBlocked }), { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
    approved = nextApproved;
    blocked = nextBlocked;
  };
  const publicRecord = ({ hash: _hash, ...record }) => record;
  const isBlocked = (digest, address) => blocked.some(b => b.hash === digest || (address && b.address === address && address !== "localhost"));
  return {
    /* the device a credential belongs to, if it may be served from `net`
       (the network the request came over; null for this computer) */
    authorize(token, origin, net) {
      if (!validToken(token)) return undefined;
      const digest = hash(token);
      const d = approved.find(r => r.hash === digest && (!origin || origin === r.origin));
      if (!d || isBlocked(digest)) return undefined;
      if (net && d.net !== net) {
        /* approved before networks were remembered: it belongs to the first one it uses */
        if (d.net !== undefined) return undefined;
        persist(approved.map(r => (r === d ? { ...r, net } : r)));
      }
      return d.id;
    },
    allowsOrigin(origin) { return approved.some(d => d.origin === origin); },
    request({ token, name }, address, origin, { net = null, auto = false } = {}) {
      if (!validToken(token)) throw fail("Invalid device credential.");
      prune();
      const digest = hash(token);
      if (isBlocked(digest, address)) throw fail("This device is blocked in the Bridge window.", 403);
      const existing = approved.find(d => d.hash === digest) || [...requests.values()].find(d => d.hash === digest);
      if (existing) return publicRecord(existing);
      /* per address, for the network; this computer is held by the overall cap */
      const rate = attempts.get(address) || { count: 0, until: now() + 60000 };
      if ((address !== "localhost" && rate.count >= 5) || requests.size >= 20 || attempts.size >= 1000 || approved.length >= 100) throw fail("Too many device requests. Try again later.", 429);
      rate.count++; attempts.set(address, rate);
      const request = { id: crypto.randomUUID(), hash: digest, name: String(name || "Nova device").slice(0, 60), address, origin: origin || "Local client", net, code: String(crypto.randomInt(100000, 1000000)), status: "pending", expiresAt: now() + TTL };
      if (auto) {
        const { expiresAt, ...record } = request;
        const done = { ...record, status: "approved", auto: true, at: now() };
        /* the same app on this computer asking again replaces its old record */
        persist([...approved.filter(d => !(d.auto && d.address === address && d.origin === record.origin)), done]);
        return publicRecord(done);
      }
      requests.set(request.id, request);
      return publicRecord(request);
    },
    status(id, token) {
      if (!validToken(token)) throw fail("Invalid device credential.");
      prune();
      const digest = hash(token);
      if (isBlocked(digest)) return { status: "rejected" };
      const record = approved.find(d => d.id === id) || requests.get(id);
      if (!record || record.hash !== digest) return { status: "expired" };
      return { status: record.status, code: record.code, expiresAt: record.expiresAt };
    },
    list() { prune(); return [...requests.values()].filter(d => d.status === "pending").concat(approved).map(publicRecord); },
    blockedList() { return blocked.map(publicRecord); },
    decide(id, action) {
      prune();
      if (action === "revoke" || action === "block") {
        const record = approved.find(d => d.id === id) || requests.get(id);
        if (!record) throw fail("Device is no longer authorized.");
        requests.delete(id);
        const nextBlocked = action === "block"
          ? [...blocked.filter(b => b.hash !== record.hash), { id: record.id, hash: record.hash, name: record.name, address: record.address, at: now() }]
          : blocked;
        persist(approved.filter(d => d.id !== id), nextBlocked);
        return;
      }
      if (action === "unblock") {
        if (!blocked.some(b => b.id === id)) throw fail("That device is not blocked.");
        persist(approved, blocked.filter(b => b.id !== id));
        return;
      }
      const request = requests.get(id);
      if (!request || request.status !== "pending") throw fail("This device request expired. Request access again.");
      if (action === "approve") {
        if (approved.length >= 100) throw fail("Remove an authorized device before adding another.", 429);
        const { expiresAt, ...record } = request;
        persist([...approved, { ...record, status: "approved", at: now() }]);
        requests.delete(id);
      } else if (action === "reject") request.status = "rejected";
      else throw fail("Unknown device action.");
    },
  };
}
