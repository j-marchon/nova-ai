import { MotionList } from "./motion/MotionList.jsx";
import React, { useState } from "react";
import { ArrowDown, BookMarked, GitBranch, Plus, Trash2 } from "lucide-react";
import { AccBtn, Button, Modal, TextInput } from "./ui.jsx";
import { timeAgo } from "../lib/util.js";
import { tidyRP } from "../lib/text.js";

/**
 * BookmarksModal provides:
 * 1. An overview of saved checkpoints and bookmarks for this story.
 * 2. Ability to jump directly to any bookmarked message.
 * 3. Ability to branch the chat into a new storyline starting from any checkpoint.
 * 4. A form to create a new bookmark at the latest or a target message.
 */
export function BookmarksModal({
  chat,
  characterName = "Character",
  targetMessage = null,
  onClose,
  onJump,
  onBranch,
  onAddBookmark,
  onDeleteBookmark,
}) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : [];
  const bookmarks = Array.isArray(chat?.bookmarks) ? chat.bookmarks : [];

  // Default target is the passed targetMessage or the latest message
  const defaultTarget = targetMessage || (messages.length > 0 ? messages[messages.length - 1] : null);
  const [selectedMsgId, setSelectedMsgId] = useState(defaultTarget?.id || "");
  const [label, setLabel] = useState("");

  const currentTargetMsg = messages.find((m) => m.id === selectedMsgId) || defaultTarget;
  const currentTargetIdx = currentTargetMsg ? messages.findIndex((m) => m.id === currentTargetMsg.id) : -1;

  const handleAdd = () => {
    if (!selectedMsgId && defaultTarget?.id) {
      setSelectedMsgId(defaultTarget.id);
    }
    const msgId = selectedMsgId || defaultTarget?.id;
    if (!msgId) return;

    const cleanLabel = label.trim() || "Checkpoint";
    onAddBookmark?.({ messageId: msgId, label: cleanLabel });
    setLabel("");
  };

  const getMessageSnippet = (msg) => {
    if (!msg) return "";
    const clean = tidyRP(msg.content || "");
    return clean.length > 130 ? clean.slice(0, 127) + "..." : clean;
  };

  return (
    <Modal title="Bookmarks & Checkpoints" onClose={onClose}>
      <div className="space-y-4">
        {/* Create Checkpoint Form */}
        <div className="p-3.5 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-200 flex items-center gap-1.5">
              <Plus size={14} className="text-[var(--acc)]" />
              Save Checkpoint
            </span>
            {currentTargetMsg && (
              <span className="text-[11px] text-zinc-400">
                Message #{currentTargetIdx + 1} of {messages.length}
              </span>
            )}
          </div>

          {messages.length === 0 ? (
            <p className="text-xs text-zinc-500 italic">No messages in this chat to bookmark yet.</p>
          ) : (
            <>
              {currentTargetMsg && (
                <div className="text-xs bg-[var(--nv-control)] border border-[var(--nv-edge-ink)] rounded-xl p-2.5 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-zinc-400 font-medium">
                    <span>{currentTargetMsg.speaker || (currentTargetMsg.role === "user" ? "You" : characterName)}</span>
                    <span className="text-zinc-500">{currentTargetMsg.role}</span>
                  </div>
                  <p className="text-zinc-300 italic line-clamp-2">
                    "{getMessageSnippet(currentTargetMsg)}"
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <TextInput
                  placeholder="Checkpoint label (e.g., Before entering the tavern)..."
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAdd();
                    }
                  }}
                  className="flex-1 text-xs"
                />
                <AccBtn
                  type="button"
                  onClick={handleAdd}
                  disabled={!currentTargetMsg}
                  className="shrink-0"
                >
                  Bookmark
                </AccBtn>
              </div>
            </>
          )}
        </div>

        {/* Bookmarks List */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h4 className="text-xs font-medium uppercase tracking-wider text-zinc-400">
              Saved Checkpoints ({bookmarks.length})
            </h4>
          </div>

          {bookmarks.length === 0 ? (
            <div className="text-center py-7 px-4 rounded-2xl border border-dashed border-[var(--nv-line)] bg-[var(--nv-control)]">
              <BookMarked size={28} className="mx-auto text-zinc-600 mb-2 opacity-60" />
              <p className="text-xs text-zinc-400 font-medium">No bookmarks saved yet</p>
              <p className="text-[11px] text-zinc-500 max-w-xs mx-auto mt-1">
                Save checkpoints above or long-press any message in the chat to bookmark important story turning points.
              </p>
            </div>
          ) : (
            <MotionList className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {bookmarks.map((bm) => {
                const msg = messages.find((m) => m.id === bm.messageId);
                const msgIdx = msg ? messages.findIndex((m) => m.id === msg.id) : -1;
                return (
                  <div
                    key={bm.id}
                    className="p-3 rounded-2xl border border-[var(--nv-line)] bg-[var(--nv-control)] hover:bg-[var(--nv-control)]  space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <BookMarked size={14} className="text-[var(--acc)] shrink-0" />
                          <h5 className="text-xs font-medium text-zinc-100 truncate">
                            {bm.label || "Checkpoint"}
                          </h5>
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-2">
                          <span>{timeAgo(bm.createdAt)}</span>
                          {msgIdx >= 0 && (
                            <>
                              <span>•</span>
                              <span>Message #{msgIdx + 1}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <Button
                        type="button"
                        variant="icon"
                        size="sm"
                        icon={Trash2}
                        onClick={() => onDeleteBookmark?.(bm.id)}
                        title="Delete bookmark"
                        aria-label="Delete bookmark"
                      />
                    </div>

                    {/* Preview of the bookmarked message */}
                    <div className="bg-[var(--nv-control)] border border-[var(--nv-edge-ink)] rounded-xl p-2 text-xs">
                      {msg ? (
                        <>
                          <div className="text-[10px] text-zinc-400 font-medium mb-0.5">
                            {msg.speaker || (msg.role === "user" ? "You" : characterName)}:
                          </div>
                          <p className="text-zinc-300 italic line-clamp-2">
                            "{getMessageSnippet(msg)}"
                          </p>
                        </>
                      ) : (
                        <p className="text-zinc-500 italic text-[11px]">(Target message no longer in history)</p>
                      )}
                    </div>

                    {/* Jump & Branch actions */}
                    <div className="flex items-center justify-end gap-2 pt-0.5">
                      {msg && (
                        <Button
                          type="button"
                          size="sm"
                          icon={ArrowDown}
                          onClick={() => onJump?.(bm)}
                          title="Scroll to this message in chat"
                        >
                          Jump
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        icon={GitBranch}
                        onClick={() => onBranch?.(bm)}
                        className="text-[var(--acc)]"
                        title="Branch chat up to this checkpoint"
                      >
                        Branch
                      </Button>
                    </div>
                  </div>
                );
              })}
            </MotionList>
          )}
        </div>
      </div>
    </Modal>
  );
}
