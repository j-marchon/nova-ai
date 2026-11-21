/* ---------- the app icon follows the skin ----------

   The skins that bring their own icon (made by scripts/make-skin-icons.cjs);
   any other wears Nova's. On Android the launcher entry for the icon is
   switched on (NovaIconPlugin); in the desktop app the window icon changes
   and, on Linux, the menu entry's too (desktop/main.cjs, told through
   novaDesktop.setSkin). The browser keeps its own. */
export const SKIN_ICONS = ["nova", "minimal", "aero"];
export const iconFor = (skin) => (SKIN_ICONS.includes(skin) ? skin : "nova");

export function applySkinIcon(skin) {
  const plugin = globalThis.window?.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.NovaIcon;
  if (plugin) plugin.set({ skin: iconFor(skin) }).catch((e) => console.warn("Could not change the app icon:", e?.message || e));
}
