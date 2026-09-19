/**
 * Phase 5L — VYRON AI Supplier Invoice Capture: the extraction contract.
 *
 * THE RULE THIS FILE ENCODES (Phase 5K, carried over from VYRON COST's own
 * hard-won finding): **the model copies; it does not calculate.** It may
 * report a figure it can see printed. It may not derive one. A value that
 * is not on the page is `null` — not a guess, and not a placeholder.
 *
 * COST wrote the strings `"Needs Review"` and `"UNKNOWN"` into fields that
 * are otherwise money and dates. That is how a magic string ends up stored
 * as a supplier's VAT number, and how `"Needs Review"` ends up where a
 * subtotal belongs. Here every unreadable value is `null` and the REASON it
 * is null is carried separately, in `missingFields`, where it cannot be
 * confused with data.
 *
 * Confidence is captured because it is occasionally informative to a human.
 * It is never authoritative: it decides no review state and triggers no
 * retry. COST measured `confidenceScore: 95` on every row of a
 * comprehensively fabricated table.
 */

/** Where a value on the review screen came from. The reviewer must always
 * be able to tell a figure the document stated from one this system
 * proposed from one they typed themselves. */
export type FieldProvenance = "extracted" | "suggested" | "user-corrected";

export type CaptureStatus =
  | "Uploaded"
  | "Queued"
  | "Extracting"
  | "NeedsReview"
  | "Converted"
  | "Duplicate"
  | "Failed"
  | "Cancelled";

export type ValidationStatus = "Pending" | "Pass" | "Review" | "Incomplete";
export type DuplicateStatus = "None" | "Possible" | "Blocked";

export type SupplierMatchTier =
  | "vat"
  | "registration"
  | "supplier-code"
  | "exact-name"
  | "normalised-name"
  | "learned"
  | "manual";

export type GlAccountSource = "supplier-default" | "learned-mapping" | "historical-bill" | "ai" | "none";
export type VatCodeSource = GlAccountSource | "printed-rate";

/**
 * One extracted line, exactly as printed.
 *
 * Money is `number | null`, never a string and never a sentinel. `quantity`
 * and `unitPrice` carry 4 decimals because a supplier may print a unit
 * price to more than 2 (a per-kilogram rate); the bill's own columns are
 * the same shape, so nothing is lost or rounded on conversion.
 *
 * `packDescription`/`packQuantity` are captured AS PRINTED and never used
 * to derive a unit cost — see `pack-size.ts`.
 */
export type ExtractedLine = {
  description: string | null;
  supplierSku: string | null;
  quantity: number | null;
  uom: string | null;
  packDescription: string | null;
  packQuantity: number | null;
  unitPrice: number | null;
  discount: number | null;
  vatRatePercent: number | null;
  vatAmount: number | null;
  lineTotal: number | null;
  /** Model self-reported, 0–100. Informative only. */
  confidence: number | null;
};

/** What KIND of document this is. A supplier credit note reduces what is
 * owed; booking one as a bill would increase it instead — the opposite
 * sign, silently. Captured so the pipeline can refuse rather than guess. */
export type ExtractedDocumentType = "Invoice" | "Credit Note" | "Debit Note" | "Other";

export type ExtractedHeader = {
  documentType: ExtractedDocumentType | null;
  supplierName: string | null;
  supplierVatNumber: string | null;
  supplierRegistrationNumber: string | null;
  invoiceNumber: string | null;
  /** ISO `YYYY-MM-DD`, or null. Never a free-text date. */
  invoiceDate: string | null;
  dueDate: string | null;
  orderReference: string | null;
  currencyCode: string | null;
  subtotal: number | null;
  discountTotal: number | null;
  vatAmount: number | null;
  total: number | null;
  confidence: number | null;
};

/**
 * The complete result of one extraction.
 *
 * `invoiceNumbersSeen` exists for one reason: a supplier who scans a month
 * of invoices into a single PDF. COST hit exactly this and documented the
 * near-miss — one file carrying 23 lines and R152,817.51 belonging to five
 * different invoices, which approving would have duplicated R121,823 of
 * cost. `assessInvoiceBoundary` refuses such a file.
 */
export type ExtractionResult = {
  header: ExtractedHeader;
  lines: ExtractedLine[];
  /** Every distinct invoice number visible anywhere in the document. */
  invoiceNumbersSeen: string[];
  /** Names of header fields the model could not read. Carried HERE so an
   * unreadable value never has to be represented inside the value. */
  missingFields: string[];
  /** The model's own remarks. Shown to a reviewer; never acted on. */
  warnings: string[];
  /** How many charged lines the model says it could see. Compared against
   * `lines.length` to detect a truncated answer — a deterministic signal,
   * unlike confidence. */
  declaredLineCount: number | null;
};

/** What the provider boundary returns. A failure is a typed category, not
 * an exception carrying a payload. */
export type ExtractionProviderResult =
  | { ok: true; result: ExtractionResult; model: string; usage: ProviderUsage | null }
  | { ok: false; category: ExtractionErrorCategory; httpStatus: number | null; message: string; model: string | null };

export type ExtractionErrorCategory =
  | "missing-api-key"
  | "unauthorized"
  | "payment-required"
  | "forbidden"
  | "configuration"
  | "timeout"
  | "rate-limit"
  | "server-error"
  | "provider-error"
  | "network"
  | "malformed-response"
  | "unsupported-document"
  | "unknown";

export type ProviderUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

/** The document as the provider boundary receives it. Deliberately the
 * smallest thing that can be extracted from — no filename, no uploader, no
 * company name, nothing that is not needed to read the invoice. */
export type ExtractionInput = {
  bytes: Uint8Array;
  mimeType: string;
};
