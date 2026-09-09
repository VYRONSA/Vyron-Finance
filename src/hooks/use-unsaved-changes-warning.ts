"use client";

import { useEffect } from "react";

/**
 * Master Implementation Tracker — Epic E11, Finding #198 (RC-9). Warns
 * before a browser refresh/close/back-forward-cache navigation discards
 * in-progress work in a multi-field form. This app's router (Next.js
 * App Router) has no supported API to intercept an in-app client-side
 * navigation, so this only covers actual page unload — a real,
 * disclosed limitation, not silently partial coverage.
 */
export function useUnsavedChangesWarning(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}
