"use client";

/**
 * SD-3E — the statement's header: date, period, balances, printed totals and
 * the debit/credit convention. While the statement is in review or being
 * entered by hand, a reviewer corrects it against the original; only the
 * fields that changed are sent, and the server checks the statement again.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { formatAmount, formatDate } from "@/lib/format";
import type { StatementHeaderValues } from "./statement-types";

type Key = keyof StatementHeaderValues;
const FIELDS: { key: Key; label: string; kind: "date" | "money" | "currency" | "convention" }[] = [
  { key: "statementDate", label: "Statement date", kind: "date" },
  { key: "periodFrom", label: "Period from", kind: "date" },
  { key: "periodTo", label: "Period to", kind: "date" },
  { key: "currencyCode", label: "Currency (blank = company currency)", kind: "currency" },
  { key: "openingBalance", label: "Opening balance", kind: "money" },
  { key: "closingBalance", label: "Closing balance", kind: "money" },
  { key: "printedTotalDebits", label: "Printed debit total", kind: "money" },
  { key: "printedTotalCredits", label: "Printed credit total", kind: "money" },
  { key: "signConvention", label: "Debit / credit convention", kind: "convention" },
];

function show(kind: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "money") return formatAmount(Number(value));
  if (kind === "date") return formatDate(String(value));
  if (kind === "convention") return value === "credit-increases-owed" ? "Credits increase what we owe" : "Debits increase what we owe";
  return String(value);
}

const toDraft = (h: StatementHeaderValues) => Object.fromEntries(FIELDS.map((f) => [f.key, h[f.key] === null ? "" : String(h[f.key])])) as Record<Key, string>;

/** Parses the draft; money accepts "1 234,56" or "1234.56". */
export function headerDraftChanges(header: StatementHeaderValues, draft: Record<Key, string>): { changes: Record<string, unknown>; invalid: string[] } {
  const changes: Record<string, unknown> = {};
  const invalid: string[] = [];
  for (const f of FIELDS) {
    const raw = draft[f.key].trim();
    let value: unknown;
    if (f.kind === "money") {
      if (raw === "") value = null;
      else {
        const n = Number(raw.replace(/[\s\u00a0]/g, "").replace(",", "."));
        if (!Number.isFinite(n)) {
          invalid.push(f.label);
          continue;
        }
        value = Math.round(n * 100) / 100;
      }
    } else if (f.kind === "currency") value = raw ? raw.toUpperCase() : null;
    else value = raw || null;
    const current = header[f.key];
    const same = typeof value === "number" && typeof current === "number" ? Math.abs(value - current) < 0.005 : (value ?? null) === (current ?? null);
    if (!same) changes[f.key] = value;
  }
  return { changes, invalid };
}

export function StatementHeaderForm({
  header,
  extracted,
  editable,
  busy,
  onSave,
}: {
  header: StatementHeaderValues;
  extracted: Partial<StatementHeaderValues> | null;
  editable: boolean;
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(() => toDraft(header));
  const [error, setError] = useState<string | null>(null);
  // Reset to what is stored after a save — adjusted during render, and only
  // when the stored values actually changed.
  const headerKey = JSON.stringify(header);
  const [shownKey, setShownKey] = useState(headerKey);
  if (shownKey !== headerKey) {
    setShownKey(headerKey);
    setDraft(toDraft(header));
  }

  const { changes, invalid } = headerDraftChanges(header, draft);
  const dirty = Object.keys(changes).length > 0;

  async function save() {
    if (invalid.length) {
      setError(`Check ${invalid.join(", ")} — enter an amount.`);
      return;
    }
    setError(null);
    await onSave(changes);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Statement details</CardTitle>
        <CardDescription>
          {editable
            ? "Check each value against the original. Corrections are recorded, and the statement is checked again."
            : "As recorded. These can be changed only while the statement is in review or being entered by hand."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {FIELDS.map((f) => {
            const id = `statement-header-${f.key}`;
            const read = extracted?.[f.key];
            const corrected = extracted && read !== undefined && show(f.kind, read) !== show(f.kind, header[f.key]);
            return (
              <div key={f.key} className="flex min-w-0 flex-col gap-1">
                {editable ? (
                  <Field label={f.label} htmlFor={id}>
                    {f.kind === "convention" ? (
                      <Select id={id} value={draft[f.key]} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                        <option value="debit-increases-owed">Debits increase what we owe (usual)</option>
                        <option value="credit-increases-owed">Credits increase what we owe</option>
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        type={f.kind === "date" ? "date" : "text"}
                        inputMode={f.kind === "money" ? "decimal" : undefined}
                        value={draft[f.key]}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                        className={f.kind === "money" ? "font-mono tabular-nums" : undefined}
                      />
                    )}
                  </Field>
                ) : (
                  <>
                    <span className="text-[0.8rem] font-medium text-vf-ink-faint">{f.label}</span>
                    <span className={f.kind === "money" ? "font-mono text-sm tabular-nums text-vf-ink" : "text-sm text-vf-ink"}>{show(f.kind, header[f.key])}</span>
                  </>
                )}
                {corrected && (
                  <span className="text-xs text-vf-ink-faint">
                    <Badge tone="good" className="mr-1">Corrected</Badge> read as {show(f.kind, read)}
                  </span>
                )}
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || !dirty} onClick={() => void save()}>
              Save details
            </Button>
            {dirty && (
              <Button variant="subtle" size="sm" disabled={busy} onClick={() => setDraft(toDraft(header))}>
                Undo changes
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
