"use client";

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Master Implementation Tracker — Programme 2, Root Cause RC-5. A single
 * query-string param, read once on mount as the initial value and kept
 * in sync on every update — so tab/filter/selection state survives a
 * refresh and participates in Back/Forward, matching every other real
 * deep-link this app already builds by hand (e.g.
 * `transactions?transaction=…`). Deliberately just one param per hook
 * call rather than a whole-object "URL state" system — every P2-scoped
 * RC-5 finding (#142, #216, #238) is a single value, and a wider
 * abstraction isn't earned by three call sites.
 *
 * The displayed value is real React state, not derived from
 * `useSearchParams()` on every render — `router.replace` updates the
 * address bar as a side effect, not as the source of truth for what's
 * on screen. Matches the read-once-on-mount pattern every tab component
 * in this app already used before RC-5 (`useState(() => tabFromSlug(...))`
 * — this hook only adds the missing writeback.
 *
 * `router.replace` (not `push`) so switching tabs/filters doesn't spam
 * browser history with one entry per keystroke/click; `scroll: false` so
 * it doesn't jump the page back to top on every change.
 */
export function useUrlParam(paramName: string, defaultValue: string): [string, (value: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValueState] = useState(() => searchParams.get(paramName) ?? defaultValue);

  const setValue = useCallback(
    (next: string) => {
      setValueState(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === defaultValue) params.delete(paramName);
      else params.set(paramName, next);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams, paramName, defaultValue],
  );

  return [value, setValue];
}
