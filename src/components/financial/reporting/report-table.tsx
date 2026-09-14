import Link from "next/link";
import { cn } from "@/lib/utils";
import type { ReportRow, ReportSection } from "@/server/report-centre/types";
import { drillHref, type ReportHomeMap } from "./drill-href";
import { formatCell, isNumericKind } from "./format";

const ROW_CLASS: Record<ReportRow["kind"], string> = {
  detail: "",
  group: "bg-vf-paper-alt/70 font-semibold text-vf-ink",
  subtotal: "font-semibold text-vf-ink border-t border-vf-paper-border",
  total: "font-bold text-vf-ink border-t-2 border-vf-ink/30 bg-vf-paper-alt/40",
  note: "italic text-vf-ink-faint",
};

/**
 * One report section as a table — the SAME component on screen and on
 * the printed/PDF document (`interactive={false}` renders drill-downs as
 * plain text). Numbers are right-aligned in tabular figures; group,
 * subtotal and total rows are styled by kind, and hierarchy is shown by
 * indentation, never by colour alone.
 */
export function ReportTable({
  section,
  companyId,
  reportHome,
  interactive = true,
}: {
  section: ReportSection;
  companyId: string;
  reportHome: ReportHomeMap;
  interactive?: boolean;
}) {
  const { columns, rows } = section;
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-vf-ink-faint">{section.emptyMessage ?? "Nothing to show."}</p>;
  }
  const firstKey = columns[0]?.key;
  return (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full border-collapse text-[0.83rem] text-vf-ink print:text-[0.72rem]">
        <thead>
          <tr className="border-b-2 border-vf-ink/20 text-left">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-2.5 py-2 align-bottom text-[0.68rem] font-semibold uppercase tracking-wider text-vf-ink-faint", isNumericKind(c.kind) && "text-right")}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const rowHref = interactive && row.drill ? drillHref(companyId, reportHome, row.drill) : null;
            // The link lives on the first cell that has text, so a group
            // row whose first column is blank still gets a target.
            const linkKey = rowHref ? columns.find((c) => row.cells[c.key] !== null && row.cells[c.key] !== undefined && row.cells[c.key] !== "")?.key : undefined;
            return (
              <tr key={i} className={cn("border-b border-vf-paper-border/60 break-inside-avoid", ROW_CLASS[row.kind], row.kind === "detail" && rowHref && "hover:bg-vf-paper-alt/60")}>
                {columns.map((c) => {
                  const value = row.cells[c.key] ?? null;
                  const text = formatCell(value, c.kind);
                  const cellTarget = interactive ? row.cellDrills?.[c.key] : undefined;
                  const href = cellTarget ? drillHref(companyId, reportHome, cellTarget) : c.key === linkKey ? rowHref : null;
                  const indent = c.key === firstKey && row.level ? { paddingLeft: `${0.75 + row.level * 1.1}rem` } : undefined;
                  const numeric = isNumericKind(c.kind);
                  return (
                    <td
                      key={c.key}
                      style={indent}
                      className={cn("px-2.5 py-1.5 align-top", (c.kind === "date" || c.key === "code" || c.key === "number") && "whitespace-nowrap", numeric ? "text-right font-mono tabular-nums whitespace-nowrap text-vf-ink" : "text-vf-ink-soft", row.kind !== "detail" && "text-vf-ink", typeof value === "number" && value < 0 && c.kind === "money" && "text-vf-danger")}
                    >
                      {c.kind === "badge" && text && row.kind === "detail" ? (
                        <span className="inline-flex rounded-full border border-vf-paper-border bg-vf-paper-alt px-2 py-0.5 text-[0.7rem] font-medium text-vf-ink-soft">{text}</span>
                      ) : href && text ? (
                        <Link href={href} className="text-vf-ink underline decoration-vf-ink/20 underline-offset-2 hover:text-vf-red-600 hover:decoration-vf-red-600 print:no-underline">
                          {text}
                        </Link>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
