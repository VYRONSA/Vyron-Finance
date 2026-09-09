"use client";

import { DocumentPreviewOverlay } from "./document-preview-overlay";
import { DocumentBrandingHeader } from "./document-branding-header";
import { useCustomerAddress } from "./use-customer-address";
import { useCustomerPrimaryEmail } from "./use-customer-primary-email";
import { useCompanyName } from "./use-company-name";
import { SendDocumentEmailAction } from "./send-document-email-action";
import { Badge } from "@/components/ui/badge";
import type { CustomerAddress } from "@/server/customer-management/types";
import type { StatementEntry } from "@/server/matching/customer-statement-engine";
import { statementPdfFilename } from "@/server/pdf/pdf-filename";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatAddress(address: CustomerAddress | null): string | null {
  if (!address) return null;
  const parts = [address.line1, address.line2, address.city, address.region, address.postalCode, address.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export type StatementCustomer = { id: number; name: string; vatNumber?: string; registrationNumber?: string };

/** Phase 20C — the first real, printable Customer Statement document.
 * `entries` is the EXACT output of `buildCustomerStatement` (the
 * existing, pure statement engine) — this component performs no
 * calculation of its own, only presentation. `buildCustomerStatement`
 * always starts a customer's running balance at 0 (no separate
 * "opening balance" is stored anywhere for a customer statement, unlike
 * the General Ledger's own Opening Balances module) — the opening
 * balance shown here is that same real starting point, not fabricated.
 * The closing balance is simply the last entry's running balance. */
export function StatementDocument({
  companyId,
  customer,
  entries,
  open,
  onClose,
  previewMode,
}: {
  companyId: string;
  customer: StatementCustomer;
  entries: StatementEntry[];
  open: boolean;
  onClose: () => void;
  /** Phase 24B — see `InvoiceDocument`'s own docs. */
  previewMode?: boolean;
}) {
  const address = useCustomerAddress(companyId, open ? customer.id : null);
  const recipientEmail = useCustomerPrimaryEmail(companyId, open ? customer.id : null);
  const companyName = useCompanyName(companyId);

  if (!open) return null;

  const addressLine = formatAddress(address);
  const closingBalance = entries.length > 0 ? entries[entries.length - 1]!.balance : 0;
  const statementDate = new Date().toISOString().slice(0, 10);

  return (
    <DocumentPreviewOverlay
      title={`Statement — ${customer.name}`}
      onClose={onClose}
      headerExtra={
        <SendDocumentEmailAction
          sendUrl={`/api/companies/${companyId}/customers/${customer.id}/statement/send-email`}
          recipientEmail={recipientEmail}
          documentLabel={`Statement — ${customer.name}`}
          attachmentFilename={statementPdfFilename(customer.name, statementDate)}
          companyName={companyName ?? ""}
          previewMode={previewMode ?? false}
        />
      }
      downloadHref={`/api/companies/${companyId}/customers/${customer.id}/statement/pdf`}
    >
      <div className="flex flex-col gap-8 p-8 sm:p-10">
        <DocumentBrandingHeader companyId={companyId} />

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
                <dd className="font-mono font-medium text-vf-ink-soft">{money(0)}</dd>
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
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{e.debit > 0 ? money(e.debit) : "—"}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{e.credit > 0 ? money(e.credit) : "—"}</td>
                  <td className="py-2 pl-2 text-right font-mono tabular-nums font-medium text-vf-ink">{money(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="flex justify-end">
          <dl className="w-64 space-y-1.5 text-sm">
            <div className="flex justify-between border-t border-vf-ink/20 pt-1.5 text-base font-semibold text-vf-ink">
              <dt>Closing Balance</dt>
              <dd className="font-mono tabular-nums">{money(closingBalance)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </DocumentPreviewOverlay>
  );
}
