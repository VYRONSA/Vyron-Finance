"use client";

/**
 * SD-3E — the reconciliation workspace for one supplier statement.
 *
 * SD-3G: this is a DOCUMENT reconciliation — the supplier invoices, debit
 * notes and credit notes on the statement against PRECISIA's. Payments are
 * out of scope: listed, never reconciled. Earlier (SD-3D) balance runs are
 * still shown with their own figures.
 *
 * READ-ONLY FOR THE BOOKS. Running a reconciliation compares the statement
 * with PRECISIA and records the result; nothing here
 * posts, allocates, adjusts or "fixes" anything. A difference is explained
 * or linked by a person, with a reason, and takes effect when the statement
 * is reconciled again. Unexplained is shown as it is.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { IconAlertTriangle, IconRefresh, IconShieldCheck } from "@/components/ui/icons";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import {
  canLinkItem,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CATEGORY_TONE,
  DOCUMENT_BASIS,
  explanationTarget,
  LINKABLE_REF_TYPES,
  RECON_TIER_LABEL,
  REF_TYPE_LABEL,
  SUB_STATUS_LABEL,
} from "@/lib/supplier-documents/statement-stages";
import { cn } from "@/lib/utils";
import type { ReconItemDetailView, ReconRunDetailView, ReconRunSummaryView, RefLinkView, ResolutionView } from "./statement-types";

function money(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : formatAmount(v);
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "good" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-vf-sm border border-vf-paper-border bg-vf-paper px-4 py-3">
      <span className="text-xs font-medium text-vf-ink-faint">{label}</span>
      <span className={cn("font-mono text-lg font-semibold tabular-nums text-vf-ink", tone === "danger" && "text-vf-danger", tone === "good" && "text-vf-success")}>{value}</span>
      {hint && <span className="text-xs text-vf-ink-faint">{hint}</span>}
    </div>
  );
}

function refLabel(r: RefLinkView): string {
  return `${REF_TYPE_LABEL[r.refType] ?? r.refType} ${r.number ?? `#${r.refId}`}${r.date ? ` · ${formatDate(r.date)}` : ""}${r.amount !== null ? ` · ${formatAmount(r.amount)}` : ""}${r.posted === false ? " · not posted" : ""}`;
}

export function StatementReconciliation({
  companyId,
  statementId,
  status,
  canEdit,
  runs,
  selected,
  latestRunId,
  resolutions,
  stale,
}: {
  companyId: string;
  statementId: number;
  status: string;
  canEdit: boolean;
  runs: ReconRunSummaryView[];
  selected: ReconRunDetailView | null;
  latestRunId: number | null;
  resolutions: ResolutionView[];
  stale: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verification, setVerification] = useState<{ runId: number; fingerprintMatches: boolean; resultMatches: boolean } | null>(null);
  const [action, setAction] = useState<{ kind: "explain" | "link"; order: number } | { kind: "revoke"; id: number } | null>(null);
  const [reason, setReason] = useState("");
  const [linkTo, setLinkTo] = useState("");

  const api = `/api/companies/${companyId}/purchasing/supplier-statements/${statementId}`;
  const reconcilable = status === "Ready" || status === "Reconciled";
  const viewingLatest = selected !== null && selected.run.id === latestRunId;
  const canDecide = canEdit && reconcilable && viewingLatest;

  async function send(url: string, init: RequestInit, success: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "That could not be done. Refresh the page and try again.");
        return false;
      }
      setNotice(success);
      setAction(null);
      setReason("");
      setLinkTo("");
      router.refresh();
      return true;
    } catch {
      setError("That could not be done. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    const ok = await send(`${api}/reconciliations`, { method: "POST" }, "Reconciled. The result below is the new run; earlier runs are kept.");
    if (ok) router.replace(`?view=reconciliation`);
  }

  async function decide(body: Record<string, unknown>, success: string) {
    await send(`${api}/resolutions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, success);
  }

  async function verify(runId: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${api}/reconciliations/${runId}?verify=1`);
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "The run could not be verified.");
      else setVerification({ runId, ...data.verification });
    } catch {
      setError("The run could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  // Records a person may link a statement line to: anything the run found in
  // PRECISIA and not on the statement, plus the item's own suggestions.
  const unmatchedRecords: RefLinkView[] = selected
    ? selected.items
        .filter((i) => i.statementLineId === null && i.refType && i.refId !== null && LINKABLE_REF_TYPES.has(i.refType))
        .map((i) => i.relatedRefs[0] ?? { refType: i.refType!, refId: i.refId!, amount: i.precisiaAmount, date: null, number: null })
    : [];
  function linkCandidates(item: ReconItemDetailView): RefLinkView[] {
    const all = [...item.suggestions, ...item.relatedRefs, ...unmatchedRecords].filter((r) => LINKABLE_REF_TYPES.has(r.refType));
    const seen = new Set<string>();
    return all.filter((r) => {
      const k = `${r.refType}:${r.refId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const liveDecisions = resolutions.filter((r) => r.action !== "revoke");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Run */}
      <Card className="min-w-0">
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Reconciliation</p>
              <h2 className="mt-1 text-lg font-semibold text-vf-ink">
                {runs.length === 0 ? "Not reconciled yet" : `Run ${selected?.run.runNumber ?? runs[0].runNumber} of ${runs.length}`}
              </h2>
              <p className="mt-1 max-w-[70ch] text-sm text-vf-ink-soft">
                Document reconciliation: the supplier invoices, debit notes and credit notes on this statement against those in PRECISIA.
                Payments are out of scope and are not reconciled — this is not a reconciliation of the supplier&apos;s balance.
                It never posts, allocates or adjusts anything; differences are explained or linked by a person, and the statement is then reconciled again.
              </p>
            </div>
            {canEdit && reconcilable && (
              <Button size="sm" disabled={busy} onClick={() => void run()}>
                <IconRefresh className="h-4 w-4" /> {runs.length === 0 ? "Reconcile" : "Reconcile again"}
              </Button>
            )}
          </div>
          {!reconcilable && <p className="text-sm text-vf-ink-faint">Mark the statement ready (supplier confirmed, statement adds up) to reconcile it.</p>}
          {stale && (
            <p role="status" className="flex items-center gap-2 rounded-vf-sm border border-vf-warning/40 px-3 py-2 text-sm text-vf-ink-soft">
              <IconAlertTriangle className="h-4 w-4 shrink-0 text-vf-warning" />
              Decisions were recorded after the latest run. Reconcile again to see their effect.
            </p>
          )}
          {selected && !viewingLatest && (
            <p className="text-sm text-vf-ink-soft">
              You are viewing an earlier run. <a className="font-medium text-vf-red-600 hover:underline" href="?view=reconciliation">Show the latest</a>
            </p>
          )}
          {notice && <p role="status" className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink-soft">{notice}</p>}
          {error && <p role="alert" className="rounded-vf-sm border border-vf-danger/40 px-3 py-2 text-sm text-vf-danger">{error}</p>}
        </CardContent>
      </Card>

      {selected && (
        <>
          {selected.run.basis === DOCUMENT_BASIS ? (
            <>
              {/* Documents (SD-3G) */}
              <section aria-label="Documents" className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Figure label="Documents on Statement" value={money(selected.run.statementClosing)} hint={`invoices, debit notes, credit notes · as at ${formatDate(selected.run.asAt)}`} />
                <Figure
                  label="Documents in PRECISIA"
                  value={money(selected.run.precisiaBalance)}
                  hint={selected.run.notPosted && selected.run.notPosted.count > 0 ? `${selected.run.notPosted.count} not posted (${formatAmount(selected.run.notPosted.amount)})` : "same supplier and period"}
                />
                <Figure label="Document Difference" value={money(selected.run.difference)} tone={selected.run.difference ? undefined : "good"} />
              </section>
              <section aria-label="Document results" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {(["Matched", "Amount Difference", "Missing in PRECISIA", "Missing on Statement", "Potential Duplicate"] as const).map((category) => (
                  <Figure key={category} label={category === "Amount Difference" ? "Amount Differences" : category === "Potential Duplicate" ? "Potential Duplicates" : category} value={String(selected.items.filter((i) => i.category === category).length)} />
                ))}
                <Figure label="Unexplained" value={money(selected.run.unexplained)} tone={selected.run.unexplained ? "danger" : "good"} hint="never adjusted away" />
              </section>
              <p className="-mt-3 text-xs text-vf-ink-faint">
                Document Difference = Explained ({money(selected.run.explained)}) + Unexplained, to the cent. Documents dated {formatDate(selected.run.windowFrom)} – {formatDate(selected.run.windowTo)}.
                {` ${selected.items.filter((i) => i.category === "Out of Scope").length} payment line(s) are out of scope and not reconciled.`}
              </p>
            </>
          ) : (
            <>
              {/* An earlier balance run (SD-3D) */}
              <p className="rounded-vf-sm border border-vf-paper-border px-3 py-2 text-sm text-vf-ink-soft">
                This is an earlier balance reconciliation (before document reconciliation replaced it). Reconcile again for a document reconciliation.
              </p>
              <section aria-label="Balances" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                <Figure label="S · Statement closing" value={money(selected.run.statementClosing)} hint={`as at ${formatDate(selected.run.asAt)}`} />
                <Figure label="P · PRECISIA (supplier ledger)" value={money(selected.run.precisiaBalance)} hint="same date, posted records only" />
                <Figure label="D · Difference (S − P)" value={money(selected.run.difference)} tone={selected.run.difference ? undefined : "good"} />
                <Figure label="Explained" value={money(selected.run.explained)} hint={selected.run.explainedByReviewer ? `${formatAmount(selected.run.explainedByReviewer)} by reviewers` : undefined} />
                <Figure label="Unexplained" value={money(selected.run.unexplained)} tone={selected.run.unexplained ? "danger" : "good"} hint="never adjusted away" />
              </section>
              <p className="-mt-3 text-xs text-vf-ink-faint">
                D = Explained + Unexplained, to the cent. Period {formatDate(selected.run.windowFrom)} – {formatDate(selected.run.windowTo)}; the statement opens at{" "}
                {money(selected.run.statementOpening)} and PRECISIA stood at {money(selected.run.precisiaBalanceBeforeWindow)} before it.
                {selected.run.residual ? ` ${formatAmount(selected.run.residual)} of Unexplained is the statement's own arithmetic gap.` : ""}
              </p>
            </>
          )}

          {/* Items by category */}
          {CATEGORY_ORDER.map((category) => {
            const items = selected.items.filter((i) => i.category === category);
            if (items.length === 0) return null;
            const total = items.reduce((s, i) => s + Math.round(i.effect * 100), 0) / 100;
            const open = category !== "Matched" && category !== "Out of Scope";
            return (
              <details key={category} open={open} className="min-w-0 rounded-vf-lg border border-vf-paper-border bg-vf-paper shadow-vf-paper-sm">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <span className="flex items-center gap-2">
                    <Badge tone={CATEGORY_TONE[category]}>{CATEGORY_LABEL[category] ?? category}</Badge>
                    <span className="text-sm text-vf-ink-soft">{items.length}</span>
                  </span>
                  <span className="font-mono text-sm tabular-nums text-vf-ink-soft">
                    {category === "Out of Scope" ? "not reconciled" : `effect ${formatAmount(total)}`}
                  </span>
                </summary>
                <ul className="flex flex-col divide-y divide-vf-paper-border border-t border-vf-paper-border">
                  {items.map((item) => {
                    const target = explanationTarget(item);
                    const explaining = action?.kind === "explain" && action.order === item.order;
                    const linking = action?.kind === "link" && action.order === item.order;
                    const candidates = linking ? linkCandidates(item) : [];
                    return (
                      <li key={item.order} className="flex min-w-0 flex-col gap-2 px-5 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-vf-ink">{item.message}</p>
                            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-vf-ink-faint">
                              <span>{SUB_STATUS_LABEL[item.subStatus] ?? item.subStatus}</span>
                              {item.matchTier && <span>· {RECON_TIER_LABEL[item.matchTier] ?? item.matchTier}</span>}
                              {item.statementLineOrder !== null && <span>· statement line {item.statementLineOrder}</span>}
                              {item.category === "Out of Scope" ? null : item.explained ? (
                                <Badge tone="good">{item.explainedByResolutionId ? "Explained by a reviewer" : "Explained"}</Badge>
                              ) : (
                                <Badge tone="danger">Unexplained</Badge>
                              )}
                            </p>
                          </div>
                          <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-3 text-right font-mono text-xs tabular-nums">
                            <dt className="font-sans text-vf-ink-faint">Statement</dt>
                            <dd>{money(item.statementAmount)}</dd>
                            <dt className="font-sans text-vf-ink-faint">PRECISIA</dt>
                            <dd>{money(item.precisiaAmount)}</dd>
                            <dt className="font-sans text-vf-ink-faint">Effect on difference</dt>
                            <dd className="font-semibold text-vf-ink">{formatAmount(item.effect)}</dd>
                          </dl>
                        </div>
                        {item.relatedRefs.length > 0 && (
                          <p className="text-xs text-vf-ink-soft">PRECISIA: {item.relatedRefs.map(refLabel).join(" · ")}</p>
                        )}
                        {item.suggestions.length > 0 && (
                          <p className="text-xs text-vf-ink-soft">
                            Suggested (not matched): {item.suggestions.map((s) => `${refLabel(s)}${s.reason ? ` — ${s.reason}` : ""}`).join(" · ")}
                          </p>
                        )}
                        {canDecide && !explaining && !linking && (
                          <div className="flex flex-wrap gap-2">
                            {!item.explained && target && (
                              <Button variant="subtle" size="sm" disabled={busy} onClick={() => { setAction({ kind: "explain", order: item.order }); setReason(""); }}>
                                Explain
                              </Button>
                            )}
                            {canLinkItem(item) && (
                              <Button variant="subtle" size="sm" disabled={busy} onClick={() => { setAction({ kind: "link", order: item.order }); setReason(""); setLinkTo(""); }}>
                                Link to a PRECISIA record
                              </Button>
                            )}
                          </div>
                        )}
                        {(explaining || linking) && (
                          <div className="flex flex-col gap-2 rounded-vf-sm border border-vf-paper-border p-3">
                            {linking && (
                              <Select aria-label="PRECISIA record to link" value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                                <option value="">Choose the record this line is…</option>
                                {candidates.map((c) => (
                                  <option key={`${c.refType}:${c.refId}`} value={`${c.refType}:${c.refId}`}>{refLabel(c)}</option>
                                ))}
                              </Select>
                            )}
                            {linking && candidates.length === 0 && <p className="text-xs text-vf-ink-faint">There is no unmatched record of this supplier to link to.</p>}
                            <Input aria-label="Reason" placeholder={explaining ? "Why is this difference acceptable? (required)" : "Why are these the same? (required)"} value={reason} onChange={(e) => setReason(e.target.value)} />
                            <p className="text-xs text-vf-ink-faint">Recorded with your name and kept permanently. Nothing in the books changes. It takes effect when you reconcile again.</p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                disabled={busy || reason.trim().length < 3 || (linking && !linkTo)}
                                onClick={() => {
                                  if (explaining && target) void decide({ action: "explained", ...target, reason }, "Explanation recorded. Reconcile again to apply it.");
                                  if (linking) {
                                    const [refType, refId] = linkTo.split(":");
                                    void decide({ action: "manual-link", statementLineId: item.statementLineId, refType, refId: Number(refId), reason }, "Link recorded. Reconcile again to apply it.");
                                  }
                                }}
                              >
                                {explaining ? "Record explanation" : "Record link"}
                              </Button>
                              <Button size="sm" variant="subtle" disabled={busy} onClick={() => setAction(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </>
      )}

      {/* Decisions */}
      <Card>
        <CardHeader>
          <CardTitle>Decisions</CardTitle>
          <CardDescription>Links and explanations recorded by reviewers. They are never edited or deleted — withdrawing one records a new entry.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {liveDecisions.length === 0 ? (
            <p className="text-sm text-vf-ink-faint">No decisions recorded.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {liveDecisions.map((d) => {
                const revoking = action?.kind === "revoke" && action.id === d.id;
                return (
                  <li key={d.id} className="flex flex-col gap-2 border-b border-vf-paper-border pb-2 text-sm last:border-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-vf-ink">
                        <Badge tone={d.revoked ? "muted" : "info"} className="mr-2">{d.action === "manual-link" ? "Link" : "Explanation"}{d.revoked ? " — withdrawn" : ""}</Badge>
                        {d.statementLineId !== null ? `statement line #${d.statementLineId}` : ""}
                        {d.refType ? ` ${d.statementLineId !== null ? "→ " : ""}${d.refType === "opening-difference" ? "opening balance difference" : `${REF_TYPE_LABEL[d.refType] ?? d.refType} #${d.refId}`}` : ""}
                        <span className="text-vf-ink-soft"> — “{d.reason}”</span>
                      </span>
                      <span className="text-xs text-vf-ink-faint">{d.performedBy} · {formatDateTime(d.createdAt)}</span>
                    </div>
                    {canEdit && reconcilable && !d.revoked && !revoking && (
                      <div>
                        <Button variant="subtle" size="sm" disabled={busy} onClick={() => { setAction({ kind: "revoke", id: d.id }); setReason(""); }}>
                          Withdraw
                        </Button>
                      </div>
                    )}
                    {revoking && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input aria-label="Reason for withdrawing" placeholder="Why is this withdrawn? (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button size="sm" disabled={busy || reason.trim().length < 3} onClick={() => void decide({ action: "revoke", revokesResolutionId: d.id, reason }, "Withdrawn. Reconcile again to apply it.")}>
                          Withdraw
                        </Button>
                        <Button size="sm" variant="subtle" disabled={busy} onClick={() => setAction(null)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Reconciliation history</CardTitle>
            <CardDescription>Every run is kept with everything it was computed from, and can be replayed to prove it reproduces exactly.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {runs.map((r) => (
              <div key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 border-b border-vf-paper-border pb-2 text-sm last:border-0", selected?.run.id === r.id && "font-semibold")}>
                <a className="text-vf-red-600 hover:underline" href={`?view=reconciliation&run=${r.id}`}>
                  Run {r.runNumber}
                </a>
                <span className="font-mono text-xs tabular-nums text-vf-ink-soft">
                  D {money(r.difference)} · unexplained {money(r.unexplained)}
                </span>
                <span className="text-xs text-vf-ink-faint">{r.createdBy} · {formatDateTime(r.createdAt)}</span>
                <span className="flex items-center gap-2">
                  {verification?.runId === r.id &&
                    (verification.fingerprintMatches && verification.resultMatches ? (
                      <Badge tone="good"><IconShieldCheck className="mr-1 inline h-3 w-3" />Reproduces exactly</Badge>
                    ) : (
                      <Badge tone="danger">Does not reproduce</Badge>
                    ))}
                  <Button variant="subtle" size="sm" disabled={busy} onClick={() => void verify(r.id)} aria-label={`Verify run ${r.runNumber}`}>
                    Verify
                  </Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
