import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 21D — the ONE explicit, opt-in mechanism that lets EXISTING,
 * UNMODIFIED session-scoped code (`import-service.ts`,
 * `rule-processing-service.ts`, `posting-engine-service.ts`,
 * `notification-service.ts`, `operations-service.ts`, and everything
 * they call) run correctly under a service-role client instead, for the
 * one legitimate case that needs it: a verified server-to-server
 * webhook (the Resend inbound bank-statement pipeline) with no browser
 * session to authorize against RLS.
 *
 * WHY this shape, not a `client?` parameter threaded through every
 * function: the real call graph from `importBankStatement`/
 * `confirmPdfBankStatementImport` fans out through
 * `applyRulesToTransactions` into Banking Rules, Matching, Banking
 * Exceptions, journal creation, and the Posting Engine — dozens of
 * functions across 8+ repository files this ticket explicitly says not
 * to touch ("keep the change small," "do not touch unrelated...").
 * Threading a new parameter through that entire existing, working,
 * already-tested accounting call graph would be a far LARGER and
 * riskier change than this one. This file is the "equivalent small
 * execution-context abstraction" the brief explicitly allows for.
 *
 * SAFETY — what this does NOT do:
 *   - It does NOT change what `createClient()` returns for any existing
 *     caller. Zero context active (the state for every normal browser
 *     request, every existing test, every existing route) means
 *     `createClient()` behaves byte-for-byte as it did before this file
 *     existed.
 *   - Nothing enters this context implicitly. It is entered in exactly
 *     ONE place in the entire codebase:
 *     `inbound-bank-statement-email-service.ts`, wrapping only the
 *     specific pipeline calls that need it.
 *   - `AsyncLocalStorage` is Node's own request/call-scoped context
 *     primitive (the same mechanism Next.js itself uses internally for
 *     `cookies()`/`headers()`) — it cannot leak into a concurrent,
 *     unrelated request's async chain by construction.
 *   - This file never constructs a service-role client itself — it only
 *     carries whatever client its one caller explicitly provides (see
 *     `@/lib/supabase/admin.ts::createAdminClient`).
 */

const executionContextStorage = new AsyncLocalStorage<SupabaseClient>();

/** Runs `fn` with `client` available to every `createClient()` call made
 * during it (directly or transitively) — and ONLY during it. */
export function runWithServerExecutionContext<T>(client: SupabaseClient, fn: () => Promise<T>): Promise<T> {
  return executionContextStorage.run(client, fn);
}

/** `undefined` outside of `runWithServerExecutionContext` — which is the
 * case for every normal request. `@/lib/supabase/server.ts::createClient()`
 * is the one caller that checks this. */
export function getServerExecutionContextClient(): SupabaseClient | undefined {
  return executionContextStorage.getStore();
}
