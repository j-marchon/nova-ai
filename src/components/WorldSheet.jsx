import { useMemo } from "react";
import { BookOpen, Check, CloudSun, MapPin } from "lucide-react";
import { Button, Modal, Pic, ToggleRow, selStyle } from "./ui.jsx";
import { parseWorldNote, visibleLog } from "../lib/memory.js";

/* ============================================================
   The World sheet of a universe chat: where the scene is, the
   card's places (with "Go here"), where everyone is, and what
   has been happening off-screen. Everything here is read from the
   world tracker's note (chat.scene) and the world log; the sheet
   itself writes nothing.
   ============================================================ */

/* lower case letters and digits only, without a leading "the" */
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");

/* "The Harbour Market" and "harbour market, by the stalls" are the same place */
export function samePlace(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || y.includes(x) || x.includes(y);
}

const firstName = (name) => norm(name).split(" ")[0] || "";
const mentions = (text, name) => {
  const t = ` ${norm(text)} `;
  const full = norm(name);
  const first = firstName(name);
  return !!full && (t.includes(` ${full} `) || (first.length > 2 && t.includes(` ${first} `)));
};
const sameName = (a, b) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || firstName(a) === firstName(b));
};

/* the time of day from the tracker's "day, date, time" */
export const timeOf = (when) => String(when || "").split(",").map((s) => s.trim()).filter(Boolean).at(-1) || "";

const Head = ({ children }) => (
  <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase px-1">{children}</p>
);
const row = "flex items-center gap-3 p-3 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)]";

export function WorldSheet({ universe, chat, lead, busy, onLead, onNarrate, onGo, onClose }) {
  const note = useMemo(() => (chat?.scene?.text ? parseWorldNote(chat.scene.text) : null), [chat?.scene?.text]);
  const log = useMemo(() => visibleLog(chat).slice(-5).reverse(), [chat?.world, chat?.messages]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasNote = !!(note && (note.place || note.when || note.here));
  const places = universe?.locations || [];
  const people = universe?.characters || [];
  const currentPlace = hasNote ? places.find((l) => samePlace(l.name, note.place)) : null;

  return (
    <Modal title={universe?.name || "World"} onClose={onClose}>
      <div className="space-y-4">
        <div className="space-y-2">
          <Head>Now</Head>
          {hasNote ? (
            <div className="p-3 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-1">
              <p className="text-sm text-zinc-100 flex items-center gap-1.5 min-w-0">
                <MapPin size={13} className="shrink-0" style={{ color: "var(--acc)" }} />
                <span className="truncate">{[note.place, note.when].filter(Boolean).join(" · ")}</span>
                {note.weather && (
                  <span className="inline-flex items-center gap-1 text-zinc-400 shrink-0 text-xs"><CloudSun size={12} /> {note.weather}</span>
                )}
              </p>
              {note.here && <p className="text-[12px] text-zinc-400 leading-snug">{note.here}</p>}
            </div>
          ) : (
            <p className="text-[12px] text-zinc-500 px-1">The world comes into focus after a couple of replies.</p>
          )}
        </div>

        {places.length > 0 && (
          <div className="space-y-2">
            <Head>Places</Head>
            {places.map((l) => {
              const here = currentPlace === l;
              return (
                <div key={l.id || l.name} className={row} data-place={l.name} data-here={here ? "1" : undefined}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-100 truncate">{l.name}</p>
                    {l.description && <p className="text-[11px] text-zinc-500 truncate">{l.description}</p>}
                  </div>
                  {here ? (
                    <span className="inline-flex items-center gap-1 text-[11px] shrink-0" style={{ color: "var(--acc)" }}><Check size={12} /> You are here</span>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => onGo(l.name)}
                      disabled={busy}
                      className="shrink-0"
                      aria-label={`Go to ${l.name}`}
                    >
                      Go here
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {people.length > 0 && (
          <div className="space-y-2">
            <Head>Where everyone is</Head>
            {people.map((c) => {
              const present = hasNote && mentions(note.here, c.name);
              const away = !present && hasNote ? note.elsewhere.find((e) => sameName(e.name, c.name)) : null;
              const leads = lead?.id === c.id;
              return (
                <button
                  key={c.id || c.name}
                  onClick={() => onLead(c)}
                  aria-pressed={leads}
                  aria-label={`${c.name}${present ? ", here" : away ? `, ${away.text}` : ""}`}
                  className={`${row} w-full text-left`}
                >
                  <Pic src={c.avatar} name={c.name} size="w-9 h-9" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-100 truncate">{c.name}</p>
                    {away && <p className="text-[11px] text-zinc-500 leading-snug line-clamp-2">{away.text}</p>}
                  </div>
                  {present && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full shrink-0" style={{ ...selStyle(true), color: "var(--acc)" }}>here</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {log.length > 0 && (
          <div className="space-y-2">
            <Head>Lately</Head>
            <ul className="space-y-1.5 px-1" data-world-log>
              {log.map((e) => (
                <li key={e.id} className="text-[12px] text-zinc-400 leading-snug flex gap-2">
                  <span aria-hidden className="w-1 h-1 rounded-full mt-[7px] shrink-0" style={{ background: "var(--acc)" }} />
                  <span>{e.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ToggleRow on={lead?.id === "narrator"} onClick={onNarrate} title="Narrate the next reply" icon={BookOpen} />
      </div>
    </Modal>
  );
}
