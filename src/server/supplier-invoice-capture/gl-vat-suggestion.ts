/**
 * Phase 5L — GL account and VAT code suggestions.
 *
 * A SUGGESTION SYSTEM. Nothing here decides accounting. Every value it
 * produces lands in a `*_suggested` column, is shown to a reviewer as a
 * suggestion with its source named, and must be confirmed before a bill
 * line can be created. `ae_purchase_bill_lines` already refuses a line with
 * no GL account and no VAT code, so an unconfirmed suggestion cannot become
 * an accounting entry by omission.
 *
 * THE PRIORITY LADDER, as approved:
 *
 *     explicit supplier default
 *         > approved historical mapping
 *             > deterministic rule
 *                 > AI suggestion
 *
 * The ordering matters more than it looks. A supplier default is something
 * a person configured on purpose; a model's guess is not evidence of
 * anything. Letting AI override a configured default would quietly undo a
 * deliberate decision, which is why `suggestGlAccount` cannot reach the AI
 * rung once a default exists.
 *
 * COST had none of this — it extracted no GL account, no tax code and no
 * category at all, and its Xero payload carried no account code.
 */

import type { GlAccountSource, VatCodeSource } from "./types";

export type SuggestionInputs = {
  /** `ae_suppliers.default_gl_account` / `default_vat_code` — the two
   * fields the Allocation Engine already reads. */
  supplierDefaultGlAccount: string | null;
  supplierDefaultVatCode: string | null;
  /** A mapping this company previously CONFIRMED for this supplier and a
   * matching description/SKU. Human-approved, never raw AI output. */
  learnedGlAccount: string | null;
  learnedVatCode: string | null;
  /** The most recent approved bill line from this supplier with the same
   * normalised description. */
  historicalGlAccount: string | null;
  historicalVatCode: string | null;
  /** What the model proposed, if anything. Lowest rung. */
  aiGlAccount: string | null;
  aiVatCode: string | null;
  /** A VAT rate actually PRINTED on the line. Deterministic evidence from
   * the document itself, so it outranks an AI guess — but not a
   * configured default, which reflects how this company decided to treat
   * this supplier. */
  printedVatRatePercent: number | null;
  /** The company's VAT treatments, for turning a printed rate into a code. */
  vatTreatments: { code: string; rate: number }[];
};

export type Suggestion<TSource> = { value: string | null; source: TSource };

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function suggestGlAccount(inputs: SuggestionInputs): Suggestion<GlAccountSource> {
  const supplierDefault = clean(inputs.supplierDefaultGlAccount);
  if (supplierDefault) return { value: supplierDefault, source: "supplier-default" };

  const learned = clean(inputs.learnedGlAccount);
  if (learned) return { value: learned, source: "learned-mapping" };

  const historical = clean(inputs.historicalGlAccount);
  if (historical) return { value: historical, source: "historical-bill" };

  const ai = clean(inputs.aiGlAccount);
  if (ai) return { value: ai, source: "ai" };

  return { value: null, source: "none" };
}

/**
 * Resolves a printed VAT rate to one of this company's own treatment codes.
 *
 * Exact rate match only. A printed 15% becomes the company's 15% code; a
 * printed 14% (a pre-2018 document) matches nothing and is left for the
 * reviewer rather than being rounded to the nearest configured rate.
 * Several codes can share a rate — Standard Rated and Import VAT are both
 * 15% — and picking one arbitrarily would be a guess, so that is treated as
 * no match.
 */
export function vatCodeForPrintedRate(
  ratePercent: number | null,
  treatments: { code: string; rate: number }[],
): string | null {
  if (ratePercent === null || !Number.isFinite(ratePercent)) return null;
  const matches = treatments.filter((t) => Math.abs(t.rate - ratePercent) < 0.001);
  return matches.length === 1 ? matches[0].code : null;
}

export function suggestVatCode(inputs: SuggestionInputs): Suggestion<VatCodeSource> {
  const supplierDefault = clean(inputs.supplierDefaultVatCode);
  if (supplierDefault) return { value: supplierDefault, source: "supplier-default" };

  const learned = clean(inputs.learnedVatCode);
  if (learned) return { value: learned, source: "learned-mapping" };

  const historical = clean(inputs.historicalVatCode);
  if (historical) return { value: historical, source: "historical-bill" };

  const printed = vatCodeForPrintedRate(inputs.printedVatRatePercent, inputs.vatTreatments);
  if (printed) return { value: printed, source: "printed-rate" };

  const ai = clean(inputs.aiVatCode);
  if (ai) return { value: ai, source: "ai" };

  return { value: null, source: "none" };
}

/** How the reviewer is told where a suggestion came from. Deliberately
 * plain: "VYRON suggested this" is not useful; "this supplier's default"
 * tells them whether to trust it. */
export function describeSource(source: GlAccountSource | VatCodeSource): string {
  return (
    {
      "supplier-default": "this supplier's default",
      "learned-mapping": "a mapping you confirmed before",
      "historical-bill": "a previous bill from this supplier",
      "printed-rate": "the VAT rate printed on the invoice",
      ai: "suggested by VYRON AI — check it",
      none: "not suggested — choose one",
    } as Record<string, string>
  )[source] ?? source;
}

/** Normalisation for the learning key. Shared by the writer and the reader
 * so a mapping can always be found again. */
export function normaliseDescription(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normaliseSku(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
