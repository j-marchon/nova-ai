/* Real Chromium layout checks in an isolated, invisible Electron window.
   No user browser profile, account, media or existing Nova storage is used. */
const path = require("node:path");
const fs = require("node:fs");
if (!process.versions.electron) {
  const { spawnSync } = require("node:child_process");
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require("electron"), [__filename], { env, stdio: "inherit", windowsHide: true });
  process.exit(result.status ?? 1);
} else {
  const { app, BrowserWindow } = require("electron");
  const http = require("node:http");
  const assert = require("node:assert/strict");
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.whenReady().then(async () => {
    const dist = path.resolve(__dirname, "../dist");
    const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".png": "image/png" };
    const server = http.createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const file = path.resolve(dist, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
      fs.createReadStream(file).pipe(response);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const win = new BrowserWindow({ show: false, useContentSize: true, width: 390, height: 844,
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: "nova-layout-check" } });
    const js = code => win.webContents.executeJavaScript(code);
    const checkScrollingTabs = async selector => {
      const geometry = await js(`(() => {
        const row = document.querySelector(${JSON.stringify(selector)});
        const buttons = [...row.querySelectorAll(":scope > button")];
        const clipped = buttons.some(button => button.scrollWidth > button.clientWidth + 1);
        row.scrollLeft = row.scrollWidth;
        const last = buttons.at(-1).getBoundingClientRect();
        const edge = row.getBoundingClientRect().right;
        row.scrollLeft = 0;
        return { clipped, lastVisible: last.right <= edge + 1 };
      })()`);
      assert.deepEqual(geometry, { clipped: false, lastVisible: true });
    };
    const waitFor = expression => js(`new Promise((resolve,reject) => { let n=0; const check=()=> { if (${expression}) resolve(true); else if (++n>300) reject(new Error('Layout check timed out: '+${JSON.stringify(expression)})); else setTimeout(check,20); }; check(); })`);
    try {
      await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
      await waitFor('document.querySelector(".nv-nav-dock")');
      assert.equal(await js('document.querySelector(".nv-root").dataset.theme'), "dark");
      const edge = await js('getComputedStyle(document.querySelector(".nv-nav-dock")).borderTopColor');
      assert.notEqual(edge, "rgba(0, 0, 0, 0)", "AMOLED dock needs a faint visible edge");
      // Create actual local content so the chat is checked, not only a viewport probe.
      await js('document.querySelector(\'button[aria-label="New character"]\').click()');
      await waitFor('document.querySelector(\'.nv-screen input[placeholder="Character name"]\')');
      await js(`{
        const name = document.querySelector('.nv-screen input[placeholder="Character name"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,'Layout Check'); name.dispatchEvent(new Event('input',{bubbles:true}));
        const greeting = [...document.querySelectorAll('.nv-screen textarea')].find(el=>el.placeholder.includes('She looks up'));
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(greeting,'A long scene description fills the available width naturally. '.repeat(10)); greeting.dispatchEvent(new Event('input',{bubbles:true}));
      }`);
      await js('[...document.querySelectorAll(".nv-screen button")].find(el=>el.textContent.trim()==="Save").click()');
      await waitFor('!document.querySelector(".nv-screen") && document.querySelector("[data-chat-card]")');

      const caption = await js(`(() => { const el=document.querySelector('.nv-card-caption'); const card=el.closest('[data-chat-card]'); return {background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,cardFilter:getComputedStyle(card).filter}; })()`);
      assert.equal(caption.background, 'rgba(0, 0, 0, 0)', 'the caption tint is a gradient confined behind text, not a flat fill');
      assert.equal(caption.color, 'rgb(255, 255, 255)');
      assert.equal(caption.cardFilter, 'none', 'do not darken the entire thumbnail');

      await js('[...document.querySelectorAll("nav button")].find(el=>el.textContent.trim()==="Settings").click()');
      await waitFor('[...document.querySelectorAll("button")].some(el=>el.textContent==="Look")');
      await js('[...document.querySelectorAll("button")].find(el=>el.textContent==="Look").click()');
      await waitFor('document.querySelector(\'input[type="range"][min="0.85"]\')');
      await js('[...document.querySelectorAll("[role=radio]")].find(el=>el.textContent.trim()==="Off").click()');
      for (const scale of process.env.NOVA_LAYOUT_NAV_ONLY ? [] : process.env.NOVA_MOTION_ONLY ? [1.25] : [.85, 1, 1.25]) {
        await js(`{ const input=document.querySelector('input[type="range"][min="0.85"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${scale}'); input.dispatchEvent(new Event('input',{bubbles:true})); }`);
        await waitFor(`document.documentElement.dataset.uiScale === '${scale}'`);
        await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
        await checkScrollingTabs('[aria-label="Settings tabs"]');
        const result = await js(`(() => {
          const dock=document.querySelector('.nv-nav-dock').getBoundingClientRect();
          const buttons=[...document.querySelectorAll('nav button')].map(el=>el.getBoundingClientRect());
          const probe=document.createElement('div'); probe.className='nv-chat-root fixed inset-0'; document.querySelector('.nv-root').append(probe);
          const dockProbe=document.createElement('div'); dockProbe.className='nv-chat-dock'; probe.append(dockProbe);
          document.documentElement.style.setProperty('--kb','220px');
          /* the chat is not resized for the keyboard: its dock rides up by the keyboard's height */
          const rect=probe.getBoundingClientRect(); const padding=-new DOMMatrix(getComputedStyle(dockProbe).transform).m42*${scale};
          const rootPad=parseFloat(getComputedStyle(probe).paddingBottom);
          probe.remove(); document.documentElement.style.removeProperty('--kb');
          return { width:document.documentElement.clientWidth,height:document.documentElement.clientHeight,innerWidth,innerHeight,dock:{left:dock.left,right:dock.right,bottom:dock.bottom},
            viewport:{width:rect.width,height:rect.height},keyboard:padding,rootPad,buttonHeights:buttons.map(r=>r.height) };
        })()`);
        assert.ok(result.dock.left >= -1 && result.dock.right <= result.width + 1, JSON.stringify(result));
        assert.ok(Math.abs(result.viewport.width - result.width) < 2 && Math.abs(result.viewport.height - result.height) < 2, JSON.stringify(result));
        assert.ok(Math.abs(result.keyboard - 220) < 2 && result.rootPad === 0, JSON.stringify(result));
        assert.ok(Math.min(...result.buttonHeights) >= 44, JSON.stringify(result));
        console.log(`PASS: mobile ${result.width}x${result.height}, UI ${scale * 100}%, fixed surfaces, dock, keyboard inset and touch targets`);
        await js('[...document.querySelectorAll("nav button")].find(el=>el.textContent.trim()==="Create").click()');
        await waitFor('document.querySelector(\'button[aria-label="New character"]\')');
        await js('document.querySelector(\'button[aria-label="New character"]\').click()');
        await waitFor('document.querySelector(".nv-screen")');
        const editor = await js('(()=>{ const r=document.querySelector(".nv-screen").getBoundingClientRect(); return {width:r.width,height:r.height,w:document.documentElement.clientWidth,h:document.documentElement.clientHeight}; })()');
        assert.ok(Math.abs(editor.width-editor.w)<2 && Math.abs(editor.height-editor.h)<2, JSON.stringify(editor));
        console.log(`PASS: full-screen editor at ${scale * 100}%`);
        await js('document.querySelector(\'.nv-screen button[aria-label="Close"]\').click()');
        await waitFor('!document.querySelector(".nv-screen")');
        await js('window.SpeechRecognition = class {}; document.querySelector(\'[data-chat-card] button[aria-label="New chat"]\').click()');
        await waitFor('document.querySelector(".nv-chat-root") && document.querySelector(".nv-msg")');
        for (const width of [320, 390]) {
          win.setContentSize(width, 844);
          await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          const chat = await js(`(() => {
            const frame=document.querySelector('.nv-composer').getBoundingClientRect();
            const tools=[...document.querySelectorAll('.nv-composer-tools > button')].map(el=>el.getBoundingClientRect());
            const row=document.querySelector('.nv-composer-actions').getBoundingClientRect();
            const centers=[...document.querySelectorAll('.nv-composer-actions button')].map(el=>{const r=el.getBoundingClientRect();return (r.top+r.bottom)/2;});
            const bubble=document.querySelector('.nv-msg').getBoundingClientRect();
            const messages=document.querySelector('.nv-chat-messages').getBoundingClientRect();
            const header=getComputedStyle(document.querySelector('.nv-chat-header'));
            return {frame:{left:frame.left,right:frame.right},row:{top:row.top,bottom:row.bottom},
              tools:tools.map(r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom})),
              centers, ratio:bubble.width/messages.width, menu:!!document.querySelector('button[aria-label="Message options"]'),
              header:header.backgroundColor,blur:header.backdropFilter};
          })()`);
          assert.ok(chat.tools.every(r=>r.left>=chat.frame.left-1 && r.right<=chat.frame.right+1 && r.top>=chat.row.top-1 && r.bottom<=chat.row.bottom+1),JSON.stringify(chat));
          assert.ok(Math.max(...chat.centers)-Math.min(...chat.centers)<2,JSON.stringify(chat));
          assert.ok(chat.ratio>.9,JSON.stringify(chat)); assert.equal(chat.menu,false);
          assert.equal(chat.header,'rgba(0, 0, 0, 0)'); assert.equal(chat.blur,'none');
          console.log(`PASS: real chat ${width}px at ${scale*100}% — single-row tools, wide bubbles, transparent header`);
        }
        // Use a long transcript and a position away from the newest message.
        // The keyboard covers the chat's foot: nothing in the transcript moves
        // or resizes, the composer glides up on top of it, and it all comes
        // back the same on closing, text size and header untouched.
        const keyboardCheck = await js(`(async () => {
          const el=document.querySelector('.nv-chat-messages');
          const spacer=document.createElement('div'); spacer.style.height='3000px'; el.append(spacer);
          const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          await frame(); el.scrollTop=500; await frame();
          const measure=()=>({top:el.scrollTop,height:el.clientHeight,bottom:el.scrollHeight-el.scrollTop-el.clientHeight,
            font:getComputedStyle(document.querySelector('.nv-msg')).fontSize,
            header:document.querySelector('.nv-chat-header').getBoundingClientRect().top,
            composer:document.querySelector('.nv-composer').getBoundingClientRect().bottom});
          const before=measure();
          document.documentElement.dataset.kb='1'; document.documentElement.style.setProperty('--kb','220px');
          await frame(); await new Promise(r=>setTimeout(r,450)); const open=measure();
          document.documentElement.style.removeProperty('--kb'); delete document.documentElement.dataset.kb;
          await frame(); await new Promise(r=>setTimeout(r,450)); const closed=measure(); spacer.remove();
          return {before,open,closed};
        })()`);
        assert.ok(Math.abs(keyboardCheck.open.top-keyboardCheck.before.top)<2 && Math.abs(keyboardCheck.open.height-keyboardCheck.before.height)<2,JSON.stringify(keyboardCheck));
        assert.ok(Math.abs(keyboardCheck.closed.top-keyboardCheck.before.top)<2,JSON.stringify(keyboardCheck));
        assert.ok(Math.abs(keyboardCheck.before.composer-keyboardCheck.open.composer-220)<2,JSON.stringify(keyboardCheck));
        assert.equal(keyboardCheck.open.font,keyboardCheck.before.font);
        assert.equal(keyboardCheck.open.header,keyboardCheck.before.header);
        console.log(`PASS: keyboard preserves reading position and text size at ${scale*100}%`);
        if (process.env.NOVA_LAYOUT_SCREENSHOT && scale === 1) {
          fs.writeFileSync(process.env.NOVA_LAYOUT_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
        }
        win.setContentSize(390,844);
        await js('document.querySelector(\'button[aria-label="Chat settings"]\').click()');
        await waitFor('document.querySelector(\'nav[aria-label="Chat settings sections"]\')');
        const tabs=await js(`(()=>{const nav=document.querySelector('nav[aria-label="Chat settings sections"]');const r=nav.querySelector('button').getBoundingClientRect();return {width:r.width,height:r.height,scroll:nav.scrollWidth>nav.clientWidth};})()`);
        assert.ok(tabs.width>tabs.height*1.5 && tabs.scroll,JSON.stringify(tabs));
        for (const width of [320, 390, 768]) {
          win.setContentSize(width,844);
          await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
          await checkScrollingTabs('nav[aria-label="Chat settings sections"]');
        }
        win.setContentSize(390,844);
        await js('document.querySelector(\'.nv-sheet button[aria-label="Close"]\').click()');
        await waitFor('!document.querySelector(".nv-sheet")');
        await js('document.querySelector(\'button[aria-label="Go back"]\').click()');
        await waitFor('!document.querySelector(".nv-chat-root")');
        await js('[...document.querySelectorAll("nav button")].find(el=>el.textContent.trim()==="Settings").click()');
        await waitFor('document.querySelector(\'input[type="range"][min="0.85"]\')');
      }
      // Exercise the actual motion policy, rapid navigation and final geometry
      // at both phone and desktop widths, beyond the Off-mode layout matrix.
      for (const width of [390, 1280]) {
        win.setContentSize(width, 844);
        for (const label of ["Full motion", "Calm", "Off"]) {
          await js(`[...document.querySelectorAll('[role="radio"]')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).click()`);
          await js(`(async()=>{for(const name of ['Providers','Look','Memory','Look']){[...document.querySelectorAll('nav[aria-label="Settings tabs"] button')].find(el=>el.textContent===name).click();await new Promise(resolve=>requestAnimationFrame(resolve));}})()`);
          await waitFor(`document.querySelector('input[type="range"][min="0.85"]')`);
          await js('new Promise(resolve=>setTimeout(resolve,750))');
          const state = await js(`(()=>{const nav=document.querySelector('nav[aria-label="Settings tabs"]');const selected=nav.querySelector('[aria-pressed="true"]');const marker=selected;const r=marker.getBoundingClientRect(),s=selected.getBoundingClientRect();return {label:'${label}',left:r.left,selectedLeft:s.left,offsetLeft:selected.offsetLeft,transform:marker.style.transform,scroll:nav.scrollLeft,offset:Math.abs(r.left-s.left),ghosts:document.querySelectorAll('[data-motion-ghost]').length,ghostDetails:[...document.querySelectorAll('[data-motion-ghost]')].map(e=>e.outerHTML.slice(0,500)),visibility:document.visibilityState,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2};})()`);
          assert.ok(state.offset<2,JSON.stringify(state)); assert.equal(state.ghosts,0,JSON.stringify(state)); assert.equal(state.overflow,false);
        }
        console.log(`PASS: ${width}px Full/Calm/Off rapid navigation, marker alignment and settled geometry`);
      }
      const second = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, partition: "nova-layout-check" } });
      await second.loadURL(`http://127.0.0.1:${server.address().port}/`);
      await second.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 300))');
      assert.equal(await second.webContents.executeJavaScript('!!document.querySelector(".nv-nav-dock")'), false);
      assert.match(await second.webContents.executeJavaScript('document.body.textContent'), /another tab/);
      win.destroy();
      await second.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        let attempts = 0;
        const check = () => {
          if (document.querySelector('.nv-nav-dock')) return resolve();
          if (++attempts > 300) return reject(new Error('Writer lock did not transfer'));
          setTimeout(check, 20);
        };
        check();
      })`);
      assert.match(await second.webContents.executeJavaScript('document.body.textContent'), /Layout Check/);
      second.destroy();
      console.log("PASS: second tab cannot edit; ownership transfers and reloads saved data after first tab closes");
      console.log("Chromium mobile layout checks passed.");
      if (!win.isDestroyed()) win.destroy(); server.close(); app.exit(0);
    } catch (error) {
      console.error(error.stack || error); if (!win.isDestroyed()) win.destroy(); server.close(); app.exit(1);
    }
  });
}
