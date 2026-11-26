import { Brain, Cable, HardDrive, MessagesSquare, Palette, PenTool, Smartphone } from "lucide-react";
import { SUPPORT_URL } from "../skins/skins.js";

/* Ko-fi's mark: a white mug with a red heart */
function KofiCup({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M3 6h13v7a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5z" fill="#fff" />
      <path d="M16 8h1.5a3 3 0 0 1 0 6H16" stroke="#fff" strokeWidth="2" fill="none" />
      <path d="M9.5 15l-2.7-2.6a1.65 1.65 0 0 1 2.7-1.9 1.65 1.65 0 0 1 2.7 1.9z" fill="#ff5e5b" />
    </svg>
  );
}

const SECTIONS = [
  { icon: MessagesSquare, title: "Chat", items: ["One-on-one, group chats (Nova Scope) and Universes", "Swipes, versions, continue and impersonate", "Bookmarks, branches and read aloud"] },
  { icon: PenTool, title: "Create", items: ["Characters, universes, personas and lorebooks", "AI Card Studio writes a whole card from an idea", "SillyTavern and Chub cards, presets and chat files"] },
  { icon: Brain, title: "Memory", items: ["Scene tracker, story summary and recall", "Lorebooks with SillyTavern's entry options"] },
  { icon: Smartphone, title: "Phone", items: ["Your persona's phone in the chat", "Messages, social apps, gallery and bank"] },
  { icon: Cable, title: "Models", items: ["OpenRouter, Google, local or any OpenAI-compatible server", "Nova Bridge: Gemini, ChatGPT, Claude and Antigravity sign-ins, no API key"] },
  { icon: Palette, title: "Look", items: ["Nova, Minimal, Aero and Holo skins", "Light and dark, chat backgrounds, bubble colours, UI size"] },
  { icon: HardDrive, title: "Backup", items: ["Everything stays on this device and works offline", "Full backups and sync between your devices"] },
];

/* Settings → About: what Nova does, by section, under the Ko-fi button. */
export function AboutPanel() {
  return (
    <div className="space-y-3">
      <div className="nv-rise nv-block p-4 sm:p-5 flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-lg text-zinc-100 font-medium">Nova</p>
          <p className="text-sm text-zinc-400">Roleplay with your own models. Free for everyone.</p>
        </div>
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="nv-kofi inline-flex flex-1 sm:flex-none justify-center items-center gap-2 h-12 px-5 rounded-full text-[15px] font-semibold"
          /* inline: the light theme remaps text-white */
          style={{ color: "#fff" }}
        >
          <KofiCup />
          Support Nova on Ko-fi
        </a>
      </div>
      <div className="grid sm:grid-cols-2 gap-2 sm:gap-3">
        {SECTIONS.map((s, i) => (
          <section key={s.title} className="nv-rise nv-block p-4 sm:p-5 space-y-3" style={{ "--i": i + 1 }} aria-label={s.title}>
            <p className="flex items-center gap-2 nv-label nv-label--ink"><s.icon size={15} strokeWidth={1.6} aria-hidden />{s.title}</p>
            <ul className="space-y-1.5 text-sm text-zinc-300 leading-snug">
              {s.items.map((t) => <li key={t} className="flex gap-2"><span aria-hidden className="text-zinc-500">·</span><span>{t}</span></li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
