/**
 * Deterministic display formatting — one set of formatters whose output is
 * identical on the server and in every browser.
 *
 * PRODUCTION DEFECT this closes (React error #418): components formatted
 * with `toLocaleString(undefined, …)` / `new Date(x).toLocaleString()`,
 * which use the RUNTIME's default locale and time zone. The Vercel server
 * rendered "20,000.00" (en-US, UTC); a South African browser rendered
 * "20 000,00" (en-ZA, SAST) — so the server HTML and the browser's first
 * render disagreed and hydration failed.
 *
 * Nothing here depends on the runtime locale, time zone or ICU data:
 *  - numbers are grouped by hand in VYRON's accounting presentation
 *    (comma thousands, point decimals — the same as the Reporting Centre);
 *  - dates and times are built from numeric parts and shown in South
 *    African time (Africa/Johannesburg is UTC+2 all year — no daylight
 *    saving since 1944 — so a fixed offset is exact, with no Intl lookup).
 */

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 20000 → "20,000.00", -1234.5 → "-1,234.50". `fractionDigits` fixes the
 * decimals exactly (the old calls all used min = max = 2). */
export function formatAmount(value: number, fractionDigits = 2): string {
  if (!Number.isFinite(value)) return String(value);
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [whole, fraction] = fixed.split(".");
  const sign = value < 0 && Number(fixed) !== 0 ? "-" : "";
  return `${sign}${groupThousands(whole)}${fraction ? `.${fraction}` : ""}`;
}

/** Whole counts: 1234 → "1,234". */
export function formatCount(value: number): string {
  return formatAmount(Math.round(value), 0);
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar parts in South African time. A bare "YYYY-MM-DD" is a calendar
 * date, not an instant, and is taken as written (no time-zone shift). */
function sastParts(input: string | number | Date): Parts | null {
  if (typeof input === "string") {
    const m = DATE_ONLY.exec(input);
    if (m) {
      const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
      return { year: Number(m[1]), month: Number(m[2]) - 1, day: Number(m[3]), hour: 0, minute: 0, weekday };
    }
  }
  const time = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(time)) return null;
  const d = new Date(time + SAST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "14 Sep 2026". */
export function formatDate(input: string | number | Date): string {
  const p = sastParts(input);
  return p ? `${p.day} ${MONTHS_SHORT[p.month]} ${p.year}` : String(input);
}

/** "14 Sep 2026, 18:09" (SAST). */
export function formatDateTime(input: string | number | Date): string {
  const p = sastParts(input);
  return p ? `${p.day} ${MONTHS_SHORT[p.month]} ${p.year}, ${pad2(p.hour)}:${pad2(p.minute)}` : String(input);
}

/** "18:09" (SAST). */
export function formatTime(input: string | number | Date): string {
  const p = sastParts(input);
  return p ? `${pad2(p.hour)}:${pad2(p.minute)}` : String(input);
}

/** "14 Sep" — chart axes. */
export function formatDayMonth(input: string | number | Date): string {
  const p = sastParts(input);
  return p ? `${p.day} ${MONTHS_SHORT[p.month]}` : String(input);
}

/** "Mon" — chart axes. */
export function formatWeekdayShort(input: string | number | Date): string {
  const p = sastParts(input);
  return p ? WEEKDAYS_SHORT[p.weekday] : String(input);
}

/** "Monday, 14 September 2026". */
export function formatLongDate(input: string | number | Date): string {
  const p = sastParts(input);
  return p ? `${WEEKDAYS_LONG[p.weekday]}, ${p.day} ${MONTHS_LONG[p.month]} ${p.year}` : String(input);
}
