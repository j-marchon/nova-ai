import { AtSign, Globe2, Images, Landmark, MessageCircle, Settings } from "lucide-react";
import { SetupCard, openAccount } from "./parts.jsx";
import { NotificationCentre } from "./Notifications.jsx";

/* ---------- the home screen: four apps, the notification centre, World,
   and Settings (the persona's profile is the name in the top row) (how lively the phone is, the new-chat default, how
   known the persona is: PhoneSettings.jsx) ---------- */
/* each tile a bright colour pair with a white glyph */
export const PHONE_APPS_UI = [
  /* Murmur's badge: what is aimed at the persona (comments, quotes, @mentions), not every new post */
  { id: "murmur", label: "Murmur", icon: AtSign, colors: ["#38bdf8", "#4f46e5"], count: (u) => u?.mentions ?? 0 },
  { id: "messages", label: "Messages", icon: MessageCircle, colors: ["#4ade80", "#059669"], count: (u) => u?.messages ?? 0 },
  { id: "gallery", label: "Gallery", icon: Images, colors: ["#fbbf24", "#e11d48"], count: () => 0 },
  { id: "bank", label: "Bank", icon: Landmark, colors: ["#c084fc", "#7c3aed"], count: (u) => u?.bank ?? 0 },
];

export { openAccount };

/* the dock: World and Settings, always within reach at the foot of home */
const DOCK = [
  { id: "world", label: "World", icon: Globe2, colors: ["#2dd4bf", "#0e7490"], testid: "phone-world" },
  { id: "settings", label: "Settings", icon: Settings, colors: ["#a1a1aa", "#52525b"], testid: "phone-settings" },
];

function Icon({ a, n = 0, tile = true }) {
  return (
    <span
      className="nv-ios-icon relative flex items-center justify-center"
      style={{ backgroundImage: `linear-gradient(150deg, ${a.colors[0]}, ${a.colors[1]})`, backgroundColor: a.colors[1], color: "#fff" }}
      {...(tile ? { "data-tile": a.id } : { "data-dock-tile": a.id })}
    >
      <a.icon size={26} strokeWidth={1.9} />
      {n > 0 && (
        <span aria-hidden data-unread-dot="" className="nv-ios-badge absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full text-[11px] font-semibold leading-5 text-center">
          {n > 9 ? "9+" : n}
        </span>
      )}
    </span>
  );
}

export function PhoneHome({ ctx }) {
  return (
    <div className="nv-ios-home flex flex-col min-h-full px-5 pt-4">
      {ctx.needsSetup && <div className="mb-6"><SetupCard ctx={ctx} compact /></div>}
      <div className="grid grid-cols-4 gap-x-2 gap-y-5" role="list" aria-label="Apps">
        {PHONE_APPS_UI.map((a) => {
          const n = a.count(ctx.unread) || 0;
          return (
            <div key={a.id} role="listitem" className="flex justify-center min-w-0">
              <button
                type="button"
                onClick={() => ctx.open({ app: a.id })}
                aria-label={n ? `${a.label}, ${n} new` : a.label}
                className="nv-ios-app flex flex-col items-center gap-1.5 min-w-0 max-w-full"
              >
                <Icon a={a} n={n} />
                <span className="text-[11px] text-zinc-200 truncate max-w-full">{a.label}</span>
              </button>
            </div>
          );
        })}
      </div>

      <NotificationCentre ctx={ctx} />

      <span className="flex-1 min-h-6" />
      <div className="nv-ios-dock sticky bottom-3 mb-3 mx-auto flex items-center justify-center gap-6 px-6 py-3" role="list" aria-label="Dock">
        {DOCK.map((a) => (
          <div key={a.id} role="listitem">
            <button type="button" onClick={() => ctx.open({ app: a.id })} aria-label={a.label} data-testid={a.testid} className="nv-ios-app flex flex-col items-center gap-1">
              <Icon a={a} tile={false} />
              <span className="text-[10px] text-zinc-300">{a.label}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
