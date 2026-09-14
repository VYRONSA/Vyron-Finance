"use client";

import { Button } from "@/components/ui/button";

/**
 * "Update Allocated (n)" — the Transaction Explorer toolbar's commit action
 * for pending allocation edits.
 *
 * PRODUCTION DEFECT this restores: the button had been removed from the
 * real toolbar (its job folded into "Post to Accounting"), while the tests
 * that "proved" it kept rendering their OWN stand-in button — so the suite
 * stayed green and production shipped without it. It now lives in its own
 * component, which the toolbar renders and the tests render, so the two can
 * no longer drift apart.
 *
 * `committableCount` is the grid's COMMITTABLE pending edits (never the raw
 * dirty count): an edit the grid would refuse — e.g. a Supplier type with no
 * supplier chosen — is not counted, cannot be submitted, and is explained by
 * the "cannot be saved yet" notice instead. Committing writes allocations
 * only; it never posts, never creates journals or GL entries.
 */
export function UpdateAllocatedButton({
  committableCount,
  blockedCount,
  saving,
  disabled = false,
  disabledTitle,
  onUpdate,
}: {
  committableCount: number;
  blockedCount: number;
  saving: boolean;
  disabled?: boolean;
  disabledTitle?: string;
  onUpdate: () => unknown;
}) {
  const plural = (n: number) => (n === 1 ? "" : "s");
  const title =
    disabledTitle ??
    (committableCount > 0
      ? `Save ${committableCount} pending allocation${plural(committableCount)} on this page. Allocating is not posting — nothing is posted to the General Ledger.`
      : blockedCount > 0
        ? `${blockedCount} pending change${plural(blockedCount)} cannot be saved yet — see the notice below the toolbar.`
        : "No pending allocation changes to save.");
  return (
    <Button
      variant="primary"
      size="sm"
      disabled={disabled || saving || committableCount === 0}
      title={title}
      onClick={() => void onUpdate()}
    >
      {saving ? `Updating ${committableCount}…` : committableCount > 0 ? `Update Allocated (${committableCount})` : "Update Allocated"}
    </Button>
  );
}
