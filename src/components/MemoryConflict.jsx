import { useState } from "react";
import { Check } from "lucide-react";
import { Modal, AccBtn, Button, ToggleRow } from "./ui.jsx";
import { MEMORY_PARTS } from "../lib/memory.js";

/* A reply style that does a job Nova already does (a tracker, a summary).
   Lists what overlaps and lets this chat, or every chat, switch Nova's off. */
export function MemoryConflict({ styleName, conflicts, onApply, onKeep }) {
  const [off, setOff] = useState(() => new Set(conflicts.map((c) => c.part)));
  const [everywhere, setEverywhere] = useState(false);
  const flip = (part) => setOff((s) => { const n = new Set(s); n.has(part) ? n.delete(part) : n.add(part); return n; });
  return (
    <Modal title="Overlapping memory" onClose={onKeep}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-300">{styleName} has its own:</p>
        <div className="space-y-2">
          {conflicts.map((c) => (
            <ToggleRow
              key={c.part}
              on={off.has(c.part)}
              onClick={() => flip(c.part)}
              title={`Turn off Nova's ${MEMORY_PARTS[c.part].label.toLowerCase()}`}
              sub={c.why}
            />
          ))}
        </div>
        <button
          type="button"
          role="checkbox"
          aria-checked={everywhere}
          onClick={() => setEverywhere((v) => !v)}
          className="nv-scope-check flex items-center gap-2 min-h-[44px] -my-1.5 text-xs text-zinc-400 hover:text-zinc-100"
          data-on={everywhere ? "1" : undefined}
        >
          <span aria-hidden className="nv-scope-box">{everywhere && <Check size={11} strokeWidth={3} />}</span>
          Turn off for all chats
        </button>
        <div className="flex gap-2 justify-end">
          <Button onClick={onKeep}>Keep both</Button>
          <AccBtn onClick={() => onApply([...off], everywhere)}>Apply</AccBtn>
        </div>
      </div>
    </Modal>
  );
}
