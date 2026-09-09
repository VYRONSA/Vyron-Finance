/**
 * Master Implementation Tracker — Programme 2, Root Cause RC-13. The
 * one shared, currency-aware money formatter — no such thing existed
 * anywhere in `src/lib` before this (57 components each had their own
 * local `money()`, almost all hardcoding the Rand symbol regardless of
 * the actual account/company currency — see the RC-13 investigation
 * notes). Retrofitting all 57 call sites is out of RC-13's own named
 * scope (#083/#143/#018/#081); this utility + those four findings'
 * call sites is what's actually in scope here.
 *
 * Symbols mirror `supabase/migrations/0006_company_management.sql`'s
 * `currencies` seed data — keep the two in sync if a currency is added.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  ZAR: "R",
  USD: "$",
  GBP: "£",
  EUR: "€",
  AUD: "A$",
  CAD: "C$",
  CHF: "CHF",
  JPY: "¥",
  CNY: "¥",
  INR: "₹",
};

/** Falls back to the currency code itself (e.g. "XYZ 100.00") for a
 * code not in the known set — never a wrong symbol, never a silent
 * Rand default. */
export function formatMoney(value: number, currencyCode: string): string {
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? currencyCode;
  return `${symbol} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
