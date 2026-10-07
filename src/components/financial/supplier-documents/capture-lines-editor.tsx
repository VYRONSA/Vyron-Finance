"use client";

/**
 * SD-2 — the document's lines: correct what was read, add a line that was
 * missed, remove one that is not a charge, confirm each line's GL account
 * and VAT code. Saving sends only what changed (`lineChanges`); the server
 * then re-validates. Totals are recomputed here the way the purchase-bill
 * engine will compute them, beside what the document itself states.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FIELD_BASE, Input } from "@/components/ui/input";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { glAccountOptions, vatCodeOptions } from "@/lib/account-picker-options";
import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { lineAmounts, lineChanges, linesTotals, type LineValues } from "@/lib/supplier-documents/review-logic";
import { describeSource } from "@/server/supplier-invoice-capture/gl-vat-suggestion";
import type { GlAccountSource, VatCodeSource } from "@/server/supplier-invoice-capture/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatTreatment } from "@/server/company-management/types";
import type { ReviewLine } from "./review-types";

type Draft = LineValues & { key: string; source?: { gl: string | null; vat: string | null } };

function toDrafts(lines: ReviewLine[]): Draft[] {
  return lines.map((l) => ({
    key: `line-${l.lineOrder}`,
    lineOrder: l.lineOrder,
    description: l.description,
    supplierSku: l.supplierSku,
    quantity: l.quantity,
    uom: l.uom,
    unitPrice: l.unitPrice,
    discount: l.discount,
    vatRatePercent: l.vatRatePercent,
    vatAmount: l.vatAmount,
    lineTotal: l.lineTotal,
    glAccount: l.glAccountConfirmed ?? l.glAccountSuggested,
    vatCode: l.vatCodeConfirmed ?? l.vatCodeSuggested,
    isExcluded: l.isExcluded,
    source: {
      gl: l.glAccountConfirmed ? null : l.glAccountSource,
      vat: l.vatCodeConfirmed ? null : l.vatCodeSource,
    },
  }));
}

function parseNumber(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function NumberCell({ value, onChange, label, disabled }: { value: number | null; onChange: (v: number | null) => void; label: string; disabled: boolean }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [shownValue, setShownValue] = useState(value);
  if (shownValue !== value) {
    setShownValue(value);
    setText(value === null ? "" : String(value));
  }
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(parseNumber(text))}
      className="w-24 text-right font-mono tabular-nums"
    />
  );
}

export function CaptureLinesEditor({
  lines,
  documentTotals,
  creditNote,
  editable,
  busy,
  vatTreatments,
  chartOfAccounts,
  onSave,
}: {
  lines: ReviewLine[];
  documentTotals: { subtotal: number | null; vatAmount: number | null; total: number | null };
  creditNote: boolean;
  editable: boolean;
  busy: boolean;
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
  onSave: (changes: ReturnType<typeof lineChanges>) => Promise<boolean>;
}) {
  const original = useMemo(() => toDrafts(lines), [lines]);
  const [drafts, setDrafts] = useState<Draft[]>(original);
  // By content, so an unrelated refresh never discards unsaved line edits.
  const originalKey = JSON.stringify(original);
  const [shownKey, setShownKey] = useState(originalKey);
  if (shownKey !== originalKey) {
    setShownKey(originalKey);
    setDrafts(original);
  }

  const glOptions = useMemo(() => glAccountOptions(chartOfAccounts), [chartOfAccounts]);
  const vatOptions = useMemo(() => vatCodeOptions(vatTreatments), [vatTreatments]);
  const rates = useMemo(() => new Map(vatTreatments.map((t) => [t.code, t.rate])), [vatTreatments]);

  const changes = lineChanges(original, drafts);
  const dirty = changes.lines.length + changes.add.length + changes.remove.length > 0;
  const totals = linesTotals(drafts, rates);

  const update = (key: string, patch: Partial<Draft>) => setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const addLine = () =>
    setDrafts((all) => [
      ...all,
      {
        key: `new-${Date.now()}-${all.length}`,
        lineOrder: null,
        description: "",
        supplierSku: null,
        quantity: 1,
        uom: null,
        unitPrice: null,
        discount: null,
        vatRatePercent: null,
        vatAmount: null,
        lineTotal: null,
        glAccount: null,
        vatCode: null,
        isExcluded: false,
      },
    ]);

  const docTotal = documentTotals.total === null ? null : Math.abs(documentTotals.total);
  const difference = docTotal === null ? null : Math.round((docTotal - totals.total) * 100) / 100;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Lines</CardTitle>
        <CardDescription>
          {editable
            ? "Correct quantities, prices and descriptions against the original, add any line that was missed, and confirm each line's GL account and VAT code."
            : "As recorded."}
          {creditNote && " This is a credit note: amounts are shown as positive figures and are booked as a reduction."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeadCell>Include</TableHeadCell>
              <TableHeadCell>Description</TableHeadCell>
              <TableHeadCell className="text-right">Qty</TableHeadCell>
              <TableHeadCell className="text-right">Unit price</TableHeadCell>
              <TableHeadCell className="text-right">Discount</TableHeadCell>
              <TableHeadCell>GL account</TableHeadCell>
              <TableHeadCell>VAT code</TableHeadCell>
              <TableHeadCell className="text-right">Net</TableHeadCell>
              <TableHeadCell>
                <span className="sr-only">Remove</span>
              </TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {drafts.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-sm text-vf-ink-faint">
                  No lines yet.{editable ? " Add the document's lines from the original." : ""}
                </TableCell>
              </TableRow>
            )}
            {drafts.map((d, index) => {
              const amounts = lineAmounts(d, rates);
              const name = d.description.trim() || `line ${index + 1}`;
              return (
                <TableRow key={d.key} className={cn(d.remove && "opacity-50", d.isExcluded && "text-vf-ink-faint")}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Include ${name}`}
                      checked={!d.isExcluded}
                      disabled={!editable || d.remove}
                      onChange={(e) => update(d.key, { isExcluded: !e.target.checked })}
                      className="h-4 w-4 accent-vf-red-600"
                    />
                  </TableCell>
                  <TableCell>
                    {editable ? (
                      <Input
                        aria-label={`Description of ${name}`}
                        value={d.description}
                        disabled={d.remove}
                        onChange={(e) => update(d.key, { description: e.target.value })}
                        className="w-56"
                      />
                    ) : (
                      <span className="text-sm">{d.description || "—"}</span>
                    )}
                    {d.supplierSku && <span className="mt-0.5 block font-mono text-xs text-vf-ink-faint">{d.supplierSku}</span>}
                    {d.lineOrder === null && <span className="mt-0.5 block text-xs text-vf-ink-faint">Added by you</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <NumberCell label={`Quantity of ${name}`} value={d.quantity} disabled={!!d.remove} onChange={(v) => update(d.key, { quantity: v })} />
                    ) : (
                      <span className="font-mono text-sm tabular-nums">{d.quantity ?? "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <NumberCell label={`Unit price of ${name}`} value={d.unitPrice} disabled={!!d.remove} onChange={(v) => update(d.key, { unitPrice: v })} />
                    ) : (
                      <span className="font-mono text-sm tabular-nums">{d.unitPrice === null ? "—" : formatAmount(Math.abs(d.unitPrice))}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {editable ? (
                      <NumberCell label={`Discount on ${name}`} value={d.discount} disabled={!!d.remove} onChange={(v) => update(d.key, { discount: v })} />
                    ) : (
                      <span className="font-mono text-sm tabular-nums">{d.discount ? formatAmount(Math.abs(d.discount)) : "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-[12rem]">
                    <Combobox
                      aria-label={`GL account for ${name}`}
                      value={d.glAccount}
                      options={glOptions}
                      disabled={!editable || d.remove}
                      inputClassName={FIELD_BASE}
                      placeholder="Choose account"
                      onCommit={(value) => update(d.key, { glAccount: value, source: { gl: null, vat: d.source?.vat ?? null } })}
                    />
                    {d.source?.gl && <span className="mt-0.5 block text-xs text-vf-ink-faint">From {describeSource(d.source.gl as GlAccountSource)}</span>}
                  </TableCell>
                  <TableCell className="min-w-[10rem]">
                    <Combobox
                      aria-label={`VAT code for ${name}`}
                      value={d.vatCode}
                      options={vatOptions}
                      disabled={!editable || d.remove}
                      inputClassName={FIELD_BASE}
                      placeholder="Choose VAT"
                      onCommit={(value) => update(d.key, { vatCode: value, source: { gl: d.source?.gl ?? null, vat: null } })}
                    />
                    {d.source?.vat && <span className="mt-0.5 block text-xs text-vf-ink-faint">From {describeSource(d.source.vat as VatCodeSource)}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{amounts ? formatAmount(amounts.net) : "—"}</TableCell>
                  <TableCell>
                    {editable && (
                      <Button
                        variant="subtle"
                        size="sm"
                        aria-label={d.remove ? `Keep ${name}` : `Remove ${name}`}
                        onClick={() =>
                          d.lineOrder === null
                            ? setDrafts((all) => all.filter((x) => x.key !== d.key))
                            : update(d.key, { remove: !d.remove })
                        }
                      >
                        <IconTrash className="h-4 w-4" />
                        <span className="hidden sm:inline">{d.remove ? "Keep" : "Remove"}</span>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-start justify-between gap-4">
          {editable ? (
            <Button variant="subtle" size="sm" onClick={addLine} disabled={busy}>
              <IconPlus className="h-4 w-4" /> Add a line
            </Button>
          ) : (
            <span />
          )}
          <dl className="grid min-w-[16rem] grid-cols-[auto_auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="sr-only">Figure</dt>
            <dd className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint" />
            <dd className="text-right text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Lines add to</dd>
            <dd className="text-right text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Document says</dd>
            {(
              [
                ["Subtotal", totals.net, documentTotals.subtotal],
                ["VAT", totals.vat, documentTotals.vatAmount],
                ["Total", totals.total, documentTotals.total],
              ] as const
            ).map(([label, computed, stated]) => (
              <div key={label} className="contents">
                <dt className="text-vf-ink-soft">{label}</dt>
                <dd className="text-right font-mono tabular-nums">{formatAmount(computed)}</dd>
                <dd className="text-right font-mono tabular-nums">{stated === null ? "—" : formatAmount(Math.abs(stated))}</dd>
              </div>
            ))}
          </dl>
        </div>
        {!totals.complete && <p className="text-xs text-vf-ink-faint">Some lines have no quantity or price yet, so they are not counted.</p>}
        {difference !== null && Math.abs(difference) >= 0.01 && (
          <p role="status" className="rounded-vf-sm border border-vf-warning/40 px-3 py-2 text-sm text-vf-warning">
            The lines and the document&rsquo;s total differ by {formatAmount(Math.abs(difference))}. Check the lines against the original.
          </p>
        )}

        {editable && (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty && (
              <Button variant="subtle" size="sm" disabled={busy} onClick={() => setDrafts(original)}>
                Undo changes
              </Button>
            )}
            <Button size="sm" disabled={!dirty || busy} onClick={() => void onSave(changes)}>
              {busy ? "Saving…" : "Save lines"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
