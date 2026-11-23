import { MotionList } from "../components/motion/MotionList.jsx";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Download, Globe, MessagesSquare, MoreHorizontal, Play, Search, Trash2, Upload } from "lucide-react";
import { useLongPress } from "../components/gestures.js";
import { CyclingAvatar } from "../components/CyclingAvatar.jsx";
import { AccBtn, ActionMenu, Avatar, Button, EmptyState, Modal, MoreBtn, TopBar } from "../components/ui.jsx";
import { ensembleTitle, linkedCards } from "../lib/scope.js";
import { hideNotes } from "../lib/text.js";
import { clip } from "../lib/util.js";
import { fileSafe, saveFile } from "../lib/cards.js";
import { chatFromImport, chatToJsonl, readChatJsonl } from "../lib/chatFile.js";
import { undoToast } from "../lib/toast.js";
import { undoPatch } from "../lib/undo.js";

/* ---------- history ---------- */

/* Everything said in a chat, lowercased once for search. A chat that changes
   is a new object, so it misses here and is worked out again. */
const SEARCH_TEXT = new WeakMap();
const searchText = (chat) => {
  let t = SEARCH_TEXT.get(chat);
  if (t === undefined) {
    /* joined on a newline, which a search box cannot hold, so no match
       spans two messages */
    t = chat.messages.map((m) => String(m.content || "").toLowerCase()).join("\n");
    SEARCH_TEXT.set(chat, t);
  }
  return t;
};

/* the last message as the row shows it: one truncated line, so a long reply
   does not go into the page whole */
const PREVIEW_MAX = 200;
const previewOf = (content) => hideNotes(content).replace(/\*+/g, "").replace(/\s+/g, " ").trim().slice(0, PREVIEW_MAX);

export function HistoryPage({ data, update, openChat, activeId = null }) {
  const all = useMemo(() => [...data.chats].sort((a, b) => b.updatedAt - a.updatedAt), [data.chats]);
  /* search by who the chat is with, its title, or anything said in it */
  const [query, setQuery] = useState("");
  /* the chat whose menu is open */
  const [menu, setMenu] = useState(null);
  /* the every-chat delete, behind its own confirmation */
  const [clearing, setClearing] = useState(false);
  const longPress = useLongPress();
  /* what the last import or export did, or why it could not */
  const [status, setStatus] = useState(null);
  const fileRef = useRef(null);

  /* id lookups for every row, built once rather than searched per row */
  const charById = useMemo(() => new Map(data.characters.map((c) => [c.id, c])), [data.characters]);
  const uniById = useMemo(() => new Map(data.universes.map((u) => [u.id, u])), [data.universes]);
  const personaById = useMemo(() => new Map(data.personas.map((p) => [p.id, p])), [data.personas]);

  const describe = (chat) => {
    const isUni = chat.kind === "universe";
    const target = isUni ? uniById.get(chat.universeId) : charById.get(chat.characterId);
    /* your other characters linked into its Scope cast, if any */
    const linked = isUni || !Array.isArray(chat.scope?.cast) ? [] : linkedCards(chat.scope, data.characters, chat.characterId);
    const who = target?.name || (isUni ? "Deleted universe" : "Deleted character");
    const cast = linked.length ? ensembleTitle([target, ...linked].filter(Boolean)) : "";
    /* a branch, or a group chat, keeps the title it was given, so it can be
       told from its source */
    /* several characters: every name in a line (cut with … where it does not
       fit), or the name the chat was given */
    const people = linked.length ? [target, ...linked].filter(Boolean).map((c) => ({ name: c.name, src: c.avatar })) : [];
    return { isUni, ensemble: linked.length > 0, target, who, people, name: chat.title?.trim() || cast || who, cast };
  };

  /* the list follows the typing a beat behind, so a keystroke is not held
     up by a search through every message */
  const q = useDeferredValue(query).trim().toLowerCase();
  const chats = useMemo(() => {
    if (!q) return all;
    return all.filter((c) => {
      /* everyone in the chat counts, not only the name it shows */
      const { name, who, cast } = describe(c);
      return name.toLowerCase().includes(q) || who.toLowerCase().includes(q) || cast.toLowerCase().includes(q) || searchText(c).includes(q);
    });
  }, [q, all, charById, uniById]);

  /* Gone at once, with Undo for a few seconds; clearing every chat still
     asks first, and can be undone too. */
  const removeChats = (keep, label) => {
    const before = data;
    const patch = { chats: data.chats.filter(keep) };
    update(patch);
    undoToast(label, () => update((d) => undoPatch(d, before, patch)));
  };
  const remove = (chat) => removeChats((x) => x.id !== chat.id, `Chat with ${describe(chat).who} deleted`);

  /* SillyTavern .jsonl both ways (chatFile.js). An import joins the card of
     the same name, which has to exist here first. */
  const exportChat = async (chat) => {
    const { who, name } = describe(chat);
    const p = personaById.get(chat.personaId);
    try {
      const where = await saveFile(`${fileSafe(name)}.jsonl`, chatToJsonl(chat, { user: p?.name || data.username || "You", char: who }), "application/jsonl");
      setStatus(`Saved to ${where}`);
    } catch (e) {
      setStatus(`Could not save: ${e?.message || e}`);
    }
  };
  const importChat = async (file) => {
    if (!file) return;
    try {
      const parsed = readChatJsonl(await file.text());
      const chat = chatFromImport(parsed, data.characters);
      if (!chat) {
        setStatus(`This chat is with ${parsed.characterName || "a character"} who is not in your library. Import their card first, then the chat.`);
        return;
      }
      update({ chats: [...data.chats, chat] });
      setStatus(`Imported ${chat.messages.length} messages with ${parsed.characterName}.`);
    } catch (e) {
      setStatus(e?.message || "Could not read that file.");
    }
  };

  return (
    <div className="nv-page-wrap max-w-[1100px] lg:max-w-none">
      <TopBar
        title="Chats"
        right={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              icon={Upload}
              onClick={() => fileRef.current?.click()}
              aria-label="Import chat"
              title="Import a chat (JSONL)"
              className="nv-import"
            >
              <span className="nv-import-label">Import</span>
            </Button>
            {all.length > 0 && (
              <Button
                size="sm"
                icon={Trash2}
                onClick={() => setClearing(true)}
                aria-label="Clear all chats"
                title="Clear all chats"
                className="nv-import"
              >
                <span className="nv-import-label">Clear all</span>
              </Button>
            )}
          </div>
        }
      />
      <input
        ref={fileRef}
        type="file"
        accept=".jsonl,application/jsonl,application/json,text/plain"
        className="hidden"
        data-testid="chat-import-input"
        onChange={(e) => { importChat(e.target.files?.[0]); e.target.value = ""; }}
      />
      {status && <p className="mb-3 px-1 text-xs text-zinc-400" role="status">{status}</p>}
      {all.length > 3 && (
        <div className="relative mb-4">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            enterKeyHint="search"
            className="w-full rounded-xl pl-10 pr-4 py-2.5 text-sm text-zinc-100 outline-none"
          />
        </div>
      )}
      {chats.length === 0 ? (
        <EmptyState icon={MessagesSquare} title={q ? "No chats match" : "No chats yet"} />
      ) : (
        <MotionList className="nv-hair-t">
          {chats.map((chat, i) => {
            const { isUni, ensemble, target, name, people } = describe(chat);
            const last = chat.messages[chat.messages.length - 1];
            return (
              <div
                key={chat.id}
                {...longPress(() => setMenu(chat))}
                onClick={() => openChat(chat.id)}
                /* skipped by the browser while far off screen */
                style={{ "--i": Math.min(i, 12), contentVisibility: "auto", containIntrinsicSize: "auto 88px" }}
                className="nv-rise nv-hold nv-row nv-hair-b group overflow-hidden"
                data-scope={ensemble ? "1" : undefined}
                /* the chat open beside the list (a wide window) */
                data-on={chat.id === activeId ? "1" : undefined}
                aria-current={chat.id === activeId ? "true" : undefined}
              >
                {isUni && !target?.avatar ? (
                  <div className="nv-hair w-12 h-12 rounded-full flex items-center justify-center shrink-0">
                    <Globe size={17} strokeWidth={1.5} className="text-zinc-500" />
                  </div>
                ) : ensemble ? (
                  /* everyone's picture in turn */
                  <CyclingAvatar people={people} size="w-12 h-12" />
                ) : (
                  <Avatar src={target?.avatar} name={target?.name || "?"} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[17px] font-medium text-zinc-100 truncate tracking-tight">{name}</p>
                    {isUni && <span className="nv-label shrink-0" style={{ fontSize: 9 }}>Universe</span>}
                  </div>
                  <p className="text-[13px] text-zinc-400 truncate mt-1">
                    {last ? `${last.role === "user" ? "You: " : ensemble && last.speaker ? `${last.speaker}: ` : ""}${previewOf(last.content)}` : "Empty chat"}
                  </p>
                </div>
                <MoreBtn onClick={() => setMenu(chat)} label="Chat options"><MoreHorizontal size={18} /></MoreBtn>
              </div>
            );
          })}
        </MotionList>
      )}

      {menu && (() => {
        const { target, name } = describe(menu);
        const last = menu.messages[menu.messages.length - 1];
        return (
          <ActionMenu
            title={name}
            onClose={() => setMenu(null)}
            actions={[
              { icon: Play, label: "Open chat", primary: true, run: () => openChat(menu.id) },
              { icon: Download, label: "Export", primary: true, run: () => exportChat(menu) },
              {
                icon: Trash2, label: "Delete chat", danger: true, sub: `${menu.messages.length} messages`,
                run: () => remove(menu),
              },
            ]}
            preview={
              <div className="flex items-center gap-3 p-3 rounded-xl nv-hair">
                <Avatar src={target?.avatar} name={name} size="w-11 h-11" />
                <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed flex-1 min-w-0">{(last && clip(hideNotes(last.content), 400)) || "Empty chat"}</p>
              </div>
            }
          />
        );
      })()}

      {clearing && (
        <Modal title="Clear all chats" onClose={() => setClearing(false)}>
          <p className="text-sm text-zinc-300 leading-relaxed">
            Delete all <span className="text-zinc-100 font-medium">{all.length}</span> chat{all.length === 1 ? "" : "s"}? Your characters, universes, personas and lorebooks stay.
          </p>
          <div className="flex items-center gap-2 mt-5">
            <Button onClick={() => setClearing(false)} className="flex-1">
              Cancel
            </Button>
            <AccBtn
              onClick={() => { removeChats(() => false, `${all.length} chat${all.length === 1 ? "" : "s"} deleted`); setClearing(false); }}
              className="flex-1"
            >
              Delete all
            </AccBtn>
          </div>
        </Modal>
      )}

    </div>
  );
}
