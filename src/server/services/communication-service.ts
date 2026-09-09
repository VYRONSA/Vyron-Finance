/**
 * Service layer for the RC1 Phase 5 Communication Platform — the ONE
 * place `queueCommunication()` is called from, on every channel, by
 * every module. Approval reuses the existing generic Workflow Engine
 * (`workflow-service.ts`); queue processing is invoked by the existing
 * Automation Scheduler (`scheduler-service.ts`, via a `CommunicationQueue`
 * task) rather than a bespoke loop of its own.
 */

import * as repo from "@/server/repositories/communication-repository";
import { getDocument, downloadDocumentFile } from "@/server/repositories/document-repository";
import * as workflowService from "@/server/services/workflow-service";
import { createNotification } from "@/server/services/notification-service";
import { createAlert } from "@/server/services/operations-service";
import { deliverInApp } from "@/server/communications/channels/in-app-sender";
import { defaultEmailSender, type EmailAttachment, type EmailSender } from "@/server/communications/channels/email-sender";
import { buildCommunicationIdempotencyIdentity } from "@/server/communications/idempotency";
import { findMissingVariables, renderTemplate } from "@/server/communications/template-engine";
import { computeNextRetryAt, isRetryExhausted, selectDueCommunications, selectExpiredCommunications } from "@/server/communications/queue-engine";
import { IMPLEMENTED_CHANNELS } from "@/server/communications/types";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import type {
  CommunicationChannel, CommunicationPriority, CommunicationRecipient, CommunicationRecord, CommunicationTemplate,
} from "@/server/communications/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listCommunications = repo.listCommunications;
export const COMMUNICATIONS_LIST_CAP = repo.COMMUNICATIONS_LIST_CAP;
export const getCommunication = repo.getCommunication;
export const listTemplates = repo.listTemplates;
export const getTemplate = repo.getTemplate;
export const listTemplateVersions = repo.listTemplateVersions;
export const listCommunicationAttachments = repo.listCommunicationAttachments;

// ---- Templates ------------------------------------------------------

export type NewTemplateInput = Omit<repo.NewCommunicationTemplate, "createdBy">;

export async function createTemplate(companyId: string, input: NewTemplateInput, performedBy: string): Promise<CommunicationTemplate> {
  if (!input.code?.trim()) throw new ValidationError("A template code is required.");
  if (!input.name?.trim()) throw new ValidationError("A template name is required.");
  if (!input.bodyTemplate?.trim()) throw new ValidationError("Template body is required.");
  const template = await repo.createTemplate(companyId, { ...input, createdBy: performedBy });
  await repo.recordTemplateVersion(template.id, 1, template.subjectTemplate, template.bodyTemplate, performedBy);
  return template;
}

export async function updateTemplate(companyId: string, templateId: number, patch: repo.TemplateUpdate, performedBy: string): Promise<CommunicationTemplate> {
  const existing = await repo.getTemplate(companyId, templateId);
  if (!existing) throw new NotFoundError(`No template with id ${templateId}.`);
  const contentChanged = patch.subjectTemplate !== undefined || patch.bodyTemplate !== undefined;
  const updated = await repo.updateTemplate(companyId, templateId, patch, contentChanged);
  if (contentChanged) {
    await repo.recordTemplateVersion(templateId, updated.version, updated.subjectTemplate, updated.bodyTemplate, performedBy);
  }
  return updated;
}

export const deleteTemplate = repo.deleteTemplate;

export type PreviewResult = { subject: string | null; body: string; missingVariables: string[] };

export async function previewTemplate(companyId: string, templateId: number, variables: Record<string, unknown>): Promise<PreviewResult> {
  const template = await repo.getTemplate(companyId, templateId);
  if (!template) throw new NotFoundError(`No template with id ${templateId}.`);
  const rendered = renderTemplate(template, variables);
  return { ...rendered, missingVariables: findMissingVariables(template, variables) };
}

/** Renders and immediately dispatches, bypassing approval — the
 * "Test Send" requirement. Still produces a real `communications` row
 * (module `TemplateAdmin`) so a test send shows up in the same log every
 * other communication does, not a side channel. */
export async function testSend(companyId: string, templateId: number, testRecipient: string, variables: Record<string, unknown>, performedBy: string, emailSender: EmailSender = defaultEmailSender): Promise<CommunicationRecord> {
  const template = await repo.getTemplate(companyId, templateId);
  if (!template) throw new NotFoundError(`No template with id ${templateId}.`);
  if (!IMPLEMENTED_CHANNELS.includes(template.channel)) throw new ValidationError(`Channel "${template.channel}" has no sender configured yet.`);

  const rendered = renderTemplate(template, variables);
  const recipients: CommunicationRecipient[] = [{ type: "Email", name: "Test Recipient", address: testRecipient }];
  const communication = await repo.createCommunication(companyId, {
    module: "TemplateAdmin",
    businessObjectType: "TemplateTest",
    businessObjectId: template.id,
    templateId: template.id,
    channel: template.channel,
    recipients,
    subject: rendered.subject,
    body: rendered.body,
    variables,
    status: "Queued",
    createdBy: performedBy,
  });
  return claimAndDeliver(companyId, communication, new Date().toISOString(), emailSender);
}

/** Phase 25K — every "deliver right now" call site (this file has four:
 * `testSend`, `queueCommunication`'s InApp-immediate path,
 * `approveCommunication`'s InApp-immediate path, and
 * `processCommunicationQueue`'s own loop) must claim the row first,
 * otherwise a concurrently-running `processCommunicationQueue` pass for
 * the same company (the queue's own claim only protects against ANOTHER
 * queue pass — it does nothing to stop one of these three immediate
 * paths from delivering the exact same still-`Queued` row a second
 * time) can claim and deliver it first, and this caller's own delivery
 * then runs too — a real duplicate InApp notification (InApp actually
 * delivers today; Email is only stubbed). A lost claim means another
 * process already has it — return the current persisted record rather
 * than delivering again. */
async function claimAndDeliver(companyId: string, communication: CommunicationRecord, nowIso: string, emailSender: EmailSender = defaultEmailSender): Promise<CommunicationRecord> {
  const claimed = await repo.claimCommunicationForSending(companyId, communication.id);
  if (!claimed) {
    const current = await repo.getCommunication(companyId, communication.id);
    return current ?? communication;
  }
  return deliverAndFinalize(companyId, communication, nowIso, emailSender);
}

// ---- Queueing ---------------------------------------------------------

export type QueueCommunicationInput = {
  module: string;
  businessObjectType?: string | null;
  businessObjectId?: number | null;
  channel: CommunicationChannel;
  recipients: CommunicationRecipient[];
  templateCode?: string;
  /** Required when no `templateCode` is given. */
  subject?: string | null;
  body?: string;
  variables?: Record<string, unknown>;
  priority?: CommunicationPriority;
  scheduledFor?: string;
  expiresAt?: string | null;
  auditRef?: string | null;
  createdBy?: string;
  /** Document ids from the shared Document Platform (Phase 4) to attach
   * — no duplicated attachment/upload logic, see `communication_attachments`. */
  documentIds?: number[];
};

/** The ONE entry point every module queues a communication through. If
 * `templateCode` resolves to a template with `requiresApproval`, the
 * communication starts `PendingApproval` and a real instance of the
 * EXISTING Workflow Engine is created for it — never a bespoke approval
 * mechanism. An `InApp` communication that doesn't need approval delivers
 * immediately (a notification insert is cheap/local); every other
 * channel waits for the Communication Queue processor. */
export async function queueCommunication(companyId: string, input: QueueCommunicationInput, emailSender: EmailSender = defaultEmailSender): Promise<CommunicationRecord> {
  if (!IMPLEMENTED_CHANNELS.includes(input.channel)) {
    throw new ValidationError(`Channel "${input.channel}" has no sender configured yet — supported today: ${IMPLEMENTED_CHANNELS.join(", ")}.`);
  }

  // RC1 Phase 7 — a document can only be attached if it genuinely
  // belongs to THIS company. `getDocument(companyId, id)` filters by
  // both company_id and id, so it resolves to null for a foreign-
  // company document id — closing a real cross-tenant attachment gap
  // found during the Phase 7 security audit (the attachment insert path
  // previously accepted any document id with no ownership check at all).
  if (input.documentIds?.length) {
    const resolved = await Promise.all(input.documentIds.map((id) => getDocument(companyId, id)));
    const missing = input.documentIds.filter((_, i) => resolved[i] === null);
    if (missing.length > 0) throw new ValidationError(`Document id(s) ${missing.join(", ")} do not exist in this company.`);
  }

  let template: CommunicationTemplate | null = null;
  let subject = input.subject ?? null;
  let body = input.body ?? "";
  const variables = input.variables ?? {};

  if (input.templateCode) {
    template = await repo.getTemplateByCode(companyId, input.templateCode, input.channel);
    if (!template) throw new NotFoundError(`No active "${input.templateCode}" template for channel "${input.channel}".`);
    if (!template.isActive) throw new ValidationError(`Template "${template.name}" is inactive.`);
    const rendered = renderTemplate(template, variables);
    subject = rendered.subject;
    body = rendered.body;
  } else if (!input.body) {
    throw new ValidationError("Either templateCode or body is required.");
  }

  const requiresApproval = template?.requiresApproval ?? false;
  const communication = await repo.createCommunication(companyId, {
    module: input.module,
    businessObjectType: input.businessObjectType ?? null,
    businessObjectId: input.businessObjectId ?? null,
    templateId: template?.id ?? null,
    channel: input.channel,
    recipients: input.recipients,
    subject,
    body,
    variables,
    status: requiresApproval ? "PendingApproval" : "Queued",
    priority: input.priority,
    scheduledFor: input.scheduledFor,
    expiresAt: input.expiresAt,
    auditRef: input.auditRef,
    createdBy: input.createdBy ?? "System",
  });

  if (input.documentIds?.length) {
    await repo.addCommunicationAttachments(communication.id, input.documentIds);
  }

  if (requiresApproval && template?.approvalWorkflowDefinitionId) {
    try {
      const instance = await workflowService.startWorkflow(companyId, template.approvalWorkflowDefinitionId, "Communication", communication.id, communication.createdBy);
      return await repo.updateCommunication(companyId, communication.id, { approvalWorkflowInstanceId: instance.id });
    } catch (error) {
      // Phase 25I — this used to be unguarded: a failure starting the
      // approval workflow left the just-created row stranded at
      // `PendingApproval` with `approvalWorkflowInstanceId: null` —
      // `approveCommunication`/`rejectCommunication` both require a
      // non-null instance id, so the only recovery was a manual
      // `cancelCommunication`. `Cancelled` (not `Failed`) is the correct
      // terminal state here, not `Queued`/`Failed`-and-retryable: the
      // normal queue/retry path (`processCommunicationQueue`) sends the
      // raw message content directly with no approval re-check, so
      // letting this row re-enter that path would silently bypass the
      // approval this template requires. The original error is
      // rethrown so the caller (e.g. the API route that called
      // `queueCommunication`) still sees the real failure.
      const reason = error instanceof Error ? error.message : "Could not start the approval workflow.";
      await repo.updateCommunication(companyId, communication.id, { status: "Cancelled", failureReason: reason }).catch(() => {});
      throw error;
    }
  }

  if (communication.status === "Queued" && communication.channel === "InApp") {
    return claimAndDeliver(companyId, communication, new Date().toISOString(), emailSender);
  }

  return communication;
}

// ---- Approval (reuses the existing Workflow Engine) --------------------

/** `workflow-service.ts` has its own `ValidationError`/`NotFoundError`
 * classes (a separate module, so a separate class identity even with
 * identical names) — a bare `await workflowService.decideStep(...)`
 * call would throw an error this file's own callers (and the API
 * route's `instanceof ValidationError` check) don't recognize, falling
 * through as an uncaught 500 instead of the clean 400/404 every other
 * error in this file produces. This translates by message, preserving
 * the real reason (including Finding #125's self-approval guard). */
async function decideCommunicationStep(companyId: string, instanceId: number, decision: "Approved" | "Rejected", decidedBy: string, note: string) {
  try {
    return await workflowService.decideStep(companyId, instanceId, decision, decidedBy, note);
  } catch (error) {
    if (error instanceof workflowService.ValidationError) throw new ValidationError(error.message);
    if (error instanceof workflowService.NotFoundError) throw new NotFoundError(error.message);
    throw error;
  }
}

export async function approveCommunication(companyId: string, communicationId: number, performedBy: string, note = ""): Promise<CommunicationRecord> {
  const communication = await repo.getCommunication(companyId, communicationId);
  if (!communication) throw new NotFoundError(`No communication with id ${communicationId}.`);
  if (communication.status !== "PendingApproval") throw new ValidationError(`Communication is ${communication.status}, not awaiting approval.`);
  if (!communication.approvalWorkflowInstanceId) throw new ValidationError("Communication has no approval workflow instance.");

  const instance = await decideCommunicationStep(companyId, communication.approvalWorkflowInstanceId, "Approved", performedBy, note);
  if (instance.status !== "Approved") return repo.getCommunication(companyId, communicationId) as Promise<CommunicationRecord>;

  const queued = await repo.updateCommunication(companyId, communicationId, { status: "Queued" });
  if (queued.channel === "InApp") return claimAndDeliver(companyId, queued, new Date().toISOString());
  return queued;
}

export async function rejectCommunication(companyId: string, communicationId: number, performedBy: string, note = ""): Promise<CommunicationRecord> {
  const communication = await repo.getCommunication(companyId, communicationId);
  if (!communication) throw new NotFoundError(`No communication with id ${communicationId}.`);
  if (communication.status !== "PendingApproval") throw new ValidationError(`Communication is ${communication.status}, not awaiting approval.`);
  if (!communication.approvalWorkflowInstanceId) throw new ValidationError("Communication has no approval workflow instance.");

  await decideCommunicationStep(companyId, communication.approvalWorkflowInstanceId, "Rejected", performedBy, note);
  return repo.updateCommunication(companyId, communicationId, { status: "Rejected" });
}

export async function cancelCommunication(companyId: string, communicationId: number): Promise<CommunicationRecord> {
  const communication = await repo.getCommunication(companyId, communicationId);
  if (!communication) throw new NotFoundError(`No communication with id ${communicationId}.`);
  if (!["Draft", "Queued", "PendingApproval"].includes(communication.status)) {
    throw new ValidationError(`Communication is ${communication.status} and can no longer be cancelled.`);
  }
  return repo.updateCommunication(companyId, communicationId, { status: "Cancelled" });
}

// ---- Queue processing (called by the Scheduler's CommunicationQueue task) --

export type QueueRunOutcome = { processed: number; sent: number; failed: number; expired: number };

// Phase 25I — deliberately short: a real send (even real SMTP/API
// delivery, not just today's synchronous stub) should never legitimately
// take anywhere near this long, so a row still `Sending` after this
// threshold is a strong signal the process that claimed it died mid-flight.
const STALE_SENDING_THRESHOLD_MS = 10 * 60_000;

/** Phase 25I — stale-claim recovery. `claimCommunicationForSending`
 * correctly guards against two overlapping queue runs both sending the
 * SAME row, but nothing previously ever revisited a row if the process
 * that claimed it crashed before `deliverAndFinalize` reached a
 * terminal `updateCommunication` call — `listPendingCommunications`'s
 * own WHERE clause excludes `Sending`, so such a row was stuck there
 * forever. This reclaims it back to `Failed`, feeding it through the
 * SAME retry/backoff/exhaustion accounting (`computeNextRetryAt`,
 * `isRetryExhausted`, the exhausted-retry notification/alert) every
 * other send failure already goes through — no new subsystem. */
async function reclaimStaleSendingCommunicationsSafely(companyId: string, nowIso: string): Promise<void> {
  try {
    const staleBeforeIso = new Date(Date.parse(nowIso) - STALE_SENDING_THRESHOLD_MS).toISOString();
    const staleCommunications = await repo.listStaleSendingCommunications(companyId, staleBeforeIso);
    const stuckReason = "Reclaimed after being stuck in Sending — the process that claimed this communication likely crashed or was terminated before it could finish.";

    for (const communication of staleCommunications) {
      const retryCount = communication.retryCount + 1;
      const exhausted = isRetryExhausted({ retryCount, maxRetries: communication.maxRetries });
      const reclaimed = await repo.reclaimStaleSendingCommunication(companyId, communication.id, {
        retryCount,
        failureReason: stuckReason,
        nextRetryAt: exhausted ? null : computeNextRetryAt(retryCount, nowIso),
      });

      if (reclaimed && exhausted) {
        try {
          const title = `Communication to ${communication.recipients[0]?.name ?? "recipient"} failed after ${retryCount} attempt(s)`;
          const notification = await createNotification(companyId, {
            notificationType: "AutomationFailure",
            title,
            message: stuckReason,
            severity: "critical",
            relatedType: "Communication",
            relatedId: communication.id,
          });
          await createAlert({ companyId, sourceEngine: "Communication Platform", severity: "critical", title, message: stuckReason, relatedNotificationId: notification.id });
        } catch {
          // Never break queue processing over a notification/alerting failure.
        }
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error.";
    try {
      const notification = await createNotification(companyId, {
        notificationType: "AutomationFailure",
        title: "Communication Platform's stale-send recovery sweep failed",
        message: errorMessage,
        severity: "critical",
        relatedType: "Communication",
        relatedId: null,
      });
      await createAlert({ companyId, sourceEngine: "Communication Platform", severity: "critical", title: "Communication Platform's stale-send recovery sweep failed", message: errorMessage, relatedNotificationId: notification.id });
    } catch {
      // Never break queue processing over a logging/alerting failure.
    }
  }
}

export async function processCommunicationQueue(companyId: string, nowIso: string, emailSender: EmailSender = defaultEmailSender): Promise<QueueRunOutcome> {
  await reclaimStaleSendingCommunicationsSafely(companyId, nowIso);
  const pending = await repo.listPendingCommunications(companyId);

  const expired = selectExpiredCommunications(pending, nowIso);
  for (const communication of expired) {
    await repo.updateCommunication(companyId, communication.id, { status: "Expired" });
  }
  const expiredIds = new Set(expired.map((c) => c.id));

  const due = selectDueCommunications(pending.filter((c) => !expiredIds.has(c.id)), nowIso);
  let processed = 0;
  let sent = 0;
  let failed = 0;
  for (const communication of due) {
    // Atomic claim (mirrors `applyAiClassification`'s conditional-UPDATE
    // pattern) — guards against an overlapping scheduler run picking up
    // and sending this same row a second time. A null claim means
    // another process already has it; skip rather than double-send.
    // (Only the claim's success matters here, not its field values —
    // it only ever flips `status`/`updated_at`, neither of which
    // `deliverAndFinalize` reads.)
    const claimed = await repo.claimCommunicationForSending(companyId, communication.id);
    if (!claimed) continue;
    processed++;
    const result = await deliverAndFinalize(companyId, communication, nowIso, emailSender);
    if (result.status === "Sent") sent++;
    else failed++;
  }

  // Commercial Billing Platform — one Usage Engine event per successful
  // send (not per queued/failed item — "Communications" is a plan usage
  // dimension for delivered messages).
  // Phase 25K — every communication in `due` has already been sent and
  // individually finalized by this point; a transient metering failure
  // here must not make an unguarded throw propagate up to the Scheduler's
  // `runTask` (CommunicationQueue branch), which would otherwise mark an
  // already-successful queue run "Failed" over billing housekeeping
  // alone. Same defensive `.catch` guard as every other call site.
  if (sent > 0) await recordUsageEvent(companyId, "communications", sent).catch(() => {});

  return { processed, sent, failed, expired: expired.length };
}

/** Phase 24B — resolves whatever documents this communication has
 * linked (`communication_attachments`, set by `queueCommunication`'s own
 * `documentIds` handling) into real, downloaded bytes ready for
 * `EmailSender.send()`. Runs at ACTUAL delivery time — which for the
 * Email channel is always later, via `processCommunicationQueue`, not
 * inside the original `queueCommunication()` call — so this cannot reuse
 * an in-memory Buffer a caller generated earlier; it has to genuinely
 * re-fetch the stored file. A document that's gone missing (deleted
 * after being linked) is skipped rather than failing the whole send —
 * an attachment problem shouldn't block the email/notification text
 * itself from reaching the recipient. */
async function resolveEmailAttachments(companyId: string, communicationId: number): Promise<EmailAttachment[]> {
  const links = await repo.listCommunicationAttachments(communicationId);
  if (links.length === 0) return [];

  const attachments: EmailAttachment[] = [];
  for (const link of links) {
    const document = await getDocument(companyId, link.documentId);
    if (!document) continue;
    try {
      const bytes = await downloadDocumentFile(document.storagePath);
      attachments.push({ filename: document.filename, contentType: document.mimeType, content: Buffer.from(bytes) });
    } catch {
      // Same "don't let an attachment problem block the send" reasoning
      // as a missing document row above.
    }
  }
  return attachments;
}

async function deliverAndFinalize(companyId: string, communication: CommunicationRecord, nowIso: string, emailSender: EmailSender = defaultEmailSender): Promise<CommunicationRecord> {
  if (communication.channel === "InApp") {
    // Phase 25K — `deliverInApp` does a real `notifications` insert (`if
    // (error) throw error`) and used to be called unwrapped here, unlike
    // the Email branch's own `emailSender.send()` (guarded since Phase
    // 25I). A single InApp row whose insert throws (a transient DB
    // error) would propagate out of `deliverAndFinalize`, out of
    // `processCommunicationQueue`'s `for` loop, silently aborting the
    // rest of that company's queue pass. Routed to the same
    // `recordFailure` retry/backoff accounting the Email branch already
    // gets — the claimed-but-unfinished row is recoverable via the
    // stale-`Sending` reclaim sweep either way, but this avoids the
    // wider pass-abort blast radius.
    let result;
    try {
      result = await deliverInApp(companyId, communication.recipients, communication.subject, communication.body, communication.businessObjectType, communication.businessObjectId);
    } catch (err) {
      return recordFailure(companyId, communication, err instanceof Error ? err.message : "In-app delivery failed unexpectedly.", nowIso);
    }
    return repo.updateCommunication(companyId, communication.id, {
      status: "Sent", sentAt: nowIso, relatedNotificationId: result.notificationId, deliveryResult: { notificationId: result.notificationId },
    });
  }

  if (communication.channel === "Email") {
    const address = communication.recipients.find((r) => r.address)?.address;
    if (!address) return recordFailure(companyId, communication, "No recipient email address on file.", nowIso);
    const attachments = await resolveEmailAttachments(companyId, communication.id);
    // Phase 25J — derived fresh from `communication.id` on every call,
    // never persisted: since a retry/reclaim always re-delivers the SAME
    // row (never creates a new one), this is byte-identical on every
    // attempt, by construction — no stored idempotency column needed. A
    // deliberate resend (a brand-new `queueCommunication` call, e.g. from
    // `document-email-service.ts`) produces a brand-new `communications`
    // row with a different id, and therefore a genuinely different
    // identity — retries and resends are never confused with each other.
    const { idempotencyKey, messageId } = buildCommunicationIdempotencyIdentity(communication.id);
    // Phase 25I — `emailSender.send()` used to be called unwrapped: a
    // THROWN error (as opposed to a returned `{delivered:false}` result)
    // would propagate straight out of `deliverAndFinalize`, leaving this
    // communication stuck at `Sending` forever (that status isn't in
    // `listPendingCommunications`'s `Queued`/`Failed` poll set, so
    // nothing would ever revisit it). Routed to the same `recordFailure`
    // retry/backoff accounting a returned failure already gets.
    let result;
    try {
      result = await emailSender.send(address, communication.subject ?? "", communication.body, { attachments, idempotencyKey, messageId });
    } catch (err) {
      return recordFailure(companyId, communication, err instanceof Error ? err.message : "The email provider call failed unexpectedly.", nowIso);
    }
    if (result.delivered) {
      return repo.updateCommunication(companyId, communication.id, {
        status: "Sent", sentAt: nowIso, deliveryResult: { providerMessageId: result.providerMessageId ?? null, messageId },
      });
    }
    return recordFailure(companyId, communication, result.failureReason ?? "Delivery failed.", nowIso);
  }

  return recordFailure(companyId, communication, `Channel "${communication.channel}" has no sender configured yet.`, nowIso);
}

async function recordFailure(companyId: string, communication: CommunicationRecord, reason: string, nowIso: string): Promise<CommunicationRecord> {
  const retryCount = communication.retryCount + 1;
  const exhausted = retryCount >= communication.maxRetries;
  const updated = await repo.updateCommunication(companyId, communication.id, {
    status: "Failed",
    retryCount,
    failureReason: reason,
    nextRetryAt: exhausted ? null : computeNextRetryAt(retryCount, nowIso),
  });
  if (exhausted) {
    const title = `Communication to ${communication.recipients[0]?.name ?? "recipient"} failed after ${retryCount} attempt(s)`;
    // Phase 25I — `createNotification` used to be unguarded here (only
    // the subsequent `createAlert` was wrapped): a real notification-
    // insert failure would throw straight out of `recordFailure`, out of
    // `deliverAndFinalize`, aborting `processCommunicationQueue`'s `for`
    // loop entirely — silently skipping every OTHER due communication
    // that pass, for a reason having nothing to do with them. Same class
    // of bug fixed in `scheduler-service.ts`'s exhausted-retry branch.
    try {
      const notification = await createNotification(companyId, {
        notificationType: "AutomationFailure",
        title,
        message: reason,
        severity: "critical",
        relatedType: "Communication",
        relatedId: communication.id,
      });
      // RC1 Phase 6 — same exhaustion moment, also raises a real
      // Operations Centre alert.
      await createAlert({ companyId, sourceEngine: "Communication Platform", severity: "critical", title, message: reason, relatedNotificationId: notification.id });
    } catch {
      // Never break queue processing over a notification/alerting failure.
    }
  }
  return updated;
}
