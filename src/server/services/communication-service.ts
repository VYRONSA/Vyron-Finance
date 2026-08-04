/**
 * Service layer for the RC1 Phase 5 Communication Platform — the ONE
 * place `queueCommunication()` is called from, on every channel, by
 * every module. Approval reuses the existing generic Workflow Engine
 * (`workflow-service.ts`); queue processing is invoked by the existing
 * Automation Scheduler (`scheduler-service.ts`, via a `CommunicationQueue`
 * task) rather than a bespoke loop of its own.
 */

import * as repo from "@/server/repositories/communication-repository";
import { getDocument } from "@/server/repositories/document-repository";
import * as workflowService from "@/server/services/workflow-service";
import { createNotification } from "@/server/services/notification-service";
import { createAlert } from "@/server/services/operations-service";
import { deliverInApp } from "@/server/communications/channels/in-app-sender";
import { defaultEmailSender, type EmailSender } from "@/server/communications/channels/email-sender";
import { findMissingVariables, renderTemplate } from "@/server/communications/template-engine";
import { computeNextRetryAt, selectDueCommunications, selectExpiredCommunications } from "@/server/communications/queue-engine";
import { IMPLEMENTED_CHANNELS } from "@/server/communications/types";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import type {
  CommunicationChannel, CommunicationPriority, CommunicationRecipient, CommunicationRecord, CommunicationTemplate,
} from "@/server/communications/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listCommunications = repo.listCommunications;
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
  return deliverAndFinalize(companyId, communication, new Date().toISOString(), emailSender);
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
    const instance = await workflowService.startWorkflow(companyId, template.approvalWorkflowDefinitionId, "Communication", communication.id);
    return repo.updateCommunication(companyId, communication.id, { approvalWorkflowInstanceId: instance.id });
  }

  if (communication.status === "Queued" && communication.channel === "InApp") {
    return deliverAndFinalize(companyId, communication, new Date().toISOString(), emailSender);
  }

  return communication;
}

// ---- Approval (reuses the existing Workflow Engine) --------------------

export async function approveCommunication(companyId: string, communicationId: number, performedBy: string, note = ""): Promise<CommunicationRecord> {
  const communication = await repo.getCommunication(companyId, communicationId);
  if (!communication) throw new NotFoundError(`No communication with id ${communicationId}.`);
  if (communication.status !== "PendingApproval") throw new ValidationError(`Communication is ${communication.status}, not awaiting approval.`);
  if (!communication.approvalWorkflowInstanceId) throw new ValidationError("Communication has no approval workflow instance.");

  const instance = await workflowService.decideStep(companyId, communication.approvalWorkflowInstanceId, "Approved", performedBy, note);
  if (instance.status !== "Approved") return repo.getCommunication(companyId, communicationId) as Promise<CommunicationRecord>;

  const queued = await repo.updateCommunication(companyId, communicationId, { status: "Queued" });
  if (queued.channel === "InApp") return deliverAndFinalize(companyId, queued, new Date().toISOString());
  return queued;
}

export async function rejectCommunication(companyId: string, communicationId: number, performedBy: string, note = ""): Promise<CommunicationRecord> {
  const communication = await repo.getCommunication(companyId, communicationId);
  if (!communication) throw new NotFoundError(`No communication with id ${communicationId}.`);
  if (communication.status !== "PendingApproval") throw new ValidationError(`Communication is ${communication.status}, not awaiting approval.`);
  if (!communication.approvalWorkflowInstanceId) throw new ValidationError("Communication has no approval workflow instance.");

  await workflowService.decideStep(companyId, communication.approvalWorkflowInstanceId, "Rejected", performedBy, note);
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

export async function processCommunicationQueue(companyId: string, nowIso: string, emailSender: EmailSender = defaultEmailSender): Promise<QueueRunOutcome> {
  const pending = await repo.listPendingCommunications(companyId);

  const expired = selectExpiredCommunications(pending, nowIso);
  for (const communication of expired) {
    await repo.updateCommunication(companyId, communication.id, { status: "Expired" });
  }
  const expiredIds = new Set(expired.map((c) => c.id));

  const due = selectDueCommunications(pending.filter((c) => !expiredIds.has(c.id)), nowIso);
  let sent = 0;
  let failed = 0;
  for (const communication of due) {
    const result = await deliverAndFinalize(companyId, communication, nowIso, emailSender);
    if (result.status === "Sent") sent++;
    else failed++;
  }

  // Commercial Billing Platform — one Usage Engine event per successful
  // send (not per queued/failed item — "Communications" is a plan usage
  // dimension for delivered messages).
  if (sent > 0) await recordUsageEvent(companyId, "communications", sent);

  return { processed: due.length, sent, failed, expired: expired.length };
}

async function deliverAndFinalize(companyId: string, communication: CommunicationRecord, nowIso: string, emailSender: EmailSender = defaultEmailSender): Promise<CommunicationRecord> {
  if (communication.channel === "InApp") {
    const result = await deliverInApp(companyId, communication.recipients, communication.subject, communication.body, communication.businessObjectType, communication.businessObjectId);
    return repo.updateCommunication(companyId, communication.id, {
      status: "Sent", sentAt: nowIso, relatedNotificationId: result.notificationId, deliveryResult: { notificationId: result.notificationId },
    });
  }

  if (communication.channel === "Email") {
    const address = communication.recipients.find((r) => r.address)?.address;
    if (!address) return recordFailure(companyId, communication, "No recipient email address on file.", nowIso);
    const result = await emailSender.send(address, communication.subject ?? "", communication.body);
    if (result.delivered) {
      return repo.updateCommunication(companyId, communication.id, {
        status: "Sent", sentAt: nowIso, deliveryResult: { providerMessageId: result.providerMessageId ?? null },
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
    const notification = await createNotification(companyId, {
      notificationType: "AutomationFailure",
      title,
      message: reason,
      severity: "critical",
      relatedType: "Communication",
      relatedId: communication.id,
    });
    // RC1 Phase 6 — same exhaustion moment, also raises a real Operations
    // Centre alert; fire-and-forget so an alerting failure never breaks
    // queue processing.
    try {
      await createAlert({ companyId, sourceEngine: "Communication Platform", severity: "critical", title, message: reason, relatedNotificationId: notification.id });
    } catch {
      // Never break queue processing over an alerting failure.
    }
  }
  return updated;
}
