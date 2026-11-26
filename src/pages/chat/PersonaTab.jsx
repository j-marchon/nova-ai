import { Plus } from "lucide-react";
import { MotionList } from "../../components/motion/MotionList.jsx";
import { Avatar, Button, PickRow } from "../../components/ui.jsx";

const firstLine = (t) => String(t || "").split("\n").find((l) => l.trim())?.trim() || "";

/* The chat settings sheet's Persona tab: every persona in a list, picked
   the way a reply style is (StylePicker). Tapping one plays as it in this
   chat; tapping the one in use goes back to playing as yourself. Edit and
   New open the same persona form as the Create tab (App.jsx), over this
   sheet, so closing it comes back here. */
export function PersonaTab({ personas, current, username = "You", onPick, onEdit, onNew, onRemove }) {
  const list = Array.isArray(personas) ? personas : [];
  const active = list.some((p) => p.id === current);
  return (
    <div className="p-4 rounded-3xl nv-glass space-y-2">
      {!active && (
        <div className="flex items-center gap-2 px-1">
          <p className="text-sm text-zinc-400 flex-1 min-w-0">{list.length ? "Playing as yourself" : "No personas yet. You play as yourself"}: {username}.</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => onPick("")}>Change name</Button>
        </div>
      )}
      {list.length > 0 && (
        <MotionList className="space-y-2">
          {list.map((p) => {
            const on = p.id === current;
            return (
              <PickRow
                key={p.id}
                on={on}
                onPick={() => onPick(on ? "" : p.id)}
                leading={<Avatar src={p.avatar} name={p.name} size="w-9 h-9" />}
                title={<span className="flex-1 min-w-0 truncate">{p.name || "Untitled"}</span>}
                sub={firstLine(p.description) || null}
                editLabel={p.name || "persona"}
                onEdit={() => onEdit(p)}
                onRemove={() => onRemove(p)}
              />
            );
          })}
        </MotionList>
      )}
      <Button type="button" onClick={onNew} icon={Plus} className="w-full">
        New persona
      </Button>
    </div>
  );
}
