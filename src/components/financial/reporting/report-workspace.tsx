"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconAlertTriangle, IconArrowDown, IconCopy, IconFileText, IconSearch, IconShieldCheck } from "@/components/ui/icons";
import type { ReportCatalogEntry } from "@/server/report-centre/registry";
import type { ReportCategory, ReportFilters, ReportResult } from "@/server/report-centre/types";
import { ReportFilterBar, type FilterOption } from "./report-filter-bar";
import { ReportTable } from "./report-table";
import { ReportChecks, ReportNotices, ReportSummary } from "./report-parts";
import { reportHref, type ReportHomeMap } from "./drill-href";

type SavedView = { id: string; name: string; category: ReportCategory; reportId: string; query: string; savedAt: string };

// Saved views are a per-browser convenience kept in localStorage and
// read through useSyncExternalStore: the server snapshot is empty, so the
// server render and hydration agree, and a save in another tab updates
// this one via the "storage" event.
const VIEWS_EVENT = "vyron:saved-views";
function storageKey(companyId: string) {
  return `vyron.reporting.saved-views.${companyId}`;
}
function subscribeViews(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(VIEWS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(VIEWS_EVENT, onChange);
  };
}
function readRaw(companyId: string): string {
  try {
    return window.localStorage.getItem(storageKey(companyId)) ?? "[]";
  } catch {
    return "[]";
  }
}
function parseViews(raw: string): SavedView[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}
function writeViews(companyId: string, views: SavedView[]) {
  try {
    window.localStorage.setItem(storageKey(companyId), JSON.stringify(views));
    window.dispatchEvent(new Event(VIEWS_EVENT));
  } catch {
    // Storage unavailable (private window, blocked site data) — saved
    // views are a convenience, the report itself still works.
  }
}

function queryOf(filters: ReportFilters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
  return q.toString();
}

/**
 * The common Reporting Centre shell — every report in every category is
 * shown through this one component: the category's report list, the
 * report's own filters, the same actions (print, PDF, Excel, CSV, email
 * where supported, save view, copy link), the summary, the
 * reconciliation checks, the report sections with drill-down, and notes.
 * Filters live in the URL, so every view is shareable, bookmarkable and
 * survives Back/Forward; the server re-runs the report on each change.
 */
export function ReportWorkspace({
  companyId,
  category,
  reports,
  selected,
  result,
  inputError,
  filters,
  filterOptions,
  reportHome,
  today,
  fyStart,
  previewMode,
}: {
  companyId: string;
  category: ReportCategory;
  reports: ReportCatalogEntry[];
  selected: ReportCatalogEntry | null;
  result: ReportResult | null;
  inputError: string | null;
  filters: ReportFilters;
  filterOptions: Record<string, FilterOption[]>;
  reportHome: ReportHomeMap;
  today: string;
  fyStart: string;
  previewMode: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const rawViews = useSyncExternalStore(subscribeViews, () => readRaw(companyId), () => "[]");
  const views = useMemo(() => parseViews(rawViews), [rawViews]);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [emailState, setEmailState] = useState<"idle" | "confirm" | "sending">("idle");

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? reports.filter((r) => r.title.toLowerCase().includes(term) || r.description.toLowerCase().includes(term)) : reports;
  }, [reports, search]);

  const base = `/company/${companyId}/reporting/${category}`;
  const query = selected ? queryOf(filters) : "";
  const exportBase = selected ? `/api/companies/${companyId}/reporting/${selected.id}/export?${query}` : "";

  function apply(next: ReportFilters) {
    if (!selected) return;
    const q = new URLSearchParams({ report: selected.id });
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, v);
    setMessage(null);
    startTransition(() => router.push(`${base}?${q.toString()}`, { scroll: false }));
  }

  function openReport(reportId: string) {
    // Carry the period across reports so switching doesn't reset it.
    const carry: ReportFilters = {};
    for (const key of ["dateFrom", "dateTo", "asAt"] as const) if (filters[key]) carry[key] = filters[key];
    startTransition(() => router.push(reportHref(companyId, reportHome, reportId, carry)));
  }

  function saveView() {
    if (!selected || !viewName.trim()) return;
    const next = [...views, { id: `${Date.now()}`, name: viewName.trim(), category, reportId: selected.id, query: queryOf({ ...filters }), savedAt: new Date().toISOString() }];
    writeViews(companyId, next);
    setNaming(false);
    setViewName("");
    setMessage(`Saved “${viewName.trim()}”. Saved views are kept in this browser.`);
  }

  function removeView(id: string) {
    writeViews(companyId, views.filter((v) => v.id !== id));
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMessage("Link copied — anyone with access to this company sees the same report.");
    } catch {
      setMessage("Couldn't copy automatically — copy the address from the browser bar.");
    }
  }

  async function sendEmail() {
    if (!selected) return;
    setEmailState("sending");
    try {
      const res = await fetch(`/api/companies/${companyId}/reporting/${selected.id}/email?${query}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setMessage(res.ok ? "Statement queued for email to the customer's primary contact." : body.error ?? `Email failed (${res.status}).`);
    } catch {
      setMessage("Couldn't reach the server to send the email.");
    } finally {
      setEmailState("idle");
    }
  }

  const canEmail = Boolean(selected?.emailable && filters.customerId && result);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="flex flex-col gap-4 print:hidden" aria-label="Reports in this category">
        <div className="relative">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-vf-ink-faint" />
          <Input aria-label="Search reports" placeholder="Search reports…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 pl-9 text-sm" />
        </div>
        <nav className="flex flex-col gap-0.5 rounded-vf-md border border-vf-paper-border bg-vf-paper p-1.5 shadow-vf-paper-sm">
          {visible.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => openReport(r.id)}
              aria-current={selected?.id === r.id ? "page" : undefined}
              className={cn(
                "rounded-vf-sm px-3 py-2 text-left text-sm transition-colors",
                selected?.id === r.id ? "bg-vf-red-500/10 font-semibold text-vf-red-600" : "text-vf-ink-soft hover:bg-vf-paper-alt hover:text-vf-ink",
              )}
            >
              {r.title}
            </button>
          ))}
          {visible.length === 0 && <p className="px-3 py-2 text-xs text-vf-ink-faint">No report matches “{search}”.</p>}
        </nav>
        {views.length > 0 && (
          <div className="rounded-vf-md border border-vf-paper-border bg-vf-paper p-3 shadow-vf-paper-sm">
            <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-wider text-vf-ink-faint">Saved views</p>
            <ul className="flex flex-col gap-1">
              {views.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/company/${companyId}/reporting/${v.category}?report=${v.reportId}${v.query ? `&${v.query}` : ""}`} className="truncate text-vf-ink-soft hover:text-vf-red-600">
                    {v.name}
                  </Link>
                  <button type="button" aria-label={`Delete saved view ${v.name}`} onClick={() => removeView(v.id)} className="text-vf-ink-faint hover:text-vf-danger">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <section aria-live="polite" className={cn("min-w-0 transition-opacity", pending && "opacity-60")}>
        {!selected ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {reports.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => openReport(r.id)}
                className="flex flex-col gap-1.5 rounded-vf-md border border-vf-paper-border bg-vf-paper p-4 text-left shadow-vf-paper-sm transition-[border-color,box-shadow] hover:border-vf-red-500 hover:shadow-vf-paper-md"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-vf-ink">
                  <IconFileText className="h-4 w-4 text-vf-red-600" />
                  {r.title}
                </span>
                <span className="text-xs leading-relaxed text-vf-ink-faint">{r.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-vf-lg border border-vf-paper-border bg-vf-paper p-5 text-vf-ink shadow-vf-paper-lg sm:p-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="font-display text-xl font-semibold text-vf-ink">{selected.title}</h2>
                <p className="mt-1 max-w-[70ch] text-sm text-vf-ink-faint">{result?.subtitle ?? selected.description}</p>
              </div>
              {result && (
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <Button href={`/company/${companyId}/reporting/print/${selected.id}?${query}`} variant="primary" size="sm">
                    Print
                  </Button>
                  <a href={`${exportBase}&format=pdf`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-vf-paper-border px-4 py-1.5 text-[0.85rem] font-semibold text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600">
                    <IconArrowDown className="h-3.5 w-3.5" /> PDF
                  </a>
                  <a href={`${exportBase}&format=xlsx`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-vf-paper-border px-4 py-1.5 text-[0.85rem] font-semibold text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600">
                    <IconArrowDown className="h-3.5 w-3.5" /> Excel
                  </a>
                  <a href={`${exportBase}&format=csv`} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-vf-paper-border px-4 py-1.5 text-[0.85rem] font-semibold text-vf-ink-soft hover:border-vf-red-500 hover:text-vf-red-600">
                    <IconArrowDown className="h-3.5 w-3.5" /> CSV
                  </a>
                  {selected.emailable && (
                    <Button
                      variant="subtle"
                      size="sm"
                      disabled={!canEmail || previewMode || emailState === "sending"}
                      title={previewMode ? "Available once a production Supabase project is connected" : !filters.customerId ? "Choose a customer first" : undefined}
                      onClick={() => setEmailState("confirm")}
                    >
                      {emailState === "sending" ? "Sending…" : "Email"}
                    </Button>
                  )}
                  <Button variant="subtle" size="sm" onClick={() => setNaming((n) => !n)}>
                    Save view
                  </Button>
                  <Button variant="subtle" size="sm" onClick={copyLink} aria-label="Copy link to this report">
                    <IconCopy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </header>

            {emailState === "confirm" && (
              <div role="alertdialog" aria-label="Confirm email" className="flex flex-wrap items-center gap-3 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt px-4 py-3 text-sm">
                <span className="text-vf-ink-soft">Email this statement as a PDF to the customer&apos;s primary contact?</span>
                <Button variant="primary" size="sm" onClick={sendEmail}>
                  Send
                </Button>
                <Button variant="subtle" size="sm" onClick={() => setEmailState("idle")}>
                  Cancel
                </Button>
              </div>
            )}
            {naming && (
              <form
                className="flex flex-wrap items-center gap-2 text-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveView();
                }}
              >
                <Input autoFocus aria-label="Saved view name" placeholder="Name this view…" value={viewName} onChange={(e) => setViewName(e.target.value)} className="h-9 w-64 text-sm" />
                <Button type="submit" variant="primary" size="sm" disabled={!viewName.trim()}>
                  Save
                </Button>
              </form>
            )}
            {message && <p className="text-sm text-vf-ink-soft">{message}</p>}

            <ReportFilterBar key={`${selected.id}:${query}`} specs={selected.filters} values={filters} options={filterOptions} today={today} fyStart={fyStart} onApply={apply} pending={pending} />

            {inputError ? (
              <div className="flex items-start gap-3 rounded-vf-md border border-vf-warning/40 bg-vf-warning/5 px-4 py-3 text-sm text-vf-ink-soft">
                <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-vf-warning" />
                <span>{inputError}</span>
              </div>
            ) : result ? (
              <>
                <ReportSummary items={result.summary} />
                <ReportChecks checks={result.checks} />
                {result.sections.map((s, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    {s.title && <h3 className="text-sm font-semibold text-vf-ink">{s.title}</h3>}
                    <ReportTable section={s} companyId={companyId} reportHome={reportHome} />
                  </div>
                ))}
                <ReportNotices
                  notices={
                    previewMode && result.checks.some((c) => !c.passed)
                      ? [...result.notices, "Preview Mode's sample documents and sample ledger are separate illustrations, not one set of books — so some reconciliation checks fail here by design. On a live company every check runs against the real ledger."]
                      : result.notices
                  }
                />
                <p className="flex items-center gap-1.5 text-[0.7rem] text-vf-ink-faint">
                  <IconShieldCheck className="h-3.5 w-3.5" /> Read-only report · generated {result.generatedAt.slice(0, 16).replace("T", " ")} UTC from live accounting records
                  {previewMode ? " (Preview Mode sample data)" : ""}
                </p>
              </>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
