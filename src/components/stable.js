import { useMemo, useRef } from "react";

/* An object whose methods always call the newest version of the functions
   passed in, while the object itself never changes. A memoised component
   handed this instead of a dozen fresh closures per render can skip
   rendering when nothing it shows has changed. */
export function useStableActions(fns) {
  const ref = useRef(fns);
  ref.current = fns;
  return useMemo(
    () => new Proxy({}, { get: (_, k) => (...args) => ref.current[k]?.(...args) }),
    [],
  );
}
