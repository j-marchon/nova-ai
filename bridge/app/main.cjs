/* Nova Bridge, in a window, on its own. Start it with bridgeStart.sh (Linux)
   or bridgeStart.cmd (Windows), or with Start Bridge in the Nova desktop app,
   which runs the same program in a process of its own (desktop/main.cjs). */

const path = require("node:path");
const { runBridgeApp } = require("./host.cjs");

const ROOT = path.join(__dirname, "..", "..");

runBridgeApp({
  bridgeFile: path.join(ROOT, "bridge", "bridge.mjs"),
  icon: path.join(ROOT, "public", "icon-512.png"),
});
