// Exercises the real host main process with isolated credentials and settings.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-host-"));
  const env = { ...process.env, NOVA_BRIDGE_DATA: dir, NOVA_BRIDGE_HOME: dir, NOVA_BRIDGE_AUTH_FILE: path.join(dir, "auth.json"), XDG_CONFIG_HOME: dir, NOVA_HOST_TEST_DIR: dir, PORT: "15005", CODEX_HOME: path.join(dir, "codex") };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NOVA_BRIDGE_KEY;
  delete env.NOVA_BRIDGE_ORIGINS;
  try {
    let key;
    for (let launch = 0; launch < 2; launch++) {
      const result = require("node:child_process").spawnSync(require("electron"), [__filename], { env, stdio: "inherit", timeout: 45000 });
      if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
      const saved = fs.readFileSync(path.join(dir, "bridge-key"), "utf8");
      if (key && key !== saved) throw new Error("Bridge key changed across launches");
      key = saved;
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
} else {
  const assert = require("node:assert/strict");
  const { app, BrowserWindow } = require("electron");
  const dir = process.env.NOVA_HOST_TEST_DIR;
  app.setPath("userData", dir);
  require("../bridge/app/main.cjs");
  app.whenReady().then(async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const js = (code) => win.webContents.executeJavaScript(code);
    const deadline = setTimeout(() => { console.error("Host test timed out"); app.exit(1); }, 30000);
    try {
      if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
      await js(`new Promise((resolve,reject)=>{let n=0;const check=async()=>{try {if((await bridge.info()).running)return resolve();}catch{} if(++n>100)return reject(new Error('Host did not start'));setTimeout(check,50);};check();})`);
      assert.equal((await (await fetch("http://127.0.0.1:15005/health")).json()).ok, true);
      assert.equal(await js('document.querySelector("#state").textContent'), "Running");
      const anotherWindow = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, "../bridge/app/preload.cjs"), sandbox: true } });
      await anotherWindow.loadURL("about:blank");
      await assert.rejects(anotherWindow.webContents.executeJavaScript("bridge.info()"), /Untrusted window/);
      anotherWindow.destroy();
      const key = fs.readFileSync(path.join(dir, "bridge-key"), "utf8");
      assert.match(key, /^[a-f0-9]{64}$/);
      if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, "bridge-key")).mode & 0o777, 0o600);
      assert.equal((await fetch("http://127.0.0.1:15005/v1/models")).status, 401);
      assert.ok(!JSON.stringify(await js('bridge.info()')).includes(key));
      assert.ok(!await js('document.body.textContent.includes(' + JSON.stringify(key) + ')'));
      /* a phone asks, shows up with its code, is approved, then blocked and unblocked */
      const deviceToken = "f".repeat(64);
      const request = await (await fetch("http://127.0.0.1:15005/pair/request", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://mobile.example" }, body: JSON.stringify({ token: deviceToken, name: "Test phone" }) })).json();
      assert.equal(request.status, "pending");
      assert.ok((await js('bridge.info()')).pending.some(device => device.id === request.id && device.code === request.code));
      await js('new Promise(r=>setTimeout(r,1200))');
      assert.equal(await js('document.querySelector("#pending-card").hidden'), false);
      assert.ok((await js('document.querySelector("#pending").textContent')).includes(request.code));
      await js('bridge.device(' + JSON.stringify(request.id) + ',"approve")');
      const phone = { Authorization: `Bearer ${deviceToken}`, Origin: "https://mobile.example" };
      assert.equal((await fetch("http://127.0.0.1:15005/v1/models", { headers: phone })).status, 200);
      assert.ok((await js('bridge.info()')).sessions.some((d) => d.id === request.id));
      await js('bridge.device(' + JSON.stringify(request.id) + ',"block")');
      /* refused: its credential is void, and its site with it */
      assert.ok([401, 403].includes((await fetch("http://127.0.0.1:15005/v1/models", { headers: phone })).status));
      assert.ok((await js('bridge.info()')).blocked.some((d) => d.id === request.id));
      await js('bridge.device(' + JSON.stringify(request.id) + ',"unblock")');
      assert.ok(!(await js('bridge.info()')).blocked.length);
      /* Nova on this computer's desktop app is let in as it asks */
      const desktop = await (await fetch("http://127.0.0.1:15005/pair/request", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://127.0.0.1:47615" }, body: JSON.stringify({ token: "e".repeat(64), name: "Nova desktop" }) })).json();
      assert.equal(desktop.status, "approved");
      /* the window wears the skin the Nova app reports */
      assert.equal(await js('document.documentElement.dataset.skin'), "nova");
      fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ skin: "aero" }));
      await js('new Promise(r=>setTimeout(r,1200))');
      assert.equal(await js('document.documentElement.dataset.skin'), "aero");
      fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ skin: "holo", theme: "light" }));
      await js('new Promise(r=>setTimeout(r,1200))');
      assert.equal(await js('document.documentElement.dataset.skin + " " + document.documentElement.dataset.theme'), "holo light");
      fs.writeFileSync(path.join(dir, "skin.json"), JSON.stringify({ skin: "some-other-pack" }));
      await js('new Promise(r=>setTimeout(r,1200))');
      assert.equal(await js('document.documentElement.dataset.skin'), "nova");
      /* Claude sits where GitHub Copilot was */
      const subs = (await js('bridge.info()')).subscriptions.map((p) => p.id);
      assert.deepEqual(subs, ["antigravity", "claude", "openai", "gemini-web"]);
      assert.deepEqual(await js('bridge.signout("claude")'), {});
      assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "auth.json"))).skipCli.includes("claude"));
      assert.equal(await js('(async()=>(await bridge.stop()).running)()'), false);
      assert.equal(await js('(async()=>(await bridge.start()).running)()'), true);
      await js('bridge.stop()');
      console.log("Real bridge host: startup, health, devices, skin, stop and restart PASS");
      clearTimeout(deadline);
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
