import React from "react";
import { RP_SPAN, hideNotes, tidyRP } from "../lib/text.js";
import { displayHtml } from "../lib/html.js";

/* `display` is the active prompt's display regex (html.js), with the
   message's role and depth; with none, the text is shown as text. */
export const RP = React.memo(function RP({ text, display, role = "assistant", depth = 0 }) {
  if (display?.length) {
    const html = displayHtml(text, display, role, depth);
    if (html != null) return <div className="nv-html" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  const parts = tidyRP(hideNotes(text)).split(RP_SPAN).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("***") && p.endsWith("***"))
      return <strong key={i}><em >{p.slice(3, -3)}</em></strong>;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*")) return <em key={i} >{p.slice(1, -1)}</em>;
    return <span key={i}>{p}</span>;
  });
});
