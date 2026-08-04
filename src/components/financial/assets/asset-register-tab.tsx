"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { AssetAcquireForm } from "./asset-acquire-form";
import { AssetDetailPanel } from "./asset-detail-panel";
import type { AssetClass, AssetLifecycleEvent, FixedAssetWithNetBookValue } from "@/server/assets/types";

function money(value: number): string {
  return `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function AssetRegisterTab({
  companyId,
  assets,
  assetClasses,
  lifecycleEventsByAsset,
  previewMode,
}: {
  companyId: string;
  assets: FixedAssetWithNetBookValue[];
  assetClasses: AssetClass[];
  lifecycleEventsByAsset: Record<number, AssetLifecycleEvent[]>;
  previewMode: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = assets.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <AssetAcquireForm companyId={companyId} assetClasses={assetClasses} previewMode={previewMode} />

      {assets.length === 0 ? (
        <EmptyState title="No fixed assets yet." description="Acquire one above — it posts a real Acquisition journal through the Posting Engine." />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Asset</TableHeadCell>
              <TableHeadCell>Description</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell className="text-right">Cost</TableHeadCell>
              <TableHeadCell className="text-right">Net Book Value</TableHeadCell>
            </tr>
          </TableHead>
          <TableBody>
            {assets.map((a) => (
              <TableRow key={a.id} onClick={() => setSelectedId(a.id === selectedId ? null : a.id)} className="cursor-pointer">
                <TableCell className="font-mono text-xs">{a.assetNumber}</TableCell>
                <TableCell>{a.description}</TableCell>
                <TableCell>
                  <Badge tone={a.status === "Active" ? "good" : a.status === "Disposed" || a.status === "WrittenOff" || a.status === "Retired" ? "muted" : "warn"}>{a.status}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(a.cost)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{money(a.netBookValue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {selected && <AssetDetailPanel companyId={companyId} asset={selected} lifecycleEvents={lifecycleEventsByAsset[selected.id] ?? []} previewMode={previewMode} />}
    </div>
  );
}
