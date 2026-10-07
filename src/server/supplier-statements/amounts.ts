/**
 * SD-3C — reading amounts and dates off a supplier statement.
 *
 * South African statements print money every way at once: "1 234,56",
 * "1,234.56", "R 1 234.56", "(500.00)", "500.00-", "500.00 CR", "500.00 DR".
 * No existing parser handled all of them (csv-utils' parseAmount reads
 * "1 234,56" as 123456 and ignores CR), so this one exists.
 *
 * THE RULE: never guess. A value that could mean two things — "1,234" with
 * no other clue whether the comma is a thousands separator or a decimal
 * point — is returned UNRESOLVED with its reason, and the caller keeps the
 * raw text for a reviewer. A statement is read with ONE decimal style,
 * inferred from its unambiguous amounts (`inferDecimalStyle`).
 *
 * Pure; no I/O.
 */

export type DecimalStyle = "point" | "comma";

export type AmountResult =
  | { ok: true; value: number }
  | { ok: false; reason: "empty" | "ambiguous" | "unreadable" };

/** Signed: credit markers (CR, parentheses, a minus either side) make it
 * negative; DR or no marker leaves it positive. Rounded to cents. */
export function parseStatementAmount(raw: string | null | undefined, style: DecimalStyle | null): AmountResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "empty" };
  let text = String(raw).replace(/[\u00a0\u202f\u2009]/g, " ").trim();
  if (text === "" || text === "-" || text === "—") return { ok: false, reason: "empty" };

  let negative = false;
  const crdr = /\s*(CR|DR)\.?$/i.exec(text);
  if (crdr) {
    if (crdr[1].toUpperCase() === "CR") negative = !negative;
    text = text.slice(0, crdr.index).trim();
  }
  if (/^\(.*\)$/.test(text)) {
    negative = !negative;
    text = text.slice(1, -1).trim();
  }
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1).trim();
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  text = text.replace(/^(ZAR|R)\s*/i, "").trim();
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  }
  if (text === "") return { ok: false, reason: "empty" };
  if (!/^[0-9][0-9 .,']*$/.test(text)) return { ok: false, reason: "unreadable" };

  const normalised = normaliseDigits(text, style);
  if (!normalised.ok) return normalised;
  const value = Math.round(Number(normalised.digits) * 100) / 100;
  if (!Number.isFinite(value)) return { ok: false, reason: "unreadable" };
  return { ok: true, value: negative && value !== 0 ? -value : value };
}

function normaliseDigits(text: string, style: DecimalStyle | null): { ok: true; digits: string } | { ok: false; reason: "ambiguous" | "unreadable" } {
  // Spaces and apostrophes are only ever thousands separators — and only in
  // groups of three ("1 234,56"; never "12 34,56").
  if (/[ ']/.test(text)) {
    const wholePart = text.replace(/[.,][0-9]{1,2}$/, "");
    if (!/^[0-9]{1,3}([ '][0-9]{3})+$/.test(wholePart)) return { ok: false, reason: "unreadable" };
  }
  const compact = text.replace(/[ ']/g, "");
  if (/^[0-9]+$/.test(compact)) {
    return { ok: true, digits: compact };
  }

  const dots = (compact.match(/\./g) ?? []).length;
  const commas = (compact.match(/,/g) ?? []).length;

  // Both separators: the LAST one is the decimal mark.
  if (dots > 0 && commas > 0) {
    const decimalMark = compact.lastIndexOf(".") > compact.lastIndexOf(",") ? "." : ",";
    const thousandsMark = decimalMark === "." ? "," : ".";
    const [whole, fraction, ...rest] = compact.split(decimalMark);
    if (rest.length > 0 || !/^[0-9]{1,2}$/.test(fraction)) return { ok: false, reason: "unreadable" };
    if (!new RegExp(`^[0-9]{1,3}(\\${thousandsMark}[0-9]{3})*$`).test(whole)) return { ok: false, reason: "unreadable" };
    if (style && (decimalMark === "." ? "point" : "comma") !== style) return { ok: false, reason: "ambiguous" };
    return { ok: true, digits: `${whole.split(thousandsMark).join("")}.${fraction}` };
  }

  const mark = dots > 0 ? "." : ",";
  const count = dots + commas;
  const parts = compact.split(mark);

  if (count > 1) {
    // Repeated mark: only a thousands separator ("1.234.567" / "1,234,567").
    if (!/^[0-9]{1,3}$/.test(parts[0]) || !parts.slice(1).every((p) => /^[0-9]{3}$/.test(p))) return { ok: false, reason: "unreadable" };
    if (style && (mark === "." ? "comma" : "point") !== style) return { ok: false, reason: "ambiguous" };
    return { ok: true, digits: parts.join("") };
  }

  const [whole, fraction] = parts;
  if (!/^[0-9]+$/.test(whole) || !/^[0-9]+$/.test(fraction)) return { ok: false, reason: "unreadable" };
  // One or two digits after a single mark: a decimal ("12,5", "12.50").
  if (fraction.length <= 2) {
    if (style && (mark === "." ? "point" : "comma") !== style) return { ok: false, reason: "ambiguous" };
    return { ok: true, digits: `${whole}.${fraction}` };
  }
  // Exactly three digits after a single mark: "1,234" is one thousand two
  // hundred and thirty-four only if the statement uses a decimal POINT.
  if (fraction.length === 3 && whole.length <= 3) {
    if (style === "point" && mark === ",") return { ok: true, digits: `${whole}${fraction}` };
    if (style === "comma" && mark === ".") return { ok: true, digits: `${whole}${fraction}` };
    return { ok: false, reason: "ambiguous" };
  }
  return { ok: false, reason: "unreadable" };
}

/** The decimal style a statement uses, from its amounts that can only mean
 * one thing (a mark followed by exactly two digits at the end, or both
 * marks present). Null when there is no evidence, or conflicting evidence. */
export function inferDecimalStyle(rawAmounts: readonly string[]): DecimalStyle | null {
  let point = 0;
  let comma = 0;
  for (const raw of rawAmounts) {
    const text = raw.replace(/[\u00a0\u202f\u2009 ']/g, "").replace(/(CR|DR)\.?$/i, "").replace(/[()\-R]/gi, "");
    const both = text.includes(".") && text.includes(",");
    if (both) {
      if (text.lastIndexOf(".") > text.lastIndexOf(",")) point += 1;
      else comma += 1;
      continue;
    }
    if (/^[0-9]+\.[0-9]{2}$/.test(text)) point += 1;
    else if (/^[0-9]+,[0-9]{2}$/.test(text)) comma += 1;
  }
  if (point > 0 && comma === 0) return "point";
  if (comma > 0 && point === 0) return "comma";
  return null;
}

/** True when free text is money as statements print it: it parses (or is
 * merely ambiguous) AND carries a money signal — two decimals, CR/DR, or
 * brackets. A bare "0001042" or "2026" is a reference or a year, never an
 * amount. */
export function looksLikeMoney(text: string): boolean {
  const t = text.replace(/[\u00a0\u202f\u2009]/g, " ").trim();
  if (!/[.,][0-9]{2}\)?-?(\s*(CR|DR)\.?)?$/i.test(t) && !/\s(CR|DR)\.?$/i.test(t) && !/^\(.*\)$/.test(t)) return false;
  const r = parseStatementAmount(t, null);
  return r.ok || r.reason === "ambiguous";
}

// ---------------------------------------------------------------------
// Dates — day first, as South African statements print them.
// ---------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

export type DateResult = { ok: true; iso: string } | { ok: false; reason: "empty" | "ambiguous" | "unreadable" | "impossible" };

function iso(year: number, month: number, day: number): DateResult {
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false, reason: "impossible" };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, reason: "impossible" };
  }
  return { ok: true, iso: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

/** Two-digit years: 00–69 → 20xx, 70–99 → 19xx. */
function fullYear(year: string): number {
  const n = Number(year);
  if (year.length === 4) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

/**
 * Parses a printed date. `context` is the statement date (ISO), used ONLY to
 * give a year to a date printed without one ("31 Jan"): the latest such date
 * on or before the statement date, so a December line on a January
 * statement belongs to the previous year.
 */
export function parseStatementDate(raw: string | null | undefined, context: { statementDate?: string | null } = {}): DateResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "empty" };
  const text = String(raw).replace(/[\u00a0\u202f]/g, " ").trim().replace(/\s+/g, " ");
  if (text === "") return { ok: false, reason: "empty" };

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
  if (m) return iso(fullYear(m[3]), Number(m[2]), Number(m[1]));

  m = /^(\d{1,2})[ \-.]([A-Za-z]{3,9})\.?[ \-.,]*(\d{2}|\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return { ok: false, reason: "unreadable" };
    return iso(fullYear(m[3]), month, Number(m[1]));
  }

  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(text);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return { ok: false, reason: "unreadable" };
    return iso(Number(m[3]), month, Number(m[2]));
  }

  m = /^(\d{1,2})[ \-]([A-Za-z]{3,9})\.?$/.exec(text);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return { ok: false, reason: "unreadable" };
    const anchor = context.statementDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(context.statementDate) : null;
    if (!anchor) return { ok: false, reason: "ambiguous" };
    const [, ay, am, ad] = anchor;
    let year = Number(ay);
    if (month > Number(am) || (month === Number(am) && Number(m[1]) > Number(ad))) year -= 1;
    return iso(year, month, Number(m[1]));
  }

  return { ok: false, reason: "unreadable" };
}

/** Whether a cell looks like a date at all (before deciding what it means). */
export function looksLikeDate(text: string): boolean {
  const t = text.trim();
  return (
    /^\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(t) ||
    /^\d{1,2}[ \-.][A-Za-z]{3,9}\.?([ \-.,]*\d{2,4})?$/.test(t) ||
    /^[A-Za-z]{3,9}\.? \d{1,2},? \d{4}$/.test(t)
  );
}

/** Money in integer cents, for exact arithmetic. */
export function toCents(value: number): number {
  return Math.round(value * 100);
}
