/**
 * Master Implementation Tracker — Programme 4, Epic E9, Root Cause
 * RC-11, Finding #105. Pure, no Supabase — a real "vatType -> VAT201
 * category" mapping over already-period-scoped `VatDocument`s, reusing
 * the exact same `VatType` enum Tax Configuration already exposes on
 * `VatTreatment` (one source of truth, not a parallel classification).
 *
 * Deliberately labels rows by their real accounting category (Standard /
 * Zero-Rated / Exempt / Import / Export / Reverse Charge / Unclassified)
 * rather than asserting specific SARS VAT201 box numbers — the platform
 * has no authoritative, versioned source for the current form's exact
 * box layout, and a wrong box number on a compliance document is worse
 * than an honest category label an accountant can map onto whichever
 * box the current VAT201 form actually uses. Accounting correctness over
 * convenience (Programme 4's own explicit instruction).
 *
 * Credit Notes are signed, not summed as positive magnitudes — a
 * Customer/Supplier Credit Note's `grossAmount`/`vatAmount` are stored as
 * positive figures but post as a REVERSAL of output/input VAT (see
 * `seed_company_defaults()`'s 'Customer Credit Note'/'Supplier Credit
 * Note' rules: DR VAT Output / CR VAT Input respectively) — summing them
 * as positive would overstate both Output and Input VAT for the period.
 */

import type { VatDocument } from "./vat-intelligence";
import type { VatType } from "./types";

export type Vat201Direction = "Output" | "Input";
export type Vat201Category = VatType | "Unclassified";

export type Vat201CategoryTotals = {
  category: Vat201Category;
  documentCount: number;
  netValue: number;
  vatValue: number;
};

export type Vat201Summary = {
  periodStart: string;
  periodEnd: string;
  outputs: Vat201CategoryTotals[];
  inputs: Vat201CategoryTotals[];
  totalOutputValue: number;
  totalOutputVat: number;
  totalInputValue: number;
  totalInputVat: number;
  netVat: number;
};

const OUTPUT_DOCUMENT_TYPES = new Set(["Customer Invoice", "Customer Credit Note"]);
const INPUT_DOCUMENT_TYPES = new Set(["Supplier Bill", "Supplier Credit Note"]);
const CREDIT_NOTE_TYPES = new Set(["Customer Credit Note", "Supplier Credit Note"]);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function directionOf(documentType: string): Vat201Direction | null {
  if (OUTPUT_DOCUMENT_TYPES.has(documentType)) return "Output";
  if (INPUT_DOCUMENT_TYPES.has(documentType)) return "Input";
  return null;
}

function accumulate(documents: VatDocument[]): Vat201CategoryTotals[] {
  const byCategory = new Map<Vat201Category, Vat201CategoryTotals>();
  for (const doc of documents) {
    const sign = CREDIT_NOTE_TYPES.has(doc.documentType) ? -1 : 1;
    const category: Vat201Category = doc.vatType ?? "Unclassified";
    const entry = byCategory.get(category) ?? { category, documentCount: 0, netValue: 0, vatValue: 0 };
    entry.documentCount += 1;
    entry.netValue = round2(entry.netValue + sign * (doc.grossAmount - doc.vatAmount));
    entry.vatValue = round2(entry.vatValue + sign * doc.vatAmount);
    byCategory.set(category, entry);
  }
  return [...byCategory.values()].sort((a, b) => b.vatValue - a.vatValue);
}

/** Pure — `documents` must already be filtered to the period; this
 * function only classifies and totals, it never derives its own period
 * window (the caller — currently a UI component's own client-side date
 * filter, see Finding #106 — owns that). */
export function buildVat201Summary(documents: VatDocument[], periodStart: string, periodEnd: string): Vat201Summary {
  const outputDocs = documents.filter((d) => directionOf(d.documentType) === "Output");
  const inputDocs = documents.filter((d) => directionOf(d.documentType) === "Input");

  const outputs = accumulate(outputDocs);
  const inputs = accumulate(inputDocs);

  const totalOutputValue = round2(outputs.reduce((sum, c) => sum + c.netValue, 0));
  const totalOutputVat = round2(outputs.reduce((sum, c) => sum + c.vatValue, 0));
  const totalInputValue = round2(inputs.reduce((sum, c) => sum + c.netValue, 0));
  const totalInputVat = round2(inputs.reduce((sum, c) => sum + c.vatValue, 0));

  return {
    periodStart,
    periodEnd,
    outputs,
    inputs,
    totalOutputValue,
    totalOutputVat,
    totalInputValue,
    totalInputVat,
    netVat: round2(totalOutputVat - totalInputVat),
  };
}
