"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ImportBatch } from "@/server/accounting/types";
import type { ImportExceptionRecord } from "@/server/import-centre/types";

type UploadResult = { batch: ImportBatch; exceptions: ImportExceptionRecord[] };

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleUpload() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError(kind === "bank-transactions" ? "Choose a .csv, .xlsx, .ofx, or .qif file first." : "Choose a .csv file first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/companies/${companyId}/import-centre/${kind}`, { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setResult(body as UploadResult);
      if (inputRef.current) inputRef.current.value = "";
      setFileName(null);
      router.refresh();
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
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={inputRef}
                type="file"
                accept={kind === "bank-transactions" ? ".csv,.xlsx,.ofx,.qif" : ".csv"}
                className="hidden"
                id={`${kind}-file-input`}
                aria-label={`Choose a file for ${title}`}
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              />
              <Button variant="subtle" size="sm" onClick={() => inputRef.current?.click()}>
                Choose File
              </Button>
              <span aria-live="polite" className="text-sm text-vf-ink-soft">
                {fileName ?? "No file selected"}
              </span>
              <Button variant="primary" size="sm" onClick={handleUpload} disabled={loading || !fileName}>
                {loading ? "Importing…" : "Import"}
              </Button>
            </div>

            {error && (
              <p role="alert" className="text-xs text-vf-danger">
                {error}
              </p>
            )}

            {result && (
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
