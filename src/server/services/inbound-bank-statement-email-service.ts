/**
 * Application Service for Phase 21C — Inbound Bank Statement Email
 * processing. The ONE orchestrator between a verified inbound email and
 * the EXISTING, unmodified Import Centre pipeline (`import-service.ts`).
 * No parsing, no ingestion, no Banking Rules, no Matching, no Exceptions
 * logic lives here — this file only resolves the recipient, retrieves
 * the attachment, and calls the same functions a manual upload already
 * calls, in the same order, with the same validation. No AI
 * classification — see the module docstring on why that's a
 * deliberately separate future phase.
 *
 * The email BODY is never read by this file beyond what the inbound
 * message's own metadata (`to`/`from`/`subject`) already exposes for
 * audit — it is never passed to any parser, rule engine, or (in a
 * future phase) VYRON AI. Only the attachment's real bytes become
 * accounting input.
 *
 * Phase 21F — the core processing function (`processInboundEmailMessage`)
 * consumes the provider-neutral `InboundEmailMessage` from
 * `@/server/inbound-email/types`, not a Resend-specific type. Today the
 * only producer of that shape is `resend-adapter.ts`; a future
 * Virtualmin/raw-MIME source would add its own adapter and call the same
 * `processInboundEmailMessage`, unchanged. `processResendInboundEmail`
 * remains the public entry point the Resend webhook route calls — its
 * signature and behavior are unchanged from Phase 21D, it just now
 * converts to the common shape as its first step.
 */

import type { EmailReceivedEvent } from "resend";
import { resendEventToInboundEmailMessage } from "@/server/inbound-email/resend-adapter";
import { resolveStableIdentifierForMessage } from "@/server/inbound-email/recipient-resolution";
import { SUPPORTED_EXTENSIONS } from "@/server/import-centre/bank-statement-adapter-registry";
import { importBankStatement, previewPdfBankStatement, confirmPdfBankStatementImport, ValidationError as ImportValidationError } from "@/server/services/import-service";
import { createNotification } from "@/server/services/notification-service";
import { createAlert } from "@/server/services/operations-service";
import * as webhookEventRepo from "@/server/repositories/resend-webhook-event-repository";
import type { ResendWebhookEventRecord } from "@/server/repositories/resend-webhook-event-repository";
import * as identityAdminRepo from "@/server/repositories/company-bank-statement-email-admin-repository";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { runWithServerExecutionContext } from "@/lib/supabase/execution-context";
import { isImapConfigured, getImapConnectionConfig, createImapClient } from "@/server/inbound-email/imap-client";
import { listCandidateMessages, fetchMessageSource, moveMessage, parseImapMessageToInboundEmailMessage, MAX_RAW_MESSAGE_SIZE_BYTES } from "@/server/inbound-email/imap-adapter";
import type { InboundEmailMessage, InboundProcessingOutcome } from "@/server/inbound-email/types";

/** Matches the 25MB ceiling already enforced elsewhere in this codebase
 * (`import-upload-card.tsx`'s client-side guard, `document-service.ts`'s
 * server-side one) — `import-service.ts` itself has no single exported
 * constant to import without modifying it, which is explicitly out of
 * scope this phase, so the same numeric value is restated here rather
 * than silently left unenforced for a path with no UI in front of it. */
const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;

function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

async function rejectEvent(eventId: number, companyId: string | null, reason: string): Promise<InboundProcessingOutcome> {
  await webhookEventRepo.completeResendWebhookEvent(eventId, "rejected", reason);
  if (companyId) await notifyFailure(companyId, reason);
  return { status: "rejected", reason, companyId };
}

async function failEvent(eventId: number, companyId: string | null, reason: string): Promise<InboundProcessingOutcome> {
  await webhookEventRepo.completeResendWebhookEvent(eventId, "failed", reason);
  if (companyId) {
    await notifyFailure(companyId, reason);
    await identityAdminRepo.recordBankStatementEmailImportFailed(companyId, new Date().toISOString()).catch(() => {});
  }
  return { status: "failed", reason, companyId };
}

/** Same convention `scheduler-service.ts` already uses for
 * `AutomationFailure` — reused as-is rather than adding a new
 * `NotificationType` union member for what is, architecturally, the
 * same kind of thing: an automated background process that couldn't
 * complete. Never allowed to break the caller — a notification/alert
 * failure is logged nowhere further and swallowed, same discipline the
 * Scheduler already applies. */
async function notifyFailure(companyId: string, message: string): Promise<void> {
  try {
    const notification = await createNotification(companyId, {
      notificationType: "AutomationFailure",
      title: "A bank statement email could not be processed",
      message,
      severity: "warning",
      relatedType: "BankStatementEmail",
      relatedId: null,
    });
    await createAlert({
      companyId,
      sourceEngine: "Bank Statement Email",
      severity: "warning",
      title: "A bank statement email could not be processed",
      message,
      relatedNotificationId: notification.id,
    });
  } catch {
    // Never let a notification/alert failure mask the real outcome.
  }
}

async function runThroughExistingImportPipeline(companyId: string, file: File, importedBy: string) {
  if (file.name.toLowerCase().endsWith(".pdf")) {
    const preview = await previewPdfBankStatement(companyId, file);
    const outcome = await confirmPdfBankStatementImport(
      companyId,
      {
        batchId: preview.batchId,
        sourceFilename: preview.sourceFilename,
        metadata: preview.metadata,
        transactions: preview.transactions,
        expectedTransactionCount: preview.expectedTransactionCount,
      },
      importedBy,
    );
    return { filename: preview.sourceFilename, importedCount: outcome.importedCount, duplicateCount: outcome.duplicateCount, exceptionCount: outcome.exceptions.length };
  }

  const outcome = await importBankStatement(companyId, file, importedBy);
  return { filename: file.name, importedCount: outcome.batch.importedCount, duplicateCount: outcome.batch.duplicateCount, exceptionCount: outcome.exceptions.length };
}

/** The single entry point the Resend webhook route calls once a
 * request's signature has already been verified. `providerEventId` is
 * the `svix-id` header value — the officially-recommended idempotency
 * key for a Resend/Svix webhook delivery (distinct from
 * `event.data.email_id`, which identifies the EMAIL, not this
 * particular delivery attempt).
 *
 * Phase 21D — the entire flow runs inside `runWithServerExecutionContext`,
 * a service-role admin client (`createAdminClient()` — the same one
 * `bootstrap-service.ts` already uses, reused here, not reinvented). A
 * server-to-server webhook has no browser session, so the EXISTING,
 * UNMODIFIED session-scoped code this function calls into
 * (`previewPdfBankStatement`/`confirmPdfBankStatementImport`/
 * `importBankStatement` and everything they in turn call — Banking
 * Rules, Matching, Banking Exceptions, journal posting — plus
 * `createNotification`/`createAlert`) all transparently pick up the
 * admin client instead of failing under RLS with no session. Tenant
 * isolation is NOT delegated to RLS for this one path — every one of
 * those functions already takes an explicit `companyId` and every
 * repository they touch already filters by it explicitly (this
 * codebase's own long-established "RLS is defense-in-depth, never the
 * only check" convention) — the admin client only changes which
 * Postgres role executes the already-scoped query, never what it's
 * scoped to. See `@/lib/supabase/execution-context.ts` for the full
 * design rationale.
 *
 * Phase 21F — converts to the provider-neutral `InboundEmailMessage`
 * (`resend-adapter.ts`) as its first step inside the execution context,
 * then delegates to `processInboundEmailMessage`, which knows nothing
 * about Resend specifically. */
export async function processResendInboundEmail(event: EmailReceivedEvent, providerEventId: string): Promise<InboundProcessingOutcome> {
  if (!isSupabaseAdminConfigured()) {
    // Honest failure — never a fabricated success, never a cryptic
    // low-level "supabaseKey is required" error surfacing instead.
    // Retryable: once `SUPABASE_SERVICE_ROLE_KEY` is set, the identical
    // redelivery will succeed.
    return { status: "failed", reason: "Inbound email processing is not fully configured (SUPABASE_SERVICE_ROLE_KEY is missing).", companyId: null };
  }
  const adminClient = createAdminClient();
  return runWithServerExecutionContext(adminClient, () => {
    const message = resendEventToInboundEmailMessage(event, providerEventId);
    return processInboundEmailMessage(message);
  });
}

/** Provider-neutral core: everything from here on operates only on the
 * common `InboundEmailMessage` shape — recipient resolution, attachment
 * filtering/dispatch, idempotency, and notifications are identical
 * regardless of which adapter produced the message. A future Virtualmin
 * (or any other) adapter calls this exact function. */
async function processInboundEmailMessage(message: InboundEmailMessage): Promise<InboundProcessingOutcome> {
  // Phase 21K — `provider` was always carried on `InboundEmailMessage`
  // but never actually used until now: every call site implicitly meant
  // "resend" (the repository hardcoded it). Passing it through is what
  // lets an IMAP-sourced message and a Resend-sourced message share the
  // same `(provider, provider_event_id)` idempotency table without ever
  // colliding on identity — a Resend `svix-id` and an IMAP
  // `"${uidValidity}:${uid}"` live in genuinely separate provider
  // namespaces even if their raw string forms ever happened to collide.
  const existing = await webhookEventRepo.findResendWebhookEvent(message.providerEventId, message.provider);
  if (existing && (existing.status === "processed" || existing.status === "rejected")) {
    return { status: "already-processed", reason: `This event was already ${existing.status} — not reprocessed.`, companyId: existing.companyId };
  }

  let eventRow: ResendWebhookEventRecord;
  if (existing) {
    eventRow = existing;
  } else {
    // "email.received" is this pipeline's own event-type label — every
    // `InboundEmailMessage` reaching this function is, by definition,
    // one of these, regardless of which provider's own event-type
    // vocabulary (if any) produced it.
    const insertResult = await webhookEventRepo.insertResendWebhookEvent(message.providerEventId, "email.received", message.provider);
    if (!insertResult.inserted) {
      // Lost the insert race — a concurrent delivery of the SAME event
      // (or, for IMAP, a concurrent/overlapping poll fetching the same
      // UID) already claimed it a moment earlier and is (or already
      // did) processing it. Back off rather than running the import a
      // second time for one statement.
      return { status: "already-processed", reason: "This event is already being handled by a concurrent delivery — not reprocessed.", companyId: insertResult.record.companyId };
    }
    eventRow = insertResult.record;
  }

  // The recipient — never the sender, body, or filename — is the
  // entire tenant boundary. Phase 21K: now checks a trusted routing
  // header (X-Original-To/Delivered-To) first when the provider
  // supplies one, falling back to To:/Cc: exactly as before — see
  // recipient-resolution.ts's own docstring.
  const stableIdentifier = resolveStableIdentifierForMessage(message);
  if (!stableIdentifier) {
    return rejectEvent(eventRow.id, null, "No recipient on this email matched a configured VYRON bank statement email address.");
  }

  // Phase 25I — these two calls used to be unguarded: a transient
  // failure here (a DB blip, not a real "unknown recipient") would
  // throw straight out of this function, through
  // `runWithServerExecutionContext` and the webhook route (neither of
  // which wraps this call either), surfacing as an unhandled 500 with
  // NO terminal status ever written — the event is left at `received`
  // forever. Every OTHER failure point in this function already routes
  // through `failEvent` (a real, retryable `failed` status, 502,
  // Resend's own retry schedule gets another chance); this closes the
  // one gap that didn't.
  let identity;
  try {
    identity = await identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier(stableIdentifier);
  } catch (error) {
    return failEvent(eventRow.id, null, error instanceof Error ? error.message : "Could not resolve the recipient identity.");
  }
  if (!identity) {
    return rejectEvent(eventRow.id, null, "The recipient does not correspond to any active company bank statement email identity.");
  }

  const companyId = identity.companyId;
  try {
    await webhookEventRepo.setResendWebhookEventCompany(eventRow.id, companyId);
  } catch (error) {
    return failEvent(eventRow.id, companyId, error instanceof Error ? error.message : "Could not record the resolved company on this event.");
  }
  await identityAdminRepo.recordBankStatementEmailReceived(companyId, new Date().toISOString()).catch(() => {});

  // Real attachments only — never an inline image, never the body.
  const realAttachments = message.attachments.filter((a) => a.contentDisposition === "attachment" && a.filename);
  if (realAttachments.length === 0) {
    return rejectEvent(eventRow.id, companyId, "This email had no bank statement attachment.");
  }

  // Reuses the EXACT existing supported-format list — never a second one.
  const supportedAttachments = realAttachments.filter((a) => SUPPORTED_EXTENSIONS.includes(extensionOf(a.filename)));
  if (supportedAttachments.length === 0) {
    return rejectEvent(eventRow.id, companyId, `Unsupported attachment type. Supported formats: ${SUPPORTED_EXTENSIONS.join(", ")}.`);
  }

  // One statement per email — the first supported attachment found.
  const attachment = supportedAttachments[0]!;

  let metadata;
  try {
    metadata = await attachment.getMetadata();
  } catch (error) {
    return failEvent(eventRow.id, companyId, error instanceof Error ? error.message : "Could not retrieve the attachment.");
  }

  if (metadata.sizeBytes <= 0) {
    return rejectEvent(eventRow.id, companyId, "The attachment was empty.");
  }
  if (metadata.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return rejectEvent(eventRow.id, companyId, `The attachment exceeds the ${MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024}MB limit.`);
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await attachment.getBytes();
  } catch (error) {
    return failEvent(eventRow.id, companyId, error instanceof Error ? error.message : "Could not download the attachment content.");
  }

  const filename = metadata.filename || attachment.filename;
  const file = new File([bytes], filename, { type: attachment.contentType || "application/octet-stream" });

  try {
    const result = await runThroughExistingImportPipeline(companyId, file, `Bank Statement Email (${stableIdentifier})`);
    await webhookEventRepo.completeResendWebhookEvent(eventRow.id, "processed", null);
    await identityAdminRepo.recordBankStatementEmailImportSucceeded(companyId, new Date().toISOString()).catch(() => {});
    return { status: "processed", reason: "Imported successfully.", companyId, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The import engine could not process this statement.";
    if (error instanceof ImportValidationError) {
      // A real, permanent rejection from the SAME validation the manual
      // upload path already enforces (corrupt/unrecognized PDF,
      // unsupported statement content, etc.) — retrying the identical
      // attachment would never succeed.
      return rejectEvent(eventRow.id, companyId, message);
    }
    return failEvent(eventRow.id, companyId, message);
  }
}

/**
 * Phase 21K — the IMAP counterpart to `processResendInboundEmail`: the
 * ONE entry point a cron-secured route calls to poll the shared
 * Virtualmin/Postfix mailbox. Everything after "translate to
 * `InboundEmailMessage`" reuses `processInboundEmailMessage()` above,
 * completely unchanged — no second import/idempotency/tenant-resolution
 * path exists for this provider.
 *
 * Deliberately bypasses the company-scoped `automation_tasks`/Scheduler
 * entirely (see the route's own docstring for the full reasoning): the
 * mailbox is shared across every company, so there is no single
 * `companyId` this work could correctly belong to, and the existing
 * per-message idempotency mechanism above (reused verbatim, with
 * `provider: "imap"`) already provides the real, database-atomic
 * concurrency guarantee — two overlapping polls racing to process the
 * SAME UID collide on the SAME insert, exactly like two concurrent
 * Resend webhook deliveries of the same event do today. No separate
 * poll-run lock table was added for this reason; see the Phase 21K
 * completion report for the full analysis of why one isn't needed for
 * correctness (only, at most, for avoiding redundant IMAP work under a
 * genuine double-fire — an efficiency question, not a safety one).
 */

const MAX_MESSAGES_PER_POLL = 20;

export type ImapPollOutcome = {
  /** false when `SUPABASE_SERVICE_ROLE_KEY`/`BANK_STATEMENT_IMAP_*` are
   * not configured — the poll was never attempted (not itself a
   * failure; a normal state before the operator finishes provisioning
   * this environment). */
  configured: boolean;
  candidates: number;
  processed: number;
  rejected: number;
  failed: number;
  duplicate: number;
  elapsedMs: number;
};

async function rejectOversizedImapCandidate(providerEventId: string, sizeBytes: number): Promise<boolean> {
  const insertResult = await webhookEventRepo.insertResendWebhookEvent(providerEventId, "email.received", "imap");
  if (!insertResult.inserted) return false; // a concurrent poll already claimed this exact UID — nothing more to do
  await webhookEventRepo.completeResendWebhookEvent(
    insertResult.record.id,
    "rejected",
    `Message size (${sizeBytes} bytes) exceeds the ${MAX_RAW_MESSAGE_SIZE_BYTES} byte limit — its content was never downloaded.`,
  );
  return true;
}

/** Only used for the `already-processed` case below — a message whose
 * outcome was already recorded by an earlier poll that crashed before
 * moving it out of the mailbox. Looks up what that recorded outcome
 * actually was so this poll can finish the housekeeping move; never
 * re-runs the import itself (that already happened, or was already
 * permanently rejected, on the earlier attempt). */
async function lookUpImapFinalStatus(providerEventId: string): Promise<"processed" | "rejected" | null> {
  const row = await webhookEventRepo.findResendWebhookEvent(providerEventId, "imap");
  if (row?.status === "processed" || row?.status === "rejected") return row.status;
  return null;
}

export async function pollBankStatementImapMailbox(): Promise<ImapPollOutcome> {
  const start = performance.now();

  if (!isSupabaseAdminConfigured() || !isImapConfigured()) {
    return { configured: false, candidates: 0, processed: 0, rejected: 0, failed: 0, duplicate: 0, elapsedMs: Math.round(performance.now() - start) };
  }

  const outcome = { candidates: 0, processed: 0, rejected: 0, failed: 0, duplicate: 0 };
  const adminClient = createAdminClient();
  const imapConfig = getImapConnectionConfig();
  const client = createImapClient(imapConfig);

  // Deliberately NOT caught here — a connection/authentication failure
  // is a genuine, real failure the caller (the cron route) must see and
  // report honestly, never silently swallowed into a zero-valued
  // "nothing to do" outcome that would look identical to a mailbox that
  // legitimately had no new mail.
  await client.connect();

  try {
    const { uidValidity, candidates } = await listCandidateMessages(client, imapConfig.mailbox, MAX_MESSAGES_PER_POLL);
    outcome.candidates = candidates.length;

    await runWithServerExecutionContext(adminClient, async () => {
      for (const candidate of candidates) {
        const providerEventId = `${uidValidity}:${candidate.uid}`;

        if (candidate.size > MAX_RAW_MESSAGE_SIZE_BYTES) {
          const claimed = await rejectOversizedImapCandidate(providerEventId, candidate.size);
          if (claimed) {
            await moveMessage(client, imapConfig.mailbox, candidate.uid, imapConfig.failedMailbox).catch(() => {});
            outcome.rejected++;
          } else {
            outcome.duplicate++;
          }
          continue;
        }

        let message: InboundEmailMessage;
        try {
          const { internalDate, source } = await fetchMessageSource(client, imapConfig.mailbox, candidate.uid);
          message = await parseImapMessageToInboundEmailMessage(uidValidity, candidate.uid, internalDate, source);
        } catch {
          // Transient IMAP-fetch/MIME-parse failure — left in INBOX
          // (never moved, never marked in the idempotency table), so
          // the next poll retries it, matching the existing "failed =
          // retryable" convention used throughout this pipeline.
          outcome.failed++;
          continue;
        }

        const result = await processInboundEmailMessage(message);

        if (result.status === "already-processed") {
          outcome.duplicate++;
          const finalStatus = await lookUpImapFinalStatus(providerEventId);
          if (finalStatus === "processed") await moveMessage(client, imapConfig.mailbox, candidate.uid, imapConfig.processedMailbox).catch(() => {});
          else if (finalStatus === "rejected") await moveMessage(client, imapConfig.mailbox, candidate.uid, imapConfig.failedMailbox).catch(() => {});
          // finalStatus null ("received"/"failed") — still genuinely in
          // progress or transiently failed; leave in INBOX, retryable.
          continue;
        }
        if (result.status === "processed") {
          outcome.processed++;
          await moveMessage(client, imapConfig.mailbox, candidate.uid, imapConfig.processedMailbox).catch(() => {});
        } else if (result.status === "rejected") {
          outcome.rejected++;
          await moveMessage(client, imapConfig.mailbox, candidate.uid, imapConfig.failedMailbox).catch(() => {});
        } else {
          // "failed" — transient (DB/import-engine failure), left in
          // INBOX exactly as the existing Resend path leaves its event
          // row retryable rather than moving anything.
          outcome.failed++;
        }
      }
    });
  } finally {
    // Never let a logout failure mask the real poll outcome computed
    // above, and never leave a socket dangling either way.
    await client.logout().catch(() => {});
  }

  return { configured: true, ...outcome, elapsedMs: Math.round(performance.now() - start) };
}
