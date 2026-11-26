/* Builds Nova for the desktop as single files, without the source tree:
     out/Nova-<version>-x86_64.AppImage   (Linux, any distribution)
     out/Nova-<version>-amd64.deb         (Linux, Debian/Ubuntu/Mint: a menu entry, no FUSE)
     out/Nova-<version>-setup.exe         (Windows installer, per user, no admin)
     out/Nova-<version>-portable.exe      (Windows, no install)

   Run after `npm run build` (npm run build:desktop does both). Targets can be
   limited: node desktop/build-desktop.mjs --linux | --win

   Only the built web app, the Bridge window and a minified Bridge bundle go
   into the package. */

import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAGE = path.join(ROOT, "build", "desktop");
const OUT = path.join(ROOT, "out");
const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const electronVersion = JSON.parse(await readFile(path.join(ROOT, "node_modules/electron/package.json"), "utf8")).version;

const args = process.argv.slice(2);
const linux = !args.includes("--win");
const win = !args.includes("--linux");

if (!existsSync(path.join(ROOT, "dist", "index.html"))) {
  console.error("dist/ is missing. Run npm run build first.");
  process.exit(1);
}

await rm(STAGE, { recursive: true, force: true });
await mkdir(path.join(STAGE, "bridge-app", "vendor"), { recursive: true });

/* the app shell, and what Nova's page may ask of it (Start Bridge, the skin) */
await copyFile(path.join(ROOT, "desktop", "main.cjs"), path.join(STAGE, "main.cjs"));
await copyFile(path.join(ROOT, "desktop", "preload.cjs"), path.join(STAGE, "preload.cjs"));

/* the Bridge window (run as its own process: main.cjs --nova-bridge); its
   page and stylesheet point at files elsewhere in the repo, so bring them along */
for (const f of ["host.cjs", "preload.cjs", "renderer.js", "motion.js"]) {
  await copyFile(path.join(ROOT, "bridge", "app", f), path.join(STAGE, "bridge-app", f));
}
await cp(path.join(ROOT, "bridge", "app", "aero"), path.join(STAGE, "bridge-app", "aero"), { recursive: true });
await cp(path.join(ROOT, "bridge", "app", "holo"), path.join(STAGE, "bridge-app", "holo"), { recursive: true });
await copyFile(path.join(ROOT, "src/assets/fonts/OverusedGroteskRoman-VF.woff2"), path.join(STAGE, "bridge-app/vendor/font.woff2"));
await copyFile(path.join(ROOT, "public/icon-192.png"), path.join(STAGE, "bridge-app/vendor/icon-192.png"));
const page = (await readFile(path.join(ROOT, "bridge", "app", "index.html"), "utf8"))
  .replace("../../public/icon-192.png", "vendor/icon-192.png");
const css = (await readFile(path.join(ROOT, "bridge", "app", "bridge.css"), "utf8"))
  .replace("../../src/assets/fonts/OverusedGroteskRoman-VF.woff2", "vendor/font.woff2");
for (const [name, text] of [["index.html", page], ["bridge.css", css]]) {
  if (text.includes("../")) throw new Error(`bridge/app/${name} links a file outside the package: ` + text.match(/["(]\.\.\/[^")]+/)?.[0]);
  await writeFile(path.join(STAGE, "bridge-app", name), text);
}

/* Nova's own title bar (Windows), using the Bridge window's font and icon */
await mkdir(path.join(STAGE, "titlebar"), { recursive: true });
for (const f of ["index.html", "titlebar.css", "titlebar.js", "preload.cjs"]) {
  const text = (await readFile(path.join(ROOT, "desktop", "titlebar", f), "utf8"))
    .replace("../../public/icon-192.png", "../bridge-app/vendor/icon-192.png")
    .replace("../../src/assets/fonts/OverusedGroteskRoman-VF.woff2", "../bridge-app/vendor/font.woff2")
    .replace("../../bridge/app/aero/", "../bridge-app/aero/");
  if (text.includes("../../")) throw new Error(`desktop/titlebar/${f} links a file outside the package: ` + text.match(/["(]\.\.\/\.\.\/[^")]+/)?.[0]);
  await writeFile(path.join(STAGE, "titlebar", f), text);
}

/* Google sign-in (Antigravity) for the packaged Bridge: read from the
   builder's .env (NOVA_GOOGLE_CLIENT_ID / NOVA_GOOGLE_CLIENT_SECRET, or the
   same names in the environment) and built into the bundle, so downloads
   work without setup. Never kept in the repository. */
function readEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}
const env = { ...readEnv(path.join(ROOT, ".env")), ...process.env };
const google = env.NOVA_GOOGLE_CLIENT_ID && env.NOVA_GOOGLE_CLIENT_SECRET ? { id: env.NOVA_GOOGLE_CLIENT_ID, secret: env.NOVA_GOOGLE_CLIENT_SECRET } : null;
if (!google) console.warn("No NOVA_GOOGLE_CLIENT_ID / NOVA_GOOGLE_CLIENT_SECRET in .env: this build's Antigravity sign-in will need a .env next to the Bridge.");

/* the Bridge itself, as one minified file */
await build({
  define: { __NOVA_BUILT_GOOGLE__: JSON.stringify(google) },
  entryPoints: [path.join(ROOT, "bridge", "bridge.mjs")],
  outfile: path.join(STAGE, "bridge.mjs"),
  bundle: true,
  minify: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  logLevel: "warning",
});

/* Update, in the app (main.cjs): electron-updater as one file */
await build({
  entryPoints: [path.join(ROOT, "node_modules", "electron-updater", "out", "main.js")],
  outfile: path.join(STAGE, "updater.cjs"),
  bundle: true,
  minify: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node22",
  legalComments: "none",
  logLevel: "warning",
});

/* Nova's web build */
await cp(path.join(ROOT, "dist"), path.join(STAGE, "nova"), { recursive: true });
await rm(path.join(STAGE, "nova", "_headers"), { force: true });

await writeFile(path.join(STAGE, "package.json"), JSON.stringify({
  name: "nova",
  productName: "Nova",
  version: pkg.version,
  description: "AI chat and roleplay with your own providers",
  author: { name: "Nova", email: "nova@users.noreply.github.com" },
  homepage: "https://github.com/j-marchon/nova-ai",
  /* the Linux menu entry (nova.desktop) and the running window match */
  desktopName: "nova.desktop",
  main: "main.cjs",
  private: true,
}, null, 2));

/* Nova Bridge's own menu entry, beside Nova's: the same program, started
   with --nova-bridge. The .deb installs it with the package; on Windows Nova
   adds a Start-menu shortcut itself (desktop/main.cjs), and the installer's
   uninstaller removes it (desktop/installer.nsh). */
const bridgeEntry = path.join(ROOT, "build", "nova-bridge.desktop");
await writeFile(bridgeEntry, [
  "[Desktop Entry]",
  "Name=Nova Bridge",
  "Comment=Use your subscriptions in Nova, on this computer and your phone",
  "Exec=/opt/Nova/nova --nova-bridge %U",
  "Terminal=false",
  "Type=Application",
  "Icon=nova",
  "Categories=Utility;",
  "",
].join("\n"));

/* The Windows installer's uninstaller is made by running Windows code, so
   off Windows it needs Wine; without it only the portable .exe is built. */
const canBuildInstaller = process.platform === "win32" || spawnSync("wine", ["--version"], { stdio: "ignore" }).status === 0;
if (win && !canBuildInstaller) console.warn("Wine not found: building the portable .exe only (the Windows installer needs Windows or Wine).");

const config = {
  appId: "com.nova.roleplay.desktop",
  productName: "Nova",
  electronVersion,
  asar: true,
  directories: { output: OUT, app: STAGE },
  files: ["**/*"],
  artifactName: "Nova-${version}-${arch}.${ext}",
  linux: {
    target: [{ target: "AppImage", arch: ["x64"] }, { target: "deb", arch: ["x64"] }],
    icon: path.join(ROOT, "public", "icon-512.png"),
    category: "Utility",
    executableName: "nova",
    synopsis: "AI chat and roleplay with your own providers",
  },
  /* electron-builder's own dependencies, plus secret-tool: the Bridge reads
     Antigravity's sign-in from the keyring with it. apt installs what is missing. */
  deb: {
    artifactName: "Nova-${version}-amd64.deb",
    fpm: [`${bridgeEntry}=/usr/share/applications/nova-bridge.desktop`],
    depends: ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0", "libsecret-tools"],
  },
  win: {
    target: [...(canBuildInstaller ? [{ target: "nsis", arch: ["x64"] }] : []), { target: "portable", arch: ["x64"] }],
    icon: path.join(ROOT, "public", "icon-512.png"),
    /* writes the icon and name into Nova.exe (rcedit, run on Windows or Wine; nothing is
       signed without a certificate). Without it Windows shows Electron's icon on the
       Start-menu entries, the taskbar and the Nova Bridge shortcut. */
    signAndEditExecutable: canBuildInstaller,
  },
  portable: { artifactName: "Nova-${version}-portable.exe" },
  /* a Start-menu entry and an uninstaller, for this user only (no admin);
     uninstalling keeps the library in %APPDATA%\Nova */
  nsis: { artifactName: "Nova-${version}-setup.exe", oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, include: path.join(ROOT, "desktop", "installer.nsh") },
  /* where Update looks (main.cjs): the public releases. Builds write latest.yml (Windows) and
     latest-linux.yml (AppImage and .deb) beside the files; upload them with the release. */
  publish: { provider: "github", owner: "j-marchon", repo: "nova-ai", releaseType: "release" },
};
const configFile = path.join(ROOT, "build", "desktop-builder.json");
await writeFile(configFile, JSON.stringify(config, null, 2));

const targets = [...(linux ? ["--linux"] : []), ...(win ? ["--win"] : [])];
const run = spawnSync(process.execPath, [path.join(ROOT, "node_modules/electron-builder/cli.js"), "--config", configFile, "--projectDir", STAGE, "--publish", "never", ...targets],
  { stdio: "inherit", cwd: ROOT, env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" } });
process.exit(run.status ?? 1);
