"use client";

/**
 * Phase 32 — "Every import function in VYRON Finance must provide a
 * downloadable template." One small, reusable button rather than a
 * hand-rolled download handler per importer page — every caller passes
 * ONLY a filename and the exact header array its own importer already
 * exports (see e.g. `SUPPLIER_IMPORT_TEMPLATE_HEADERS`), so a template
 * can never drift from the real contract. Row 2 is deliberately left
 * blank (headers only) rather than a sample data row — an example row
 * risks being imported as-is as real accounting data, which the
 * template must never do.
 */

import { Button } from "@/components/ui/button";
import { IconArrowDown } from "@/components/ui/icons";
import { downloadCsv } from "@/lib/csv-export";

export function DownloadTemplateButton({
  filename,
  headers,
  label = "Download Template",
  disabled,
  title,
}: {
  filename: string;
  headers: string[];
  label?: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Button variant="subtle" size="sm" disabled={disabled} title={title} onClick={() => downloadCsv(filename, headers, [])}>
      <IconArrowDown className="h-4 w-4" /> {label}
    </Button>
  );
}
