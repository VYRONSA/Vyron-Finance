"use client";

import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChevronLeft, IconListChecks, IconShieldCheck, IconTarget } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { ALL_CATEGORIES, FINDING_SOURCE_LABEL, categoryLabel, distinctCategories, filterFindings, metaGroup, splitDataQuality, type CategoryFilter } from "./intelligence-view";
import type { BusinessSituation, Finding, FindingMetaGroup, FindingSeverity } from "@/server/financial-intelligence/types";
import { BUSINESS_SITUATION_CATEGORY_LABEL } from "@/server/financial-intelligence/types";

const SEVERITY_BADGE_TONE: Record<FindingSeverity, "danger" | "warn" | "info" | "muted"> = {
  Critical: "danger",
  High: "warn",
  Medium: "info",
  Low: "muted",
};

/** Phase 13, section 14 — a quiet visual distinction between Financial
 * Risk and Operational Attention (Data Quality already gets its own
 * whole section below, so it never reaches this badge). */
const META_GROUP_TONE: Record<FindingMetaGroup, "danger" | "info" | "muted"> = {
  "Financial Risk": "danger",
  "Operational Attention": "info",
  "Data Quality": "muted",
};

function FindingRow({ finding, onOpen, muted }: { finding: Finding; onOpen: () => void; muted?: boolean }) {
  const group = metaGroup(finding.category);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full flex-col gap-2 rounded-vf-md border p-4 text-left transition-colors",
          muted ? "border-vf-info/25 bg-vf-info/5 hover:bg-vf-info/10" : "border-vf-paper-border hover:border-vf-red-400/50 hover:bg-vf-paper-alt",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_BADGE_TONE[finding.severity]}>{finding.severity}</Badge>
          <Badge tone="muted">{categoryLabel(finding.category)}</Badge>
          {!muted && <Badge tone={META_GROUP_TONE[group]}>{group}</Badge>}
          <p className="font-medium text-vf-ink">{finding.title}</p>
        </div>
        <p className="text-sm text-vf-ink-soft">{finding.description}</p>
        <p className="text-xs text-vf-ink-faint">{finding.evidence}</p>
        {finding.recommendedAction && <p className="text-xs font-medium text-vf-red-600">{finding.recommendedAction} →</p>}
      </button>
    </li>
  );
}

/**
 * Phase 14 — a Business Situation groups several EXISTING findings into
 * a broader narrative. It never replaces those findings: the "Related
 * conditions" list below links straight back to the same rows the
 * Priority Findings section (further down this page) already renders,
 * via the same `onOpenFinding` callback/detail panel — nothing here is
 * a second copy of a finding.
 */
function SituationCard({ situation, onOpenFinding }: { situation: BusinessSituation; onOpenFinding: (finding: Finding) => void }) {
  return (
    <li className="rounded-vf-md border border-vf-paper-border bg-vf-paper-alt p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_BADGE_TONE[situation.severity]}>{situation.severity}</Badge>
        <Badge tone="muted">{BUSINESS_SITUATION_CATEGORY_LABEL[situation.category]}</Badge>
        <p className="font-medium text-vf-ink">{situation.title}</p>
      </div>
      <p className="mt-1.5 text-sm text-vf-ink-soft">{situation.summary}</p>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Evidence</p>
        <ul className="mt-1 flex flex-col gap-1">
          {situation.evidence.map((line, i) => (
            <li key={i} className="text-xs text-vf-ink-faint">
              • {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Related Conditions</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {situation.contributingFindings.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => onOpenFinding(f)}
              className="rounded-full border border-vf-paper-border bg-vf-paper px-2.5 py-1 text-xs font-medium text-vf-ink-soft hover:border-vf-red-400/50 hover:text-vf-ink"
            >
              {f.title}
            </button>
          ))}
        </div>
      </div>

      {situation.recommendedActions.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {situation.recommendedActions.map((action) => (
            <Button key={action.href} href={action.href} variant="subtle" size="sm">
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

function FindingDetailPanel({ finding, onClose }: { finding: Finding | null; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(Boolean(finding), panelRef);

  if (!finding) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close finding details" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="finding-detail-heading"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-vf-paper p-6 shadow-2xl"
      >
        <button type="button" onClick={onClose} className="mb-4 flex items-center gap-1 self-start text-sm text-vf-ink-faint hover:text-vf-ink">
          <IconChevronLeft className="h-4 w-4" />
          Close
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY_BADGE_TONE[finding.severity]}>{finding.severity}</Badge>
          <Badge tone="muted">{categoryLabel(finding.category)}</Badge>
          <Badge tone={META_GROUP_TONE[metaGroup(finding.category)]}>{metaGroup(finding.category)}</Badge>
        </div>
        <h2 id="finding-detail-heading" className="mt-2 text-lg font-semibold text-vf-ink">
          {finding.title}
        </h2>

        <div className="mt-6 flex flex-col gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">What VYRON Found</p>
            <p className="mt-1 text-sm text-vf-ink-soft">{finding.title}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Why It Matters</p>
            <p className="mt-1 text-sm text-vf-ink-soft">{finding.description}</p>
          </div>
          <div className="rounded-vf-md border border-vf-paper-border bg-vf-paper-alt p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Evidence</p>
            <p className="mt-1 text-sm text-vf-ink">{finding.evidence}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Recommended Action</p>
            {finding.recommendedAction && finding.actionHref ? (
              <>
                <p className="mt-1 text-sm text-vf-ink-soft">{finding.recommendedAction}</p>
                <Button href={finding.actionHref} variant="primary" size="sm" className="mt-3">
                  {finding.recommendedAction}
                </Button>
              </>
            ) : (
              <p className="mt-1 text-sm text-vf-ink-faint">Informational — no action needed.</p>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Source</p>
            <p className="mt-1 text-sm text-vf-ink-soft">{FINDING_SOURCE_LABEL[finding.source]}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Phase 11 — VYRON Intelligence Centre. Purely presentational: every
 * finding here was already computed by `buildFinancialIntelligenceSummary`
 * (Phase 10) on the server — this component filters/selects/displays,
 * it never computes a severity, category, or evidence string itself.
 *
 * Phase 14 — `situations` is an ADDITIONAL layer above the same
 * `findings`, computed by `buildBusinessSituations` (also on the
 * server). It is rendered first, per the brief's own ordering ("1.
 * Business Situations, 2. Priority Findings, 3. Data Quality"), but it
 * never hides or replaces a finding — every contributing finding still
 * appears, unaltered, in Priority Findings below.
 */
export function IntelligenceCentre({ findings, situations }: { companyId: string; findings: Finding[]; situations: BusinessSituation[] }) {
  const [category, setCategory] = useState<CategoryFilter>(ALL_CATEGORIES);
  const [selected, setSelected] = useState<Finding | null>(null);

  const { dataQuality, other } = splitDataQuality(findings);
  const categories = distinctCategories(other);
  const filtered = filterFindings(other, category);

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Business Situations — Phase 14. */}
      {situations.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <IconListChecks className="h-4 w-4 text-vf-red-600" />
            <div>
              <CardTitle>Business Situations</CardTitle>
              <CardDescription>Related conditions VYRON noticed occurring together — not a claim that one caused another.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-3">
              {situations.map((s) => (
                <SituationCard key={s.id} situation={s} onOpenFinding={setSelected} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* 2. Priority Findings */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <IconTarget className="h-4 w-4 text-vf-red-600" />
          <div>
            <CardTitle>Priority Findings</CardTitle>
            <CardDescription>Sorted by severity — most urgent first.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
              <button
                type="button"
                onClick={() => setCategory(ALL_CATEGORIES)}
                className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", category === ALL_CATEGORIES ? "bg-vf-red-500 text-white" : "bg-vf-paper-alt text-vf-ink-soft")}
              >
                All ({other.length})
              </button>
              {categories.map((c) => {
                const count = other.filter((f) => f.category === c).length;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", category === c ? "bg-vf-red-500 text-white" : "bg-vf-paper-alt text-vf-ink-soft")}
                  >
                    {categoryLabel(c)} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {other.length === 0 ? (
            <EmptyState icon={<IconShieldCheck className="h-5 w-5" />} title="Nothing here needs attention." description="Every finding right now is a Data Quality note — see below." />
          ) : filtered.length === 0 ? (
            <EmptyState icon={<IconTarget className="h-5 w-5" />} title="No findings in this category." description="Choose a different category, or select All." />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {filtered.map((f) => (
                <FindingRow key={f.id} finding={f} onOpen={() => setSelected(f)} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 3. Data Quality — Phase 11 section 8: separate, calmer treatment. */}
      {dataQuality.length > 0 && (
        <Card className="border-vf-info/25 bg-vf-info/5">
          <CardHeader className="flex flex-row items-center gap-2">
            <IconShieldCheck className="h-4 w-4 text-vf-info" />
            <div>
              <CardTitle>Data Quality</CardTitle>
              <CardDescription>
                These notes don&rsquo;t necessarily mean something is financially wrong — they just mean VYRON&rsquo;s picture of your business is still incomplete.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-2.5">
              {dataQuality.map((f) => (
                <FindingRow key={f.id} finding={f} onOpen={() => setSelected(f)} muted />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <FindingDetailPanel finding={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
