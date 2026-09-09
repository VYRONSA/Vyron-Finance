/**
 * Phase 21B — pure identifier/address construction logic for the
 * inbound Bank Statement Email identity foundation. No Supabase, no
 * network — kept testable without a database, matching this codebase's
 * established "pure engine" convention (e.g. document-engine.ts,
 * branding-engine.ts).
 */

import { randomBytes } from "node:crypto";

const MAX_SLUG_LENGTH = 40;
const SUFFIX_LENGTH = 4;
const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MAX_IDENTIFIER_LENGTH = 64;
const IDENTIFIER_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Pure — normalizes a company name into a lowercase, hyphenated,
 * email-local-part-safe slug. Deliberately NOT the stable identifier
 * itself (see `generateStableIdentifierCandidate`) — a slug alone is
 * never stored or used as a lookup key, since a company rename must
 * never change what's already stored. */
export function slugifyCompanyName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents/diacritics (combining marks left behind by NFKD normalization)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, ""); // trim a hyphen the length cut may have left dangling
  return slug || "company";
}

/** Pure — a short, lowercase, alphanumeric random suffix (e.g. "a7k3"),
 * generated via Node's `crypto.randomBytes` — the same primitive
 * `bank-connectivity-service.ts::generateState()` already uses
 * elsewhere in this codebase for a different unguessable-token need. */
export function generateRandomSuffix(): string {
  const bytes = randomBytes(SUFFIX_LENGTH);
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += SUFFIX_ALPHABET[bytes[i]! % SUFFIX_ALPHABET.length];
  return suffix;
}

/** Pure — a single candidate stable identifier: `{slug}-{randomSuffix}`.
 * Always includes the random suffix (never just the bare slug) so two
 * companies with the same/similar name don't need a collision to be
 * detected before they already look distinct. The caller
 * (`ensureCompanyBankStatementEmail`) is responsible for checking this
 * candidate against the database's real uniqueness constraint and
 * retrying with a fresh candidate on the rare collision — this function
 * only ever produces one candidate, it never checks storage. */
export function generateStableIdentifierCandidate(companyName: string): string {
  const candidate = `${slugifyCompanyName(companyName)}-${generateRandomSuffix()}`;
  if (!isValidStableIdentifier(candidate)) {
    // Defensive only — slugifyCompanyName's own output rules make this
    // unreachable in practice, but a generator must never silently hand
    // back a value it wouldn't itself accept as valid.
    throw new Error(`Generated an invalid stable identifier candidate: "${candidate}".`);
  }
  return candidate;
}

/** Pure — the same shape rule the migration's own database constraint
 * expects: lowercase alphanumeric, hyphens only in the middle, no
 * leading/trailing hyphen, no space, no character that could break an
 * email local-part or a URL path segment. */
export function isValidStableIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && IDENTIFIER_PATTERN.test(value);
}

export class BankStatementEmailConfigurationError extends Error {}

/** Pure — constructs the full inbound address from a stored identifier
 * plus the configured domain. Never hard-codes a domain (Phase 21A
 * confirmed no production domain/DNS exists yet) — fails honestly,
 * never fabricates a placeholder address, matching this codebase's
 * `NoOpEmailSender` precedent for "the real capability isn't configured
 * yet, say so." */
export function buildBankStatementEmailAddress(stableIdentifier: string): string {
  const domain = process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;
  if (!domain) {
    throw new BankStatementEmailConfigurationError(
      "VYRON_BANK_IMPORT_EMAIL_DOMAIN is not configured — no bank statement email address can be shown yet.",
    );
  }
  return `${stableIdentifier}.bank@${domain}`;
}
