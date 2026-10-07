/**
 * SD-3C — whose statement is this? A PROPOSAL, never a decision.
 *
 * Reuses the capture's supplier resolution unchanged (VAT → registration →
 * supplier code → exact name → normalised name → learned; fuzzy names are
 * candidates only) and adds one deterministic signal statements carry and
 * invoices often do not: OUR account number at the supplier
 * (`ae_suppliers.our_account_number`), compared verbatim after trimming —
 * leading zeros matter.
 *
 * Whatever this proposes, a reviewer must CONFIRM the supplier before the
 * statement can be marked ready (owner decision, enforced by the database).
 * A supplier is never created here.
 */
import {
  resolveSupplier,
  type SupplierCandidate,
  type SupplierResolution,
} from "@/server/supplier-invoice-capture/supplier-resolution";
import type { Supplier } from "@/server/accounting/types";

export type StatementSupplierInput = {
  supplierName: string | null;
  vatNumber: string | null;
  registrationNumber: string | null;
  accountNumber: string | null;
};

export type StatementSupplierProposal = {
  supplierId: number | null;
  tier: "vat" | "registration" | "supplier-code" | "account-number" | "exact-name" | "normalised-name" | "learned" | null;
  candidates: SupplierCandidate[];
  outcome: SupplierResolution["outcome"];
  reason: string | null;
};

const STRONG_TIERS = new Set(["vat", "registration", "supplier-code"]);

function accountKey(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function candidateFor(s: Supplier, reason: string): SupplierCandidate {
  return { supplierId: s.id, supplierName: s.name, vatNumber: s.vatNumber, similarity: 1, reason };
}

export function proposeStatementSupplier(
  input: StatementSupplierInput,
  suppliers: Supplier[],
  ourAccountNumbers: ReadonlyMap<number, string | null>,
): StatementSupplierProposal {
  const resolution = resolveSupplier(
    { supplierName: input.supplierName, vatNumber: input.vatNumber, registrationNumber: input.registrationNumber },
    suppliers,
  );

  const key = accountKey(input.accountNumber);
  const byAccount = key
    ? suppliers.filter((s) => s.status !== "Inactive" && accountKey(ourAccountNumbers.get(s.id)) === key)
    : [];

  if (resolution.outcome === "resolved" && STRONG_TIERS.has(resolution.tier)) {
    // A tax/company identity outranks an account number — unless the
    // account number points somewhere else, which a person must look at.
    const conflict = byAccount.find((s) => s.id !== resolution.supplierId);
    if (conflict) {
      const identified = suppliers.find((s) => s.id === resolution.supplierId);
      return {
        supplierId: null,
        tier: null,
        candidates: [
          ...(identified ? [candidateFor(identified, `The statement's ${resolution.tier === "vat" ? "VAT number" : resolution.tier === "registration" ? "registration number" : "supplier code"} belongs to this supplier.`)] : []),
          candidateFor(conflict, "Our account number on the statement belongs to this supplier."),
        ],
        outcome: "ambiguous",
        reason: "The statement's VAT/registration number and our account number point to different suppliers.",
      };
    }
    return { supplierId: resolution.supplierId, tier: resolution.tier as StatementSupplierProposal["tier"], candidates: resolution.candidates, outcome: "resolved", reason: null };
  }

  if (byAccount.length === 1) {
    const match = byAccount[0];
    if (resolution.outcome === "resolved" && resolution.supplierId !== match.id) {
      return {
        supplierId: null,
        tier: null,
        candidates: [candidateFor(match, "Our account number on the statement belongs to this supplier."), ...resolution.candidates],
        outcome: "ambiguous",
        reason: "The statement's name and our account number point to different suppliers.",
      };
    }
    return {
      supplierId: match.id,
      tier: "account-number",
      candidates: [candidateFor(match, "Our account number on the statement belongs to this supplier.")],
      outcome: "resolved",
      reason: null,
    };
  }
  if (byAccount.length > 1) {
    return {
      supplierId: null,
      tier: null,
      candidates: byAccount.map((s) => candidateFor(s, "Has the same account number recorded.")),
      outcome: "ambiguous",
      reason: "More than one supplier has this account number recorded.",
    };
  }

  if (resolution.outcome === "resolved") {
    return { supplierId: resolution.supplierId, tier: resolution.tier as StatementSupplierProposal["tier"], candidates: resolution.candidates, outcome: "resolved", reason: null };
  }
  return {
    supplierId: null,
    tier: null,
    candidates: resolution.candidates,
    outcome: resolution.outcome,
    reason: resolution.outcome === "ambiguous" ? resolution.reason : null,
  };
}
