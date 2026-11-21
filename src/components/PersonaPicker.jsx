import { Check } from "lucide-react";
import { Avatar, Modal, selStyle } from "./ui.jsx";

/* one choice in the picker; outside PersonaPicker so it is not a new
   component type, and remounted, on every render */
function Item({ id, src, name, sub, on, onChoose }) {
  return (
    <button
      onClick={() => onChoose(id)}
      style={on ? selStyle(true) : {}}
      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left  ${
        on ? "" : "bg-zinc-900 border-zinc-800 hover:border-zinc-600"
      }`}
    >
      <Avatar src={src} name={name} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-100 truncate">{name}</p>
        <p className="text-xs text-zinc-600 truncate">{sub}</p>
      </div>
      {on && <Check size={15} style={{ color: "var(--acc)" }} className="shrink-0" />}
    </button>
  );
}

/* quick settings from inside a chat */
/* Choose who you are before a chat starts, and swap mid-chat. */
export function PersonaPicker({ personas, username = "You", current, onPick, onClose, title = "Who are you here?" }) {
  const choose = (id) => { onPick(id); onClose(); };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-2">
        <Item id="" name={username} sub="No persona — just you" on={current === ""} onChoose={choose} />
        {personas.map((p) => (
          <Item key={p.id} id={p.id} name={p.name} sub={p.description || "No description"} on={current === p.id} onChoose={choose} />
        ))}
      </div>
    </Modal>
  );
}
