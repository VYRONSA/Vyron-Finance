/**
 * Phase 21C — pure recipient -> stable identifier extraction. This is
 * the ENTIRE tenant boundary for inbound email: the recipient address
 * is the only thing ever used to determine which company an email
 * belongs to — never the sender, the email body, the attachment
 * filename, or any bank/company name mentioned anywhere in the message.
 */

import { isValidStableIdentifier } from "@/server/company-bank-statement-email/identifier-engine";

/** Pure — the inverse of `buildBankStatementEmailAddress()`. Returns
 * the stable identifier only when the address is shaped exactly like
 * `{identifier}.bank@{configuredDomain}` for THIS environment's
 * configured domain — a recipient on any other domain (including a
 * lookalike) is not ours and returns `null`. Case-insensitive, since
 * email addresses are. */
export function extractStableIdentifierFromRecipient(recipientAddress: string): string | null {
  const domain = process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;
  if (!domain) return null;

  const expectedSuffix = `.bank@${domain}`.toLowerCase();
  const normalized = recipientAddress.trim().toLowerCase();
  if (!normalized.endsWith(expectedSuffix)) return null;

  const candidate = normalized.slice(0, -expectedSuffix.length);
  return isValidStableIdentifier(candidate) ? candidate : null;
}

/** Pure — an inbound email can technically be addressed to multiple
 * recipients (`to`/`cc`/`bcc`); this returns the first one that's
 * genuinely one of ours. Order is deterministic (the order the caller
 * provides), not something this function chooses on its own. */
export function findStableIdentifierAmongRecipients(recipients: string[]): string | null {
  for (const recipient of recipients) {
    const identifier = extractStableIdentifierFromRecipient(recipient);
    if (identifier) return identifier;
  }
  return null;
}

/** Phase 21K — server-generated routing headers, checked in this
 * priority order, ahead of the sender-controlled `To:`/`Cc:` content
 * headers below. `X-Original-To`/`Delivered-To` are added by Postfix's
 * own delivery agent from the actual SMTP envelope/alias-expansion it
 * performed — never sender-controlled, unlike `To:`/`Cc:` (which a
 * sufficiently deliberate sender could in principle spoof). This is the
 * correct signal for a Virtualmin/Postfix-routed message; a provider
 * that never supplies these (Resend today) simply has no matching key,
 * so this degrades to exactly today's `To:`/`Cc:`-only behavior with the
 * same header-Map lookup cost, not a behavior change. */
const ROUTING_HEADER_PRIORITY = ["x-original-to", "delivered-to"];

function findStableIdentifierFromRoutingHeaders(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null;
  for (const headerName of ROUTING_HEADER_PRIORITY) {
    const value = headers[headerName];
    if (!value) continue;
    const identifier = extractStableIdentifierFromRecipient(value);
    if (identifier) return identifier;
  }
  return null;
}

/** Phase 21K — the entry point `processInboundEmailMessage()` now calls,
 * replacing its previous direct `findStableIdentifierAmongRecipients(message.to)`
 * call. Two additive changes over that prior behavior, both strictly
 * widening (never narrowing) which genuine messages resolve correctly:
 * (1) a trusted routing header, when present, is checked BEFORE `To:`/`Cc:`;
 * (2) `Cc:` is now actually included in the content-header fallback check
 * (the recipient-resolution module's own docstring already described
 * `To:`/`Cc:`/`Bcc:` as "technically" checked, but the call site only
 * ever passed `to` — this was a real, if narrow, pre-existing gap,
 * closed here as the smallest correct fix rather than left in place). A
 * message that resolved correctly before this change still resolves
 * identically now; nothing that used to match stops matching. */
export function resolveStableIdentifierForMessage(message: { to: string[]; cc: string[]; headers?: Record<string, string> }): string | null {
  return findStableIdentifierFromRoutingHeaders(message.headers) ?? findStableIdentifierAmongRecipients([...message.to, ...message.cc]);
}
