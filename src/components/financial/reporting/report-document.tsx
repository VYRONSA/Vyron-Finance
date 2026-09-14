import type { ReportResult } from "@/server/report-centre/types";
import type { Letterhead } from "@/server/report-centre/letterhead";
import { ReportTable } from "./report-table";
import { ReportChecks, ReportNotices, ReportSummary } from "./report-parts";
import type { ReportHomeMap } from "./drill-href";

/** The company letterhead every printed report and document carries.
 * Fields are shown only when the company has them. */
export function DocumentLetterhead({ letterhead }: { letterhead: Letterhead }) {
  const contact = [letterhead.telephone && `Tel: ${letterhead.telephone}`, letterhead.email, letterhead.website].filter(Boolean).join(" | ");
  return (
    <div className="flex items-start justify-between gap-6 border-b border-vf-paper-border pb-5">
      <div>
        <p className="font-display text-xl font-semibold text-vf-ink">{letterhead.name}</p>
        {letterhead.tradingName && <p className="text-sm text-vf-ink-soft">t/a {letterhead.tradingName}</p>}
        {letterhead.address && <p className="mt-1 max-w-[40ch] text-sm text-vf-ink-soft">{letterhead.address}</p>}
        {contact && <p className="mt-1 text-xs text-vf-ink-faint">{contact}</p>}
        {letterhead.registrationNumber && <p className="mt-1 text-xs text-vf-ink-faint">Reg No: {letterhead.registrationNumber}</p>}
        {letterhead.vatNumber && <p className="text-xs text-vf-ink-faint">VAT No: {letterhead.vatNumber}</p>}
      </div>
      {letterhead.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Storage URL, same reasoning as DocumentBrandingHeader.
        <img src={letterhead.logoUrl} alt={`${letterhead.name} logo`} className="h-16 max-w-[220px] object-contain" />
      )}
    </div>
  );
}

/**
 * A report as a client-ready document — letterhead, title, period,
 * headline figures, the reconciliation evidence, every section and the
 * notes. This is what Print and Download PDF produce; drill-downs render
 * as plain text.
 */
export function ReportDocument({ result, letterhead, companyId, reportHome }: { result: ReportResult; letterhead: Letterhead; companyId: string; reportHome: ReportHomeMap }) {
  return (
    <article className="flex flex-col gap-6 p-8 text-vf-ink sm:p-10 print:p-6">
      <DocumentLetterhead letterhead={letterhead} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">{result.title}</h1>
          <p className="mt-1 text-sm text-vf-ink-soft">{result.subtitle}</p>
        </div>
        <p className="text-right text-xs text-vf-ink-faint">
          Generated {result.generatedAt.slice(0, 10)} {result.generatedAt.slice(11, 16)} UTC
          <br />
          Prepared with VYRON Finance
        </p>
      </header>
      <ReportSummary items={result.summary} />
      <ReportChecks checks={result.checks} />
      {result.sections.map((s, i) => (
        <section key={i} className="flex flex-col gap-2">
          {s.title && <h2 className="text-sm font-semibold uppercase tracking-wide text-vf-ink-soft">{s.title}</h2>}
          <ReportTable section={s} companyId={companyId} reportHome={reportHome} interactive={false} />
        </section>
      ))}
      <ReportNotices notices={result.notices} />
    </article>
  );
}
