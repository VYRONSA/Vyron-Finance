import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { formatAmount } from "@/lib/format";
import type { StatementEntry } from "@/server/matching/customer-statement-engine";

export type StatementCustomer = { id: number; name: string; vatNumber?: string; registrationNumber?: string };

/** The printable Customer Statement itself. `entries` is the EXACT output of
 * `buildCustomerStatement` — presentation only, no calculation; the running
 * balance starts at 0 (no customer opening balance is stored) and the
 * closing balance is the last entry's running balance. Pure markup (no
 * hooks, no "use client"): the in-app preview (`StatementDocument`) and the
 * server-rendered PDF render this ONE component. */
export function StatementDocumentBody({
  customer,
  entries,
  addressLine,
  statementDate,
  letterhead,
}: {
  customer: StatementCustomer;
  entries: StatementEntry[];
  addressLine: string | null;
  statementDate: string;
  letterhead: ReactNode;
}) {
  const closingBalance = entries.length > 0 ? entries[entries.length - 1]!.balance : 0;
  return (
    <div className="flex flex-col gap-8 p-8 sm:p-10">
      {letterhead}

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-ink-faint">Statement For</p>
          <p className="mt-1.5 text-sm font-medium text-vf-ink">{customer.name}</p>
          {addressLine && <p className="mt-0.5 max-w-[32ch] text-sm text-vf-ink-soft">{addressLine}</p>}
          {customer.vatNumber && <p className="mt-0.5 text-xs text-vf-ink-faint">VAT No: {customer.vatNumber}</p>}
          {customer.registrationNumber && <p className="mt-0.5 text-xs text-vf-ink-faint">Reg No: {customer.registrationNumber}</p>}
        </div>

        <div className="text-right">
          <p className="font-display text-lg font-semibold text-vf-ink">Statement of Account</p>
          <dl className="mt-3 space-y-1 text-xs text-vf-ink-faint">
            <div className="flex justify-end gap-2">
              <dt>Statement Date:</dt>
              <dd className="font-medium text-vf-ink-soft">{statementDate}</dd>
            </div>
            <div className="flex justify-end gap-2">
              <dt>Opening Balance:</dt>
              <dd className="font-mono font-medium text-vf-ink-soft">{formatAmount(0)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-vf-ink-faint">No Posted invoices or receipts for this customer.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-vf-ink/20 text-left text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">
              <th className="pb-2 pr-2">Date</th>
              <th className="pb-2 px-2">Type</th>
              <th className="pb-2 px-2">Reference</th>
              <th className="pb-2 px-2 text-right">Debit</th>
              <th className="pb-2 px-2 text-right">Credit</th>
              <th className="pb-2 pl-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className="border-b border-vf-paper-border">
                <td className="py-2 pr-2 text-vf-ink-soft">{e.date}</td>
                <td className="py-2 px-2">
                  <Badge tone="info">{e.type}</Badge>
                </td>
                <td className="py-2 px-2 text-vf-ink-soft">{e.reference}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{e.debit > 0 ? formatAmount(e.debit) : "—"}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{e.credit > 0 ? formatAmount(e.credit) : "—"}</td>
                <td className="py-2 pl-2 text-right font-mono tabular-nums font-medium text-vf-ink">{formatAmount(e.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-end">
        <dl className="w-64 space-y-1.5 text-sm">
          <div className="flex justify-between border-t border-vf-ink/20 pt-1.5 text-base font-semibold text-vf-ink">
            <dt>Closing Balance</dt>
            <dd className="font-mono tabular-nums">{formatAmount(closingBalance)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
