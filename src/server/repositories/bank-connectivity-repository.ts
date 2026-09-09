/**
 * Repository layer for Phase 16 Direct Bank Connectivity — the only
 * layer allowed to speak Supabase for `bank_oauth_states`,
 * `bank_connections`, `bank_connection_accounts`, `bank_sync_runs`
 * (see supabase/migrations/0075_bank_connectivity.sql). Row Level
 * Security enforces company isolation on every table except
 * `bank_oauth_states` (see that migration's own comment for why); every
 * query here still filters by `company_id` explicitly where the table
 * has one, matching this codebase's established defense-in-depth
 * convention (bank-account-repository.ts's own header).
 */

import { createClient } from "@/lib/supabase/server";
import type { BankConnection, BankConnectionAccount, BankConnectionAccountStatus, BankConnectionStatus, BankEnvironment, BankProviderName, BankSyncRun, BankSyncStatus, BankSyncType } from "@/server/bank-connectivity/types";

// ---------------------------------------------------------------------
// bank_oauth_states
// ---------------------------------------------------------------------

export type OAuthStateRow = {
  state: string;
  company_id: string;
  provider: string;
  bank_connection_id: number;
  redirect_after: string | null;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

export async function createOAuthState(state: string, companyId: string, provider: BankProviderName, bankConnectionId: number, expiresAt: string, redirectAfter: string | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("bank_oauth_states").insert({ state, company_id: companyId, provider, bank_connection_id: bankConnectionId, expires_at: expiresAt, redirect_after: redirectAfter });
  if (error) throw error;
}

/** Single-use: this both reads and immediately marks the state row
 * consumed (an atomic-enough sequence for this purpose — the row is
 * only ever meant to be read once, by the one legitimate callback
 * request holding the exact random value FNB echoed back). Returns
 * `null` for a missing, already-consumed, or expired state — the
 * caller treats all three identically (reject the callback). */
export async function consumeOAuthState(state: string, nowIso: string): Promise<OAuthStateRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_oauth_states").select("*").eq("state", state).maybeSingle<OAuthStateRow>();
  if (error) throw error;
  if (!data) return null;
  if (data.consumed_at) return null;
  if (data.expires_at < nowIso) return null;

  const { error: updateError } = await supabase.from("bank_oauth_states").update({ consumed_at: nowIso }).eq("state", state);
  if (updateError) throw updateError;
  return data;
}

// ---------------------------------------------------------------------
// bank_connections
// ---------------------------------------------------------------------

type BankConnectionRow = {
  id: number;
  company_id: string;
  provider: string;
  environment: string;
  status: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  granted_scope: string | null;
  last_health_check_at: string | null;
  last_health_check_status: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
  disconnected_at: string | null;
};

function bankConnectionFromRow(row: BankConnectionRow): BankConnection {
  return {
    id: row.id,
    companyId: row.company_id,
    provider: row.provider as BankProviderName,
    environment: row.environment as BankEnvironment,
    status: row.status as BankConnectionStatus,
    grantedScope: row.granted_scope,
    tokenExpiresAt: row.token_expires_at,
    lastHealthCheckAt: row.last_health_check_at,
    lastHealthCheckStatus: row.last_health_check_status as BankConnection["lastHealthCheckStatus"],
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    disconnectedAt: row.disconnected_at,
  };
}

/** Tokens are ALWAYS the already-encrypted envelope
 * (`token-encryption.ts::encryptToken`'s output) — this repository
 * never sees or writes plaintext. */
export type CreatePendingBankConnectionInput = { provider: BankProviderName; environment: BankEnvironment };

export async function createPendingBankConnection(companyId: string, input: CreatePendingBankConnectionInput): Promise<BankConnection> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_connections")
    .insert({ company_id: companyId, provider: input.provider, environment: input.environment, status: "PendingAuthorization" })
    .select("*")
    .single<BankConnectionRow>();
  if (error) throw error;
  return bankConnectionFromRow(data);
}

export type AuthorizeBankConnectionInput = {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  tokenExpiresAt: string;
  grantedScope: string | null;
};

export async function markBankConnectionAuthorized(companyId: string, connectionId: number, input: AuthorizeBankConnectionInput): Promise<BankConnection> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_connections")
    .update({
      status: "Connected",
      access_token_encrypted: input.accessTokenEncrypted,
      refresh_token_encrypted: input.refreshTokenEncrypted,
      token_expires_at: input.tokenExpiresAt,
      granted_scope: input.grantedScope,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("id", connectionId)
    .select("*")
    .single<BankConnectionRow>();
  if (error) throw error;
  return bankConnectionFromRow(data);
}

export async function updateBankConnectionTokens(companyId: string, connectionId: number, input: AuthorizeBankConnectionInput): Promise<BankConnection> {
  return markBankConnectionAuthorized(companyId, connectionId, input);
}

export async function recordBankConnectionHealthCheck(companyId: string, connectionId: number, status: "Ok" | "Error", errorMessage: string | null, nowIso: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_connections")
    .update({ last_health_check_at: nowIso, last_health_check_status: status, last_error_message: errorMessage, updated_at: nowIso })
    .eq("company_id", companyId)
    .eq("id", connectionId);
  if (error) throw error;
}

export async function markBankConnectionError(companyId: string, connectionId: number, message: string, nowIso: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("bank_connections").update({ status: "Error", last_error_message: message, updated_at: nowIso }).eq("company_id", companyId).eq("id", connectionId);
  if (error) throw error;
}

export async function disconnectBankConnection(companyId: string, connectionId: number, nowIso: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_connections")
    .update({ status: "Disconnected", access_token_encrypted: null, refresh_token_encrypted: null, disconnected_at: nowIso, updated_at: nowIso })
    .eq("company_id", companyId)
    .eq("id", connectionId);
  if (error) throw error;
}

export async function listBankConnections(companyId: string): Promise<BankConnection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_connections").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).returns<BankConnectionRow[]>();
  if (error) throw error;
  return data.map(bankConnectionFromRow);
}

export async function getBankConnection(companyId: string, connectionId: number): Promise<BankConnection | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_connections").select("*").eq("company_id", companyId).eq("id", connectionId).maybeSingle<BankConnectionRow>();
  if (error) throw error;
  return data ? bankConnectionFromRow(data) : null;
}

/** All Connected connections across every company — the recurring-sync
 * task reads this without a companyId filter... except it always runs
 * PER company already (the scheduler's `runDueTasks(companyId, ...)`
 * loop), so this stays company-scoped for consistency with every other
 * repository query in this codebase; see bank-sync-service.ts. */
/** The only two reads that return a raw encrypted token column — kept
 * narrow and separate from `bankConnectionFromRow`'s own `BankConnection`
 * shape specifically so nothing outside `bank-connectivity-service.ts`
 * (the only caller) can accidentally forward a token into an API
 * response (brief, Part 25: "tokens never appear in client responses"). */
export async function getAccessTokenEncrypted(companyId: string, connectionId: number): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_connections").select("access_token_encrypted").eq("company_id", companyId).eq("id", connectionId).maybeSingle<{ access_token_encrypted: string | null }>();
  if (error) throw error;
  return data?.access_token_encrypted ?? null;
}

export async function getRefreshTokenEncrypted(companyId: string, connectionId: number): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_connections").select("refresh_token_encrypted").eq("company_id", companyId).eq("id", connectionId).maybeSingle<{ refresh_token_encrypted: string | null }>();
  if (error) throw error;
  return data?.refresh_token_encrypted ?? null;
}

export async function listConnectedBankConnections(companyId: string): Promise<BankConnection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_connections").select("*").eq("company_id", companyId).eq("status", "Connected").returns<BankConnectionRow[]>();
  if (error) throw error;
  return data.map(bankConnectionFromRow);
}

// ---------------------------------------------------------------------
// bank_connection_accounts
// ---------------------------------------------------------------------

type BankConnectionAccountRow = {
  id: number;
  company_id: string;
  bank_connection_id: number;
  bank_account_id: number;
  provider_account_id: string;
  masked_account_number: string;
  account_holder_name: string;
  currency: string;
  status: string;
  last_synced_through: string | null;
  last_sync_status: string | null;
  last_sync_at: string | null;
  last_transaction_received_at: string | null;
  created_at: string;
};

function bankConnectionAccountFromRow(row: BankConnectionAccountRow): BankConnectionAccount {
  return {
    id: row.id,
    companyId: row.company_id,
    bankConnectionId: row.bank_connection_id,
    bankAccountId: row.bank_account_id,
    providerAccountId: row.provider_account_id,
    maskedAccountNumber: row.masked_account_number,
    accountHolderName: row.account_holder_name,
    currency: row.currency,
    status: row.status as BankConnectionAccountStatus,
    lastSyncedThrough: row.last_synced_through,
    lastSyncStatus: row.last_sync_status as BankConnectionAccount["lastSyncStatus"],
    lastSyncAt: row.last_sync_at,
    lastTransactionReceivedAt: row.last_transaction_received_at,
    createdAt: row.created_at,
  };
}

export type LinkBankConnectionAccountInput = {
  bankConnectionId: number;
  bankAccountId: number;
  providerAccountId: string;
  maskedAccountNumber: string;
  accountHolderName: string;
  currency: string;
};

export async function linkBankConnectionAccount(companyId: string, input: LinkBankConnectionAccountInput): Promise<BankConnectionAccount> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_connection_accounts")
    .insert({
      company_id: companyId,
      bank_connection_id: input.bankConnectionId,
      bank_account_id: input.bankAccountId,
      provider_account_id: input.providerAccountId,
      masked_account_number: input.maskedAccountNumber,
      account_holder_name: input.accountHolderName,
      currency: input.currency,
      status: "Active",
    })
    .select("*")
    .single<BankConnectionAccountRow>();
  if (error) throw error;
  return bankConnectionAccountFromRow(data);
}

export async function listBankConnectionAccounts(companyId: string, bankConnectionId?: number): Promise<BankConnectionAccount[]> {
  const supabase = await createClient();
  let query = supabase.from("bank_connection_accounts").select("*").eq("company_id", companyId);
  if (bankConnectionId !== undefined) query = query.eq("bank_connection_id", bankConnectionId);
  const { data, error } = await query.order("created_at").returns<BankConnectionAccountRow[]>();
  if (error) throw error;
  return data.map(bankConnectionAccountFromRow);
}

export async function getBankConnectionAccount(companyId: string, id: number): Promise<BankConnectionAccount | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("bank_connection_accounts").select("*").eq("company_id", companyId).eq("id", id).maybeSingle<BankConnectionAccountRow>();
  if (error) throw error;
  return data ? bankConnectionAccountFromRow(data) : null;
}

/** Advances the sync cursor — called ONLY after a Success/PartialFailure
 * run that genuinely made progress (Part 7 #10 / Part 13 "failed sync
 * does not move the cursor"). A wholly Failed run never calls this. */
export async function recordSuccessfulSyncCursor(companyId: string, id: number, syncedThrough: string, status: "Success" | "PartialFailure", nowIso: string, lastTransactionReceivedAt: string | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_connection_accounts")
    .update({ last_synced_through: syncedThrough, last_sync_status: status, last_sync_at: nowIso, ...(lastTransactionReceivedAt ? { last_transaction_received_at: lastTransactionReceivedAt } : {}) })
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw error;
}

export async function recordFailedSync(companyId: string, id: number, nowIso: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("bank_connection_accounts").update({ last_sync_status: "Failed", last_sync_at: nowIso }).eq("company_id", companyId).eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// bank_sync_runs
// ---------------------------------------------------------------------

type BankSyncRunRow = {
  id: number;
  company_id: string;
  bank_connection_account_id: number;
  sync_type: string;
  status: string;
  range_start: string;
  range_end: string;
  transactions_fetched: number;
  transactions_imported: number;
  transactions_duplicate: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

function bankSyncRunFromRow(row: BankSyncRunRow): BankSyncRun {
  return {
    id: row.id,
    companyId: row.company_id,
    bankConnectionAccountId: row.bank_connection_account_id,
    syncType: row.sync_type as BankSyncType,
    status: row.status as BankSyncStatus,
    rangeStart: row.range_start,
    rangeEnd: row.range_end,
    transactionsFetched: row.transactions_fetched,
    transactionsImported: row.transactions_imported,
    transactionsDuplicate: row.transactions_duplicate,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export async function startBankSyncRun(companyId: string, bankConnectionAccountId: number, syncType: BankSyncType, rangeStart: string, rangeEnd: string): Promise<BankSyncRun> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_sync_runs")
    .insert({ company_id: companyId, bank_connection_account_id: bankConnectionAccountId, sync_type: syncType, status: "Running", range_start: rangeStart, range_end: rangeEnd })
    .select("*")
    .single<BankSyncRunRow>();
  if (error) throw error;
  return bankSyncRunFromRow(data);
}

export type FinishBankSyncRunInput = {
  status: BankSyncStatus;
  transactionsFetched: number;
  transactionsImported: number;
  transactionsDuplicate: number;
  errorMessage: string | null;
};

export async function finishBankSyncRun(companyId: string, runId: number, input: FinishBankSyncRunInput, nowIso: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_sync_runs")
    .update({
      status: input.status,
      transactions_fetched: input.transactionsFetched,
      transactions_imported: input.transactionsImported,
      transactions_duplicate: input.transactionsDuplicate,
      error_message: input.errorMessage,
      finished_at: nowIso,
    })
    .eq("company_id", companyId)
    .eq("id", runId);
  if (error) throw error;
}

export async function listBankSyncRuns(companyId: string, bankConnectionAccountId: number, limit = 20): Promise<BankSyncRun[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bank_sync_runs")
    .select("*")
    .eq("company_id", companyId)
    .eq("bank_connection_account_id", bankConnectionAccountId)
    .order("started_at", { ascending: false })
    .limit(limit)
    .returns<BankSyncRunRow[]>();
  if (error) throw error;
  return data.map(bankSyncRunFromRow);
}
