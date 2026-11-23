const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let info = null, busy = false, skin = null;

/* redraw a list only when it changed; rows that are new arrive */
function paint(id, html) {
  const host = $(id);
  if (host._markup === html) return;
  host._markup = html;
  const before = new Set([...host.querySelectorAll("[data-key]")].map((el) => el.dataset.key));
  host.innerHTML = html;
  BridgeMotion.rows(host, before);
}

const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000 | 0); return s < 60 ? "just now" : s < 3600 ? `${s / 60 | 0} min ago` : s < 86400 ? `${s / 3600 | 0} h ago` : `${s / 86400 | 0} d ago`; };
const up = (t) => { const m = (Date.now() - t) / 60000 | 0; return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${m / 60 | 0} h ${m % 60} min`; };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function render(i) {
  info = i;
  if (i.skin !== skin) {
    skin = i.skin;
    document.documentElement.dataset.skin = skin;
    BridgeMotion.startField();
  }
  const s = busy || i.starting ? "wait" : i.running ? "on" : "off";
  if ($("hero").dataset.s !== s) { $("hero").dataset.s = s; BridgeMotion.status($("state")); }
  $("state").textContent = s === "wait" ? "Starting…" : i.running ? "Running" : "Stopped";
  $("sub").textContent = i.running ? `For ${up(i.startedAt)}` : "";
  const t = $("toggle");
  t.textContent = i.running ? "Stop" : "Start";
  t.classList.toggle("primary", !i.running);
  t.disabled = busy || i.starting;

  const err = i.problem || (i.running && i.lastError && Date.now() - i.lastError.at < 60000 ? i.lastError.message : "");
  $("err").hidden = !err; $("err").textContent = err;

  const active = i.sessions.filter((d) => d.active).length;
  BridgeMotion.count($("n-subs"), i.subscriptions.filter((p) => p.connected).length);
  BridgeMotion.count($("n-dev"), i.running ? active : 0);
  BridgeMotion.count($("n-req"), i.active ? i.active : i.requests);
  $("l-req").textContent = i.active ? "Replying" : "Replies";

  /* the address a phone types (Enter address): the IP, with the port only
     when it is not Nova's usual 5005 */
  let addr = "";
  try { if (i.running && i.lan) { const u = new URL(i.lan); addr = u.port && u.port !== "5005" ? `${u.hostname}:${u.port}` : u.hostname; } } catch {}
  $("wifi-card").hidden = !addr;
  if ($("wifi-addr").textContent !== addr) $("wifi-addr").textContent = addr;

  $("pending-card").hidden = !i.pending.length;
  paint("pending", i.pending.map((d) => `
    <div data-key="ask-${esc(d.id)}"><div class="row"><div class="grow">${esc(d.name)}<small>${esc(d.address)}</small></div></div>
      <div class="code">${esc(d.code)}</div>
      <div class="actions"><button class="btn primary" data-device="${esc(d.id)}" data-action="approve">Approve</button><button class="btn" data-device="${esc(d.id)}" data-action="reject">Reject</button></div></div>`).join(""));

  paint("subs", i.subscriptions.map((p) => {
    const pending = !p.connected && p.flow?.status === "pending";
    const note = p.problem || (p.connected ? "Connected" : p.flow?.message || "Not connected");
    return `<div class="row" data-key="sub-${esc(p.id)}"><span class="dot ${p.connected ? (p.problem ? "bad" : "on") : ""}"></span>
      <div class="grow">${esc(p.name)}<small>${esc(note)}</small></div>
      ${pending && p.flow?.url ? `<button class="btn sm" data-open="${esc(p.flow.url)}">Open</button>` : ""}
      ${p.connected ? `<button class="btn sm" data-out="${esc(p.id)}">Disconnect</button>` : `<button class="btn sm primary" data-in="${esc(p.id)}" ${pending ? "disabled" : ""}>${pending ? "Signing in…" : "Sign in"}</button>`}</div>`;
  }).join(""));

  paint("sessions", i.sessions.length ? i.sessions.map((d) => `
    <div class="row" data-key="dev-${esc(d.id)}"><span class="dot ${d.active ? "on" : ""}"></span>
      <div class="grow">${esc(d.local ? "This computer" : d.name)}<small>${d.replying ? "Replying now" : d.active ? "Active now" : d.lastSeen ? `Seen ${ago(d.lastSeen)}` : "Approved"}${d.requests ? ` · ${plural(d.requests, "request")}` : ""}${d.local ? "" : ` · ${esc(d.address)}`}</small></div>
      ${d.local ? "" : `<button class="btn sm" data-device="${esc(d.id)}" data-action="block">Block</button>`}</div>`).join("")
    : `<p class="empty">No devices</p>`);
  paint("blocked", i.blocked.map((d) => `
    <div class="row" data-key="blk-${esc(d.id)}"><div class="grow">${esc(d.name)}<small>Blocked · ${esc(d.address)}</small></div>
      <button class="btn sm" data-device="${esc(d.id)}" data-action="unblock">Unblock</button></div>`).join(""));
}

const say = (text) => { $("sub-status").hidden = !text; $("sub-status").textContent = text || ""; };

async function act(fn) { if (!info || busy) return; busy = true; render(info); try { info = await fn(); } catch (error) { info = { ...info, problem: error.message }; } finally { busy = false; render(info); } }
$("toggle").onclick = () => act(() => (info.running ? bridge.stop() : bridge.start()));
$("minimize").onclick = () => bridge.window("minimize");
/* Start with this computer: off unless turned on here */
const autostartNote = (on) => (on ? "On: the Bridge starts without its window when you log in, so your phone can always reach it." : "Off: the Bridge runs only while you have it open.");
const showAutostart = (on) => { $("autostart").setAttribute("aria-checked", String(!!on)); $("autostart-note").textContent = autostartNote(on); };
if (bridge.autostart) bridge.autostart().then(showAutostart).catch(() => { $("autostart").closest(".card").hidden = true; });
else $("autostart").closest(".card").hidden = true;
$("autostart").onclick = async () => {
  const want = $("autostart").getAttribute("aria-checked") !== "true";
  try { showAutostart(await bridge.autostart(want)); } catch (e) { say(e.message); }
};
/* Keep running in the tray: on unless turned off here */
const trayNote = (on) => (on ? "On: closing the window hides it; the Bridge keeps running." : "Off: closing the window stops the Bridge.");
const showTray = (on) => { $("tray").setAttribute("aria-checked", String(!!on)); $("tray-note").textContent = trayNote(on); };
if (bridge.tray) bridge.tray().then(showTray).catch(() => { $("tray").closest(".row").hidden = true; });
else $("tray").closest(".row").hidden = true;
$("tray").onclick = async () => {
  const want = $("tray").getAttribute("aria-checked") !== "true";
  try { showTray(await bridge.tray(want)); } catch (e) { say(e.message); }
};
$("wifi-copy").onclick = async () => {
  const b = $("wifi-copy");
  try { await navigator.clipboard.writeText($("wifi-addr").textContent); b.textContent = "Copied"; }
  catch { b.textContent = "Select it"; }
  setTimeout(() => { b.textContent = "Copy"; }, 1600);
};
$("close").onclick = () => bridge.window("close");

async function signIn(id, button) {
  button.disabled = true;
  button.textContent = "Opening…";
  say("");
  try {
    const r = await bridge.signin(id);
    if (r.error) say(r.error);
  } catch (error) { say(error.message); }
  finally { $("subs")._markup = null; await tick(); }
}

/* Claude: the warning first, its button held for three seconds */
const claudeDialog = $("claude-dialog");
let claudeTimer = 0, claudeButton = null;
function warnClaude(button) {
  claudeButton = button;
  const ok = $("claude-ok");
  let left = 3;
  const label = () => { ok.innerHTML = left ? `Connect anyway<span class="count">${left}</span>` : "Connect anyway"; ok.disabled = left > 0; };
  label();
  clearInterval(claudeTimer);
  claudeTimer = setInterval(() => { left--; label(); if (!left) clearInterval(claudeTimer); }, 1000);
  BridgeMotion.open(claudeDialog);
}
const closeClaude = () => { clearInterval(claudeTimer); BridgeMotion.close(claudeDialog); };
$("claude-cancel").onclick = closeClaude;
claudeDialog.addEventListener("cancel", (e) => { e.preventDefault(); closeClaude(); });
$("claude-ok").onclick = () => { if ($("claude-ok").disabled) return; closeClaude(); signIn("claude", claudeButton); };

document.addEventListener("click", async (e) => {
  const link = e.target.closest("[data-open]");
  /* a sign-in page the Bridge started (Google, Claude): opened in the browser
     by the host's window-open handler, for when it did not open by itself */
  if (link && /^https:\/\//.test(link.dataset.open)) window.open(link.dataset.open);
  const s = e.target.closest("[data-in]");
  if (s) {
    if (s.dataset.in === "claude") warnClaude(s);
    else signIn(s.dataset.in, s);
  }
  const out = e.target.closest("[data-out]");
  if (out) {
    out.disabled = true;
    try { const r = await bridge.signout(out.dataset.out); if (r.error) throw new Error(r.error); say(""); }
    catch (error) { say(error.message); }
    finally { out.disabled = false; await tick(); }
  }
  const device = e.target.closest("[data-device]");
  if (device) {
    device.disabled = true;
    try { render(await bridge.device(device.dataset.device, device.dataset.action)); }
    catch (error) { say(error.message); }
    finally { device.disabled = false; }
  }
});

const closeDialog = $("close-dialog");
bridge.onConfirmClose((i) => {
  const active = i.sessions.filter((d) => d.active).length;
  const bits = [];
  if (active) bits.push(plural(active, "active device"));
  if (i.active) bits.push(`${i.active} unfinished repl${i.active === 1 ? "y" : "ies"}`);
  $("close-detail").textContent = bits.join(" · ");
  $("close-detail").hidden = !bits.length;
  if (!closeDialog.open) BridgeMotion.open(closeDialog);
});
$("keep-running").onclick = () => BridgeMotion.close(closeDialog);
closeDialog.addEventListener("cancel", (event) => { event.preventDefault(); BridgeMotion.close(closeDialog); });
$("stop-close").onclick = async () => {
  $("stop-close").disabled = true;
  $("keep-running").disabled = true;
  $("stop-close").textContent = "Closing…";
  await bridge.closeConfirmed();
};
const tick = async () => { try { render(await bridge.info()); } catch {} };
tick(); setInterval(tick, 1000);
