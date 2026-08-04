/**
 * Self-contained parsing helpers for the Import Centre — ported from
 * `import_centre/utils.py` / `bank_import/utils.py` (identical in both
 * reference packages for the CSV-only path; Excel-serial-date handling is
 * intentionally omitted here since .xlsx import is out of scope for this
 * module — see docs/MIGRATION_ROADMAP.md).
 */

const DATE_PATTERNS: Array<{ regex: RegExp; order: "ymd" | "dmy" | "mdy" }> = [
  { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: "ymd" },
  { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: "ymd" },
  { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: "dmy" },
  { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: "dmy" },
  { regex: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, order: "dmy" },
];

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

// dd/MM/yyyy is tried before MM/dd/yyyy, matching Xero's default (non-US)
// export convention — see _DATE_FORMATS ordering in the reference.
const SLASH_OR_DASH_MDY: Array<{ regex: RegExp }> = [
  { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/ },
  { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/ },
];

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse a CSV date cell into an ISO (yyyy-mm-dd) string, trying formats
 * in the same order as the reference implementation's `_DATE_FORMATS`. */
export function parseDate(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;

  for (const { regex, order } of DATE_PATTERNS) {
    const match = regex.exec(text);
    if (!match) continue;
    const [, a, b, c] = match;
    const [year, month, day] =
      order === "ymd" ? [Number(a), Number(b), Number(c)] : [Number(c), Number(b), Number(a)];
    const iso = toIsoDate(year, month, day);
    if (iso) return iso;
  }

  const spaced = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(text);
  if (spaced) {
    const [, dayStr, monthName, yearStr] = spaced;
    const month = MONTH_NAMES[monthName.toLowerCase()];
    if (month) {
      const iso = toIsoDate(Number(yearStr), month, Number(dayStr));
      if (iso) return iso;
    }
  }

  for (const { regex } of SLASH_OR_DASH_MDY) {
    const match = regex.exec(text);
    if (!match) continue;
    const [, monthStr, dayStr, yearStr] = match;
    const iso = toIsoDate(Number(yearStr), Number(monthStr), Number(dayStr));
    if (iso) return iso;
  }

  return null;
}

const AMOUNT_JUNK_RE = /[^\d.-]/g;

/** Strip currency symbols/thousands separators; parenthesised values are
 * negative (common for credit balances in exported reports). */
export function parseAmount(value: string | null | undefined): number | null {
  if (value == null) return null;
  let text = String(value).trim();
  if (!text) return null;

  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text.replace(/,/g, "").replace(/\s/g, "");
  text = text.replace(AMOUNT_JUNK_RE, "");
  if (text === "" || text === "-" || text === "." || text === "-.") return null;

  const amount = Number(text);
  if (Number.isNaN(amount)) return null;
  return negative ? -amount : amount;
}

export function cleanText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** RFC4180-ish CSV tokenizer — handles quoted fields with embedded commas,
 * newlines, and doubled-quote escaping. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\r") {
      continue;
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Decode an uploaded file's bytes into text, tolerating a UTF-8 BOM
 * (common in Xero exports) and falling back to legacy Windows/Excel
 * encodings, matching the reference's `utf-8-sig` -> `cp1252` -> `latin-1`
 * fallback chain. */
export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const attempts: Array<{ label: string; fatal: boolean }> = [
    { label: "utf-8", fatal: true },
    { label: "windows-1252", fatal: false },
    { label: "iso-8859-1", fatal: false },
  ];

  for (const { label, fatal } of attempts) {
    try {
      const decoder = new TextDecoder(label, { fatal });
      let text = decoder.decode(buffer);
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      return text;
    } catch {
      continue;
    }
  }

  throw new Error("Could not decode file with any supported encoding.");
}

export function isBlankRow(rawRow: string[]): boolean {
  return rawRow.every((cell) => !cleanText(cell));
}

export function normalizeHeader(text: string): string {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
}
