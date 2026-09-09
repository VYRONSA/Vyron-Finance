/**
 * Shared Age Analysis bucketing — used identically by Supplier Management
 * (`supplier-financial-service.ts`) and Customer Management
 * (`customer-financial-service.ts`). Extracted here rather than
 * duplicated once Customer Financial Information became real (Commercial
 * Platform Module 3, Sales), per the Product Review Board's "no
 * duplicated logic between modules" instruction.
 */

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type AgingBuckets = {
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days120Plus: number;
};

const MS_PER_DAY = 86_400_000;

/** Pure — unit tested. Buckets each item's outstanding amount by how many
 * days past its due date `asOfDate` is; an item with no due date is
 * treated as Current (not overdue) rather than dropped. */
export function computeAgingBuckets(items: { outstanding: number; dueDate: string | null }[], asOfDate: string): AgingBuckets {
  const buckets = { current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 };
  const asOfMs = Date.parse(asOfDate);

  for (const item of items) {
    if (item.outstanding <= 0) continue;
    if (!item.dueDate) {
      buckets.current += item.outstanding;
      continue;
    }
    const daysOverdue = Math.floor((asOfMs - Date.parse(item.dueDate)) / MS_PER_DAY);
    if (daysOverdue <= 0) buckets.current += item.outstanding;
    else if (daysOverdue <= 30) buckets.days30 += item.outstanding;
    else if (daysOverdue <= 60) buckets.days60 += item.outstanding;
    else if (daysOverdue <= 90) buckets.days90 += item.outstanding;
    else buckets.days120Plus += item.outstanding;
  }

  return {
    current: round2(buckets.current),
    days30: round2(buckets.days30),
    days60: round2(buckets.days60),
    days90: round2(buckets.days90),
    days120Plus: round2(buckets.days120Plus),
  };
}
