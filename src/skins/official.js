/* ---------- the skins Nova accepts ----------

   Only published skins can be added: each is known by the SHA-256 of the
   .zip as it is sold. A file whose hash is not listed here is turned away,
   whether it is picked by hand, comes in a backup or arrives through Sync.
   Publishing a new skin, or a new version of one, means adding its hash. */
export const OFFICIAL_SKINS = {
  aero: [
    "02dad90a0fc6d4cbd964d2eb3c689e0d4423d3011eba2602f366ef2dd3c4e473", // Nova-Aero-skin-1.2.0.zip: the scenes at 4K
    "0d2bb93ed3b95792d5ba620e21a65048c380f458aded93dd3d35ec9120f149d6", // Nova-Aero-skin-1.1.0.zip: the layered scenes
    "b5b60fcb1e2319add2fdb24a4884bc88b9974412b1dad501d791b99545678718", // Nova-Aero-skin-1.0.0.zip
  ],
};

const known = new Map(Object.entries(OFFICIAL_SKINS).flatMap(([id, hashes]) => hashes.map((h) => [h, id])));
let trustAll = false;

export async function sha256Hex(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* The skin a file is, by its hash, or null for any other file. */
export async function officialSkinOf(bytes) {
  if (trustAll) return "*";
  return known.get(await sha256Hex(bytes)) || null;
}

/* for tests, which build packs of their own */
export function trustAllSkinsForTests(on = true) { trustAll = on; }
