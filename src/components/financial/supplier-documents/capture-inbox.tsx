"use client";

/**
 * SD-2 — the Invoice Capture inbox: every captured supplier document, by
 * stage (Inbox / Processing / Needs Review / Approved / Posted / Rejected),
 * with upload for those allowed to capture.
 *
 * Data is loaded by the server page; after an upload the page is refreshed
 * rather than re-fetched here, so there is one source of truth.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { IconFileText, IconPlus } from "@/components/ui/icons";
import { useUrlParam } from "@/hooks/use-url-param";
import { cn } from "@/lib/utils";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import {
  billStatusLabel,
  CAPTURE_STAGES,
  isCreditNote,
  STATUS_LABEL,
  STATUS_TONE,
  type CapturePermissions,
  type CaptureStage,
  type InboxRow,
} from "@/lib/supplier-documents/capture-stages";

const STAGE_KEYS = new Set(CAPTURE_STAGES.map((s) => s.key));

/** The one-word verdict of the checks, for scanning a list. */
function checksBadge(row: InboxRow): { label: string; tone: "good" | "warn" | "danger" | "muted" } | null {
  if (row.stage === "rejected" || row.stage === "approved" || row.stage === "posted") return null;
  if (row.duplicateStatus === "Blocked") return { label: "Duplicate", tone: "danger" };
  if (row.validationStatus === "Incomplete") return { label: "Incomplete", tone: "danger" };
  if (row.duplicateStatus === "Possible") return { label: "Possible duplicate", tone: "warn" };
  if (row.validationStatus === "Review") return { label: "Check", tone: "warn" };
  if (row.validationStatus === "Pass") return { label: "Passed", tone: "good" };
  return { label: "Not checked", tone: "muted" };
}

export function CaptureInbox({
  companyId,
  rows,
  can,
  previewMode,
}: {
  companyId: string;
  rows: InboxRow[];
  can: CapturePermissions;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [stageParam, setStageParam] = useUrlParam("stage", "inbox");
  const stage: CaptureStage = STAGE_KEYS.has(stageParam as CaptureStage) ? (stageParam as CaptureStage) : "inbox";
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((r) => r.stage === stage)
      .filter((r) =>
        !term
          ? true
          : [r.supplierName, r.invoiceNumber, r.filename].some((v) => (v ?? "").toLowerCase().includes(term)),
      );
  }, [rows, stage, search]);

  const stageInfo = CAPTURE_STAGES.find((s) => s.key === stage)!;
  const base = `/company/${companyId}/supplier-documents/invoice-capture`;

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/companies/${companyId}/purchasing/invoice-capture`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "The document could not be uploaded.");
        return;
      }
      setMessage(
        data.capture?.status === "Duplicate"
          ? (data.capture?.message ?? "This file has already been captured.")
          : `“${file.name}” was received. It is in the Inbox, waiting to be read or entered by hand.`,
      );
      setStageParam("inbox");
      router.refresh();
    } catch {
      setError("The document could not be uploaded. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  const canUpload = can.upload && !previewMode;

  return (
    <Card className="min-w-0">
      <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-vf-paper-border px-4 pt-3" role="navigation" aria-label="Invoice capture stages">
        {CAPTURE_STAGES.map((s) => {
          const n = rows.filter((r) => r.stage === s.key).length;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStageParam(s.key)}
              aria-current={stage === s.key ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-t-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition",
                stage === s.key ? "border-b-2 border-vf-red-600 text-vf-red-600" : "text-vf-ink-faint hover:text-vf-ink-soft",
              )}
            >
              {s.label}
              <span className="ml-1.5 font-mono text-xs tabular-nums opacity-80">{n}</span>
            </button>
          );
        })}
      </div>

      <CardContent className="flex min-w-0 flex-col gap-4 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-[60ch] text-xs text-vf-ink-faint">{stageInfo.description}</p>
          {canUpload && (
            <label className={cn("shrink-0", uploading && "pointer-events-none opacity-60")}>
              <span className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-full bg-vf-red-600 px-5 py-2 text-[0.88rem] font-semibold text-white focus-within:outline-2">
                <IconPlus className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload supplier document"}
              </span>
              <input
                type="file"
                className="sr-only"
                accept="application/pdf,image/png,image/jpeg"
                disabled={uploading}
                aria-label="Supplier invoice or credit note (PDF, JPG or PNG)"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </label>
          )}
        </div>

        {message && (
          <p role="status" className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink-soft">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-vf-sm border border-vf-danger/40 px-3 py-2 text-sm text-vf-danger">
            {error}
          </p>
        )}

        <Input
          aria-label="Search supplier documents"
          placeholder="Search supplier, number or file…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72"
        />

        {visible.length === 0 ? (
          <EmptyState
            icon={<IconFileText className="h-6 w-6" />}
            title={search ? "Nothing matches your search" : `Nothing in ${stageInfo.label}`}
            description={
              search
                ? "Try a supplier name, a document number or a file name."
                : stage === "inbox" && canUpload
                  ? "Upload a supplier invoice or credit note to start."
                  : stageInfo.description
            }
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeadCell>Document</TableHeadCell>
                <TableHeadCell>Supplier</TableHeadCell>
                <TableHeadCell>Number</TableHeadCell>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell className="text-right">Total</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>Checks</TableHeadCell>
                <TableHeadCell>Received</TableHeadCell>
                <TableHeadCell>
                  <span className="sr-only">Actions</span>
                </TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((row) => {
                const checks = checksBadge(row);
                const credit = isCreditNote(row.documentType);
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex max-w-[16rem] flex-col gap-1">
                        <span className="truncate text-sm text-vf-ink" title={row.filename ?? undefined}>
                          {row.filename ?? "—"}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          {credit && <Badge tone="info">Credit note</Badge>}
                          {row.manualEntry && <Badge tone="muted">Entered by hand</Badge>}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-vf-ink">{row.supplierName ?? "—"}</span>
                      {row.supplierName && !row.supplierConfirmed && (
                        <span className="block text-xs text-vf-ink-faint">Not yet confirmed</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{row.invoiceNumber ?? "—"}</TableCell>
                    <TableCell className="text-sm">{row.invoiceDate ? formatDate(row.invoiceDate) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {row.total === null ? "—" : formatAmount(Math.abs(row.total))}
                      {credit && row.total !== null && <span className="ml-1 text-xs text-vf-ink-faint">CR</span>}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      {row.billId !== null && (
                        <span className="mt-1 block text-xs text-vf-ink-faint">
                          {credit ? "Credit note" : "Bill"} #{row.billId} · {billStatusLabel(row.billPostingStatus)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{checks ? <Badge tone={checks.tone}>{checks.label}</Badge> : <span className="text-xs text-vf-ink-faint">—</span>}</TableCell>
                    <TableCell className="text-sm text-vf-ink-soft">{formatDateTime(row.receivedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button href={`${base}/${row.id}`} variant="subtle" size="sm" aria-label={`Open ${row.filename ?? `document ${row.id}`}`}>
                        {row.stage === "needs-review" || (row.stage === "inbox" && can.edit) ? "Review" : "Open"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
