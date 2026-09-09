"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Master Implementation Tracker — Epic E12, RC-15, Finding #213. None
 * of this app's ad hoc `role="dialog"` overlays trapped focus, moved
 * initial focus into the dialog, or restored it to the trigger on
 * close — a keyboard/screen-reader user could tab straight out of an
 * open dialog into the page behind it. No shared `Dialog`/`Modal`
 * component exists to fix this in one place, so this is a hook to
 * retrofit onto each existing overlay instead of a new component.
 *
 * `active` gates everything (mount, not just render — the overlay's
 * own conditional render already handles show/hide); `containerRef`
 * must point at the dialog's outer element.
 */
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = getFocusable(container);
    (focusable[0] ?? container).focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !container) return;
      const focusables = getFocusable(container);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active, containerRef]);
}
