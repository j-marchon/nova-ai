/* the buttons, and the look Nova's page reports (desktop/main.cjs) */
const bar = window.novaBar;
document.getElementById("minimize").onclick = () => bar.window("minimize");
document.getElementById("maximize").onclick = () => bar.window("maximize");
document.getElementById("close").onclick = () => bar.window("close");
bar.onLook(({ skin, scheme, maximized }) => {
  const root = document.documentElement;
  root.dataset.skin = skin;
  root.dataset.scheme = scheme;
  root.dataset.max = maximized ? "1" : "0";
  document.getElementById("maximize").setAttribute("aria-label", maximized ? "Restore" : "Maximize");
});
