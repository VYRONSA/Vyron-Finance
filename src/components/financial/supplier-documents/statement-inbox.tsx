"use client";

/**
 * SD-3E — the Supplier Statements inbox: every statement by stage, with
 * upload (PDF first; JPG/PNG scans; CSV/XLSX as a convenience) for those
 * allowed to upload.
 *
 * Reading happens AFTER the upload responds (SD-3C), so a statement arrives
 * in the Inbox as "Waiting to be read" and moves on by itself; the list
 * refreshes while anything is still being read.
 */
import { useEffect, useMemo, useState } from "react";
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
  SOURCE_LABEL,
  STATEMENT_STAGES,
  STATEMENT_STATUS_LABEL,
  STATEMENT_STATUS_TONE,
  type StatementStage,
  type StatementStatus,
} from "@/lib/supplier-documents/statement-stages";
import type { CapturePermissions } from "@/lib/supplier-documents/capture-stages";

export type StatementInboxRow = {
  id: number;
  status: StatementStatus;
  stage: StatementStage;
  sourceType: string;
  supplierName: string | null;
  supplierConfirmed: boolean;
  statementDate: string | null;
  closingBalance: number | null;
  currencyCode: string | null;
  validationStatus: string;
  filename: string | null;
  receivedAt: string;
};

const STAGE_KEYS = new Set(STATEMENT_STAGES.map((s) => s.key));

function checksBadge(row: StatementInboxRow): { label: string; tone: "good" | "warn" | "danger" | "muted" } | null {
  if (!["needs-review", "ready", "reconciled"].includes(row.stage)) return null;
  if (row.validationStatus === "Incomplete") return { label: "Does not add up", tone: "danger" };
  if (row.validationStatus === "Review") return { label: "Check", tone: "warn" };
  if (row.validationStatus === "Pass") return { label: "Adds up", tone: "good" };
  return { label: "Not checked", tone: "muted" };
}

export function StatementInbox({ companyId, rows, can, previewMode }: { companyId: string; rows: StatementInboxRow[]; can: CapturePermissions; previewMode: boolean }) {
  const router = useRouter();
  const [stageParam, setStageParam] = useUrlParam("stage", "inbox");
  const stage: StatementStage = STAGE_KEYS.has(stageParam as StatementStage) ? (stageParam as StatementStage) : "inbox";
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // While anything is still being read, look again shortly.
  const reading = rows.some((r) => r.status === "Queued" || r.status === "Processing");
  useEffect(() => {
    if (!reading) return;
    const t = setTimeout(() => router.refresh(), 4000);
    return () => clearTimeout(t);
  }, [reading, rows, router]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows
      .filter((r) => r.stage === stage)
      .filter((r) => (!term ? true : [r.supplierName, r.filename].some((v) => (v ?? "").toLowerCase().includes(term))));
  }, [rows, stage, search]);

  const stageInfo = STATEMENT_STAGES.find((s) => s.key === stage)!;
  const base = `/company/${companyId}/supplier-documents/statements`;

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/companies/${companyId}/purchasing/supplier-statements`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "The statement could not be uploaded.");
        return;
      }
      setMessage(
        data.statement?.status === "Duplicate"
          ? (data.statement?.message ?? "This statement has already been uploaded.")
          : `“${file.name}” was received and is being read. You can leave this page — it carries on without you.`,
      );
      setStageParam("inbox");
      router.refresh();
    } catch {
      setError("The statement could not be uploaded. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  const canUpload = can.upload && !previewMode;

  return (
    <Card className="min-w-0">
      <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-vf-paper-border px-4 pt-3" role="navigation" aria-label="Statement stages">
        {STATEMENT_STAGES.map((s) => {
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
                <IconPlus className="h-4 w-4" /> {uploading ? "Uploading…" : "Upload statement"}
              </span>
              <input
                type="file"
                className="sr-only"
                accept="application/pdf,image/png,image/jpeg,.csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={uploading}
                aria-label="Supplier statement (PDF; or a JPG/PNG scan, CSV or XLSX)"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </label>
          )}
        </div>
        {canUpload && <p className="-mt-2 text-xs text-vf-ink-faint">PDF statements are read automatically. Scanned statements (JPG, PNG or image-only PDF) are entered by hand. CSV and Excel are also accepted. Up to 25 MB.</p>}

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

        <Input aria-label="Search statements" placeholder="Search supplier or file…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-72" />

        {visible.length === 0 ? (
          <EmptyState
            icon={<IconFileText className="h-6 w-6" />}
            title={search ? "Nothing matches your search" : `Nothing in ${stageInfo.label}`}
            description={search ? "Try a supplier name or a file name." : stage === "inbox" && canUpload ? "Upload a supplier statement to start." : stageInfo.description}
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeadCell>Statement</TableHeadCell>
                <TableHeadCell>Supplier</TableHeadCell>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell className="text-right">Closing balance</TableHeadCell>
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
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex max-w-[16rem] flex-col gap-1">
                        <span className="truncate text-sm text-vf-ink" title={row.filename ?? undefined}>
                          {row.filename ?? `Statement ${row.id}`}
                        </span>
                        <span className="flex flex-wrap gap-1">
                          <Badge tone="muted">{SOURCE_LABEL[row.sourceType] ?? row.sourceType}</Badge>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-vf-ink">{row.supplierName ?? "—"}</span>
                      {row.supplierName && !row.supplierConfirmed && <span className="block text-xs text-vf-ink-faint">Not yet confirmed</span>}
                    </TableCell>
                    <TableCell className="text-sm">{row.statementDate ? formatDate(row.statementDate) : "—"}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">
                      {row.closingBalance === null ? "—" : formatAmount(row.closingBalance)}
                      {row.currencyCode && <span className="ml-1 text-xs text-vf-ink-faint">{row.currencyCode}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATEMENT_STATUS_TONE[row.status]}>{STATEMENT_STATUS_LABEL[row.status]}</Badge>
                    </TableCell>
                    <TableCell>{checks ? <Badge tone={checks.tone}>{checks.label}</Badge> : <span className="text-xs text-vf-ink-faint">—</span>}</TableCell>
                    <TableCell className="text-sm text-vf-ink-soft">{formatDateTime(row.receivedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button href={`${base}/${row.id}`} variant="subtle" size="sm" aria-label={`Open ${row.filename ?? `statement ${row.id}`}`}>
                        {row.stage === "reconciled" || row.stage === "ready" ? "Reconcile" : row.stage === "closed" ? "Open" : "Review"}
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
