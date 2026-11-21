/* A stand-in for Chrome, for tests/geminiCookies.test.js: writes DevToolsActivePort,
   serves just enough of the DevTools protocol over a hand-made WebSocket, and
   exits when asked (or by itself, as a user closing the window would).

   Env: FAKE_COOKIES  JSON [{ name, value, domain }] shown by Storage.getCookies
        FAKE_DELAY    ms before the cookies appear (the user signing in)
        FAKE_EXIT_AFTER  ms after which it quits on its own
        FAKE_LEARN    JSON [{ prompt, header, url? }] sent as requests once a page is attached */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const profile = process.argv.find((a) => a.startsWith("--user-data-dir="))?.slice(16);
const started = Date.now();
const cookies = JSON.parse(process.env.FAKE_COOKIES || "[]");
const delay = Number(process.env.FAKE_DELAY || 0);
const learn = JSON.parse(process.env.FAKE_LEARN || "[]");
const bodies = {};
/* a tiny protobuf writer, for the newer web app's processSession messages */
const vint = (n) => { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return Buffer.from(out); };
const pb = (fields) => Buffer.concat(fields.map(([f, v]) => typeof v === "number"
  ? Buffer.concat([vint(f * 8), vint(v)])
  : (() => { const b = Buffer.isBuffer(v) ? v : Array.isArray(v) ? pb(v) : Buffer.from(String(v)); return Buffer.concat([vint(f * 8 + 2), vint(b.length), b]); })()));
const sessionConfig = (model, prompt) => pb([[1, [[1, [[1, 1], [2, model], [3, "en-US"]]], [2, 0],
  ...(prompt ? [[8, [[5, [[1, [[1, [[1, prompt], [2, 0], [7, 0]]], [2, [[1, "en-US"]]]]]]]]]] : [])]]]);
const sessionText = (prompt) => pb([[2, [[1, 1], [9, [[1, prompt]]]]]]);
const form = (msgs) => new URLSearchParams([["count", String(msgs.length)], ["ofs", "0"], ...msgs.map((b, i) => [`req${i}___data__`, b.toString("base64")])]).toString();

const frame = (obj) => {
  const body = Buffer.from(JSON.stringify(obj));
  const head = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([head, body]);
};

const server = http.createServer((req, res) => res.end("fake"));
server.on("upgrade", (req, socket) => {
  const accept = crypto.createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const send = (o) => socket.write(frame(o));
  let buf = Buffer.alloc(0);
  const handle = (m) => {
    const reply = (result = {}) => send({ id: m.id, result, ...(m.sessionId ? { sessionId: m.sessionId } : {}) });
    switch (m.method) {
      case "Storage.getCookies": return reply({ cookies: Date.now() - started >= delay ? cookies : [] });
      case "Target.getTargets": return reply({ targetInfos: [{ targetId: "t1", type: "page", url: "https://gemini.google.com/app" }, { targetId: "t2", type: "service_worker" }] });
      case "Target.attachToTarget": return reply({ sessionId: "s1" });
      case "Network.enable":
        reply();
        learn.forEach((l, i) => setTimeout(() => {
          const requestId = `r${i}`;
          const headers = l.header ? { "X-Goog-Ext-525001261-Jspb": l.header, "content-type": "x" } : { "content-type": "x", ...(l.ext || {}) };
          if (l.session) {
            /* "combined": model and text in one message; "split": two requests */
            const bodiesNow = l.session === "split" ? [form([sessionConfig(l.model)]), form([sessionText(l.prompt)])] : [form([sessionConfig(l.model, l.prompt)])];
            bodiesNow.forEach((body, j) => setTimeout(() => send({
              method: "Network.requestWillBeSent",
              sessionId: "s1",
              params: { requestId: `${requestId}.${j}`, request: { url: "https://geminiweb-pa.clients6.google.com/v1/processSession?VER=8&RID=1", method: "POST", headers: {}, hasPostData: true, postData: body } },
            }), j * 5));
            return;
          }
          const body = `f.req=${encodeURIComponent(JSON.stringify([null, JSON.stringify([[l.prompt, 0, null, null, null, null, 0], ["en"], null])]))}&at=tok`;
          bodies[requestId] = body;
          /* extraInfo: the model header only in the headers really sent; noBody: the body must be asked for */
          send({
            method: "Network.requestWillBeSent",
            sessionId: "s1",
            params: { requestId, request: {
              url: l.url || "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=x",
              method: "POST",
              headers: l.extraInfo ? { "content-type": "x" } : headers,
              hasPostData: true,
              ...(l.noBody ? {} : { postData: body }),
            } },
          });
          if (l.extraInfo) setTimeout(() => send({ method: "Network.requestWillBeSentExtraInfo", sessionId: "s1", params: { requestId, headers } }), 5);
          setTimeout(() => send({ method: "Network.responseReceived", sessionId: "s1", params: { requestId } }), 10);
        }, 50 + i * 20));
        return;
      case "Network.getRequestPostData": return reply({ postData: bodies[m.params.requestId] || "" });
      case "Storage.setCookies": fs.writeFileSync(path.join(profile, "set-cookies.json"), JSON.stringify(m.params)); return reply();
      case "Page.navigate": fs.appendFileSync(path.join(profile, "navigations.log"), `${m.params.url}\n`); return reply();
      case "Browser.close": reply(); return setTimeout(() => process.exit(0), 50);
      default: return reply();
    }
  };
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15;
      let len = buf[1] & 127;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4);
      const data = Buffer.from(buf.subarray(off + 4, off + 4 + len).map((b, i) => b ^ mask[i % 4]));
      buf = buf.subarray(off + 4 + len);
      if (op === 8) { socket.end(); return; }
      if (op === 1) handle(JSON.parse(data.toString()));
    }
  });
  socket.on("error", () => {});
});
server.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(path.join(profile, "DevToolsActivePort"), `${server.address().port}\n/devtools/browser/fake\n`);
});
if (process.env.FAKE_EXIT_AFTER) setTimeout(() => process.exit(0), Number(process.env.FAKE_EXIT_AFTER));
