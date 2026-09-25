"use client";

/**
 * VYRON AI Supplier Invoice Capture — the inbox and the review screen.
 *
 * Deliberately NOT a separate AI application. It lives inside Purchasing
 * beside Bills, because what it produces is a Draft bill and the person
 * doing it is already there.
 *
 * Two things this screen is careful about, both learned from VYRON COST:
 *
 *  1. **Every figure says where it came from.** An extracted value, a
 *     suggested one and one the reviewer typed look different, because
 *     confirming a number you think the system knows is not the same act
 *     as confirming one you know a model guessed.
 *  2. **There is no "approve anyway".** COST's bulk approve hard-coded
 *     `force: true` and wrote costs past every rule behind one confirm
 *     dialog. The Convert button here is simply disabled, with the reasons
 *     listed, until the invoice is actually convertible.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChevronLeft, IconFileText, IconPlus } from "@/components/ui/icons";
import { glAccountOptions, vatCodeOptions } from "@/lib/account-picker-options";
import { formatAmount, formatDateTime } from "@/lib/format";
import { describeSource } from "@/server/supplier-invoice-capture/gl-vat-suggestion";
import type { CaptureStatus } from "@/server/supplier-invoice-capture/types";
import type { Supplier } from "@/server/accounting/types";
import type { VatTreatment } from "@/server/company-management/types";
import type { ChartOfAccount } from "@/server/general-ledger/types";

type Capture = {
  id: number;
  document_id: number;
  status: CaptureStatus;
  supplier_name_extracted: string | null;
  supplier_id: number | null;
  supplier_match_tier: string | null;
  supplier_candidates: { supplierId: number; supplierName: string; similarity: number; reason: string }[];
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  order_reference: string | null;
  currency_code: string | null;
  subtotal: number | null;
  vat_amount: number | null;
  total: number | null;
  validation_status: "Pending" | "Pass" | "Review" | "Incomplete";
  validation_findings: { code: string; severity: string; message: string; lineIndex?: number }[];
  model_confidence: number | null;
  duplicate_status: "None" | "Possible" | "Blocked";
  duplicate_reason: string;
  last_error_message: string | null;
  bill_id: number | null;
  created_at: string;
};

type CaptureLine = {
  line_order: number;
  description: string;
  supplier_sku: string | null;
  quantity: number | null;
  uom: string | null;
  pack_description: string | null;
  unit_price: number | null;
  discount: number | null;
  vat_amount: number | null;
  line_total: number | null;
  gl_account_suggested: string | null;
  gl_account_source: string | null;
  vat_code_suggested: string | null;
  vat_code_source: string | null;
  gl_account_confirmed: string | null;
  vat_code_confirmed: string | null;
  is_excluded: boolean;
  line_confidence: number | null;
};

const STATUS_TONE: Record<CaptureStatus, "muted" | "info" | "good" | "danger" | "warn"> = {
  Uploaded: "muted",
  Queued: "info",
  Extracting: "info",
  NeedsReview: "warn",
  Converted: "good",
  Duplicate: "danger",
  Failed: "danger",
  Cancelled: "muted",
};

/** What each state means to the person waiting, in their words. */
const STATUS_LABEL: Record<CaptureStatus, string> = {
  Uploaded: "Waiting",
  Queued: "Waiting",
  Extracting: "Processing",
  NeedsReview: "Needs review",
  Converted: "Converted to bill",
  Duplicate: "Duplicate",
  Failed: "Could not be read",
  Cancelled: "Discarded",
};

const FILTERS: (CaptureStatus | "All")[] = ["All", "Queued", "Extracting", "NeedsReview", "Duplicate", "Failed", "Converted"];

function money(value: number | null): string {
  return value === null || value === undefined ? "—" : formatAmount(Number(value));
}

/** The provenance chip. This is the point of the screen: the reviewer can
 * always tell what the document said from what VYRON proposed from what
 * they themselves changed. */
function Provenance({ kind, detail }: { kind: "extracted" | "suggested" | "user-corrected"; detail?: string }) {
  const tone = kind === "extracted" ? "info" : kind === "suggested" ? "muted" : "good";
  const label = kind === "extracted" ? "From the invoice" : kind === "suggested" ? detail ?? "Suggested" : "You changed this";
  return (
    <Badge tone={tone as never} className="ml-2 align-middle text-[0.65rem]">
      {label}
    </Badge>
  );
}

export function AiInvoiceCaptureTab({
  companyId,
  previewMode,
  suppliers,
  vatTreatments,
  chartOfAccounts,
}: {
  companyId: string;
  previewMode: boolean;
  suppliers: Supplier[];
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
}) {
  const router = useRouter();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [filter, setFilter] = useState<CaptureStatus | "All">("All");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/purchasing/invoice-capture`;

  /** Fetches the list. Returns it rather than setting state, so the
   * caller decides whether the answer is still wanted — a filter changed
   * mid-flight must not be overwritten by the previous request landing. */
  const fetchCaptures = useCallback(async (): Promise<Capture[] | null> => {
    try {
      const params = new URLSearchParams();
      if (filter !== "All") params.set("status", filter);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`${base}?${params}`);
      if (!res.ok) return null;
      const data = await res.json();
      return (data.captures ?? []) as Capture[];
    } catch {
      // A list that cannot load is not worth an error dialog; the empty
      // state and the Refresh button are enough.
      return null;
    }
  }, [base, filter, search]);

  const load = useCallback(async () => {
    const next = await fetchCaptures();
    if (next) setCaptures(next);
  }, [fetchCaptures]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchCaptures();
      if (!cancelled && next) setCaptures(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchCaptures]);

  async function upload(file: File) {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(base, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status})`);
        return;
      }
      setMessage(
        data.capture?.status === "Duplicate"
          ? (data.capture.message as string)
          : "Uploaded. PRECISIA is reading it — you can close this page, it will carry on.",
      );
      await load();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  if (openId !== null) {
    return (
      <ReviewPanel
        companyId={companyId}
        captureId={openId}
        suppliers={suppliers}
        vatTreatments={vatTreatments}
        chartOfAccounts={chartOfAccounts}
        previewMode={previewMode}
        onBack={() => {
          setOpenId(null);
          void load();
        }}
        onConverted={(billId) => {
          setOpenId(null);
          setMessage(`Converted to draft bill #${billId}. It is now in Bills, awaiting approval.`);
          void load();
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-vf-ink">AI Invoice Capture</p>
          <p className="mt-0.5 max-w-[60ch] text-xs text-vf-ink-faint">
            Upload a supplier&rsquo;s invoice. PRECISIA reads it, checks the figures add up, and prepares a draft bill for you to
            review. Nothing is posted until you convert it and approve the bill.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="subtle" size="sm" onClick={() => void load()}>
            Refresh
          </Button>
          <label className={previewMode ? "pointer-events-none opacity-50" : ""}>
            <span className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-full bg-vf-red-600 px-5 py-2 text-[0.88rem] font-semibold text-white">
              <IconPlus className="h-4 w-4" /> {loading ? "Uploading…" : "Capture Invoice"}
            </span>
            <input
              type="file"
              className="sr-only"
              accept="application/pdf,image/png,image/jpeg"
              disabled={previewMode || loading}
              aria-label="Supplier invoice file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        </div>
      </div>

      {message && <p role="status" className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink-soft">{message}</p>}
      {error && <p role="alert" className="rounded-vf-sm border border-vf-danger/40 px-3 py-2 text-sm text-vf-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Status" value={filter} onChange={(e) => setFilter(e.target.value as CaptureStatus | "All")} className="w-44">
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === "All" ? "All statuses" : STATUS_LABEL[f as CaptureStatus]}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Search captured invoices"
          placeholder="Search supplier or invoice number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
      </div>

      {captures.length === 0 ? (
        <EmptyState
          icon={<IconFileText className="h-6 w-6" />}
          title="No captured invoices"
          description="Upload a supplier invoice and PRECISIA will read it for you."
        />
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeadCell>Supplier</TableHeadCell>
              <TableHeadCell>Invoice #</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell align="right">Total</TableHeadCell>
              <TableHeadCell>Status</TableHeadCell>
              <TableHeadCell>Checks</TableHeadCell>
              <TableHeadCell>Uploaded</TableHeadCell>
              <TableHeadCell>Bill</TableHeadCell>
              <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {captures.map((capture) => (
              <TableRow key={capture.id}>
                <TableCell>{capture.supplier_name_extracted ?? <span className="text-vf-ink-faint">Not read</span>}</TableCell>
                <TableCell className="font-mono text-sm">{capture.invoice_number ?? "—"}</TableCell>
                <TableCell>{capture.invoice_date ?? "—"}</TableCell>
                <TableCell align="right" className="font-mono tabular-nums">{money(capture.total)}</TableCell>
                <TableCell>
                  <Badge tone={STATUS_TONE[capture.status] as never}>{STATUS_LABEL[capture.status]}</Badge>
                </TableCell>
                <TableCell>
                  {capture.duplicate_status !== "None" ? (
                    <Badge tone="danger">{capture.duplicate_status === "Blocked" ? "Duplicate" : "Possible duplicate"}</Badge>
                  ) : capture.validation_status === "Incomplete" ? (
                    <Badge tone="danger">Could not be read</Badge>
                  ) : capture.validation_status === "Review" ? (
                    <Badge tone="warn">Check figures</Badge>
                  ) : capture.validation_status === "Pass" ? (
                    <Badge tone="good">Figures agree</Badge>
                  ) : (
                    <span className="text-xs text-vf-ink-faint">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-vf-ink-faint">{formatDateTime(capture.created_at)}</TableCell>
                <TableCell>{capture.bill_id ? <span className="font-mono text-sm">#{capture.bill_id}</span> : "—"}</TableCell>
                <TableCell align="right">
                  <Button variant="subtle" size="sm" onClick={() => setOpenId(capture.id)}>
                    {capture.status === "NeedsReview" ? "Review" : "Open"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function ReviewPanel({
  companyId,
  captureId,
  suppliers,
  vatTreatments,
  chartOfAccounts,
  previewMode,
  onBack,
  onConverted,
}: {
  companyId: string;
  captureId: number;
  suppliers: Supplier[];
  vatTreatments: VatTreatment[];
  chartOfAccounts: ChartOfAccount[];
  previewMode: boolean;
  onBack: () => void;
  onConverted: (billId: number) => void;
}) {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [lines, setLines] = useState<CaptureLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/companies/${companyId}/purchasing/invoice-capture/${captureId}`;
  const glOptions = useMemo(() => glAccountOptions(chartOfAccounts), [chartOfAccounts]);
  const vatOptions = useMemo(() => vatCodeOptions(vatTreatments), [vatTreatments]);

  const fetchCapture = useCallback(async () => {
    const res = await fetch(base);
    if (!res.ok) return null;
    return (await res.json()) as { capture: Capture; lines: CaptureLine[] };
  }, [base]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const data = await fetchCapture();
      if (cancelled || !data) return;
      setCapture(data.capture);
      setLines(data.lines ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchCapture]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return null;
      }
      if (data.capture) setCapture(data.capture);
      if (data.lines) setLines(data.lines);
      return data;
    } catch {
      setError("Couldn't reach the API.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (!capture) return <p className="text-sm text-vf-ink-faint">Loading…</p>;

  const included = lines.filter((l) => !l.is_excluded);
  const lineTotal = included.reduce((sum, l) => sum + (Number(l.line_total) || 0), 0);

  /* The reasons Convert is unavailable, shown as a list rather than
     discovered one at a time. This is where COST would have offered a
     "force" — there is nothing to click here except fixing them. */
  const blockers: string[] = [];
  if (capture.duplicate_status === "Blocked") blockers.push(capture.duplicate_reason || "This invoice has already been captured.");
  if (capture.validation_status === "Incomplete") blockers.push("The figures on this document could not be read reliably.");
  if (!capture.supplier_id) blockers.push("Choose the supplier this invoice is from.");
  if (!capture.invoice_number) blockers.push("Enter the supplier's invoice number.");
  if (!capture.invoice_date) blockers.push("Enter the invoice date.");
  if (included.length === 0) blockers.push("Include at least one line.");
  for (const line of included) {
    if (!(line.gl_account_confirmed ?? line.gl_account_suggested)) blockers.push(`Line ${line.line_order + 1} needs a GL account.`);
    if (!(line.vat_code_confirmed ?? line.vat_code_suggested)) blockers.push(`Line ${line.line_order + 1} needs a VAT code.`);
  }
  const convertible = blockers.length === 0 && capture.status === "NeedsReview";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="subtle" size="sm" onClick={onBack}>
          <IconChevronLeft className="h-4 w-4" /> Back to captured invoices
        </Button>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[capture.status] as never}>{STATUS_LABEL[capture.status]}</Badge>
          <a
            href={`/api/companies/${companyId}/documents/${capture.document_id}/download`}
            className="text-sm font-medium text-vf-red-600 underline-offset-2 hover:underline"
          >
            View the original invoice
          </a>
        </div>
      </div>

      {error && <p role="alert" className="rounded-vf-sm border border-vf-danger/40 px-3 py-2 text-sm text-vf-danger">{error}</p>}

      {capture.duplicate_status !== "None" && (
        <p role="alert" className={`rounded-vf-sm border px-3 py-2 text-sm ${capture.duplicate_status === "Blocked" ? "border-vf-danger/40 text-vf-danger" : "border-vf-paper-border text-vf-ink-soft"}`}>
          <strong>{capture.duplicate_status === "Blocked" ? "Duplicate. " : "Possible duplicate. "}</strong>
          {capture.duplicate_reason}
        </p>
      )}

      {capture.validation_findings?.length > 0 && (
        <div className="rounded-vf-sm border border-vf-paper-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">What to check</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-vf-ink-soft">
            {capture.validation_findings.map((finding, i) => (
              <li key={i}>{finding.message}</li>
            ))}
          </ul>
          {capture.model_confidence !== null && (
            <p className="mt-2 text-xs text-vf-ink-faint">
              PRECISIA&rsquo;s own confidence was {capture.model_confidence}% — shown for information only. Whether this invoice
              needs checking is decided by the arithmetic above, not by that number.
            </p>
          )}
        </div>
      )}

      {capture.last_error_message && (
        <p role="status" className="rounded-vf-sm border border-vf-paper-border px-3 py-2 text-sm text-vf-ink-soft">{capture.last_error_message}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Supplier" htmlFor="cap-supplier" required className="lg:col-span-2">
          <Combobox
            aria-label="Supplier"
            value={capture.supplier_id}
            options={suppliers.filter((s) => s.status !== "Inactive").map((s) => ({ value: s.id, label: s.name, sublabel: s.vatNumber || s.supplierCode }))}
            placeholder="Choose the supplier"
            onCommit={(value) => void patch({ action: "correct-header", header: { supplierId: value ?? null } })}
          />
          {capture.supplier_name_extracted && (
            <p className="mt-1 text-xs text-vf-ink-faint">
              The invoice says &ldquo;{capture.supplier_name_extracted}&rdquo;
              {capture.supplier_match_tier === "manual" ? <Provenance kind="user-corrected" /> : capture.supplier_id ? <Provenance kind="extracted" /> : null}
            </p>
          )}
          {!capture.supplier_id && capture.supplier_candidates?.length > 0 && (
            <div className="mt-1.5">
              <p className="text-xs text-vf-ink-faint">PRECISIA could not confirm the supplier. Did you mean:</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {capture.supplier_candidates.map((candidate) => (
                  <Button
                    key={candidate.supplierId}
                    variant="subtle"
                    size="sm"
                    onClick={() => void patch({ action: "correct-header", header: { supplierId: candidate.supplierId } })}
                  >
                    {candidate.supplierName}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Field>

        <Field label="Invoice Number" htmlFor="cap-number" required>
          <Input
            id="cap-number"
            defaultValue={capture.invoice_number ?? ""}
            onBlur={(e) => void patch({ action: "correct-header", header: { invoiceNumber: e.target.value || null } })}
          />
        </Field>
        <Field label="Invoice Date" htmlFor="cap-date" required>
          <Input
            id="cap-date"
            type="date"
            defaultValue={capture.invoice_date ?? ""}
            onBlur={(e) => void patch({ action: "correct-header", header: { invoiceDate: e.target.value || null } })}
          />
        </Field>
        <Field label="Due Date" htmlFor="cap-due">
          <Input
            id="cap-due"
            type="date"
            defaultValue={capture.due_date ?? ""}
            onBlur={(e) => void patch({ action: "correct-header", header: { dueDate: e.target.value || null } })}
          />
        </Field>
        <Field label="Order / Reference" htmlFor="cap-ref">
          <Input
            id="cap-ref"
            defaultValue={capture.order_reference ?? ""}
            onBlur={(e) => void patch({ action: "correct-header", header: { orderReference: e.target.value || null } })}
          />
        </Field>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeadCell>Description</TableHeadCell>
              <TableHeadCell align="right">Qty</TableHeadCell>
              <TableHeadCell>UOM / Pack</TableHeadCell>
              <TableHeadCell align="right">Unit Price</TableHeadCell>
              <TableHeadCell align="right">Discount</TableHeadCell>
              <TableHeadCell align="right">VAT</TableHeadCell>
              <TableHeadCell align="right">Total</TableHeadCell>
              <TableHeadCell>GL Account</TableHeadCell>
              <TableHeadCell>VAT Code</TableHeadCell>
              <TableHeadCell>Include</TableHeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.line_order} className={line.is_excluded ? "opacity-50" : undefined}>
                <TableCell>
                  {line.description || <span className="text-vf-ink-faint">Not read</span>}
                  {line.supplier_sku && <span className="ml-2 font-mono text-xs text-vf-ink-faint">{line.supplier_sku}</span>}
                </TableCell>
                <TableCell align="right" className="font-mono tabular-nums">{line.quantity ?? "—"}</TableCell>
                <TableCell className="text-xs text-vf-ink-faint">
                  {line.pack_description ?? line.uom ?? "—"}
                </TableCell>
                <TableCell align="right" className="font-mono tabular-nums">{money(line.unit_price)}</TableCell>
                <TableCell align="right" className="font-mono tabular-nums">{line.discount ? money(line.discount) : "—"}</TableCell>
                <TableCell align="right" className="font-mono tabular-nums">{money(line.vat_amount)}</TableCell>
                <TableCell align="right" className="font-mono tabular-nums font-medium">{money(line.line_total)}</TableCell>
                <TableCell>
                  <Combobox
                    aria-label={`GL account for line ${line.line_order + 1}`}
                    value={line.gl_account_confirmed ?? line.gl_account_suggested}
                    options={glOptions}
                    placeholder="Choose"
                    onCommit={(value) =>
                      void patch({ action: "correct-lines", lines: [{ lineOrder: line.line_order, glAccount: value ?? null }] })
                    }
                  />
                  {!line.gl_account_confirmed && line.gl_account_source && line.gl_account_source !== "none" && (
                    <p className="mt-0.5 text-[0.65rem] text-vf-ink-faint">{describeSource(line.gl_account_source as never)}</p>
                  )}
                </TableCell>
                <TableCell>
                  <Combobox
                    aria-label={`VAT code for line ${line.line_order + 1}`}
                    value={line.vat_code_confirmed ?? line.vat_code_suggested}
                    options={vatOptions}
                    placeholder="Choose"
                    onCommit={(value) =>
                      void patch({ action: "correct-lines", lines: [{ lineOrder: line.line_order, vatCode: value ?? null }] })
                    }
                  />
                  {!line.vat_code_confirmed && line.vat_code_source && line.vat_code_source !== "none" && (
                    <p className="mt-0.5 text-[0.65rem] text-vf-ink-faint">{describeSource(line.vat_code_source as never)}</p>
                  )}
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Include line ${line.line_order + 1}`}
                    checked={!line.is_excluded}
                    onChange={(e) =>
                      void patch({ action: "correct-lines", lines: [{ lineOrder: line.line_order, isExcluded: !e.target.checked }] })
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-[46ch] text-xs text-vf-ink-faint">
          Converting creates a <strong>draft</strong> bill. VAT and the amount payable are calculated by PRECISIA&rsquo;s accounting
          engine from the lines you confirm above — nothing is posted to the ledger until that bill is approved in the ordinary
          way.
        </div>
        <dl className="w-64 space-y-1 text-sm">
          <div className="flex justify-between text-vf-ink-soft">
            <dt>The invoice says</dt>
            <dd className="font-mono tabular-nums">{money(capture.total)}</dd>
          </div>
          <div className="flex justify-between text-vf-ink-soft">
            <dt>The lines add to</dt>
            <dd className="font-mono tabular-nums">{formatAmount(Math.round(lineTotal * 100) / 100)}</dd>
          </div>
        </dl>
      </div>

      {blockers.length > 0 && (
        <div className="rounded-vf-sm border border-vf-paper-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Before this can become a bill</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-vf-ink-soft">
            {[...new Set(blockers)].map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={!convertible || busy || previewMode}
          onClick={async () => {
            const result = await patch({ action: "convert" });
            if (result?.billId) onConverted(result.billId as number);
          }}
        >
          {busy ? "Converting…" : "Convert to draft bill"}
        </Button>
        <Button
          variant="subtle"
          disabled={busy || previewMode || capture.status === "Converted"}
          onClick={() => void patch({ action: "cancel" }).then(onBack)}
        >
          Discard
        </Button>
        {capture.bill_id && (
          <a href={`/company/${companyId}/purchasing?tab=bills`} className="self-center text-sm font-medium text-vf-red-600 underline-offset-2 hover:underline">
            Open draft bill #{capture.bill_id}
          </a>
        )}
      </div>
    </div>
  );
}
