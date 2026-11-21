/* Isolated renderer test: never loads the real Bridge main process or accounts. */
const path = require('node:path');
if (!process.versions.electron) {
 const {spawnSync}=require('node:child_process'); const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
 const result=spawnSync(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true}); process.exit(result.status??1);
} else {
 const {app,BrowserWindow}=require('electron'); const assert=require('node:assert/strict');
 app.commandLine.appendSwitch('disable-gpu');
 app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:440,height:720,webPreferences:{preload:path.join(__dirname,'fixtures/bridge-ui-preload.cjs'),contextIsolation:true,sandbox:true,backgroundThrottling:false,partition:'bridge-ui-check'}});
  const js=code=>win.webContents.executeJavaScript(code);
  const wait=expr=>js(`new Promise((resolve,reject)=>{let n=0; const check=()=>{if(${expr})resolve();else if(++n>150)reject(new Error(${JSON.stringify(expr)}));else setTimeout(check,20);};check();})`);
  try {
   await win.loadFile(path.join(__dirname,'../bridge/app/index.html'));
   await wait('document.querySelector("#subs .row")');
   /* the rounded, frameless window; Nova's own skin first */
   assert.equal(await js('getComputedStyle(document.querySelector(".frame")).borderTopLeftRadius'),'22px');
   assert.equal(await js('document.documentElement.dataset.skin'),'nova');
   /* nothing but what was asked for: no keys, addresses or models, and one
      switch, Start with this computer, off until turned on */
   assert.equal(await js('document.querySelectorAll("#copy-key, #origins, #addr, #list, input").length'),0);
   assert.equal(await js('document.querySelectorAll("[role=switch]").length'),1);
   await wait('document.querySelector("#autostart").getAttribute("aria-checked") === "false"');
   await js('document.querySelector("#autostart").click()');
   await wait('document.querySelector("#autostart").getAttribute("aria-checked") === "true"');
   assert.equal(await js('(async()=>(await bridge.callsForTest()).some(c=>c[0]==="autostart"&&c[1]===true))()'),true);
   await js('document.querySelector("#toggle").click()');
   await wait('document.querySelector("#state").textContent === "Running" && !document.querySelector("#toggle").disabled');
   /* a phone asks: its code, approve, then block and unblock it */
   await wait('!document.querySelector("#pending-card").hidden && document.querySelector("#pending .code").textContent === "123456"');
   await js('document.querySelector("[data-device][data-action=approve]").click()');
   await wait('document.querySelector("#pending-card").hidden && document.querySelector("#sessions [data-action=block]")');
   assert.equal(await js('document.querySelector("#n-dev").textContent'),'1');
   await js('document.querySelector("#sessions [data-action=block]").click()');
   await wait('document.querySelector("#blocked [data-action=unblock]")');
   await js('document.querySelector("#blocked [data-action=unblock]").click()');
   await wait('!document.querySelector("#blocked .row")');
   /* Claude: the red warning, its button held three seconds */
   await js('document.querySelector("[data-in=claude]").click()');
   await wait('document.querySelector("#claude-dialog").open');
   assert.equal(await js('document.querySelector("#claude-ok").disabled'),true);
   assert.match(await js('document.querySelector("#claude-text").textContent'),/ban/);
   assert.equal(await js('getComputedStyle(document.querySelector("#claude-text")).color === getComputedStyle(document.querySelector("#claude-ok")).backgroundColor'),true);
   assert.equal(await js('(async()=>(await bridge.callsForTest()).some(c=>c[0]==="signin"))()'),false);
   await new Promise(r=>setTimeout(r,3200));
   assert.equal(await js('document.querySelector("#claude-ok").disabled'),false);
   await js('document.querySelector("#claude-ok").click()');
   await wait('!document.querySelector("#claude-dialog").open');
   assert.equal(await js('(async()=>JSON.stringify((await bridge.callsForTest()).find(c=>c[0]==="signin")))()'),'["signin","claude"]');
   /* other subscriptions sign in straight away */
   await js('document.querySelector("[data-in=antigravity]").click()');
   await wait('(async()=>0)() && true');
   await js('document.querySelector("[data-out]").click()');
   await wait('!document.querySelector("[data-out]")');
   /* the window follows the app's skin */
   await js('bridge.setSkinForTest("aero")');
   await wait('document.documentElement.dataset.skin === "aero"');
   assert.equal(await js('getComputedStyle(document.querySelector(".skyline")).display'),'block');
   await js('document.querySelector("#minimize").click()');
   assert.ok(await js('(async()=>(await bridge.callsForTest()).some(c=>c[0]==="window"&&c[1]==="minimize"))()'));
   await js('bridge.confirmForTest()'); await wait('document.querySelector("#close-dialog").open');
   await js('document.querySelector("#keep-running").click()');
   await wait('!document.querySelector("#close-dialog").open');
   await js('document.querySelector("#toggle").click()'); await wait('document.querySelector("#state").textContent === "Stopped"');
   console.log('Bridge window: rounded frame, start/stop, device approve/block/unblock, Claude warning, subscriptions, skin switch, window controls, close dialog: PASS'); app.exit(0);
  } catch(error) { console.error(error); app.exit(1); }
 });
}
