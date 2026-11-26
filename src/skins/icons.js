/* ---------- the app icon ----------

   Look → App icon: Auto (the default) wears the skin's own icon; any other
   pick is kept whatever the skin. The skins that bring their own icon (made
   by scripts/make-skin-icons.cjs) are the choices; a supporter skin's only
   where it is unlocked. Applied everywhere Nova runs: on Android the icon
   is noted and switched the next time Nova starts (NovaIconPlugin:
   switching it while Nova is open would close the app); in the desktop app
   the window icon changes and, on Linux, the menu entries' too
   (desktop/main.cjs, told through novaDesktop.setIcon); in a browser, the
   tab's icon. */
import { canWear, isBuiltInSkin, skinOf } from "./skins.js";

export const SKIN_ICONS = ["nova", "minimal", "aero", "holo"];
export const iconFor = (skin) => (SKIN_ICONS.includes(skin) ? skin : "nova");

/* the icons this device may pick */
export const iconChoices = () => SKIN_ICONS.filter((id) => isBuiltInSkin(id) || canWear(id));
/* the picked icon, or "auto" */
export const iconPick = (appearance) => (iconChoices().includes(appearance?.icon) ? appearance.icon : "auto");
/* the icon worn: the picked one, or the skin's own */
export const appIconOf = (appearance) => {
  const pick = iconPick(appearance);
  return pick === "auto" ? iconFor(skinOf(appearance)) : pick;
};
/* its picture, as the app serves it */
export const iconSrc = (icon) => `${import.meta.env?.BASE_URL || "/"}${icon === "nova" ? "icon-192.png" : `icons/${iconFor(icon)}.png`}`;

export function applyAppIcon(icon) {
  const id = iconFor(icon);
  const native = globalThis.window?.Capacitor?.isNativePlatform?.();
  const plugin = native && window.Capacitor.Plugins?.NovaIcon;
  if (plugin) plugin.set({ skin: id }).catch((e) => console.warn("Could not change the app icon:", e?.message || e));
  if (native) return;
  window.novaDesktop?.setIcon?.(id);
  for (const link of document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')) link.setAttribute("href", iconSrc(id));
}
