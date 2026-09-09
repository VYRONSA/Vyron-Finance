/**
 * Phase 24B — focused on the ONE new behavior this phase added to
 * `communication-service.ts`: `deliverAndFinalize`'s Email branch now
 * actually resolves and forwards real attachment bytes to
 * `EmailSender.send()`, via `processCommunicationQueue` (the real path
 * an Email-channel communication is delivered through — Email always
 * queues, never sends synchronously from `queueCommunication` itself).
 * Every dependency is mocked; nothing here touches a real Supabase
 * project or a real email provider.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/communication-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/communication-repository")>();
  return {
    ...actual,
    listPendingCommunications: vi.fn(),
    listCommunicationAttachments: vi.fn(),
    updateCommunication: vi.fn(),
    claimCommunicationForSending: vi.fn(),
    listStaleSendingCommunications: vi.fn(),
    reclaimStaleSendingCommunication: vi.fn(),
    getTemplateByCode: vi.fn(),
    createCommunication: vi.fn(),
    addCommunicationAttachments: vi.fn(),
    getCommunication: vi.fn(),
    getTemplate: vi.fn(),
  };
});
vi.mock("@/server/repositories/document-repository", () => ({ getDocument: vi.fn(), downloadDocumentFile: vi.fn() }));
vi.mock("@/server/services/workflow-service", () => ({
  startWorkflow: vi.fn(),
  decideStep: vi.fn(),
  ValidationError: class ValidationError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
}));
vi.mock("@/server/services/notification-service", () => ({ createNotification: vi.fn() }));
vi.mock("@/server/services/operations-service", () => ({ createAlert: vi.fn() }));
vi.mock("@/server/communications/channels/in-app-sender", () => ({ deliverInApp: vi.fn() }));
vi.mock("@/server/billing-platform/engine/usage-metering-engine", () => ({ recordUsageEvent: vi.fn() }));

import { processCommunicationQueue, queueCommunication, approveCommunication, testSend } from "./communication-service";
import * as repo from "@/server/repositories/communication-repository";
import { getDocument, downloadDocumentFile } from "@/server/repositories/document-repository";
import { createNotification } from "@/server/services/notification-service";
import { createAlert } from "@/server/services/operations-service";
import { startWorkflow, decideStep } from "@/server/services/workflow-service";
import { deliverInApp } from "@/server/communications/channels/in-app-sender";
import { buildCommunicationIdempotencyIdentity } from "@/server/communications/idempotency";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import type { CommunicationRecord, CommunicationTemplate } from "@/server/communications/types";
import type { EmailSender } from "@/server/communications/channels/email-sender";

function emailCommunication(overrides: Partial<CommunicationRecord> = {}): CommunicationRecord {
  return {
    id: 1, companyId: "company-a", module: "Sales", businessObjectType: "SalesInvoice", businessObjectId: 501,
    templateId: null, channel: "Email", recipients: [{ type: "Customer", id: 42, name: "Northwood", address: "jane@northwood.co.za" }],
    subject: "Tax Invoice INV000125", body: "<html>...</html>", variables: {}, status: "Queued", priority: "Normal",
    scheduledFor: "2026-08-01T00:00:00.000Z", expiresAt: null, retryCount: 0, maxRetries: 5, nextRetryAt: null, sentAt: null,
    deliveryResult: null, failureReason: null, approvalWorkflowInstanceId: null, relatedNotificationId: null, auditRef: null,
    createdBy: "Jane Accountant", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeEmailSender(): EmailSender & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn().mockResolvedValue({ delivered: true, providerMessageId: "msg_1" }) };
}

beforeEach(() => {
  vi.mocked(repo.updateCommunication).mockReset().mockImplementation(async (_companyId, id, patch) => ({ ...emailCommunication({ id }), ...patch }) as CommunicationRecord);
  vi.mocked(repo.listCommunicationAttachments).mockReset().mockResolvedValue([]);
  vi.mocked(repo.claimCommunicationForSending).mockReset().mockImplementation(async (_companyId, id) => emailCommunication({ id, status: "Sending" }));
  vi.mocked(repo.listStaleSendingCommunications).mockReset().mockResolvedValue([]);
  vi.mocked(repo.reclaimStaleSendingCommunication).mockReset().mockResolvedValue(true);
  vi.mocked(getDocument).mockReset();
  vi.mocked(downloadDocumentFile).mockReset();
  vi.mocked(createNotification).mockReset().mockResolvedValue({ id: 1 } as never);
  vi.mocked(repo.getCommunication).mockReset();
  vi.mocked(deliverInApp).mockReset().mockResolvedValue({ notificationId: 900 });
  vi.mocked(recordUsageEvent).mockReset().mockResolvedValue(undefined);
});

describe("processCommunicationQueue — Email attachments (Phase 24B)", () => {
  it("resolves and forwards the real attachment bytes to EmailSender.send", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication()]);
    vi.mocked(repo.listCommunicationAttachments).mockResolvedValue([{ id: 1, communicationId: 1, documentId: 999, createdAt: "2026-08-01T00:00:00.000Z" }]);
    vi.mocked(getDocument).mockResolvedValue({
      id: 999, companyId: "company-a", entityType: "SalesInvoice", entityId: 501, documentGroupId: null, versionNumber: 1,
      isCurrent: true, category: "Invoice", filename: "INV000125.pdf", storagePath: "company-a/501/INV000125.pdf", mimeType: "application/pdf",
      sizeBytes: 4, virusScanStatus: "skipped", ocrStatus: "skipped", ocrMetadata: null, retentionUntil: null,
      uploadedBy: "Jane Accountant", uploadedAt: "2026-08-01T00:00:00.000Z",
    } as never);
    vi.mocked(downloadDocumentFile).mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer);

    const emailSender = fakeEmailSender();
    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    expect(emailSender.send).toHaveBeenCalledTimes(1);
    const [to, subject, body, options] = emailSender.send.mock.calls[0]!;
    expect(to).toBe("jane@northwood.co.za");
    expect(subject).toBe("Tax Invoice INV000125");
    expect(body).toBe("<html>...</html>");
    expect(options.attachments).toHaveLength(1);
    expect(options.attachments[0]).toEqual({ filename: "INV000125.pdf", contentType: "application/pdf", content: Buffer.from([0x25, 0x50, 0x44, 0x46]) });
  });

  it("no regression: a communication with no attachments still sends with an empty attachments array", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication()]);
    vi.mocked(repo.listCommunicationAttachments).mockResolvedValue([]);

    const emailSender = fakeEmailSender();
    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    expect(emailSender.send).toHaveBeenCalledWith("jane@northwood.co.za", "Tax Invoice INV000125", "<html>...</html>", expect.objectContaining({ attachments: [] }));
    expect(getDocument).not.toHaveBeenCalled();
    expect(downloadDocumentFile).not.toHaveBeenCalled();
  });

  it("skips a linked document that's gone missing, rather than failing the whole send", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication()]);
    vi.mocked(repo.listCommunicationAttachments).mockResolvedValue([{ id: 1, communicationId: 1, documentId: 999, createdAt: "2026-08-01T00:00:00.000Z" }]);
    vi.mocked(getDocument).mockResolvedValue(null);

    const emailSender = fakeEmailSender();
    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    expect(emailSender.send).toHaveBeenCalledWith("jane@northwood.co.za", "Tax Invoice INV000125", "<html>...</html>", expect.objectContaining({ attachments: [] }));
  });

  it("skips an attachment that fails to download, rather than failing the whole send", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication()]);
    vi.mocked(repo.listCommunicationAttachments).mockResolvedValue([{ id: 1, communicationId: 1, documentId: 999, createdAt: "2026-08-01T00:00:00.000Z" }]);
    vi.mocked(getDocument).mockResolvedValue({ id: 999, filename: "x.pdf", mimeType: "application/pdf", storagePath: "p" } as never);
    vi.mocked(downloadDocumentFile).mockRejectedValue(new Error("storage unavailable"));

    const emailSender = fakeEmailSender();
    const outcome = await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    expect(emailSender.send).toHaveBeenCalledWith("jane@northwood.co.za", "Tax Invoice INV000125", "<html>...</html>", expect.objectContaining({ attachments: [] }));
    expect(outcome.sent).toBe(1);
  });

  it("skips a communication another concurrent run already claimed, instead of sending it a second time (Phase 25H race fix)", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication()]);
    vi.mocked(repo.claimCommunicationForSending).mockResolvedValue(null);

    const emailSender = fakeEmailSender();
    const outcome = await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    expect(emailSender.send).not.toHaveBeenCalled();
    expect(outcome).toEqual({ processed: 0, sent: 0, failed: 0, expired: 0 });
  });

  it("claims each due communication before delivering it, guarding the queue against a double-send race", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ id: 7 })]);

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", fakeEmailSender());

    expect(repo.claimCommunicationForSending).toHaveBeenCalledWith("company-a", 7);
  });

  it("an exhausted-retry notification failure does not abort processing of the REST of the queue (Phase 25I)", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([
      emailCommunication({ id: 1, retryCount: 4, maxRetries: 5 }),
      emailCommunication({ id: 2, retryCount: 0, maxRetries: 5, recipients: [{ type: "Customer", id: 43, name: "Southwood", address: "jane@southwood.co.za" }] }),
    ]);
    vi.mocked(createNotification).mockRejectedValue(new Error("notifications table unreachable"));
    const emailSender = fakeEmailSender();
    emailSender.send.mockResolvedValueOnce({ delivered: false, failureReason: "Provider rejected." }).mockResolvedValueOnce({ delivered: true, providerMessageId: "msg_2" });

    const outcome = await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    // Communication 1 exhausts its retries and its own notification
    // insert throws — this must not stop communication 2 from sending.
    expect(outcome).toEqual({ processed: 2, sent: 1, failed: 1, expired: 0 });
    expect(emailSender.send).toHaveBeenCalledTimes(2);
  });

  it("a thrown (not returned) email-provider error is recorded as a real failure instead of leaving the row unreachable (Phase 25I)", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ id: 3 })]);
    const emailSender = fakeEmailSender();
    emailSender.send.mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const outcome = await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    expect(outcome).toEqual({ processed: 1, sent: 0, failed: 1, expired: 0 });
    expect(repo.updateCommunication).toHaveBeenCalledWith("company-a", 3, expect.objectContaining({ status: "Failed", failureReason: "connect ECONNREFUSED" }));
  });

  it("reclaims a communication permanently stuck in Sending (its process crashed before finishing) back to Failed with real retry accounting", async () => {
    vi.mocked(repo.listStaleSendingCommunications).mockResolvedValue([emailCommunication({ id: 8, status: "Sending", retryCount: 0, maxRetries: 5 })]);
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([]);

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", fakeEmailSender());

    expect(repo.reclaimStaleSendingCommunication).toHaveBeenCalledWith("company-a", 8, expect.objectContaining({ retryCount: 1, nextRetryAt: expect.any(String) }));
  });

  it("fires the exhausted-retry notification/alert once a reclaimed communication's retries are exhausted", async () => {
    vi.mocked(repo.listStaleSendingCommunications).mockResolvedValue([emailCommunication({ id: 9, status: "Sending", retryCount: 4, maxRetries: 5 })]);
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([]);

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", fakeEmailSender());

    expect(repo.reclaimStaleSendingCommunication).toHaveBeenCalledWith("company-a", 9, expect.objectContaining({ retryCount: 5, nextRetryAt: null }));
    expect(createNotification).toHaveBeenCalledWith("company-a", expect.objectContaining({ notificationType: "AutomationFailure", relatedType: "Communication", relatedId: 9 }));
    expect(createAlert).toHaveBeenCalledTimes(1);
  });

  it("does NOT overwrite a communication that finished normally a split second before the reclaim ran (atomic guard holds)", async () => {
    vi.mocked(repo.listStaleSendingCommunications).mockResolvedValue([emailCommunication({ id: 10, status: "Sending", retryCount: 4, maxRetries: 5 })]);
    vi.mocked(repo.reclaimStaleSendingCommunication).mockResolvedValue(false);
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([]);

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", fakeEmailSender());

    expect(createNotification).not.toHaveBeenCalledWith("company-a", expect.objectContaining({ relatedId: 10 }));
  });

  it("a failure inside the reclaim sweep itself does not abort the rest of the queue processing", async () => {
    vi.mocked(repo.listStaleSendingCommunications).mockRejectedValue(new Error("communications table unreachable"));
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ id: 11 })]);

    const outcome = await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", fakeEmailSender());

    expect(outcome).toEqual({ processed: 1, sent: 1, failed: 0, expired: 0 });
    expect(createNotification).toHaveBeenCalledWith("company-a", expect.objectContaining({ title: expect.stringContaining("stale-send recovery sweep") }));
  });

  it("only fetches attachments for the exact company on the communication", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ companyId: "company-b" })]);
    vi.mocked(repo.listCommunicationAttachments).mockResolvedValue([{ id: 1, communicationId: 1, documentId: 999, createdAt: "2026-08-01T00:00:00.000Z" }]);
    vi.mocked(getDocument).mockResolvedValue({ id: 999, filename: "x.pdf", mimeType: "application/pdf", storagePath: "p" } as never);
    vi.mocked(downloadDocumentFile).mockResolvedValue(new ArrayBuffer(0));

    await processCommunicationQueue("company-b", "2026-08-01T00:00:01.000Z", fakeEmailSender());

    expect(getDocument).toHaveBeenCalledWith("company-b", 999);
  });
});

describe("processCommunicationQueue — outbound email idempotency (Phase 25J)", () => {
  it("the provider receives the exact idempotency information derived from the communication's own id", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ id: 501 })]);
    const emailSender = fakeEmailSender();

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    const expected = buildCommunicationIdempotencyIdentity(501);
    expect(emailSender.send).toHaveBeenCalledWith(
      "jane@northwood.co.za", "Tax Invoice INV000125", "<html>...</html>",
      expect.objectContaining({ idempotencyKey: expected.idempotencyKey, messageId: expected.messageId }),
    );
  });

  it("a RETRY (the same communication failing then being picked up again) uses the EXACT SAME idempotency key and Message-ID", async () => {
    const communication = emailCommunication({ id: 501, status: "Queued" });
    vi.mocked(repo.listPendingCommunications).mockResolvedValueOnce([communication]);
    const failingSender = fakeEmailSender();
    failingSender.send.mockResolvedValueOnce({ delivered: false, failureReason: "Provider timeout." });
    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", failingSender);
    const firstCallOptions = failingSender.send.mock.calls[0]![3];

    // Same row (id 501), now Failed, picked up again on the next pass —
    // exactly what a real retry looks like: no new communication, no new id.
    vi.mocked(repo.listPendingCommunications).mockResolvedValueOnce([{ ...communication, status: "Failed", retryCount: 1, nextRetryAt: "2026-08-01T00:04:00.000Z" }]);
    const retrySender = fakeEmailSender();
    await processCommunicationQueue("company-a", "2026-08-01T00:05:00.000Z", retrySender);
    const retryCallOptions = retrySender.send.mock.calls[0]![3];

    expect(retryCallOptions.idempotencyKey).toBe(firstCallOptions.idempotencyKey);
    expect(retryCallOptions.messageId).toBe(firstCallOptions.messageId);
  });

  it("a stale-Sending RECLAIM followed by a retry uses the SAME identity as the original attempt would have", async () => {
    vi.mocked(repo.listStaleSendingCommunications).mockResolvedValue([emailCommunication({ id: 501, status: "Sending", retryCount: 0, maxRetries: 5 })]);
    vi.mocked(repo.listPendingCommunications).mockResolvedValueOnce([]);
    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", fakeEmailSender());
    // Reclaim only ever flips status/retryCount/failureReason/nextRetryAt —
    // it never touches `id`, so the identity for the SAME row post-reclaim
    // is provably unchanged (it's a pure function of `id` alone).
    expect(repo.reclaimStaleSendingCommunication).toHaveBeenCalledWith("company-a", 501, expect.anything());

    vi.mocked(repo.listStaleSendingCommunications).mockResolvedValueOnce([]);
    vi.mocked(repo.listPendingCommunications).mockResolvedValueOnce([emailCommunication({ id: 501, status: "Failed", retryCount: 1, nextRetryAt: "2026-08-01T00:09:00.000Z" })]);
    const retrySender = fakeEmailSender();
    await processCommunicationQueue("company-a", "2026-08-01T00:10:00.000Z", retrySender);

    const expected = buildCommunicationIdempotencyIdentity(501);
    const retryCallOptions = retrySender.send.mock.calls[0]![3];
    expect(retryCallOptions.idempotencyKey).toBe(expected.idempotencyKey);
    expect(retryCallOptions.messageId).toBe(expected.messageId);
  });

  it("two DIFFERENT communications (a deliberate resend creates a new row/new id) get two DIFFERENT identities", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([
      emailCommunication({ id: 501 }),
      emailCommunication({ id: 502, recipients: [{ type: "Customer", id: 43, name: "Southwood", address: "jane@southwood.co.za" }] }),
    ]);
    const emailSender = fakeEmailSender();

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    const [firstOptions, secondOptions] = emailSender.send.mock.calls.map((call) => call[3]);
    expect(firstOptions.idempotencyKey).not.toBe(secondOptions.idempotencyKey);
    expect(firstOptions.messageId).not.toBe(secondOptions.messageId);
  });

  it("records the generated messageId on the successful deliveryResult, alongside the provider's own message id", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ id: 501 })]);
    const emailSender = fakeEmailSender();
    emailSender.send.mockResolvedValue({ delivered: true, providerMessageId: "provider-msg-abc" });

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    const expected = buildCommunicationIdempotencyIdentity(501);
    expect(repo.updateCommunication).toHaveBeenCalledWith("company-a", 501, expect.objectContaining({
      status: "Sent",
      deliveryResult: { providerMessageId: "provider-msg-abc", messageId: expected.messageId },
    }));
  });

  it("a communication lost to a concurrent claim race never reaches the provider at all — no identity is even computed for it", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ id: 501 })]);
    vi.mocked(repo.claimCommunicationForSending).mockResolvedValue(null);
    const emailSender = fakeEmailSender();

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it("NoOpEmailSender (the only sender wired in today) remains fully compatible with the extended send() signature", async () => {
    const { NoOpEmailSender } = await import("@/server/communications/channels/email-sender");
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ id: 501 })]);

    const outcome = await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", new NoOpEmailSender());

    // NoOp never claims delivery — it must still report an honest,
    // real failure, never crash on the new options fields it ignores.
    expect(outcome).toEqual({ processed: 1, sent: 0, failed: 1, expired: 0 });
  });
});

function approvalTemplate(overrides: Partial<CommunicationTemplate> = {}): CommunicationTemplate {
  return {
    id: 10, companyId: "company-a", code: "SUPPLIER_PAYMENT_APPROVAL", name: "Supplier Payment Approval", channel: "Email",
    category: "Suppliers", subjectTemplate: "Payment approval needed", bodyTemplate: "Please approve.", variablesSchema: [],
    branding: {}, requiresApproval: true, approvalWorkflowDefinitionId: 55, isActive: true, version: 1,
    createdBy: "System", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("queueCommunication — approval workflow start failure (Phase 25I)", () => {
  beforeEach(() => {
    vi.mocked(repo.getTemplateByCode).mockReset().mockResolvedValue(approvalTemplate());
    vi.mocked(repo.createCommunication).mockReset().mockResolvedValue(
      emailCommunication({ id: 42, status: "PendingApproval", templateId: 10, createdBy: "Jane Accountant" }),
    );
    vi.mocked(startWorkflow).mockReset();
    vi.mocked(repo.updateCommunication).mockReset().mockImplementation(async (_companyId, id, patch) => ({ ...emailCommunication({ id }), ...patch }) as CommunicationRecord);
  });

  it("never leaves the communication stranded at PendingApproval with no workflow instance when starting the workflow fails", async () => {
    vi.mocked(startWorkflow).mockRejectedValue(new Error("workflow_instances table unreachable"));

    await expect(
      queueCommunication("company-a", { module: "Purchasing", channel: "Email", recipients: [{ type: "Supplier", id: 1, name: "Acme", address: "ap@acme.co.za" }], templateCode: "SUPPLIER_PAYMENT_APPROVAL" }),
    ).rejects.toThrow("workflow_instances table unreachable");

    // Cancelled, not Queued/Failed — the normal send/retry queue has no
    // approval re-check, so a Failed row here would silently bypass the
    // approval this template requires.
    expect(repo.updateCommunication).toHaveBeenCalledWith("company-a", 42, expect.objectContaining({ status: "Cancelled" }));
  });

  it("still starts the workflow and returns normally when it succeeds (regression)", async () => {
    vi.mocked(startWorkflow).mockResolvedValue({ id: 900 } as never);

    const result = await queueCommunication(
      "company-a",
      { module: "Purchasing", channel: "Email", recipients: [{ type: "Supplier", id: 1, name: "Acme", address: "ap@acme.co.za" }], templateCode: "SUPPLIER_PAYMENT_APPROVAL" },
    );

    expect(result.approvalWorkflowInstanceId).toBe(900);
    expect(repo.updateCommunication).toHaveBeenCalledWith("company-a", 42, { approvalWorkflowInstanceId: 900 });
  });
});

describe("outbound email idempotency — no user-controlled key, tenant isolation (Phase 25J)", () => {
  it("QueueCommunicationInput has no idempotencyKey field — a caller cannot supply one even by trying to smuggle it in", async () => {
    vi.mocked(repo.createCommunication).mockReset().mockResolvedValue(emailCommunication({ id: 77, status: "Queued" }));

    // Simulates a careless/malicious caller trying to force a specific
    // identity by attaching an extra field the type system doesn't
    // declare — `queueCommunication` only ever reads its own named
    // fields, so this must be silently dropped, not honored.
    const maliciousInput = {
      module: "Sales", channel: "Email" as const, recipients: [{ type: "Customer" as const, id: 1, name: "Acme", address: "ap@acme.co.za" }],
      subject: "Invoice", body: "<html></html>", idempotencyKey: "attacker-supplied-key-to-force-a-collision",
    };
    await queueCommunication("company-a", maliciousInput as never);

    const createCall = vi.mocked(repo.createCommunication).mock.calls[0]![1];
    expect(createCall).not.toHaveProperty("idempotencyKey");
    expect(JSON.stringify(createCall)).not.toContain("attacker-supplied-key-to-force-a-collision");
  });

  it("the delivered identity always derives from the REAL persisted communication id, never a caller-supplied value", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ id: 501 })]);
    const emailSender = fakeEmailSender();

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSender);

    const expected = buildCommunicationIdempotencyIdentity(501);
    const callOptions = emailSender.send.mock.calls[0]![3];
    expect(callOptions.idempotencyKey).toBe(expected.idempotencyKey);
  });

  it("buildCommunicationIdempotencyIdentity takes only a numeric communication id — no companyId parameter exists for a cross-tenant value to leak through", () => {
    // Structural proof, not just behavioral: the function signature
    // itself has no channel for tenant data to enter, so it cannot be
    // tricked into producing another company's identity.
    expect(buildCommunicationIdempotencyIdentity.length).toBe(1);
  });

  it("one company's queue run never computes or sends an identity for another company's communication", async () => {
    vi.mocked(repo.listPendingCommunications).mockImplementation(async (companyId) =>
      companyId === "company-a" ? [emailCommunication({ id: 501, companyId: "company-a" })] : [],
    );
    const emailSenderA = fakeEmailSender();
    const emailSenderB = fakeEmailSender();

    await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", emailSenderA);
    await processCommunicationQueue("company-b", "2026-08-01T00:00:01.000Z", emailSenderB);

    expect(emailSenderA.send).toHaveBeenCalledTimes(1);
    expect(emailSenderB.send).not.toHaveBeenCalled();
  });
});

describe("immediate-delivery paths claim before delivering (Phase 25K)", () => {
  it("queueCommunication's InApp-immediate path claims the row before delivering", async () => {
    vi.mocked(repo.createCommunication).mockResolvedValue(emailCommunication({ id: 77, channel: "InApp", status: "Queued" }));

    await queueCommunication("company-a", { module: "Sales", channel: "InApp", recipients: [{ type: "User", id: 1, name: "Jane", address: null }], body: "Hi" });

    expect(repo.claimCommunicationForSending).toHaveBeenCalledWith("company-a", 77);
    expect(deliverInApp).toHaveBeenCalledTimes(1);
  });

  it("queueCommunication's InApp-immediate path does NOT deliver a second time when a concurrent queue pass already claimed it (the core fix)", async () => {
    vi.mocked(repo.createCommunication).mockResolvedValue(emailCommunication({ id: 78, channel: "InApp", status: "Queued" }));
    vi.mocked(repo.claimCommunicationForSending).mockResolvedValue(null);
    vi.mocked(repo.getCommunication).mockResolvedValue(emailCommunication({ id: 78, channel: "InApp", status: "Sent" }));

    const result = await queueCommunication("company-a", { module: "Sales", channel: "InApp", recipients: [{ type: "User", id: 1, name: "Jane", address: null }], body: "Hi" });

    expect(deliverInApp).not.toHaveBeenCalled();
    expect(result.status).toBe("Sent");
  });

  it("approveCommunication's InApp-immediate path claims before delivering, and skips delivery on a lost claim", async () => {
    const pending = emailCommunication({ id: 79, channel: "InApp", status: "PendingApproval", approvalWorkflowInstanceId: 55 });
    vi.mocked(repo.getCommunication).mockResolvedValueOnce(pending).mockResolvedValue(emailCommunication({ id: 79, channel: "InApp", status: "Sent" }));
    vi.mocked(decideStep).mockResolvedValue({ status: "Approved" } as never);
    vi.mocked(repo.updateCommunication).mockResolvedValueOnce(emailCommunication({ id: 79, channel: "InApp", status: "Queued" }));
    vi.mocked(repo.claimCommunicationForSending).mockResolvedValue(null);

    const result = await approveCommunication("company-a", 79, "jane@vyron.test");

    expect(repo.claimCommunicationForSending).toHaveBeenCalledWith("company-a", 79);
    expect(deliverInApp).not.toHaveBeenCalled();
    expect(result.status).toBe("Sent");
  });

  it("testSend claims before delivering", async () => {
    vi.mocked(repo.getTemplate).mockResolvedValue({
      id: 10, companyId: "company-a", code: "TEST", name: "Test", channel: "InApp", category: "Internal",
      subjectTemplate: null, bodyTemplate: "Hi", variablesSchema: [], branding: {}, requiresApproval: false,
      approvalWorkflowDefinitionId: null, isActive: true, version: 1, createdBy: "System",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    } as never);
    vi.mocked(repo.createCommunication).mockResolvedValue(emailCommunication({ id: 80, channel: "InApp", status: "Queued" }));

    await testSend("company-a", 10, "test@vyron.test", {}, "Jane Accountant");

    expect(repo.claimCommunicationForSending).toHaveBeenCalledWith("company-a", 80);
    expect(deliverInApp).toHaveBeenCalledTimes(1);
  });
});

describe("InApp delivery exception safety (Phase 25K)", () => {
  it("a thrown (not returned) InApp delivery error is recorded as a real failure instead of aborting the queue pass", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([emailCommunication({ id: 81, channel: "InApp" })]);
    vi.mocked(deliverInApp).mockRejectedValue(new Error("notifications table unreachable"));

    const outcome = await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", fakeEmailSender());

    expect(outcome).toEqual({ processed: 1, sent: 0, failed: 1, expired: 0 });
    expect(repo.updateCommunication).toHaveBeenCalledWith("company-a", 81, expect.objectContaining({ status: "Failed", failureReason: "notifications table unreachable" }));
  });

  it("an InApp delivery failure does not abort processing of OTHER due communications in the same pass", async () => {
    vi.mocked(repo.listPendingCommunications).mockResolvedValue([
      emailCommunication({ id: 82, channel: "InApp" }),
      emailCommunication({ id: 83, channel: "Email" }),
    ]);
    vi.mocked(deliverInApp).mockRejectedValue(new Error("notifications table unreachable"));

    const outcome = await processCommunicationQueue("company-a", "2026-08-01T00:00:01.000Z", fakeEmailSender());

    expect(outcome).toEqual({ processed: 2, sent: 1, failed: 1, expired: 0 });
  });
});
