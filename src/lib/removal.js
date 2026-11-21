/* ---------- deleting a card ----------

   One way to delete a character, universe, persona or lorebook, used by
   the Create tab and by a chat's Persona tab, so both take the same chats
   with it and offer the same Undo. */
import { dropCharacter } from "./scope.js";
import { undoToast } from "./toast.js";
import { undoPatch } from "./undo.js";

/* The patch that deletes `id` from `data[type]`. Deleting a character or
   universe has to take its chats with it, or the Chats tab fills up with
   rows pointing at something that no longer exists. A deleted persona
   leaves its chats as they are: a chat whose persona is gone plays as
   yourself, and Undo brings the persona back to them. */
export function removalPatch(data, type, id) {
  const patch = { [type]: data[type].filter((x) => x.id !== id) };
  /* A chat with other characters of yours in its Scope cast carries on
     without this one (scope.js dropCharacter); only a chat with no
     character left goes. */
  if (type === "characters") {
    patch.chats = data.chats.map((c) => dropCharacter(c, id, data.characters)).filter(Boolean);
  }
  if (type === "universes") patch.chats = data.chats.filter((c) => c.universeId !== id);
  /* chats it was attached to just stop using it */
  if (type === "lorebooks") {
    patch.chats = data.chats.map((c) =>
      c.lorebookIds?.includes(id) ? { ...c, lorebookIds: c.lorebookIds.filter((x) => x !== id) } : c
    );
  }
  return patch;
}

/* Gone at once, with Undo for a few seconds. Returns the patch applied. */
export function removeWithUndo({ data, update, type, item }) {
  let before = data;
  let patch = removalPatch(data, type, item.id);
  /* built from the newest data, so a save made since the last render stays */
  update((d) => {
    before = d;
    patch = removalPatch(d, type, item.id);
    return { ...d, ...patch };
  });
  undoToast(`${item.name?.trim() || "Untitled"} deleted`, () => update((d) => undoPatch(d, before, patch)));
  return patch;
}
