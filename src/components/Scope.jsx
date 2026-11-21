import { MotionList } from "./motion/MotionList.jsx";
import { useState } from "react";
import { BookOpen, Check, Globe, MapPin, MessagesSquare, Plus, RefreshCw, ScanSearch, UserRound, Users, X } from "lucide-react";
import { Avatar, Button, Modal, NovaMark, Pic, Segmented, TextArea, TextInput, Toggle, selStyle, SwapIcon } from "./ui.jsx";

/* ============================================================
   Nova Scope: the button, the cast strip and the sheet
   (the logic is in lib/scope.js)
   ============================================================ */

const MODE_INFO = {
  off: "Off: the chat works exactly as it always has.",
  manual: "Manual: people found in the story are offered above the message box; tap one to bring them in.",
  auto: "Auto: people who keep coming up join the scene on their own.",
};

const avatarOf = (member, characters) =>
  member.characterId ? characters.find((c) => c.id === member.characterId)?.avatar : null;

/* A little character icon in the composer. Off, it is a quiet round
   button; on, it opens out into a pill with the cast count and glows in the
   accent. */
export function ScopeButton({ scope, onClick }) {
  const on = scope.mode !== "off";
  const button = (
    <button
      onClick={onClick}
      aria-label="Nova Scope"
      title={on ? `Nova Scope: ${scope.mode}` : "Nova Scope"}
      className={`nv-scope-btn relative inline-flex items-center h-8 rounded-full shrink-0 overflow-hidden ${on ? "nv-scope-on pl-2 pr-2.5 gap-1.5" : "w-8 justify-center"}`}
      style={on
        ? { background: "var(--nv-control)", color: "var(--acc)" }
        : { background: "var(--nv-control)", color: "var(--color-zinc-400)" }}
    >
      <SwapIcon icon={on ? Users : UserRound} size={14} className="shrink-0" />
      {on && (
        <span className="nv-scope-label text-[11px] font-medium whitespace-nowrap">
          Scope{scope.cast.length ? ` · ${scope.cast.length + 1}` : ""}
        </span>
      )}
    </button>
  );
  if (!on) return button;
  /* The glow breathes on a layer of its own beside the button, fading in
     and out. Animating the button's own shadow repainted it on every frame
     for as long as Scope was on, chat idle or not. */
  return (
    <span className="relative inline-flex shrink-0 rounded-full">
      <span aria-hidden className="nv-scope-glow absolute inset-0 rounded-full pointer-events-none" />
      {button}
    </span>
  );
}

/* Who is in the story, just above the message box. Tapping someone has
   them lead the next reply, once (tap again to take it back); nobody picked
   leaves it to the model. `leads` are the chat's own people: its character,
   or a universe's characters and its narration ({ narrator: true }). With
   Scope off (`active` false, a universe only) the cast is not shown. */
/* `world` (a universe only): { name, place, time } for the leading chip
   that opens the World sheet; the universe's name until the tracker has
   written its first note. */
export function worldChipText(world) {
  if (!world) return "";
  return world.place ? [world.place, world.time].filter(Boolean).join(" · ") : world.name || "World";
}

export function ScopeStrip({ scope, active = true, leads = [], lead, characters, suggestions, describing, scanning, playing, chipBlur, world, onOpenWorld, onAdd, onLead, onStepIn }) {
  const cast = active ? scope.cast : [];
  if (!world && !leads.length && !playing && !scanning && !cast.length && !suggestions.length) return null;
  const chip = "nv-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs whitespace-nowrap shrink-0";
  /* a picture sits close to the chip's edge; without one the name is
     centred, padded the same on both sides */
  const pad = (src) => (src ? "pl-1" : "");
  const leadChip = (who, { src, title, extra, dim } = {}) => {
    const on = lead?.id === who.id;
    return (
      <button
        key={who.id}
        onClick={() => onLead(who)}
        aria-pressed={on}
        className={`${chip} ${who.narrator ? "" : pad(src)} ${on ? "" : `nv-glass ${dim ? "text-zinc-300" : "text-zinc-200"}`} ${describing === who.name ? "nv-breathe" : ""}`}
        style={{ ...(on ? { ...selStyle(true), color: "var(--acc)" } : {}), ...chipBlur }}
        title={on ? `${who.name} leads the next reply` : title || `Have ${who.name} lead the next reply`}
      >
        {who.narrator ? <BookOpen size={12} /> : <Pic src={src} name={who.name} size="w-5 h-5" />}
        {who.name}
        {extra}
      </button>
    );
  };
  return (
    <MotionList horizontal className="nv-fade-x flex items-center gap-1.5 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: "none" }} data-noswipe>
      {playing && (
        <button
          onClick={onStepIn}
          className={`${chip} nv-breathe`}
          style={{ ...selStyle(true), color: "var(--acc)", ...chipBlur }}
          aria-label="Step in"
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--acc)" }} />
          Scene playing · step in
        </button>
      )}
      {world && (
        <button
          key="world"
          onClick={onOpenWorld}
          aria-label={world.place ? `World: ${world.place}${world.time ? `, ${world.time}` : ""}` : `World: ${world.name || "the world"}`}
          className={`${chip} nv-glass text-zinc-200 max-w-[11.5rem]`}
          style={chipBlur}
        >
          {world.place ? <MapPin size={12} className="shrink-0" style={{ color: "var(--acc)" }} /> : <Globe size={12} className="shrink-0" style={{ color: "var(--acc)" }} />}
          <span className="truncate min-w-0">{worldChipText(world)}</span>
        </button>
      )}
      {leads.map((l) => leadChip(l, { src: l.avatar }))}
      {cast.map((m) => leadChip(
        { id: m.id, name: m.name, ...(m.characterId ? { characterId: m.characterId } : {}) },
        {
          src: avatarOf(m, characters),
          dim: true,
          title: m.characterId ? undefined : m.description || "Description on its way",
          extra: !m.description && !m.characterId ? <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--acc)" }} /> : null,
        }
      ))}
      {scanning && (
        <span className={`${chip} border-[var(--nv-line)] text-zinc-400 nv-breathe`} style={chipBlur}>
          Reading for the cast…
        </span>
      )}
      {suggestions.map((n) => (
        <button
          key={n}
          onClick={() => onAdd(n)}
          className={`${chip} pl-2 border-dashed border-zinc-600 text-zinc-400 hover:text-zinc-100`}
          style={chipBlur}
          aria-label={`Add ${n}`}
        >
          <Plus size={12} /> {n}
        </button>
      ))}
    </MotionList>
  );
}

/* The sheet: what Scope is, its switches, and the cast. */
/* What the leads are called in the sheet, and what gets read for the cast. */
const KIND = {
  card: { lead: "The card's character", reading: "Reading the card for the people in it…", read: "the card is read for its cast" },
  universe: { lead: "From the universe", reading: "Reading the world for the people in it…", read: "the world is read for its cast" },
};

export function ScopeSheet({ scope, kind = "card", leads = [], characters, suggestions, describing, sceneOn, scanning, newChats, onNewChats, onClose, onChange, onAdd, onAddCharacter, onEdit, onRemove, onRedescribe }) {
  const [name, setName] = useState("");
  const on = scope.mode !== "off";
  const k = KIND[kind] || KIND.card;
  /* a member linked to one of your cards that still exists */
  const linkedCard = (m) => (m.characterId ? characters.find((c) => c.id === m.characterId) : null);
  const library = characters.filter((c) => !leads.some((l) => l.id === c.id) && !scope.cast.some((m) => m.characterId === c.id));
  const add = () => { if (name.trim()) { onAdd(name); setName(""); } };

  return (
    <Modal title="Nova Scope" onClose={onClose} wide>
      <div className="space-y-4">
        {/* the pitch */}
        <div className="nv-scope-hero relative overflow-hidden rounded-3xl p-4 nv-glass">
          <div aria-hidden className="absolute -top-16 -right-10 w-48 h-48 rounded-full" style={{ background: "var(--nv-control)" }} />
          <div className="relative flex items-center gap-3">
            <NovaMark size={34} />
            <div className="min-w-0">
              <p className="text-xl font-medium tracking-tight nv-display nv-holo-text">Nova Scope</p>
              <p className="text-xs text-zinc-400">Your story, with everyone in it.</p>
            </div>
          </div>
          <div className="relative mt-4 space-y-3">
            {[
              { icon: ScanSearch, t: "Finds the people in your story", d: "Anyone who keeps coming up joins the scene, with a description written from the chat itself. No new cards to write." },
              { icon: MessagesSquare, t: "Lets them talk to each other", d: "Several people can speak in one turn, and the scene can play on by itself until it is your move. Type or tap Stop to step in." },
              { icon: MapPin, t: "Knows where everyone is", d: "Time, place and who is present come from the scene tracker, so nobody butts in from across town." },
            ].map((f) => (
              <div key={f.t} className="flex gap-3">
                <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--nv-control)", color: "var(--acc)" }}>
                  <f.icon size={15} />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-zinc-100">{f.t}</p>
                  <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">{f.d}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Segmented
            value={scope.mode}
            onChange={(mode) => onChange({ mode })}
            options={[{ id: "off", label: "Off" }, { id: "manual", label: "Manual" }, { id: "auto", label: "Auto" }]}
          />
          <p className="text-[11px] text-zinc-500 leading-snug px-1">{MODE_INFO[scope.mode]}</p>
        </div>

        {on && (
          <div className="p-3.5 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-3">
            <button onClick={() => onChange({ carry: !scope.carry })} role="switch" aria-checked={scope.carry} className="w-full flex items-center gap-3 text-left">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-100">Let the scene play on</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">The people present keep going without you until it is your turn.</p>
              </div>
              <Toggle on={scope.carry} />
            </button>
            {scope.carry && (
              <div className="flex items-center gap-3">
                <p className="text-[11px] text-zinc-400 flex-1">Replies in a row, at most</p>
                <div className="nv-group nv-group--pill inline-flex">
                  {[2, 3, 4, 6].map((n) => (
                    <button key={n} onClick={() => onChange({ turns: n })} className={`w-9 h-7 rounded-full text-xs ${scope.turns === n ? "" : "text-zinc-400"}`} style={scope.turns === n ? { background: "var(--nv-ink)", color: "var(--nv-bg)" } : {}}>{n}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-3">
              <p className="text-[11px] text-zinc-400 flex-1">Found after this many mentions</p>
              <div className="nv-group nv-group--pill inline-flex">
                {[2, 3, 5].map((n) => (
                  <button key={n} onClick={() => onChange({ threshold: n })} className={`w-9 h-7 rounded-full text-xs ${scope.threshold === n ? "" : "text-zinc-400"}`} style={scope.threshold === n ? { background: "var(--nv-ink)", color: "var(--nv-bg)" } : {}}>{n}</button>
                ))}
              </div>
            </div>
            <button
              onClick={() => onNewChats(newChats === scope.mode ? "off" : scope.mode)}
              role="switch"
              aria-checked={newChats === scope.mode}
              className="w-full flex items-center gap-3 text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-100">Start new chats like this</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">New chats open with Scope {scope.mode === "auto" ? "on Auto" : "on Manual"}, and {k.read}.</p>
              </div>
              <Toggle on={newChats === scope.mode} />
            </button>
            {!sceneOn && (
              <p className="text-[11px] text-zinc-500 leading-snug">Scene tracking is off in Settings, so Scope keeps it running for this chat, every two replies.</p>
            )}
          </div>
        )}

        {/* the cast */}
        <div className="space-y-2">
          <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase px-1">In this story</p>
          {scanning && <p className="text-[11px] text-zinc-500 nv-breathe px-1">{k.reading}</p>}
          {leads.map((l) => (
            <div key={l.id || l.name} className="flex items-center gap-3 p-3 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)]">
              <Pic src={l.avatar} name={l.name} size="w-9 h-9" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-100 truncate">{l.name}</p>
                <p className="text-[11px] text-zinc-500">{k.lead}</p>
              </div>
            </div>
          ))}
          {scope.cast.map((m) => (
            <div key={m.id} className="p-3 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-2">
              <div className="flex items-center gap-3">
                <Pic src={avatarOf(m, characters)} name={m.name} size="w-9 h-9" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-100 truncate">{m.name}</p>
                  <p className="text-[11px] text-zinc-500">{linkedCard(m) ? "From your characters" : m.fromCard ? "From the card" : m.auto ? "Joined from the story" : "Added by you"}</p>
                </div>
                {!linkedCard(m) && (
                  <Button variant="icon" onClick={() => onRedescribe(m)} disabled={!!describing} aria-label={`Describe ${m.name} again`}>
                    <RefreshCw className={`nv-btn-icon ${describing === m.name ? "nv-spin" : ""}`} />
                  </Button>
                )}
                <Button variant="icon" icon={X} onClick={() => onRemove(m)} aria-label={`Remove ${m.name}`} />
              </div>
              {linkedCard(m) ? (
                <p className="text-[11px] text-zinc-500 leading-snug">Full card: {linkedCard(m).name}'s whole card goes with every reply.</p>
              ) : describing === m.name && !m.description ? (
                <p className="text-[11px] text-zinc-500 nv-breathe">Writing a description from the chat…</p>
              ) : (
                <TextArea
                  rows={3}
                  value={m.description || ""}
                  onChange={(e) => onEdit(m.id, { description: e.target.value })}
                  placeholder="Who they are. Written from the chat after the next reply, or type it here."
                />
              )}
            </div>
          ))}
        </div>

        {suggestions.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase px-1">Found in the story</p>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((n) => (
                <Button key={n} size="sm" icon={Plus} onClick={() => onAdd(n)}>
                  {n}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
            placeholder="Add someone by name"
          />
          <Button variant="icon" icon={Plus} onClick={add} disabled={!name.trim()} className="bg-[var(--nv-control)] text-zinc-300" aria-label="Add to the scene" />
        </div>

        {library.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-medium tracking-wide text-zinc-400 uppercase px-1">Bring in one of your characters</p>
            <div className="nv-fade-x flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" style={{ scrollbarWidth: "none" }} data-noswipe>
              {library.map((c) => (
                <button key={c.id} onClick={() => onAddCharacter(c)} className="flex flex-col items-center gap-1.5 w-16 shrink-0" aria-label={`Bring in ${c.name}`}>
                  <span className="relative">
                    <Avatar src={c.avatar} name={c.name} size="w-12 h-12" />
                    <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "var(--acc)", color: "var(--on-acc)" }}>
                      <Plus size={12} />
                    </span>
                  </span>
                  <span className="text-[11px] text-zinc-300 truncate w-full text-center">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!on && scope.cast.length > 0 && (
          <p className="text-[11px] text-zinc-500 flex items-center gap-1.5 px-1"><Check size={12} /> The cast is kept while Scope is off.</p>
        )}
      </div>
    </Modal>
  );
}
