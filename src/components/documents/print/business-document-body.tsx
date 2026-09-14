import { DocumentLetterhead } from "@/components/financial/reporting/report-document";
import { formatDate, formatMoney } from "@/components/financial/reporting/format";
import type { BusinessDocument } from "@/server/report-centre/documents";
import type { Letterhead } from "@/server/report-centre/letterhead";

/** A Document Centre document itself — letterhead, party, header block,
 * lines, settlements and totals. Pure markup (no hooks, no "use client"):
 * the on-screen view (`BusinessDocumentView`) and the server-rendered PDF
 * render this ONE component. */
export function BusinessDocumentBody({ document: doc, letterhead }: { document: BusinessDocument; letterhead: Letterhead }) {
  return (
    <article className="flex flex-col gap-7 p-8 text-vf-ink sm:p-10">
      <DocumentLetterhead letterhead={letterhead} />
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-ink-faint">{doc.partyLabel}</p>
          <p className="mt-1.5 text-sm font-medium">{doc.party.name}</p>
          {doc.party.code && <p className="text-xs text-vf-ink-faint">{doc.party.code}</p>}
          {doc.party.vatNumber && <p className="text-xs text-vf-ink-faint">VAT No: {doc.party.vatNumber}</p>}
        </div>
        <div className="text-right">
          <p className="font-display text-lg font-semibold">{doc.title}</p>
          <dl className="mt-2 space-y-1 text-xs text-vf-ink-faint">
            <div className="flex justify-end gap-2">
              <dt>Number:</dt>
              <dd className="font-medium text-vf-ink-soft">{doc.number}</dd>
            </div>
            {doc.date && (
              <div className="flex justify-end gap-2">
                <dt>Date:</dt>
                <dd className="font-medium text-vf-ink-soft">{formatDate(doc.date)}</dd>
              </div>
            )}
            {doc.dueDate && (
              <div className="flex justify-end gap-2">
                <dt>{doc.docType === "quotation" ? "Valid until:" : "Due:"}</dt>
                <dd className="font-medium text-vf-ink-soft">{formatDate(doc.dueDate)}</dd>
              </div>
            )}
            {doc.reference && (
              <div className="flex justify-end gap-2">
                <dt>Reference:</dt>
                <dd className="font-medium text-vf-ink-soft">{doc.reference}</dd>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <dt>Status:</dt>
              <dd className="font-medium text-vf-ink-soft">{doc.status}</dd>
            </div>
          </dl>
        </div>
      </div>

      {doc.lines.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-vf-ink/20 text-left text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">
              <th className="pb-2 pr-2">Description</th>
              <th className="pb-2 px-2 text-right">Qty</th>
              <th className="pb-2 px-2 text-right">Unit Price</th>
              <th className="pb-2 px-2 text-right">Net</th>
              <th className="pb-2 px-2 text-right">VAT</th>
              <th className="pb-2 pl-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={i} className="border-b border-vf-paper-border">
                <td className="py-2 pr-2 text-vf-ink-soft">{l.description}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{l.quantity ?? ""}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{l.unitPrice === null ? "" : formatMoney(l.unitPrice)}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{formatMoney(l.net)}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-vf-ink-soft">{formatMoney(l.vat)}</td>
                <td className="py-2 pl-2 text-right font-mono tabular-nums">{formatMoney(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {doc.settlements.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-vf-ink/20 text-left text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">
              <th className="pb-2 pr-2">{doc.docType === "supplier-payment" ? "Bill Paid" : "Invoice Paid"}</th>
              <th className="pb-2 px-2">Date</th>
              <th className="pb-2 pl-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.settlements.map((s, i) => (
              <tr key={i} className="border-b border-vf-paper-border">
                <td className="py-2 pr-2 text-vf-ink-soft">{s.reference}</td>
                <td className="py-2 px-2 text-vf-ink-soft">{s.date ? formatDate(s.date) : ""}</td>
                <td className="py-2 pl-2 text-right font-mono tabular-nums">{formatMoney(s.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex justify-end">
        <dl className="w-72 space-y-1.5 text-sm">
          {doc.lines.length > 0 && (
            <>
              <div className="flex justify-between text-vf-ink-soft">
                <dt>Net</dt>
                <dd className="font-mono tabular-nums">{formatMoney(doc.totals.net)}</dd>
              </div>
              <div className="flex justify-between text-vf-ink-soft">
                <dt>VAT</dt>
                <dd className="font-mono tabular-nums">{formatMoney(doc.totals.vat)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-vf-ink/20 pt-1.5 text-base font-semibold">
            <dt>{doc.lines.length > 0 ? "Total" : "Amount"}</dt>
            <dd className="font-mono tabular-nums">{formatMoney(doc.totals.total)}</dd>
          </div>
          {doc.totals.outstanding !== null && doc.totals.outstanding !== 0 && (
            <div className="flex justify-between text-vf-ink-soft">
              <dt>{doc.lines.length > 0 ? "Outstanding" : "Unallocated"}</dt>
              <dd className="font-mono tabular-nums">{formatMoney(doc.totals.outstanding)}</dd>
            </div>
          )}
        </dl>
      </div>
      {doc.notes && <p className="border-t border-vf-paper-border pt-4 text-xs text-vf-ink-faint">{doc.notes}</p>}
    </article>
  );
}
