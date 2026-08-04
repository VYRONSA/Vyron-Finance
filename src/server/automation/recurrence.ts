/**
 * Pure recurrence-date math for Recurring Documents — no Supabase, no
 * `Date.now()`/`new Date()` (every call takes its "from" date explicitly,
 * so this is deterministic and safe to unit test exhaustively, same
 * rigor as `costing.ts`'s FIFO math).
 */

export type RecurrenceFrequency = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Annually" | "Custom";

export type RecurrenceRule = {
  frequency: RecurrenceFrequency;
  /** Only meaningful for "Custom" (every N days); ignored otherwise —
   * Daily/Weekly/Monthly/Quarterly/Annually each have their own fixed
   * calendar-unit step. */
  intervalCount: number;
  skipWeekends: boolean;
  /** Real, respected, and currently always empty — no public holiday
   * calendar is configured anywhere in this codebase (jurisdiction-
   * specific data this platform doesn't have a source for yet). Passing
   * a real set here makes the flag do something without any change to
   * this function. */
  publicHolidays: string[];
};

function parseIso(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Adds calendar months, clamping day-of-month overflow (e.g. Jan 31 + 1
 * month lands on Feb 28/29, not Mar 3) — the "last valid day of the
 * target month" convention every real calendaring system uses. */
function addMonths(date: Date, months: number): Date {
  const targetMonthIndex = date.getUTCMonth() + months;
  const next = new Date(date);
  next.setUTCMonth(targetMonthIndex);
  const expectedMonth = ((targetMonthIndex % 12) + 12) % 12;
  if (next.getUTCMonth() !== expectedMonth) {
    next.setUTCDate(0); // rolled into the month after target; back up to target month's last day.
  }
  return next;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function rollForwardPastNonBusinessDays(date: Date, skipWeekends: boolean, publicHolidays: Set<string>): Date {
  let result = date;
  while ((skipWeekends && isWeekend(result)) || publicHolidays.has(toIso(result))) {
    result = addDays(result, 1);
  }
  return result;
}

/** Pure — the one place "what's the next occurrence" logic lives, so the
 * Scheduler, the Recurring Templates UI's "Preview Next Execution," and
 * the generation pipeline can never disagree. `fromDate` is the template's
 * own `next_run_date` (or `start_date` for the first occurrence) — this
 * function returns the occurrence AFTER it, never `fromDate` itself. */
export function computeNextRunDate(fromDate: string, rule: RecurrenceRule): string {
  const from = parseIso(fromDate);
  const holidays = new Set(rule.publicHolidays);

  let next: Date;
  switch (rule.frequency) {
    case "Daily": next = addDays(from, 1); break;
    case "Weekly": next = addDays(from, 7); break;
    case "Monthly": next = addMonths(from, 1); break;
    case "Quarterly": next = addMonths(from, 3); break;
    case "Annually": next = addMonths(from, 12); break;
    case "Custom": next = addDays(from, Math.max(1, rule.intervalCount)); break;
  }

  next = rollForwardPastNonBusinessDays(next, rule.skipWeekends, holidays);
  return toIso(next);
}

export type OccurrenceCheck = {
  /** Whether a new occurrence should be generated at `candidateDate`. */
  isDue: boolean;
  /** Why not, when `isDue` is false — end date passed, occurrence cap
   * reached, or the template isn't active. Never null when `isDue` is
   * false. */
  reason: string | null;
};

/** Pure — whether a template due at `candidateDate` should actually fire,
 * given its end conditions. Kept separate from `computeNextRunDate` so
 * "what's the next calendar date" and "should we still be generating at
 * all" are two independently testable questions. */
export function checkOccurrenceDue(
  candidateDate: string,
  todayIso: string,
  endDate: string | null,
  maxOccurrences: number | null,
  occurrencesGenerated: number,
  isActive: boolean,
): OccurrenceCheck {
  if (!isActive) return { isDue: false, reason: "Template is paused or disabled." };
  if (candidateDate > todayIso) return { isDue: false, reason: "Not due yet." };
  if (endDate && candidateDate > endDate) return { isDue: false, reason: "Past the template's end date." };
  if (maxOccurrences !== null && occurrencesGenerated >= maxOccurrences) return { isDue: false, reason: "Occurrence limit reached." };
  return { isDue: true, reason: null };
}
