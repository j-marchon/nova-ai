import { MotionList } from "./motion/MotionList.jsx";
import React, { useEffect, useRef, useState } from "react";
import { undoToast } from "../lib/toast.js";
import { restoreList } from "../lib/undo.js";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  Plus,
  Trash2,
  User,
  Users,
  Wand2,
} from "lucide-react";
import { AccBtn, Button, Modal, Pic, Segmented, TextInput, ToggleRow, selStyle } from "./ui.jsx";
import { uid } from "../lib/util.js";

/* ---------- Quick Replies Strip ----------
   Horizontal scrolling chip bar above the composer. */
export function QuickRepliesStrip({
  replies = [],
  onTrigger,
  onOpenManager,
  disabled = false,
  impersonating = false,
}) {
  if (!replies || replies.length === 0) return null;

  return (
    <MotionList horizontal className="nv-fade-x flex items-center gap-1.5 overflow-x-auto nv-no-scrollbar py-1 px-1 min-w-0 select-none">
      {replies.map((qr) => {
        const isAction = qr.mode === "action";
        const isImp = isAction && qr.action === "impersonate";
        return (
          <button
            key={qr.id}
            type="button"
            onClick={() => onTrigger(qr)}
            disabled={disabled || (isImp && impersonating)}
            className={`nv-chip inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1 rounded-full  shrink-0  ${
              isImp && impersonating
                ? "bg-[var(--acc)]/25 text-[var(--acc)] border border-[var(--acc)]/50 nv-pulse"
                : "bg-[var(--nv-control)] hover:bg-[var(--nv-control)] text-zinc-300 hover:text-white border border-[var(--nv-edge-ink)]"
            }`}
            title={qr.text || qr.label}
          >
            {isImp && <Wand2 size={12} className={impersonating ? "nv-spin" : ""} />}
            <span>{qr.label}</span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onOpenManager}
        className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--nv-control)] hover:bg-[var(--nv-control)] text-zinc-400 hover:text-zinc-200 border border-[var(--nv-edge-ink)] shrink-0 "
        title="Manage Quick Replies"
        aria-label="Manage Quick Replies"
      >
        <Plus size={13} />
      </button>
    </MotionList>
  );
}

/* ---------- Quick Replies Manager Modal ----------
   Add, remove, reorder and reset quick reply buttons. */
export function QuickRepliesManager({
  replies = [],
  onChange,
  onClose,
}) {
  const [list, setList] = useState(replies || []);
  const [newLabel, setNewLabel] = useState("");
  const [newText, setNewText] = useState("");
  const [newMode, setNewMode] = useState("send");

  const saveList = (next) => {
    setList(next);
    onChange(next);
  };

  const addReply = () => {
    const label = newLabel.trim();
    const text = newText.trim();
    if (!label) return;
    const item = {
      id: uid(),
      label,
      text: text || label,
      mode: newMode,
    };
    saveList([...list, item]);
    setNewLabel("");
    setNewText("");
  };

  /* gone at once, with Undo for a few seconds (also after the sheet closed) */
  const open = useRef(true);
  useEffect(() => () => { open.current = false; }, []);
  const removeReply = (id) => {
    const before = list;
    const after = list.filter((x) => x.id !== id);
    saveList(after);
    undoToast("Quick reply deleted", () => {
      onChange((cur) => restoreList(cur, before, after));
      if (open.current) setList((cur) => restoreList(cur, before, after));
    });
  };

  const moveReply = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    saveList(next);
  };

  return (
    <Modal title="Quick Replies" onClose={onClose}>
      <div className="space-y-4">
        {/* Add new reply form */}
        <div className="p-3 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-3">
          <div className="text-xs font-medium text-zinc-300">Add Quick Reply</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <TextInput
              placeholder="Button Label (e.g. *Laughs*)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <TextInput
              placeholder="Message text or macro"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="min-w-0 flex-1 max-w-[260px]">
              <Segmented
                value={newMode}
                onChange={setNewMode}
                options={[{ id: "send", label: "Send", aria: "Send straight away" }, { id: "insert", label: "Insert in box", aria: "Insert in the message box" }]}
              />
            </div>
            <AccBtn
              onClick={addReply}
              disabled={!newLabel.trim()}
              size="sm"
            >
              Add button
            </AccBtn>
          </div>
        </div>

        {/* Existing replies list */}
        <MotionList className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {list.map((qr, i) => (
            <div
              key={qr.id}
              className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-[var(--nv-line)] bg-[var(--nv-control)] hover:bg-[var(--nv-control)] "
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-zinc-200 truncate">{qr.label}</span>
                  <span className="text-[10px] px-1.5 py-px rounded bg-[var(--nv-control)] text-zinc-400 shrink-0">
                    {qr.mode === "action" ? qr.action : qr.mode}
                  </span>
                </div>
                {qr.text && qr.text !== qr.label && (
                  <div className="text-[11px] text-zinc-500 truncate mt-0.5">{qr.text}</div>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="icon"
                  size="sm"
                  icon={ArrowUp}
                  onClick={() => moveReply(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                />
                <Button
                  type="button"
                  variant="icon"
                  size="sm"
                  icon={ArrowDown}
                  onClick={() => moveReply(i, 1)}
                  disabled={i === list.length - 1}
                  aria-label="Move down"
                />
                <Button
                  type="button"
                  variant="icon"
                  size="sm"
                  icon={Trash2}
                  onClick={() => removeReply(qr.id)}
                  className="ml-1"
                  aria-label="Delete"
                />
              </div>
            </div>
          ))}

          {list.length === 0 && (
            <div className="text-center py-6 text-xs text-zinc-500">
              No quick replies configured.
            </div>
          )}
        </MotionList>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--nv-line)]">
          <p className="text-[11px] text-zinc-500">Text runs macros as it is sent: {"{{user}}"}, {"{{char}}"}, {"{{roll:1d20}}"}, variables.</p>
          <AccBtn onClick={onClose} size="sm">
            Done
          </AccBtn>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Send As Selection Modal ----------
   Choose who speaks the next message: You, Character, Scope Cast, or Narrator. */
export function SendAsModal({
  current,
  userName = "You",
  characters = [],
  cast = [],
  onSelect,
  onClose,
}) {
  const [lock, setLock] = useState(!!current?.lock);

  const pick = (opt) => {
    onSelect({ ...opt, lock });
    onClose();
  };

  const isCurrent = (type, id, name) => {
    if (current.type !== type) return false;
    if (type === "user") return true;
    if (type === "system") return true;
    if (id && current.id === id) return true;
    return current.name?.toLowerCase() === name?.toLowerCase();
  };

  return (
    <Modal title="Send message as" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-zinc-400 leading-relaxed">
          Select who authors the next message you type. When sent as another character or narrator,
          the AI responds to their words.
        </p>

        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {/* User persona */}
          <button
            type="button"
            onClick={() => pick({ type: "user", id: null, name: "" })}
            aria-pressed={isCurrent("user")}
            data-on={isCurrent("user") ? "1" : undefined}
            data-inverted={isCurrent("user") ? "1" : undefined}
            style={selStyle(isCurrent("user"))}
            className={`w-full flex items-center justify-between p-2.5 rounded-2xl border ${isCurrent("user") ? "" : " border-[var(--nv-line)] bg-[var(--nv-control)] text-zinc-200"}`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[var(--nv-control)] flex items-center justify-center text-zinc-300 shrink-0">
                <User size={16} />
              </div>
              <div className="text-left min-w-0">
                <div className="text-xs font-medium truncate">{userName}</div>
                <p className="text-[11px] text-zinc-500">Your persona (default)</p>
              </div>
            </div>
            {isCurrent("user") && <Check size={16} className="shrink-0" />}
          </button>

          {/* Main characters */}
          {characters.map((c) => {
            const active = isCurrent("character", c.id, c.name);
            return (
              <button
                key={c.id || c.name}
                type="button"
                onClick={() => pick({ type: "character", id: c.id, name: c.name })}
                aria-pressed={active}
                data-on={active ? "1" : undefined}
                data-inverted={active ? "1" : undefined}
                style={selStyle(active)}
                className={`w-full flex items-center justify-between p-2.5 rounded-2xl border ${active ? "" : " border-[var(--nv-line)] bg-[var(--nv-control)] text-zinc-200"}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Pic src={c.avatar} name={c.name} size="w-8 h-8" />
                  <div className="text-left min-w-0">
                    <div className="text-xs font-medium truncate">{c.name}</div>
                    <p className="text-[11px] text-zinc-500 truncate">Character</p>
                  </div>
                </div>
                {active && <Check size={16} className="shrink-0" />}
              </button>
            );
          })}

          {/* Nova Scope Cast */}
          {cast.length > 0 && (
            <div className="pt-2">
              <div className="text-[11px] font-medium text-zinc-400 px-1 mb-1 flex items-center gap-1">
                <Users size={12} />
                <span>Nova Scope Cast</span>
              </div>
              {cast.map((c) => {
                const active = isCurrent("cast", c.id, c.name);
                return (
                  <button
                    key={c.id || c.name}
                    type="button"
                    onClick={() => pick({ type: "cast", id: c.id, name: c.name })}
                    aria-pressed={active}
                    data-on={active ? "1" : undefined}
                    data-inverted={active ? "1" : undefined}
                    style={selStyle(active)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-2xl border mb-1 ${active ? "" : " border-[var(--nv-line)] bg-[var(--nv-control)] text-zinc-200"}`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Pic src={c.avatar} name={c.name} size="w-8 h-8" />
                      <div className="text-left min-w-0">
                        <div className="text-xs font-medium truncate">{c.name}</div>
                        <p className="text-[11px] text-zinc-500 truncate">Side character</p>
                      </div>
                    </div>
                    {active && <Check size={16} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Narrator / System */}
          <button
            type="button"
            onClick={() => pick({ type: "system", id: null, name: "Narrator" })}
            aria-pressed={isCurrent("system")}
            data-on={isCurrent("system") ? "1" : undefined}
            data-inverted={isCurrent("system") ? "1" : undefined}
            style={selStyle(isCurrent("system"))}
            className={`w-full flex items-center justify-between p-2.5 rounded-2xl border ${isCurrent("system") ? "" : " border-[var(--nv-line)] bg-[var(--nv-control)] text-zinc-200"}`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-[var(--nv-control)] flex items-center justify-center text-zinc-300 shrink-0">
                <BookOpen size={16} />
              </div>
              <div className="text-left min-w-0">
                <div className="text-xs font-medium truncate">Narrator / System</div>
                <p className="text-[11px] text-zinc-500">World events, time skips, environmental notes</p>
              </div>
            </div>
            {isCurrent("system") && <Check size={16} className="shrink-0" />}
          </button>
        </div>

        {/* Lock speaker toggle */}
        <div className="pt-2 border-t border-[var(--nv-line)]">
          <ToggleRow
            title="Lock speaker"
            sub="Until changed back"
            on={lock}
            onClick={() => setLock(!lock)}
          />
        </div>
      </div>
    </Modal>
  );
}
