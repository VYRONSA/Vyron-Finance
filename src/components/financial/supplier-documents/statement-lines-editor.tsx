"use client";

/**
 * SD-3E — the statement's lines, as read (or entered), with every value the
 * reader could not interpret reliably shown as UNREAD next to the text it
 * actually read. A reviewer corrects lines against the original; references
 * are kept exactly as typed (leading zeros matter).
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { IconPlus, IconTrash } from "@/components/ui/icons";
import { formatAmount, formatDate } from "@/lib/format";
import { EXCLUSION_LABEL, TRANSACTION_TYPE_LABEL, TRANSACTION_TYPES, UNRESOLVED_LABEL } from "@/lib/supplier-documents/statement-stages";
import { cn } from "@/lib/utils";
import type { StatementLineView } from "./statement-types";

type Draft = { date: string; reference: string; description: string; type: string; debit: string; credit: string; balance: string };
const EMPTY: Draft = { date: "", reference: "", description: "", type: "invoice", debit: "", credit: "", balance: "" };

const toDraft = (l: StatementLineView): Draft => ({
  date: l.transactionDate ?? "",
  reference: l.referenceText ?? "",
  description: l.description ?? "",
  type: l.transactionType,
  debit: l.debit === null ? "" : String(l.debit),
  credit: l.credit === null ? "" : String(l.credit),
  balance: l.runningBalance === null ? "" : String(l.runningBalance),
});

function amount(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(/[\s\u00a0]/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : "invalid";
}

/** The changes a draft makes to a line, in the API's terms (only what changed). */
export function lineDraftChanges(line: StatementLineView, d: Draft): Record<string, unknown> | "invalid" {
  const out: Record<string, unknown> = {};
  if ((d.date || null) !== line.transactionDate) out.transactionDate = d.date || null;
  if ((d.reference.trim() || null) !== line.referenceText) out.referenceText = d.reference.trim() || null;
  if ((d.description.trim() || null) !== line.description) out.description = d.description.trim() || null;
  if (d.type !== line.transactionType) out.transactionType = d.type;
  for (const [key, raw, current] of [["debit", d.debit, line.debit], ["credit", d.credit, line.credit], ["runningBalance", d.balance, line.runningBalance]] as const) {
    const v = amount(raw);
    if (v === "invalid") return "invalid";
    if (v !== current) out[key] = v;
  }
  return out;
}

export function StatementLinesEditor({
  lines,
  editable,
  busy,
  onSave,
  onShowPage,
}: {
  lines: StatementLineView[];
  editable: boolean;
  busy: boolean;
  onSave: (changes: { update: Record<string, unknown>[]; add: Record<string, unknown>[]; remove: number[] }) => Promise<boolean>;
  onShowPage: (page: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [added, setAdded] = useState<Draft[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const [excluded, setExcluded] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const linesKey = JSON.stringify(lines);
  const [shownKey, setShownKey] = useState(linesKey);
  if (shownKey !== linesKey) {
    setShownKey(linesKey);
    setDrafts({});
    setAdded([]);
    setRemoved([]);
    setExcluded({});
    setEditing(false);
  }

  const transactions = lines.filter((l) => !l.isExcluded);
  const unread = transactions.filter((l) => l.unresolvedFields.length > 0).length;

  function begin() {
    setDrafts(Object.fromEntries(lines.map((l) => [l.id, toDraft(l)])));
    setEditing(true);
  }

  async function save() {
    const update: Record<string, unknown>[] = [];
    for (const l of lines) {
      if (removed.includes(l.id)) continue;
      const d = drafts[l.id];
      const change = d ? lineDraftChanges(l, d) : {};
      if (change === "invalid") {
        setError(`Line ${l.lineOrder}: enter amounts as numbers.`);
        return;
      }
      if (excluded[l.id] !== undefined && excluded[l.id] !== l.isExcluded) change.isExcluded = excluded[l.id];
      if (Object.keys(change).length > 0) update.push({ lineId: l.id, ...change });
    }
    const add: Record<string, unknown>[] = [];
    for (const [i, d] of added.entries()) {
      const debit = amount(d.debit);
      const credit = amount(d.credit);
      const balance = amount(d.balance);
      if (debit === "invalid" || credit === "invalid" || balance === "invalid") {
        setError(`New line ${i + 1}: enter amounts as numbers.`);
        return;
      }
      if (debit === null && credit === null) {
        setError(`New line ${i + 1}: enter a debit or a credit.`);
        return;
      }
      add.push({ transactionDate: d.date || null, referenceText: d.reference.trim() || null, description: d.description.trim() || null, transactionType: d.type, debit, credit, runningBalance: balance });
    }
    setError(null);
    await onSave({ update, add, remove: removed });
  }

  const cell = (id: number, key: keyof Draft, label: string, props: Record<string, unknown> = {}) => (
    <Input
      aria-label={label}
      value={drafts[id]?.[key] ?? ""}
      onChange={(e) => setDrafts({ ...drafts, [id]: { ...drafts[id], [key]: e.target.value } })}
      className="h-8 min-w-[6rem] px-2 text-sm"
      {...props}
    />
  );

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Statement lines</CardTitle>
        <CardDescription>
          {transactions.length} transaction{transactions.length === 1 ? "" : "s"}
          {lines.length > transactions.length ? `, plus ${lines.length - transactions.length} total / balance row(s) kept for the record` : ""}.
          {unread > 0 && ` ${unread} line${unread === 1 ? " has" : "s have"} a value that could not be read reliably — correct it from the original.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {lines.length === 0 && added.length === 0 ? (
          <p className="text-sm text-vf-ink-faint">{editable ? "No lines yet. Add them from the original." : "No lines."}</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeadCell>#</TableHeadCell>
                <TableHeadCell>Date</TableHeadCell>
                <TableHeadCell>Reference</TableHeadCell>
                <TableHeadCell>Description</TableHeadCell>
                <TableHeadCell>Type</TableHeadCell>
                <TableHeadCell className="text-right">Debit</TableHeadCell>
                <TableHeadCell className="text-right">Credit</TableHeadCell>
                <TableHeadCell className="text-right">Balance</TableHeadCell>
                {editing && <TableHeadCell><span className="sr-only">Line actions</span></TableHeadCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {lines.map((l) => {
                const gone = removed.includes(l.id);
                const isExcluded = excluded[l.id] ?? l.isExcluded;
                const unreadFields = new Set(l.unresolvedFields.map((f) => UNRESOLVED_LABEL[f] ?? f));
                const flag = (name: string) => unreadFields.has(name) && <Badge tone="danger" className="ml-1">Unread</Badge>;
                if (editing && !gone && !l.isExcluded) {
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-vf-ink-faint">{l.lineOrder}</TableCell>
                      <TableCell>{cell(l.id, "date", `Line ${l.lineOrder} date`, { type: "date" })}</TableCell>
                      <TableCell>{cell(l.id, "reference", `Line ${l.lineOrder} reference`, { className: "h-8 min-w-[7rem] px-2 font-mono text-sm" })}</TableCell>
                      <TableCell>{cell(l.id, "description", `Line ${l.lineOrder} description`)}</TableCell>
                      <TableCell>
                        <Select aria-label={`Line ${l.lineOrder} type`} value={drafts[l.id]?.type ?? l.transactionType} className="h-8 text-sm"
                          onChange={(e) => setDrafts({ ...drafts, [l.id]: { ...drafts[l.id], type: e.target.value } })}>
                          {TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{TRANSACTION_TYPE_LABEL[t]}</option>)}
                        </Select>
                      </TableCell>
                      <TableCell>{cell(l.id, "debit", `Line ${l.lineOrder} debit`, { inputMode: "decimal", className: "h-8 min-w-[6rem] px-2 text-right font-mono text-sm" })}</TableCell>
                      <TableCell>{cell(l.id, "credit", `Line ${l.lineOrder} credit`, { inputMode: "decimal", className: "h-8 min-w-[6rem] px-2 text-right font-mono text-sm" })}</TableCell>
                      <TableCell>{cell(l.id, "balance", `Line ${l.lineOrder} balance`, { inputMode: "decimal", className: "h-8 min-w-[6rem] px-2 text-right font-mono text-sm" })}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button variant="subtle" size="sm" aria-label={`Exclude line ${l.lineOrder}`} title="Not a transaction (a total or balance row)"
                          onClick={() => setExcluded({ ...excluded, [l.id]: !isExcluded })}>
                          {isExcluded ? "Include" : "Exclude"}
                        </Button>
                        <Button variant="subtle" size="sm" aria-label={`Remove line ${l.lineOrder}`} onClick={() => setRemoved([...removed, l.id])}>
                          <IconTrash className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                }
                if (gone) return null;
                return (
                  <TableRow key={l.id} className={cn(isExcluded && "opacity-60")}>
                    <TableCell className="text-xs text-vf-ink-faint">
                      {l.lineOrder}
                      {l.pageNumber !== null && (
                        <button type="button" className="block text-vf-red-600 hover:underline" onClick={() => onShowPage(l.pageNumber!)} aria-label={`Show page ${l.pageNumber} of the original`}>
                          p.{l.pageNumber}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{l.transactionDate ? formatDate(l.transactionDate) : "—"}{flag("date")}</TableCell>
                    <TableCell className="font-mono text-sm">{l.referenceText ?? "—"}</TableCell>
                    <TableCell className="max-w-[18rem] text-sm">
                      <span className="block truncate" title={l.description ?? undefined}>{isExcluded ? EXCLUSION_LABEL[l.exclusionReason ?? ""] ?? "Excluded" : (l.description ?? "—")}</span>
                      {l.unresolvedFields.length > 0 && l.rawText && <span className="block text-xs text-vf-danger">As read: {l.rawText}</span>}
                      {l.extractedBy === "ai" && <Badge tone="warn" className="mt-1" title="Transcribed by AI from the scan — compare with the original">AI read</Badge>}
                      {l.corrected && <Badge tone="good" className="mt-1">Corrected</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{isExcluded ? "—" : TRANSACTION_TYPE_LABEL[l.transactionType] ?? l.transactionType}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{l.debit === null ? "" : formatAmount(l.debit)}{flag("amount")}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{l.credit === null ? "" : formatAmount(l.credit)}</TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums">{l.runningBalance === null ? "" : formatAmount(l.runningBalance)}{flag("balance")}</TableCell>
                    {editing && <TableCell />}
                  </TableRow>
                );
              })}
              {editing &&
                added.map((d, i) => (
                  <TableRow key={`new-${i}`}>
                    <TableCell className="text-xs text-vf-ink-faint">new</TableCell>
                    {(["date", "reference", "description"] as const).map((k) => (
                      <TableCell key={k}>
                        <Input aria-label={`New line ${i + 1} ${k}`} type={k === "date" ? "date" : "text"} value={d[k]} className="h-8 min-w-[6rem] px-2 text-sm"
                          onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                      </TableCell>
                    ))}
                    <TableCell>
                      <Select aria-label={`New line ${i + 1} type`} value={d.type} className="h-8 text-sm" onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                        {TRANSACTION_TYPES.map((t) => <option key={t} value={t}>{TRANSACTION_TYPE_LABEL[t]}</option>)}
                      </Select>
                    </TableCell>
                    {(["debit", "credit", "balance"] as const).map((k) => (
                      <TableCell key={k}>
                        <Input aria-label={`New line ${i + 1} ${k}`} inputMode="decimal" value={d[k]} className="h-8 min-w-[6rem] px-2 text-right font-mono text-sm"
                          onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} />
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Button variant="subtle" size="sm" aria-label={`Discard new line ${i + 1}`} onClick={() => setAdded(added.filter((_, j) => j !== i))}>
                        <IconTrash className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
        {error && <p role="alert" className="text-sm text-vf-danger">{error}</p>}
        {editable && (
          <div className="flex flex-wrap gap-2">
            {!editing ? (
              <Button size="sm" variant="subtle" disabled={busy} onClick={begin}>
                Correct lines
              </Button>
            ) : (
              <>
                <Button size="sm" variant="subtle" disabled={busy} onClick={() => setAdded([...added, { ...EMPTY }])}>
                  <IconPlus className="h-4 w-4" /> Add line
                </Button>
                <Button size="sm" disabled={busy} onClick={() => void save()}>
                  Save lines
                </Button>
                <Button size="sm" variant="subtle" disabled={busy} onClick={() => setShownKey("")}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
