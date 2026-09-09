"use client";

import { useEffect, useRef, useState } from "react";
import type { VisibilityState } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { ALL_COLUMN_IDS, COLUMN_LABELS } from "./transaction-grid";

export function TransactionColumnChooser({
  columnVisibility,
  onChange,
}: {
  columnVisibility: VisibilityState;
  onChange: (updater: VisibilityState | ((old: VisibilityState) => VisibilityState)) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggle(columnId: string) {
    onChange((prev) => ({ ...prev, [columnId]: prev[columnId] === false ? true : false }));
  }

  return (
    <div className="relative" ref={ref}>
      <Button variant="subtle" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Columns
      </Button>
      {open && (
        <div
          role="group"
          aria-label="Choose visible columns"
          className="absolute right-0 z-10 mt-2 max-h-80 w-56 overflow-y-auto rounded-vf-md border border-vf-paper-border bg-vf-paper p-2 shadow-vf-paper-lg"
        >
          {ALL_COLUMN_IDS.map((id) => (
            <label key={id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-vf-ink-soft hover:bg-vf-paper-alt">
              <input type="checkbox" checked={columnVisibility[id] !== false} onChange={() => toggle(id)} />
              {COLUMN_LABELS[id]}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
