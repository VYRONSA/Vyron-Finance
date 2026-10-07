"use client";

/**
 * SD-2 — the document's header details: what was read, what the reviewer has
 * corrected, and (while the capture is in review or being entered by hand)
 * the form to correct it. Saving sends only the fields that changed; the
 * server then re-checks duplicates and re-validates.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { formatAmount, formatDate } from "@/lib/format";
import { headerChanges, type HeaderValues } from "@/lib/supplier-documents/review-logic";

type Extracted = HeaderValues | null;

const FIELDS: { key: keyof HeaderValues; label: string; kind: "text" | "date" | "money" | "type" | "currency" }[] = [
  { key: "documentType", label: "Document type", kind: "type" },
  { key: "invoiceNumber", label: "Document number", kind: "text" },
  { key: "invoiceDate", label: "Document date", kind: "date" },
  { key: "dueDate", label: "Due date", kind: "date" },
  { key: "orderReference", label: "Order / reference", kind: "text" },
  { key: "currencyCode", label: "Currency", kind: "currency" },
  { key: "subtotal", label: "Subtotal (excl. VAT)", kind: "money" },
  { key: "discountTotal", label: "Discount", kind: "money" },
  { key: "vatAmount", label: "VAT", kind: "money" },
  { key: "total", label: "Total", kind: "money" },
];

function display(kind: string, value: string | number | null): string {
  if (value === null || value === "") return "—";
  if (kind === "money") return formatAmount(Number(value));
  if (kind === "date") return formatDate(String(value));
  return String(value);
}

function toDraft(values: HeaderValues): Record<keyof HeaderValues, string> {
  const out = {} as Record<keyof HeaderValues, string>;
  for (const f of FIELDS) out[f.key] = values[f.key] === null ? "" : String(values[f.key]);
  return out;
}

function fromDraft(draft: Record<keyof HeaderValues, string>): { values: HeaderValues; invalid: string[] } {
  const invalid: string[] = [];
  const values = {} as HeaderValues;
  for (const f of FIELDS) {
    const raw = draft[f.key].trim();
    if (f.kind === "money") {
      if (raw === "") (values as Record<string, unknown>)[f.key] = null;
      else {
        const n = Number(raw.replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(n)) invalid.push(f.label);
        (values as Record<string, unknown>)[f.key] = Number.isFinite(n) ? n : null;
      }
    } else if (f.kind === "currency") {
      (values as Record<string, unknown>)[f.key] = raw ? raw.toUpperCase() : null;
    } else {
      (values as Record<string, unknown>)[f.key] = raw || null;
    }
  }
  return { values, invalid };
}

export function CaptureHeaderForm({
  header,
  extracted,
  manualEntry,
  editable,
  busy,
  onSave,
}: {
  header: HeaderValues;
  extracted: Extracted;
  manualEntry: boolean;
  editable: boolean;
  busy: boolean;
  onSave: (changes: Partial<HeaderValues>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => toDraft(header));
  const [error, setError] = useState<string | null>(null);
  // A refreshed capture (after any save) resets the form to what is stored —
  // adjusted during render, as React recommends, rather than in an effect.
  // Compared by content: a refresh after an unrelated action (confirming the
  // supplier, say) must not discard edits the reviewer is still making.
  const headerKey = JSON.stringify(header);
  const [shownKey, setShownKey] = useState(headerKey);
  if (shownKey !== headerKey) {
    setShownKey(headerKey);
    setDraft(toDraft(header));
  }

  const { values, invalid } = fromDraft(draft);
  const changes = headerChanges(header, values);
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    if (invalid.length) {
      setError(`Check ${invalid.join(", ")} — enter a number.`);
      return;
    }
    setError(null);
    await onSave(changes);
  }

  function provenance(key: keyof HeaderValues) {
    if (manualEntry && !extracted) return <Badge tone="muted">Entered by hand</Badge>;
    if (!extracted) return null;
    const read = extracted[key];
    const current = header[key];
    const differs = (read ?? null) !== (current ?? null) && !(typeof read === "number" && typeof current === "number" && Math.abs(read - current) < 0.0005);
    return differs ? <Badge tone="good">Corrected</Badge> : read !== null ? <Badge tone="info">From the document</Badge> : null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document details</CardTitle>
        <CardDescription>
          {editable
            ? "Check each value against the original. Correct anything that was read wrongly — corrections are recorded, and the document is checked again."
            : "As recorded. These details can be changed only while the document is in review or being entered by hand."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {FIELDS.map((f) => {
            const id = `capture-header-${f.key}`;
            const read = extracted?.[f.key] ?? null;
            // The stored (reviewed) value differs from what the document was read as.
            const changed = extracted !== null && display(f.kind, read) !== display(f.kind, header[f.key]);
            return (
              <div key={f.key} className="flex min-w-0 flex-col gap-1">
                {editable ? (
                  <Field label={f.label} htmlFor={id}>
                    {f.kind === "type" ? (
                      <Select id={id} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                        <option value="">Not stated</option>
                        <option value="Invoice">Invoice</option>
                        <option value="Credit Note">Credit note</option>
                        <option value="Debit Note">Debit note</option>
                        <option value="Other">Something else</option>
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        type={f.kind === "date" ? "date" : "text"}
                        inputMode={f.kind === "money" ? "decimal" : undefined}
                        maxLength={f.kind === "currency" ? 3 : undefined}
                        value={draft[f.key]}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                        className={f.kind === "money" ? "font-mono tabular-nums" : f.key === "invoiceNumber" ? "font-mono" : undefined}
                      />
                    )}
                  </Field>
                ) : (
                  <div>
                    <p className="text-xs font-medium text-vf-ink-faint">{f.label}</p>
                    <p className={`text-sm text-vf-ink ${f.kind === "money" ? "font-mono tabular-nums" : ""}`}>{display(f.kind, header[f.key])}</p>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-vf-ink-faint">
                  {provenance(f.key)}
                  {changed && extracted && <span>Read from the document: {display(f.kind, read)}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <p role="alert" className="text-sm text-vf-danger">
            {error}
          </p>
        )}
        {editable && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty && (
              <Button variant="subtle" size="sm" disabled={busy} onClick={() => setDraft(toDraft(header))}>
                Undo changes
              </Button>
            )}
            <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save details"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
