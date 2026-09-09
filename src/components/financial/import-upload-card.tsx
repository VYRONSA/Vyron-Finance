"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconArrowDown } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/lib/csv-export";
import type { ImportBatch } from "@/server/accounting/types";
import type { ImportExceptionRecord } from "@/server/import-centre/types";
import { PdfImportReviewPanel, type PdfStatementPreview } from "@/components/financial/import-centre/pdf-import-review-panel";
import { ImportOutcomeSummary } from "@/components/financial/import-centre/import-outcome-summary";
import { STANDARD_HEADERS } from "@/server/import-centre/bank-statement-parser";
import { BILLS_IMPORT_TEMPLATE_HEADERS } from "@/server/import-centre/xero-bills-parser";

type UploadResult = { batch: ImportBatch; exceptions: ImportExceptionRecord[]; rulesAutoAllocated?: number };

/** Phase 8 — Intelligent Bank Statement Processing. Reports this
 * component's real, already-existing state transitions to an optional
 * listener so a guided multi-step UI (`StatementProcessingFlow`) can
 * reflect genuine progress instead of a fabricated one — every phase
 * here corresponds to a real state this component already reaches, not
 * a new one invented for the stepper. `committed` fires once for either
 * import path: directly from `handleUpload` for CSV/XLSX/OFX/QIF, or
 * from the PDF review panel's own confirm success. */
export type StatementUploadPhase =
  | { phase: "idle" }
  | { phase: "file-selected"; fileName: string }
  | { phase: "uploading" }
  | { phase: "pdf-preview"; batchId: string }
  | { phase: "committed"; batchId: string; importedAt: string }
  | { phase: "error"; message: string };

/** Master Implementation Tracker — Epic E11, Finding #209 (RC-9). The
 * PDF review panel's in-progress corrections previously lived only in
 * React state, unmounted (and lost) on any navigation away from this
 * page. `pdfPreview` (this component) and `transactions`
 * (`PdfImportReviewPanel`) are persisted to `sessionStorage` under
 * matching keys so navigating away and back — or an accidental refresh
 * — rehydrates the in-progress review instead of silently discarding
 * it. Cleared on explicit Discard or a successful Confirm Import. */
export function pdfPreviewStorageKey(companyId: string, kind: string): string {
  return `vyron:pdf-import-preview:${companyId}:${kind}`;
}

function readStoredPreview(companyId: string, kind: string): PdfStatementPreview | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(pdfPreviewStorageKey(companyId, kind));
    return raw ? (JSON.parse(raw) as PdfStatementPreview) : null;
  } catch {
    return null;
  }
}

/** Pilot Review Round 1, Phase 9 — "PDF Upload, Drag & Drop, Validation,
 * Progress, Detection." Upload progress uses `XMLHttpRequest` rather than
 * `fetch`, since `fetch` has no upload-progress event — the one place in
 * this codebase that needs it, so the one place that reaches for it. */
function uploadWithProgress(url: string, formData: FormData, onProgress: (percent: number) => void): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body: unknown = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // non-JSON response — body stays {}
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(formData);
  });
}

export function ImportUploadCard({
  companyId,
  kind,
  title,
  description,
  templateHint,
  previewMode,
  onPhaseChange,
}: {
  companyId: string;
  kind: "bills" | "bank-transactions";
  title: string;
  description: string;
  templateHint: string;
  previewMode: boolean;
  onPhaseChange?: (phase: StatementUploadPhase) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [pdfPreview, setPdfPreview] = useState<PdfStatementPreview | null>(() => readStoredPreview(companyId, kind));

  const acceptString = kind === "bank-transactions" ? ".csv,.xlsx,.ofx,.qif,.pdf" : ".csv";
  // Master Implementation Tracker — Programme 2, Epic E2, Finding #144.
  const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

  function selectFile(file: File | null) {
    if (file && file.size > MAX_FILE_SIZE_BYTES) {
      const message = `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the maximum supported file size is 25 MB. Split it into smaller files and import each separately.`;
      setError(message);
      setPendingFile(null);
      setFileName(null);
      setResult(null);
      onPhaseChange?.({ phase: "error", message });
      return;
    }
    setPendingFile(file);
    setFileName(file?.name ?? null);
    setResult(null);
    setError(null);
    onPhaseChange?.(file ? { phase: "file-selected", fileName: file.name } : { phase: "idle" });
  }

  function clearStoredPreview() {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(pdfPreviewStorageKey(companyId, kind));
    if (pdfPreview) window.sessionStorage.removeItem(`vyron:pdf-import-transactions:${companyId}:${pdfPreview.batchId}`);
  }

  function discardPreview() {
    clearStoredPreview();
    setPdfPreview(null);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = "";
    onPhaseChange?.({ phase: "idle" });
  }

  async function handleUpload() {
    const file = pendingFile;
    if (!file) {
      setError(kind === "bank-transactions" ? "Choose or drop a .csv, .xlsx, .ofx, .qif, or .pdf file first." : "Choose a .csv file first.");
      return;
    }

    const isPdf = file.name.toLowerCase().endsWith(".pdf");

    setLoading(true);
    setProgress(0);
    setError(null);
    setResult(null);
    onPhaseChange?.({ phase: "uploading" });
    try {
      const formData = new FormData();
      formData.append("file", file);
      // PDF Bank Statement Import — Product Review Board's Final
      // Outstanding Requirement: "Display all extracted transactions for
      // user review before import." PDFs go through a read-only preview
      // endpoint; every other format still commits in one shot below.
      const endpoint = isPdf
        ? `/api/companies/${companyId}/import-centre/bank-transactions/preview`
        : `/api/companies/${companyId}/import-centre/${kind}`;
      const { status, body } = await uploadWithProgress(endpoint, formData, setProgress);
      if (status < 200 || status >= 300) {
        const message = (body as { error?: string }).error ?? `Request failed (${status})`;
        // Phase 8 — preserve the real technical detail (status + raw
        // response body) for diagnostics, even though the user only ever
        // sees the human-readable `message` below.
        console.error("Statement import request failed", { status, body });
        setError(message);
        onPhaseChange?.({ phase: "error", message });
        return;
      }
      if (isPdf) {
        setPdfPreview(body as PdfStatementPreview);
        if (typeof window !== "undefined") window.sessionStorage.setItem(pdfPreviewStorageKey(companyId, kind), JSON.stringify(body));
        onPhaseChange?.({ phase: "pdf-preview", batchId: (body as PdfStatementPreview).batchId });
      } else {
        const uploadResult = body as UploadResult;
        setResult(uploadResult);
        router.refresh();
        onPhaseChange?.({ phase: "committed", batchId: uploadResult.batch.batchId, importedAt: new Date().toISOString() });
      }
      if (inputRef.current) inputRef.current.value = "";
      setPendingFile(null);
    } catch (err) {
      console.error("Statement import request could not be sent", err);
      const message = "Couldn't reach the API. Check the dev server is running.";
      setError(message);
      onPhaseChange?.({ phase: "error", message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <p className="text-xs text-vf-ink-faint">{templateHint}</p>

        {/* Phase 32 — "a user must never have to guess what columns an
         * import requires." Headers come straight from each parser's own
         * exported constant, never a hand-copied list. Bank Transactions
         * gets both formats since it's the one importer that genuinely
         * supports both CSV and Excel. */}
        <div className="flex flex-wrap items-center gap-2">
          {kind === "bills" ? (
            <Button variant="subtle" size="sm" onClick={() => downloadCsv("VYRON_Bills_Import_Template.csv", BILLS_IMPORT_TEMPLATE_HEADERS, [])}>
              <IconArrowDown className="h-4 w-4" /> Download Template
            </Button>
          ) : (
            <>
              <Button variant="subtle" size="sm" onClick={() => downloadCsv("VYRON_Bank_Transactions_Import_Template.csv", STANDARD_HEADERS, [])}>
                <IconArrowDown className="h-4 w-4" /> Download CSV Template
              </Button>
              <Button variant="subtle" size="sm" onClick={() => window.open(`/api/companies/${companyId}/import-centre/bank-transactions/template`, "_blank")}>
                <IconArrowDown className="h-4 w-4" /> Download Excel Template
              </Button>
            </>
          )}
        </div>

        {previewMode ? (
          <div className="flex flex-col items-start gap-1">
            <Button variant="subtle" size="sm" disabled title="Available once a production Supabase project is connected">
              Choose File
            </Button>
            <p className="text-xs text-vf-ink-faint">Imports run against real data once Supabase is configured.</p>
          </div>
        ) : pdfPreview ? (
          <PdfImportReviewPanel
            companyId={companyId}
            preview={pdfPreview}
            onDiscard={discardPreview}
            onConfirmed={() => {
              clearStoredPreview();
              onPhaseChange?.({ phase: "committed", batchId: pdfPreview.batchId, importedAt: new Date().toISOString() });
            }}
          />
        ) : (
          <>
            <div
              className={cn(
                "flex flex-col items-center gap-2 rounded-vf-md border-2 border-dashed p-6 text-center transition-colors",
                dragActive ? "border-vf-red-500 bg-vf-red-500/5" : "border-vf-paper-border",
              )}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) selectFile(file);
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept={acceptString}
                className="hidden"
                id={`${kind}-file-input`}
                aria-label={`Choose a file for ${title}`}
                onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-sm text-vf-ink-soft">Drag &amp; drop a file here, or</p>
              <Button variant="subtle" size="sm" onClick={() => inputRef.current?.click()}>
                Choose File
              </Button>
              <span aria-live="polite" className="text-sm text-vf-ink-soft">
                {fileName ?? "No file selected"}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <Button variant="primary" size="sm" onClick={handleUpload} disabled={loading || !fileName}>
                {loading ? "Importing…" : "Import"}
              </Button>
              {loading && (
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-vf-paper-alt">
                  <div className="h-full bg-vf-red-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>

            {error && (
              <div role="alert" className="flex flex-col items-start gap-2 rounded-vf-md border border-vf-danger/25 bg-vf-danger/5 p-3.5">
                <p className="text-sm font-medium text-vf-danger">We couldn&rsquo;t complete this import</p>
                <p className="text-xs text-vf-ink-soft">{error}</p>
                <p className="text-xs text-vf-ink-faint">You can try again, or choose a different file.</p>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    onPhaseChange?.({ phase: "idle" });
                  }}
                >
                  Try Again
                </Button>
              </div>
            )}

            {result && kind === "bank-transactions" && (
              <div className="flex flex-col gap-2">
                <ImportOutcomeSummary
                  companyId={companyId}
                  batchId={result.batch.batchId}
                  importedCount={result.batch.importedCount}
                  duplicateCount={result.batch.duplicateCount}
                  rulesAllocatedCount={result.rulesAutoAllocated ?? 0}
                  exceptionCount={result.exceptions.length}
                  onImportAnother={() => {
                    setResult(null);
                    onPhaseChange?.({ phase: "idle" });
                  }}
                  onFinish={() => {
                    setResult(null);
                    onPhaseChange?.({ phase: "idle" });
                  }}
                />
                {result.exceptions.length > 0 && (
                  <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-vf-md border border-vf-paper-border bg-vf-paper-alt p-3 text-xs text-vf-ink-faint">
                    {result.exceptions.slice(0, 20).map((exc, i) => (
                      <li key={i}>
                        Row {exc.rowNumber} — <span className="font-medium text-vf-ink-soft">{exc.exceptionType}</span>: {exc.description}
                      </li>
                    ))}
                    {result.exceptions.length > 20 && <li>…and {result.exceptions.length - 20} more.</li>}
                  </ul>
                )}
              </div>
            )}

            {result && kind === "bills" && (
              <div role="status" aria-live="polite" className="flex flex-col gap-2 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="good">{result.batch.importedCount} imported</Badge>
                  {result.batch.duplicateCount > 0 && <Badge tone="muted">{result.batch.duplicateCount} already on file</Badge>}
                  {result.exceptions.length > 0 && <Badge tone="warn">{result.exceptions.length} exception(s)</Badge>}
                </div>
                {result.exceptions.length > 0 && (
                  <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-xs text-vf-ink-faint">
                    {result.exceptions.slice(0, 20).map((exc, i) => (
                      <li key={i}>
                        Row {exc.rowNumber} — <span className="font-medium text-vf-ink-soft">{exc.exceptionType}</span>: {exc.description}
                      </li>
                    ))}
                    {result.exceptions.length > 20 && <li>…and {result.exceptions.length - 20} more.</li>}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
