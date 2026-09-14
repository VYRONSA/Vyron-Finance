import { cn } from "@/lib/utils";
import type { ReconciliationCheck, SummaryItem } from "@/server/report-centre/types";
import { formatCell, formatMoney } from "./format";

/** Headline figures — the same tiles on screen and on paper. */
export function ReportSummary({ items }: { items: SummaryItem[] }) {
  if (items.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5 print:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="rounded-vf-md border border-vf-paper-border bg-vf-paper-alt/50 px-3 py-2.5 break-inside-avoid">
          <dt className="text-[0.68rem] font-semibold uppercase tracking-wider text-vf-ink-faint">{item.label}</dt>
          <dd className={cn("mt-1 text-base font-semibold text-vf-ink", item.kind !== "text" && "font-mono tabular-nums")}>
            {typeof item.value === "number" ? formatCell(item.value, item.kind) : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The report's reconciliation evidence. A failing check is shown with
 * its difference and explanation — never hidden or softened. */
export function ReportChecks({ checks }: { checks: ReconciliationCheck[] }) {
  if (checks.length === 0) return null;
  const failed = checks.filter((c) => !c.passed);
  return (
    <div className={cn("rounded-vf-md border px-4 py-3 break-inside-avoid", failed.length ? "border-vf-danger/40 bg-vf-danger/5" : "border-vf-success/40 bg-vf-success/5")}>
      <p className={cn("text-sm font-semibold", failed.length ? "text-vf-danger" : "text-vf-success")}>
        {failed.length ? `${failed.length} of ${checks.length} reconciliation check${checks.length === 1 ? "" : "s"} failed` : `Reconciled — ${checks.length} check${checks.length === 1 ? "" : "s"} passed`}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5 text-[0.8rem]">
        {checks.map((c) => (
          <li key={c.label} className="flex flex-col gap-0.5">
            <span className="flex items-start gap-2">
              <span aria-hidden className={cn("font-bold", c.passed ? "text-vf-success" : "text-vf-danger")}>
                {c.passed ? "✓" : "✗"}
              </span>
              <span className="text-vf-ink-soft">
                {c.label}
                <span className="sr-only">{c.passed ? " — passed" : " — failed"}</span>
                <span className="ml-2 font-mono text-[0.75rem] text-vf-ink-faint">
                  {formatMoney(c.actual)} vs {formatMoney(c.expected)}
                  {!c.passed && ` · difference ${formatMoney(c.difference)}`}
                </span>
              </span>
            </span>
            {!c.passed && c.explanation && <span className="pl-5 text-[0.75rem] text-vf-ink-faint">{c.explanation}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReportNotices({ notices }: { notices: string[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="border-t border-vf-paper-border pt-3 break-inside-avoid">
      <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-vf-ink-faint">Notes</p>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-[0.78rem] text-vf-ink-faint">
        {notices.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
