import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(`${dir}/${e.name}`) : `${dir}/${e.name}`))).flat();
}
const packages = ["react", "react-dom", "scheduler", "lucide-react", "dompurify", "mediabunny", "gsap",
  "@capacitor/android", "@capacitor/core", "@capacitor/filesystem", "@capacitor/share", "@capacitor/app", "@capacitor/keyboard", "@capacitor/synapse"];
const notices = [await readFile("src/assets/fonts/LICENSE.txt", "utf8")];
for (const name of packages) {
  const dir = `node_modules/${name}`;
  const pkg = JSON.parse(await readFile(`${dir}/package.json`, "utf8"));
  const licenses = (await readdir(dir)).filter(f => /^(license|notice)([.-]|$)/i.test(f)).sort();
  if (!licenses.length && name !== "gsap") throw new Error(`Missing license for ${name}`);
  notices.push([`${name} ${pkg.version}`, pkg.license, ...await Promise.all(licenses.map(f => readFile(`${dir}/${f}`, "utf8")))].join("\n"));
}
await writeFile("dist/THIRD-PARTY-NOTICES.txt", notices.join("\n\n"));
const assets = (await files('dist')).filter(p => !p.endsWith('/sw.js') && !p.endsWith('/_headers')).sort();
const hash = createHash('sha256');
for (const file of assets) hash.update(await readFile(file));
/* the bundled skin zips (17 MB) stay out of the install cache; the service
   worker keeps each one the first time it is worn (public/sw.js) */
const template = await readFile('public/sw.js', 'utf8');
await writeFile('dist/sw.js', template.replace('__RELEASE__', hash.digest('hex').slice(0, 16)).replace('__ASSETS__', JSON.stringify(assets.filter(p => !p.endsWith('.zip')).map(p => p.slice(4)))));
