/**
 * SD-3F — the supplier-statement AI boundary. LIVE AI IS OFF.
 *
 * WHAT A PROVIDER MAY DO: transcribe what is printed on a scanned statement
 * (PDF, JPEG or PNG) into `StatementTranscription` — every amount, date and
 * reference as the TEXT printed on the page. It is never asked for a
 * number: the deterministic reader's own parsers turn the text into values,
 * so the provider has no way to calculate, round, total or "fix" anything,
 * and an amount it cannot read is simply unread.
 *
 * WHAT IT MAY NEVER DO: calculate balances or totals, decide signs, invent
 * lines, choose or confirm a supplier, match, reconcile, or touch an
 * accounting record. None of those are representable in its output.
 *
 * The output is UNTRUSTED EVIDENCE. It goes through the same validation as
 * any other statement, and a person must confirm the supplier and the
 * statement must add up before it can be marked ready.
 *
 * THE SWITCH (same rule as invoice extraction, separate switch):
 *   VYRON_AI_STATEMENT_EXTRACTION absent / anything else → unavailable
 *   = "certification" without AI_GATEWAY_API_KEY          → unavailable
 *   = "certification" with a key                          → gateway
 * The gateway provider checks the key again before any network activity.
 *
 * DISTINCTION (owner decision, SD-3A §16.1): scanned SUPPLIER STATEMENTS go
 * to manual entry while this is off — a temporary state, not the design:
 * this boundary is how they become automatic. Scanned supplier INVOICES are
 * a separate, already automatic-eligible workflow
 * (`supplier-invoice-capture/extraction-provider.ts`); neither is manual-only
 * by design.
 */
import type { ExtractionErrorCategory, ProviderUsage } from "@/server/supplier-invoice-capture/types";

export const STATEMENT_AI_SWITCH_ENV_VAR = "VYRON_AI_STATEMENT_EXTRACTION";
export const STATEMENT_AI_SWITCH_ON_VALUE = "certification";
export const STATEMENT_AI_API_KEY_ENV_VAR = "AI_GATEWAY_API_KEY";
export const STATEMENT_AI_SCOPE = "supplier-statement-extraction";

/** One printed row, as TEXT. Nothing here is a number. */
export type TranscribedRow = {
  page: number | null;
  dateText: string | null;
  referenceText: string | null;
  description: string | null;
  /** A type code or word only if printed (INV, CN, PMT …). */
  typeText: string | null;
  debitText: string | null;
  creditText: string | null;
  /** For statements with a single amount column (signs as printed: CR, -, brackets). */
  amountText: string | null;
  balanceText: string | null;
  /** The whole row as it reads on the page. */
  rowText: string;
};

export type StatementTranscription = {
  supplierName: string | null;
  supplierVatNumber: string | null;
  supplierRegistrationNumber: string | null;
  accountNumber: string | null;
  statementDateText: string | null;
  periodText: string | null;
  currencyText: string | null;
  openingBalanceText: string | null;
  closingBalanceText: string | null;
  rows: TranscribedRow[];
  /** How many TRANSACTION rows the page shows, counted before transcribing
   * (checked against what was transcribed — a truncated read is caught). */
  declaredTransactionRows: number | null;
  warnings: string[];
};

export type StatementDocument = { bytes: Uint8Array; mimeType: "application/pdf" | "image/jpeg" | "image/png"; pageCount: number | null };

export type StatementProviderResult =
  | { ok: true; transcription: StatementTranscription; model: string; usage: ProviderUsage | null }
  | { ok: false; category: ExtractionErrorCategory; httpStatus: number | null; message: string; model: string | null };

export interface StatementExtractionProvider {
  readonly name: "unavailable" | "gateway" | "test";
  /** Never throws for a provider failure: failures are typed results. */
  transcribe(document: StatementDocument): Promise<StatementProviderResult>;
}

/** The default. Reads nothing, sends nothing, and says so. */
export class UnavailableStatementProvider implements StatementExtractionProvider {
  readonly name = "unavailable" as const;
  async transcribe(): Promise<StatementProviderResult> {
    return { ok: false, category: "missing-api-key", httpStatus: null, message: "Automatic reading of scanned statements is not switched on.", model: null };
  }
}

export type StatementProviderDecision = { provider: "unavailable" | "gateway"; switchOn: boolean; credentialPresent: boolean; reason: string };

type Env = Record<string, string | undefined>;

export function decideStatementProvider(env: Env = process.env): StatementProviderDecision {
  const switchOn = env[STATEMENT_AI_SWITCH_ENV_VAR]?.trim().toLowerCase() === STATEMENT_AI_SWITCH_ON_VALUE;
  const credentialPresent = Boolean(env[STATEMENT_AI_API_KEY_ENV_VAR]?.trim());
  if (!switchOn) {
    return {
      provider: "unavailable",
      switchOn: false,
      credentialPresent,
      reason: "Automatic reading of scanned statements is switched off. Enter this statement by hand from the original.",
    };
  }
  if (!credentialPresent) {
    return {
      provider: "unavailable",
      switchOn: true,
      credentialPresent: false,
      reason: `The statement certification switch is on, but ${STATEMENT_AI_API_KEY_ENV_VAR} is not configured; no request can be made. Enter this statement by hand.`,
    };
  }
  return { provider: "gateway", switchOn: true, credentialPresent: true, reason: "Scanned statements are read under the certification switch." };
}

/** Builds the selected provider; the gateway module is loaded only when the
 * switch is deliberately on, so the default path never imports a provider SDK. */
export async function selectStatementProvider(env: Env = process.env): Promise<StatementExtractionProvider> {
  if (decideStatementProvider(env).provider === "unavailable") return new UnavailableStatementProvider();
  const { createGatewayStatementProvider } = await import("./gateway-statement-provider");
  return createGatewayStatementProvider();
}

// ---------------------------------------------------------------------
// The instruction and the structural check of an answer.
// ---------------------------------------------------------------------

export const STATEMENT_TRANSCRIPTION_INSTRUCTION = [
  "You are reading a supplier's statement of account. COPY what is printed; never calculate.",
  "Every amount, date and reference must be the exact text printed on the page — including spaces, commas, decimal marks, leading zeros, 'CR'/'DR', minus signs and brackets.",
  "Never compute, total, round, convert or re-sign a value. Never fill in a value that is not printed: use null.",
  "If a value is unclear, copy what you can see into rowText and set that field to null. Do not guess.",
  "List every transaction row in the order printed, including brought-forward, carried-forward, totals and closing-balance rows (they are identified later).",
  "Count the transaction rows on the statement BEFORE transcribing and report that count as declaredTransactionRows.",
  "Do not decide who the supplier is: copy the name, VAT number, registration number and the customer account number exactly as printed.",
].join("\n");

const str = (v: unknown): string | null => (typeof v === "string" ? v : v === null || v === undefined ? null : null);

/** Accepts an answer only if it has the exact shape, with TEXT (never
 * numbers) for every value. Anything else is a malformed response. */
export function parseStatementTranscription(value: unknown): StatementTranscription | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const textOrNull = (x: unknown) => x === null || typeof x === "string";
  for (const key of ["supplierName", "supplierVatNumber", "supplierRegistrationNumber", "accountNumber", "statementDateText", "periodText", "currencyText", "openingBalanceText", "closingBalanceText"]) {
    if (!textOrNull(v[key])) return null;
  }
  if (!Array.isArray(v.rows) || !Array.isArray(v.warnings)) return null;
  if (!(v.declaredTransactionRows === null || (Number.isInteger(v.declaredTransactionRows) && (v.declaredTransactionRows as number) >= 0))) return null;
  const rows: TranscribedRow[] = [];
  for (const r of v.rows) {
    if (!r || typeof r !== "object") return null;
    const row = r as Record<string, unknown>;
    for (const key of ["dateText", "referenceText", "description", "typeText", "debitText", "creditText", "amountText", "balanceText"]) {
      if (!textOrNull(row[key])) return null; // a NUMBER here is refused: values are text only
    }
    if (typeof row.rowText !== "string") return null;
    if (!(row.page === null || (Number.isInteger(row.page) && (row.page as number) >= 1 && (row.page as number) <= 60))) return null;
    rows.push({
      page: row.page as number | null,
      dateText: str(row.dateText),
      referenceText: str(row.referenceText),
      description: str(row.description),
      typeText: str(row.typeText),
      debitText: str(row.debitText),
      creditText: str(row.creditText),
      amountText: str(row.amountText),
      balanceText: str(row.balanceText),
      rowText: row.rowText as string,
    });
  }
  return {
    supplierName: str(v.supplierName),
    supplierVatNumber: str(v.supplierVatNumber),
    supplierRegistrationNumber: str(v.supplierRegistrationNumber),
    accountNumber: str(v.accountNumber),
    statementDateText: str(v.statementDateText),
    periodText: str(v.periodText),
    currencyText: str(v.currencyText),
    openingBalanceText: str(v.openingBalanceText),
    closingBalanceText: str(v.closingBalanceText),
    rows,
    declaredTransactionRows: v.declaredTransactionRows as number | null,
    warnings: (v.warnings as unknown[]).filter((w): w is string => typeof w === "string").slice(0, 50),
  };
}
