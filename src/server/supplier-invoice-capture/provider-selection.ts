/**
 * Phase 5N — the certification switch.
 *
 * ONE place decides which extraction provider runs, and it defaults to the
 * one that extracts nothing.
 *
 * Phase 5M left the Gateway adapter written but unreachable: nothing
 * selected it, so "is it wired in?" was answered by reading imports. That
 * is not a control. This module is the control — a single named switch,
 * off unless deliberately set, with the selection rule stated in one
 * readable function and asserted by tests.
 *
 * THE RULE
 *
 *   switch absent / any other value  → UnavailableExtractionProvider
 *   switch = "certification", no key → UnavailableExtractionProvider
 *   switch = "certification" + key   → GatewayExtractionProvider
 *
 * WHY THE VALUE IS A WORD AND NOT A BOOLEAN
 *
 * `"1"`, `"true"`, `"on"` and `"yes"` are all things that end up in an
 * environment by accident — copied from another service, set by a
 * platform default, inherited from a template. `"certification"` is not a
 * value anyone sets by accident, and reading it in a deployment's
 * environment tells you immediately that someone meant it. Every other
 * value, including the truthy ones, is OFF.
 *
 * WHY A CREDENTIAL IS NOT ENOUGH ON ITS OWN
 *
 * The brief is explicit: the Gateway provider must NOT become the default
 * merely because `AI_GATEWAY_API_KEY` exists. Production has a credential.
 * Production has never set this switch, and until an owner sets it,
 * production keeps capturing documents for a human to type — a working
 * product, and the fail-closed one.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 *  - It does not read a `.env` file. It reads the process environment it
 *    is handed. Nothing here can reach `web/.env.local`.
 *  - It does not fall back. An unavailable or failing provider is not a
 *    reason to try a different one; there IS no different one. A second
 *    provider architecture is how a safety layer gets routed around.
 *  - It does not log, return or interpolate the credential. It asks one
 *    question of it — is there one — and never handles its value.
 */

import {
  UnavailableExtractionProvider,
  type ExtractionProvider,
} from "./extraction-provider";

/** The switch. Named for what it is for, so it reads correctly in a
 * deployment's environment list. */
export const EXTRACTION_SWITCH_ENV_VAR = "VYRON_AI_INVOICE_EXTRACTION";

/** The only value that turns it on. */
export const EXTRACTION_SWITCH_ON_VALUE = "certification";

/** The credential the Gateway SDK itself reads. Named here only so the
 * selection rule can ask whether it is present. */
export const EXTRACTION_API_KEY_ENV_VAR = "AI_GATEWAY_API_KEY";

export type ExtractionProviderSelection = {
  /** Which implementation a caller will get. */
  provider: "unavailable" | "gateway";
  /** Why — an operator-facing sentence, safe to log and safe to show. It
   * never contains the credential, because it never sees it. */
  reason: string;
  /** True only when the switch was deliberately set to the ON value. */
  switchOn: boolean;
  /** True when a credential is present. Presence only — never its value,
   * never a prefix, never a length. */
  credentialPresent: boolean;
};

type Env = Record<string, string | undefined>;

/**
 * The selection rule, as a pure function of the environment.
 *
 * Pure and exported so the decision can be tested exhaustively and read in
 * a review without running anything — the same reason `assessConversion`
 * is pure.
 */
export function decideExtractionProvider(env: Env = process.env): ExtractionProviderSelection {
  const raw = env[EXTRACTION_SWITCH_ENV_VAR];
  // Trimmed and lower-cased, so "Certification " is honoured; anything
  // that is not that word is not.
  const switchOn = raw?.trim().toLowerCase() === EXTRACTION_SWITCH_ON_VALUE;
  const credentialPresent = Boolean(env[EXTRACTION_API_KEY_ENV_VAR]?.trim());

  if (!switchOn) {
    return {
      provider: "unavailable",
      switchOn: false,
      credentialPresent,
      reason:
        `AI invoice extraction is off. Documents are captured for a person to enter. ` +
        `To run certification, set ${EXTRACTION_SWITCH_ENV_VAR}=${EXTRACTION_SWITCH_ON_VALUE} in a non-production environment.`,
    };
  }

  if (!credentialPresent) {
    // Fail closed, and say which of the two conditions is missing — an
    // operator who has set the switch and sees "off" with no reason will
    // go looking for the wrong thing.
    return {
      provider: "unavailable",
      switchOn: true,
      credentialPresent: false,
      reason: `The certification switch is on, but ${EXTRACTION_API_KEY_ENV_VAR} is not configured. No provider request can be made.`,
    };
  }

  return {
    provider: "gateway",
    switchOn: true,
    credentialPresent: true,
    reason: "AI invoice extraction is running against the AI Gateway under the certification switch.",
  };
}

/**
 * Builds the selected provider.
 *
 * The Gateway module is imported lazily, so a process that never turns the
 * switch on never loads it — the same discipline
 * `getDefaultTransactionClassificationProvider()` uses, and what keeps
 * importing this file free of any provider SDK.
 */
export async function selectExtractionProvider(env: Env = process.env): Promise<ExtractionProvider> {
  const decision = decideExtractionProvider(env);
  if (decision.provider === "unavailable") return new UnavailableExtractionProvider();

  const { createGatewayExtractionProvider } = await import("./gateway-extraction-provider");
  return createGatewayExtractionProvider();
}
