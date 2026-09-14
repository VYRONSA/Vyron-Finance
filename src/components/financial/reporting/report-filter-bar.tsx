"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import type { FilterSpec, ReportFilters } from "@/server/report-centre/types";

export type FilterOption = { value: string; label: string };

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function monthStart(today: string, back = 0): Date {
  const [y, m] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - back, 1));
}
function monthEndOf(start: Date): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
}

/** Period presets every date-range report offers, in the company's own
 * financial year. */
export function periodPresets(today: string, fyStart: string): { label: string; dateFrom: string; dateTo: string }[] {
  const thisMonth = monthStart(today);
  const lastMonth = monthStart(today, 1);
  const lastFyStart = new Date(Date.UTC(Number(fyStart.slice(0, 4)) - 1, Number(fyStart.slice(5, 7)) - 1, Number(fyStart.slice(8, 10))));
  const lastFyEnd = new Date(Date.parse(`${fyStart}T00:00:00Z`) - 86_400_000);
  const twelve = monthStart(today, 11);
  return [
    { label: "This month", dateFrom: iso(thisMonth), dateTo: today },
    { label: "Last month", dateFrom: iso(lastMonth), dateTo: iso(monthEndOf(lastMonth)) },
    { label: "Year to date", dateFrom: fyStart, dateTo: today },
    { label: "Last financial year", dateFrom: iso(lastFyStart), dateTo: iso(lastFyEnd) },
    { label: "Last 12 months", dateFrom: iso(twelve), dateTo: today },
  ];
}

/**
 * The ONE filter control set for every report: dates, selects and text
 * inputs driven by the report's own `FilterSpec`s, with the same labels
 * and URL parameters everywhere. Nothing runs until "Run report", so a
 * large report isn't recomputed on every keystroke.
 */
export function ReportFilterBar({
  specs,
  values,
  options,
  today,
  fyStart,
  onApply,
  pending,
}: {
  specs: FilterSpec[];
  values: ReportFilters;
  options: Record<string, FilterOption[]>;
  today: string;
  fyStart: string;
  onApply: (filters: ReportFilters) => void;
  pending?: boolean;
}) {
  const [draft, setDraft] = useState<ReportFilters>(values);
  const hasPeriod = specs.some((s) => s.key === "dateFrom") && specs.some((s) => s.key === "dateTo");
  const set = (key: keyof ReportFilters, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  if (specs.length === 0) return null;
  return (
    <form
      className="flex flex-col gap-3 print:hidden"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(draft);
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        {specs.map((spec) => {
          const id = `report-filter-${spec.key}`;
          const value = draft[spec.key] ?? "";
          return (
            <label key={spec.key} htmlFor={id} className="flex min-w-[9.5rem] flex-col gap-1 text-xs font-medium text-vf-ink-faint">
              <span>
                {spec.label}
                {spec.required && <span className="text-vf-red-600"> *</span>}
              </span>
              {spec.control === "date" ? (
                <Input id={id} type="date" value={value} onChange={(e) => set(spec.key, e.target.value)} className="h-9 py-1 text-sm" />
              ) : spec.control === "select" ? (
                <Select id={id} value={value} onChange={(e) => set(spec.key, e.target.value)} className="h-9 max-w-[18rem] py-1 text-sm">
                  <option value="">{spec.required ? `Choose ${spec.label.toLowerCase()}…` : `All`}</option>
                  {(options[spec.key] ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input id={id} value={value} onChange={(e) => set(spec.key, e.target.value)} className="h-9 w-40 py-1 text-sm" />
              )}
            </label>
          );
        })}
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Running…" : "Run report"}
        </Button>
      </div>
      {hasPeriod && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-vf-ink-faint">Quick periods:</span>
          {periodPresets(today, fyStart).map((p) => (
            <button
              key={p.label}
              type="button"
              className="rounded-full border border-vf-paper-border px-2.5 py-0.5 text-vf-ink-soft transition-colors hover:border-vf-red-500 hover:text-vf-red-600"
              onClick={() => {
                const next = { ...draft, dateFrom: p.dateFrom, dateTo: p.dateTo };
                setDraft(next);
                onApply(next);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
