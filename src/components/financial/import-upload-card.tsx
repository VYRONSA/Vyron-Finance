"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ImportBatch } from "@/server/accounting/types";
import type { ImportExceptionRecord } from "@/server/import-centre/types";
import { PdfImportReviewPanel, type PdfStatementPreview } from "@/components/financial/import-centre/pdf-import-review-panel";
import { ImportOutcomeSummary } from "@/components/financial/import-centre/import-outcome-summary";

type UploadResult = { batch: ImportBatch; exceptions: ImportExceptionRecord[] };

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
}: {
  companyId: string;
  kind: "bills" | "bank-transactions";
  title: string;
  description: string;
  templateHint: string;
  previewMode: boolean;
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
  const [pdfPreview, setPdfPreview] = useState<PdfStatementPreview | null>(null);

  const acceptString = kind === "bank-transactions" ? ".csv,.xlsx,.ofx,.qif,.pdf" : ".csv";

  function selectFile(file: File | null) {
    setPendingFile(file);
    setFileName(file?.name ?? null);
    setResult(null);
    setError(null);
  }

  function discardPreview() {
    setPdfPreview(null);
    setFileName(null);
    if (inputRef.current) inputRef.current.value = "";
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
        setError((body as { error?: string }).error ?? `Request failed (${status})`);
        return;
      }
      if (isPdf) {
        setPdfPreview(body as PdfStatementPreview);
      } else {
        setResult(body as UploadResult);
        router.refresh();
      }
      if (inputRef.current) inputRef.current.value = "";
      setPendingFile(null);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
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

        {previewMode ? (
          <div className="flex flex-col items-start gap-1">
            <Button variant="subtle" size="sm" disabled title="Available once a production Supabase project is connected">
              Choose File
            </Button>
            <p className="text-xs text-vf-ink-faint">Imports run against real data once Supabase is configured.</p>
          </div>
        ) : pdfPreview ? (
          <PdfImportReviewPanel companyId={companyId} preview={pdfPreview} onDiscard={discardPreview} />
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
              <p role="alert" className="text-xs text-vf-danger">
                {error}
              </p>
            )}

            {result && kind === "bank-transactions" && (
              <div className="flex flex-col gap-2">
                <ImportOutcomeSummary
                  companyId={companyId}
                  batchId={result.batch.batchId}
                  importedCount={result.batch.importedCount}
                  duplicateCount={result.batch.duplicateCount}
                  rulesAllocatedCount={0}
                  exceptionCount={result.exceptions.length}
                  onImportAnother={() => setResult(null)}
                  onFinish={() => setResult(null)}
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
