import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { IconChevronLeft } from "@/components/ui/icons";
import { CATEGORY_INFO } from "@/components/financial/reporting/categories";
import { reportHref } from "@/components/financial/reporting/drill-href";
import { REPORTS, reportHomeMap, reportsInCategory } from "@/server/report-centre/registry";
import { REPORT_CATEGORIES } from "@/server/report-centre/types";

export const metadata: Metadata = {
  title: "Reporting Centre — VYRON FINANCE",
};

const TRAIL: { label: string; reportId: string }[] = [
  { label: "Financial statement", reportId: "balance-sheet" },
  { label: "GL account", reportId: "general-ledger" },
  { label: "Journal", reportId: "journal-register" },
  { label: "Bank transaction", reportId: "transaction-lifecycle" },
  { label: "Payment", reportId: "customer-receipt-register" },
  { label: "Invoice", reportId: "customer-invoice-register" },
  { label: "Statement", reportId: "customer-ledger" },
];

const FEATURED = ["management-pack", "profit-and-loss", "balance-sheet", "trial-balance", "customer-aging", "supplier-aging", "vat-summary", "bank-reconciliation"];

export default async function ReportingCentrePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const home = reportHomeMap();
  const byId = new Map(REPORTS.map((r) => [r.id, r]));

  return (
    <div className="flex w-full flex-col gap-6">
      <Card tone="hero" className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-1/3 -right-1/4 h-[80%] w-[60%] rounded-full opacity-40" style={{ background: "radial-gradient(circle, rgba(255,255,255,0.18), transparent 70%)" }} />
        <CardContent className="relative flex flex-wrap items-end justify-between gap-6 p-8 lg:p-10">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-vf-on-dark-soft">VYRON Reporting</span>
            <h1 className="mt-2 text-3xl font-medium text-vf-on-dark sm:text-4xl">Reporting Centre</h1>
            <p className="mt-1.5 max-w-[68ch] text-sm text-vf-on-dark-soft">
              {REPORTS.length} read-only reports on one engine — every figure drawn from the live ledger, reconciled to the General Ledger on the page, drillable
              to the source document, and ready to print, download or export.
            </p>
          </div>
        </CardContent>
      </Card>

      <section aria-labelledby="reporting-categories" className="flex flex-col gap-3">
        <h2 id="reporting-categories" className="text-sm font-semibold uppercase tracking-wider text-vf-ink-faint">Report areas</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {REPORT_CATEGORIES.map((category) => {
            const info = CATEGORY_INFO[category];
            const Icon = info.icon;
            return (
              <Link
                key={category}
                href={`/company/${companyId}/reporting/${category}`}
                className="group flex flex-col gap-2 rounded-vf-lg border border-vf-paper-border bg-vf-paper p-5 shadow-vf-paper-sm transition-[border-color,box-shadow] hover:border-vf-red-500 hover:shadow-vf-paper-md"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5 text-base font-semibold text-vf-ink">
                    <Icon className="h-5 w-5 text-vf-red-600" />
                    {info.label}
                  </span>
                  <span className="rounded-full bg-vf-paper-alt px-2 py-0.5 text-xs font-medium text-vf-ink-faint">{reportsInCategory(category).length} reports</span>
                </span>
                <span className="text-sm leading-relaxed text-vf-ink-faint">{info.description}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="reporting-trail" className="rounded-vf-lg border border-vf-paper-border bg-vf-paper p-5 shadow-vf-paper-sm">
        <h2 id="reporting-trail" className="text-sm font-semibold text-vf-ink">Everything connects</h2>
        <p className="mt-1 text-sm text-vf-ink-faint">Start anywhere and drill through: every line opens the next level down, all the way to the source document — and every level prints and exports.</p>
        <ol className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          {TRAIL.map((step, i) => (
            <li key={step.label} className="flex items-center gap-2">
              <Link href={reportHref(companyId, home, step.reportId)} className="rounded-full border border-vf-paper-border px-3 py-1 font-medium text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600">
                {step.label}
              </Link>
              {i < TRAIL.length - 1 && <IconChevronLeft aria-hidden className="h-3.5 w-3.5 rotate-180 text-vf-ink-faint" />}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="reporting-featured" className="flex flex-col gap-3">
        <h2 id="reporting-featured" className="text-sm font-semibold uppercase tracking-wider text-vf-ink-faint">Most used</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FEATURED.map((id) => {
            const r = byId.get(id);
            if (!r) return null;
            return (
              <Link key={id} href={reportHref(companyId, home, id)} className="flex flex-col gap-1 rounded-vf-md border border-vf-paper-border bg-vf-paper p-4 shadow-vf-paper-sm transition-[border-color,box-shadow] hover:border-vf-red-500 hover:shadow-vf-paper-md">
                <span className="text-sm font-semibold text-vf-ink">{r.title}</span>
                <span className="text-xs text-vf-ink-faint">{CATEGORY_INFO[r.categories[0]].label}</span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
