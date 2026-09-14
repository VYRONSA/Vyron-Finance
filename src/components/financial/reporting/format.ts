/**
 * Report cell formatting — one set of rules for the viewer and the
 * printed document. Money uses accounting presentation: two decimals,
 * comma thousands separators, negatives in parentheses. A fixed locale
 * (not the viewer's) so the screen, the server-rendered PDF and every
 * user see identical figures.
 */

import type { ColumnKind, ReportCell } from "@/server/report-centre/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONEY = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const PERCENT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function formatMoney(value: number): string {
  const abs = MONEY.format(Math.abs(value));
  return value < 0 ? `(${abs})` : abs;
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function formatCell(value: ReportCell, kind: ColumnKind): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") {
    if (kind === "money") return formatMoney(value);
    if (kind === "percent") return `${PERCENT.format(value)}%`;
    return NUMBER.format(value);
  }
  if (kind === "date") return formatDate(value);
  return value;
}

export function isNumericKind(kind: ColumnKind): boolean {
  return kind === "money" || kind === "number" || kind === "percent";
}
