"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { IconArrowDown, IconChevronLeft } from "@/components/ui/icons";
import { SortableHeadCell, useSearchAndSort } from "@/components/financial/matching/sortable-document-table";
import { downloadCsv } from "@/lib/csv-export";
import { AssetAcquireForm } from "./asset-acquire-form";
import { AssetDetailPanel } from "./asset-detail-panel";
import type { AssetClass, AssetLifecycleEvent, FixedAssetWithNetBookValue } from "@/server/assets/types";
import { formatAmount } from "@/lib/format";

function money(value: number): string {
  return `R ${formatAmount(value)}`;
}

const PAGE_SIZE = 50;

/** Findings #109 (RC-6) and #236 (RC-5) — the register was a flat,
 * unpaginated table with no search/sort and a pure client `useState`
 * selection (no route/query-param, so a specific asset couldn't be
 * linked to or bookmarked). Mirrors `trial-balance-tab.tsx`'s
 * search/sort and `?tab=` deep-link pattern used elsewhere in this app,
 * applied here as `?assetId=`. */
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const raw = searchParams.get("assetId");
    return raw ? Number(raw) : null;
  });
  const [page, setPage] = useState(1);

  const { search, setSearch, sort, toggleSort, result } = useSearchAndSort(assets, (a) => `${a.assetNumber} ${a.description}`, "assetNumber");
  const pageCount = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
  const pageRows = result.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const selected = assets.find((a) => a.id === selectedId) ?? null;

  // Keep the URL in sync so a specific asset can be linked to/bookmarked
  // — deliberately shallow (no scroll jump, doesn't touch other params).
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (selectedId !== null) params.set("assetId", String(selectedId));
    else params.delete("assetId");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function selectRow(id: number) {
    setSelectedId((current) => (current === id ? null : id));
  }

  function exportCsv() {
    downloadCsv(
      "asset-register.csv",
      ["Asset Number", "Description", "Status", "Cost", "Net Book Value"],
      result.map((a) => [a.assetNumber, a.description, a.status, a.cost.toFixed(2), a.netBookValue.toFixed(2)]),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <AssetAcquireForm companyId={companyId} assetClasses={assetClasses} previewMode={previewMode} />

      {assets.length === 0 ? (
        <EmptyState title="No fixed assets yet." description="Acquire one above — it posts a real Acquisition journal through the Posting Engine." />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Input aria-label="Search assets" placeholder="Search by asset number or description…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="w-64" />
            <Button variant="subtle" size="sm" onClick={exportCsv} disabled={result.length === 0}>
              <IconArrowDown className="h-4 w-4" /> Export CSV
            </Button>
          </div>
          {result.length === 0 ? (
            <EmptyState title="No assets match this search." description="Try a different asset number or description." />
          ) : (
            <>
              <Table>
                <TableHead>
                  <tr>
                    <SortableHeadCell field="assetNumber" sort={sort} onSort={toggleSort}>Asset</SortableHeadCell>
                    <SortableHeadCell field="description" sort={sort} onSort={toggleSort}>Description</SortableHeadCell>
                    <SortableHeadCell field="status" sort={sort} onSort={toggleSort}>Status</SortableHeadCell>
                    <SortableHeadCell field="cost" sort={sort} onSort={toggleSort} align="right">Cost</SortableHeadCell>
                    <SortableHeadCell field="netBookValue" sort={sort} onSort={toggleSort} align="right">Net Book Value</SortableHeadCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {pageRows.map((a) => (
                    <TableRow key={a.id} onClick={() => selectRow(a.id)} className="cursor-pointer" aria-current={a.id === selectedId ? "true" : undefined}>
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
              {pageCount > 1 && (
                <div className="flex items-center justify-end gap-1.5 text-xs text-vf-ink-faint">
                  <Button variant="subtle" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    <IconChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  Page {page} of {pageCount} ({result.length} assets)
                  <Button variant="subtle" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                    <IconChevronLeft className="h-3.5 w-3.5 rotate-180" />
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {selected && <AssetDetailPanel companyId={companyId} asset={selected} lifecycleEvents={lifecycleEventsByAsset[selected.id] ?? []} previewMode={previewMode} />}
    </div>
  );
}
