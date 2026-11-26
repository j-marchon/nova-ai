/* ---------- a skin's shaders ----------

   A skin brings GLSL fragment shaders as text; the app sets them up and
   feeds them. GLSL runs on the GPU and has no way to reach the page, the
   network or storage, so a shader from a pack is as safe as its pictures.

   Two kinds, each with fixed inputs:
   - "field": the full-screen layer behind every screen. Inputs: res
     (pixels), t (seconds) and the pack's own number uniforms. A field that
     also declares `dark` (1 in dark mode, 0 in light), `scene` (the place
     of the chosen background among the skin's backgrounds, from 0), `ptr` (the pointer,
     0..1, eased) or `flow` (how far the page has been scrolled, in screens,
     eased) is given them, and then the page gets the same motion as CSS
     variables on the root (--hx and --hy: the pointer, -1..1; --hf: a
     slow drift plus the scroll, in pixels), so a skin's surfaces can catch
     the same light as its background. Drawn at a
     fraction of the screen's pixels, at most `fps` times a second, never
     while the app is hidden, and held on one still frame when motion is
     Calm or Off (the scene decides).
   - "glyph": a small canvas drawn over Nova's mark on the startup screen.
     Inputs: tex (the app's logo), t, px (one texel) and the pack's own.

   Any failure (no WebGL, a shader that does not compile) returns null and
   the skin's still layers carry the look. */

const VERT = `attribute vec2 p; varying vec2 v; void main() { v = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const MAX_PIXELS = 280000;

function program(gl, frag) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  /* one triangle that covers the canvas */
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  return { prog, buf };
}

function setUniforms(gl, prog, uniforms) {
  for (const [k, v] of Object.entries(uniforms || {})) {
    const at = gl.getUniformLocation(prog, k);
    if (at) gl.uniform1f(at, v);
  }
}


/* ---------- the motion a field may follow ----------
   One shared tracker for every field: the pointer and the scroll of
   whatever scrolls (scroll events do not bubble, so they are caught on the
   way down). It only listens while a field that asks for it is mounted. */
const motion = { users: 0, tx: .5, ty: .5, x: .5, y: .5, scroll: 0, flow: 0, tops: new WeakMap(), off: null };
function trackMotion() {
  if (motion.users++) return;
  const move = (e) => { motion.tx = e.clientX / Math.max(1, innerWidth); motion.ty = e.clientY / Math.max(1, innerHeight); };
  const scroll = (e) => {
    const el = e.target === document ? document.scrollingElement : e.target;
    if (!el || el.scrollTop == null) return;
    const prev = motion.tops.get(el);
    motion.tops.set(el, el.scrollTop);
    if (prev != null) motion.scroll += el.scrollTop - prev;
  };
  addEventListener("pointermove", move, { passive: true });
  addEventListener("scroll", scroll, { capture: true, passive: true });
  motion.off = () => { removeEventListener("pointermove", move); removeEventListener("scroll", scroll, { capture: true }); };
}
function untrackMotion() { if (--motion.users === 0) { motion.off?.(); motion.off = null; } }
/* eases toward the pointer and the scroll, once per frame drawn */
function stepMotion(dt) {
  const k = 1 - Math.pow(.001, dt);  /* the same glide at any frame rate */
  motion.x += (motion.tx - motion.x) * k * .35;
  motion.y += (motion.ty - motion.y) * k * .35;
  const target = motion.scroll / Math.max(1, innerHeight);
  motion.flow += (target - motion.flow) * k * .25;
}
const isLight = () => document.documentElement.dataset.theme === "light";
const sceneIx = () => Number(document.documentElement.dataset.sceneIx) || 0;

/* The field. Returns { play, still, resize, stop } or null. */
export function startField(canvas, spec) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false });
  if (!gl) return null;
  const { prog, buf } = program(gl, spec.frag);
  const uRes = gl.getUniformLocation(prog, "res");
  const uT = gl.getUniformLocation(prog, "t");
  const uDark = gl.getUniformLocation(prog, "dark");
  const uScene = gl.getUniformLocation(prog, "scene");
  const uPtr = gl.getUniformLocation(prog, "ptr");
  const uFlow = gl.getUniformLocation(prog, "flow");
  const follows = !!(uPtr || uFlow);
  setUniforms(gl, prog, spec.uniforms);
  const frameMs = 1000 / (spec.fps || 30);
  if (follows) trackMotion();

  let raf = 0, last = 0, running = false, lastDraw = performance.now(), lastVars = 0;
  /* the moment a still frame shows, so it stays the same frame */
  let frozen = performance.now(), drawn = false;
  let t0 = performance.now() - 40000 * Math.random();
  const size = () => {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    const scale = Math.min(.5, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
    const cw = Math.max(32, Math.round(w * scale)), ch = Math.max(32, Math.round(h * scale));
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    gl.viewport(0, 0, cw, ch);
    gl.uniform2f(uRes, cw, ch);
  };
  const draw = (now) => {
    const t = (now - t0) / 1000;
    gl.uniform1f(uT, t);
    if (uDark) gl.uniform1f(uDark, isLight() ? 0 : 1);
    if (uScene) gl.uniform1f(uScene, sceneIx());
    if (follows) {
      stepMotion(Math.min(.1, Math.max(0, (now - lastDraw) / 1000)));
      lastDraw = now;
      if (uPtr) gl.uniform2f(uPtr, motion.x, motion.y);
      if (uFlow) gl.uniform1f(uFlow, motion.flow);
      /* the page's own surfaces follow the same light, at a gentler rate */
      if (now - lastVars > 45) {
        lastVars = now;
        const st = document.documentElement.style;
        st.setProperty("--hx", (motion.x * 2 - 1).toFixed(3));
        st.setProperty("--hy", (motion.y * 2 - 1).toFixed(3));
        st.setProperty("--hf", (t * 9 + motion.flow * 520).toFixed(1));
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (now - last < frameMs) return;
    last = now;
    draw(now);
  };
  size();
  /* wearing the other mode, or another background, while the frame is still: draw it again */
  const watch = (uDark || uScene) && typeof MutationObserver !== "undefined" ? new MutationObserver(() => { if (!running) draw(frozen); }) : null;
  watch?.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-scene-ix"] });
  return {
    /* the clock picks up where the still frame left it, so the light
       never jumps after a sheet closes or Full comes back */
    play() { if (running) return; running = true; t0 += performance.now() - frozen; raf = requestAnimationFrame(loop); },
    still() {
      if (running) { running = false; cancelAnimationFrame(raf); frozen = performance.now(); draw(frozen); }
      else if (!drawn) draw(frozen);
      drawn = true;
    },
    resize() { size(); if (!running) draw(frozen); },
    /* the context is left alive: the canvas may be mounted again (React's
       development double-mount does exactly that), and a lost context
       handed back by getContext would never draw */
    stop() {
      running = false; cancelAnimationFrame(raf); gl.deleteProgram(prog); gl.deleteBuffer(buf);
      watch?.disconnect();
      if (follows) {
        untrackMotion();
        for (const k of ["--hx", "--hy", "--hf"]) document.documentElement.style.removeProperty(k);
      }
    },
  };
}

/* The glyph: runs until stopped; marks the canvas data-live once it draws. */
export function startGlyph(canvas, spec, logoUrl) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) return null;
  let made;
  try { made = program(gl, spec.frag); } catch { return null; }
  const { prog, buf } = made;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const uT = gl.getUniformLocation(prog, "t");
  const uPx = gl.getUniformLocation(prog, "px");
  if (uPx) gl.uniform1f(uPx, 1 / 256);
  setUniforms(gl, prog, spec.uniforms);
  const frameMs = 1000 / (spec.fps || 30);
  let raf = 0, alive = true;
  const img = new Image();
  img.onload = () => {
    if (!alive) return;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    const t0 = performance.now();
    canvas.dataset.live = "1";
    let last = 0;
    const frame = (now) => {
      if (!alive) return;
      if (now - last < frameMs) { raf = requestAnimationFrame(frame); return; }
      last = now;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uT, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  };
  img.src = logoUrl;
  /* the context is left alive for the same canvas to use again */
  return { stop() { alive = false; cancelAnimationFrame(raf); gl.deleteProgram(prog); gl.deleteBuffer(buf); } };
}
