/**
 * Phase 5L — pack/UOM information, captured and NOT acted upon.
 *
 * VYRON COST has no pack-size intelligence at all — no "12 x 1L" parser
 * exists anywhere in it — and yet on approval it wrote the invoice's line
 * price straight into a column named `true_unit_cost`. For a supplier who
 * invoices by the case, the field called "true unit cost" holds the CASE
 * price. Every price analytic built on it inherits that error.
 *
 * The lesson is not "parse harder". It is that deriving a unit cost is an
 * accounting decision, and this module is not entitled to make it.
 *
 * So: a pack description that is clearly printed is captured as printed,
 * and a pack quantity is read only when it is unambiguous. Neither is ever
 * divided into a price. `unitPrice` stays exactly what the document says.
 *
 * Finance's `ae_purchase_bill_lines` has no UOM, no pack size and no item
 * link — its lines are GL-coded expense lines. So there is currently
 * nowhere for a derived unit cost to go even if one were computed, and
 * item/inventory linking is explicitly left for a later controlled phase.
 */

export type PackInfo = {
  /** Exactly as printed, e.g. "12 x 1L". Null when nothing pack-like was
   * printed — never inferred from a description. */
  packDescription: string | null;
  /** The multiplier, when it is unambiguous. 12 for "12 x 1L". */
  packQuantity: number | null;
  /** The unit size text, e.g. "1L". Kept as text: converting "1L" to a
   * number needs a UOM conversion table this system does not have, and
   * inventing one is how COST's bug happened. */
  unitSize: string | null;
};

const EMPTY: PackInfo = { packDescription: null, packQuantity: null, unitSize: null };

/**
 * Reads a pack expression from text a supplier actually printed.
 *
 * Accepts the forms that are genuinely unambiguous:
 *   "12 x 1L"  "12 X 1 L"  "12×1L"  "6 x 750ml"  "24x330ML"
 *
 * Deliberately does NOT accept:
 *   "1L x 12"   — ambiguous ordering; which number is the count?
 *   "12"        — a bare number is a quantity, not a pack
 *   "box of 12" — prose, and the unit size is missing
 *
 * When in doubt it returns nothing. A missing pack description costs a
 * reviewer a glance at the document; a wrong one silently misstates cost.
 */
export function parsePackDescription(text: string | null | undefined): PackInfo {
  const source = String(text ?? "").trim();
  if (!source) return EMPTY;

  // <count> x <size><unit> — the count must be a plain integer and the
  // size must carry a unit, otherwise it is not a pack expression.
  const match = source.match(/(?<![\d.])(\d{1,4})\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]{1,6})\b/);
  if (!match) return EMPTY;

  const packQuantity = Number(match[1]);
  if (!Number.isFinite(packQuantity) || packQuantity <= 1) return EMPTY;

  const size = match[2].replace(",", ".");
  const unit = match[3];
  return {
    packDescription: `${match[1]} x ${size}${unit}`,
    packQuantity,
    unitSize: `${size}${unit}`,
  };
}

/**
 * The deliberate non-operation.
 *
 * Exists so the intent is written down in code rather than only in a
 * document: there is no supported way to turn a pack quantity into a unit
 * cost in this phase. A caller reaching for one finds this, and the reason.
 *
 * When Finance gains an item/UOM architecture, the decision belongs there —
 * in deterministic business logic that knows what the item is and how it is
 * stocked — not in the extraction path.
 */
export function derivedUnitCostIsOutOfScope(): never {
  throw new Error(
    "Phase 5L does not derive a unit cost from a pack quantity. The invoice's printed unit price is stored as printed. " +
      "Deriving a per-unit cost requires item and UOM architecture Finance does not yet have, and is a controlled change to inventory costing.",
  );
}
