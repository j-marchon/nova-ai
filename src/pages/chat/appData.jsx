import { useEffect, useRef } from "react";

/* The app's newest data, for chat jobs that outlive their screen. A reply
   keeps running after the chat page unmounts (or while it is hidden and not
   re-rendering), and reads the chat it is writing through getData(); the
   page's own copy would go stale, so it asks here first. ChatDataSource is
   rendered once, by App, and holds the data App last rendered. */
let read = null;
export const getAppChatData = () => read?.();

export function ChatDataSource({ data }) {
  const ref = useRef(data);
  ref.current = data;
  useEffect(() => {
    const fn = () => ref.current;
    read = fn;
    return () => { if (read === fn) read = null; };
  }, []);
  return null;
}
