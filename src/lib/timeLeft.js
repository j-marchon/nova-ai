/* How long until a moment, short: "45m", "3h 20m", "2d 4h". Minutes round
   up, so a reset 30 seconds away reads "1m", never "0m". "" for a time that
   is missing, unreadable or already past. */
export function timeLeft(when, now = Date.now()) {
  const at = when == null || when === "" ? NaN : new Date(when).getTime();
  if (!Number.isFinite(at) || at <= now) return "";
  const mins = Math.ceil((at - now) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}
