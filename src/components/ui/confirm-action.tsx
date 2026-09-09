"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface ConfirmActionRowProps {
  message: ReactNode;
  itemsPreview?: ReactNode;
  confirmLabel?: string;
  confirmingLabel?: string;
  cancelLabel?: string;
  loading: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: "primary" | "danger";
  layout?: "inline" | "panel";
  size?: "sm" | "default";
}

/**
 * Master Implementation Tracker — Epic E11, Root Cause RC-3. The one
 * enforced confirm/cancel row for destructive or consequential actions,
 * replacing the ad hoc inline patterns that had grown independently
 * across Journals, Financial Years, and Banking Rules. Renders either
 * `inline` (compact, for a table-row action — matches the prior Financial
 * Year Close/Banking Rule Delete shape) or `panel` (bordered box with room
 * for an itemized preview — matches the prior Post Approved Journals
 * shape). Callers keep their own request/loading/error handling; this only
 * standardizes the confirm/cancel presentation.
 */
export function ConfirmActionRow({
  message,
  itemsPreview,
  confirmLabel = "Confirm",
  confirmingLabel = "Working…",
  cancelLabel = "Cancel",
  loading,
  error,
  onConfirm,
  onCancel,
  tone = "primary",
  layout = "inline",
  size = "sm",
}: ConfirmActionRowProps) {
  const confirmButton = (
    <Button variant={tone === "danger" ? "danger" : "primary"} size={size} disabled={loading} onClick={onConfirm}>
      {loading ? confirmingLabel : confirmLabel}
    </Button>
  );
  const cancelButton = (
    <Button variant="subtle" size={size} disabled={loading} onClick={onCancel}>
      {cancelLabel}
    </Button>
  );

  if (layout === "panel") {
    return (
      <div
        className={`flex flex-col gap-2 rounded-vf-md border px-3.5 py-3 text-sm ${
          tone === "danger" ? "border-vf-danger/25 bg-vf-danger/8 text-vf-danger" : "border-vf-info/25 bg-vf-info/8 text-vf-info"
        }`}
      >
        <p className="font-medium">{message}</p>
        {itemsPreview}
        <div className="flex flex-wrap items-center gap-2">
          {confirmButton}
          {cancelButton}
        </div>
        {error && <p className="text-xs text-vf-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs text-vf-ink-faint">{message}</span>
      {confirmButton}
      {cancelButton}
      {error && <span className="text-xs text-vf-danger">{error}</span>}
    </div>
  );
}

/** Shared "which item, if any, is currently armed for confirmation" state
 * — `Key` is typically `true` (single toggle, e.g. a toolbar action) or a
 * row id (e.g. `number` for a per-row delete/reverse). */
export function useConfirmTarget<Key = true>() {
  const [target, setTarget] = useState<Key | null>(null);

  return {
    target,
    isConfirming: (key: Key) => target === key,
    request: (key: Key) => setTarget(key),
    cancel: () => setTarget(null),
  } as const;
}
