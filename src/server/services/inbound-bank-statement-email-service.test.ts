/**
 * Phase 21C — comprehensive tests for the inbound bank-statement-email
 * orchestrator: idempotency, tenant isolation, attachment handling,
 * existing-import-pipeline wiring, and failure handling. Every
 * dependency is mocked; this never touches a real Supabase project or
 * the real Resend API.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/server/inbound-email/resend-client", () => ({ getResendClient: vi.fn() }));
vi.mock("@/server/inbound-email/attachment-fetcher", () => ({
  fetchAttachmentMetadata: vi.fn(),
  downloadAttachmentBytes: vi.fn(),
  AttachmentFetchError: class AttachmentFetchError extends Error {},
}));
vi.mock("@/server/repositories/resend-webhook-event-repository", () => ({
  findResendWebhookEvent: vi.fn(),
  insertResendWebhookEvent: vi.fn(),
  setResendWebhookEventCompany: vi.fn(),
  completeResendWebhookEvent: vi.fn(),
}));
vi.mock("@/server/repositories/company-bank-statement-email-admin-repository", () => ({
  findActiveCompanyBankStatementEmailByIdentifier: vi.fn(),
  recordBankStatementEmailReceived: vi.fn(),
  recordBankStatementEmailImportSucceeded: vi.fn(),
  recordBankStatementEmailImportFailed: vi.fn(),
}));
vi.mock("@/server/services/import-service", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/import-service")>("@/server/services/import-service");
  return { ...actual, importBankStatement: vi.fn(), previewPdfBankStatement: vi.fn(), confirmPdfBankStatementImport: vi.fn() };
});
vi.mock("@/server/services/notification-service", () => ({ createNotification: vi.fn() }));
vi.mock("@/server/services/operations-service", () => ({ createAlert: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isSupabaseAdminConfigured: vi.fn() }));
vi.mock("@/server/inbound-email/imap-client", () => ({
  isImapConfigured: vi.fn(),
  getImapConnectionConfig: vi.fn(),
  createImapClient: vi.fn(),
}));
vi.mock("@/server/inbound-email/imap-adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/inbound-email/imap-adapter")>();
  return { ...actual, listCandidateMessages: vi.fn(), fetchMessageSource: vi.fn(), moveMessage: vi.fn(), parseImapMessageToInboundEmailMessage: vi.fn() };
});

import { processResendInboundEmail, pollBankStatementImapMailbox } from "./inbound-bank-statement-email-service";
import { isImapConfigured, getImapConnectionConfig, createImapClient } from "@/server/inbound-email/imap-client";
import { listCandidateMessages, fetchMessageSource, moveMessage, parseImapMessageToInboundEmailMessage, MAX_RAW_MESSAGE_SIZE_BYTES } from "@/server/inbound-email/imap-adapter";
import type { InboundEmailMessage } from "@/server/inbound-email/types";
import { getResendClient } from "@/server/inbound-email/resend-client";
import { fetchAttachmentMetadata, downloadAttachmentBytes, AttachmentFetchError } from "@/server/inbound-email/attachment-fetcher";
import * as webhookEventRepo from "@/server/repositories/resend-webhook-event-repository";
import * as identityAdminRepo from "@/server/repositories/company-bank-statement-email-admin-repository";
import { importBankStatement, previewPdfBankStatement, confirmPdfBankStatementImport, ValidationError } from "@/server/services/import-service";
import { createNotification } from "@/server/services/notification-service";
import { createAlert } from "@/server/services/operations-service";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { getServerExecutionContextClient } from "@/lib/supabase/execution-context";
import type { EmailReceivedEvent } from "resend";
import type { CompanyBankStatementEmailRecord } from "@/server/company-bank-statement-email/types";
import type { ResendWebhookEventRecord } from "@/server/repositories/resend-webhook-event-repository";
import type { SupabaseClient } from "@supabase/supabase-js";

const FAKE_ADMIN_CLIENT = { __label: "admin-client" } as unknown as SupabaseClient;
const FAKE_IMAP_CLIENT = { connect: vi.fn(), logout: vi.fn() } as unknown as import("imapflow").ImapFlow;

function imapMessage(overrides: Partial<InboundEmailMessage> = {}): InboundEmailMessage {
  return {
    provider: "imap",
    providerEventId: "999:1",
    messageId: "<abc@thebank.co.za>",
    from: "statements@thebank.co.za",
    to: ["bankstatements@vyronsoft.co.za"],
    cc: [],
    subject: "Your statement",
    receivedAt: "2026-08-01T10:00:00.000Z",
    headers: { "x-original-to": "company-a-a7k3.bank@imports.vyronfinance.co.za" },
    attachments: [
      {
        filename: "statement.pdf",
        contentType: "application/pdf",
        contentDisposition: "attachment",
        getMetadata: async () => ({ sizeBytes: 2048, filename: "statement.pdf" }),
        getBytes: async () => new ArrayBuffer(8),
      },
    ],
    ...overrides,
  };
}

type ReceivedEmailAttachment = EmailReceivedEvent["data"]["attachments"][number];

const ORIGINAL_DOMAIN = process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;

function attachment(overrides: Partial<ReceivedEmailAttachment> = {}): ReceivedEmailAttachment {
  return { id: "att_1", filename: "statement.pdf", content_type: "application/pdf", content_disposition: "attachment", content_id: null, ...overrides };
}

function event(overrides: Partial<EmailReceivedEvent["data"]> = {}): EmailReceivedEvent {
  return {
    type: "email.received",
    created_at: "2026-08-01T10:00:00.000Z",
    data: {
      email_id: "email_1",
      created_at: "2026-08-01T10:00:00.000Z",
      from: "statements@thebank.co.za",
      to: ["company-a-a7k3.bank@imports.vyronfinance.co.za"],
      bcc: [],
      cc: [],
      received_for: [],
      message_id: "<abc@thebank.co.za>",
      subject: "Your monthly statement",
      attachments: [attachment()],
      ...overrides,
    },
  };
}

function webhookEventRecord(overrides: Partial<ResendWebhookEventRecord> = {}): ResendWebhookEventRecord {
  return {
    id: 1, provider: "resend", providerEventId: "msg_1", eventType: "email.received",
    companyId: null, status: "received", receivedAt: "2026-08-01T10:00:00.000Z", processedAt: null, error: null,
    ...overrides,
  };
}

function identity(overrides: Partial<CompanyBankStatementEmailRecord> = {}): CompanyBankStatementEmailRecord {
  return {
    id: 1, companyId: "company-a", stableIdentifier: "company-a-a7k3", status: "active",
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    lastReceivedAt: null, lastSuccessfulImportAt: null, lastFailureAt: null,
    ...overrides,
  };
}

function attachmentMetadata(overrides: Record<string, unknown> = {}) {
  return { attachmentId: "att_1", filename: "statement.pdf", sizeBytes: 2048, contentType: "application/pdf", contentDisposition: "attachment" as const, downloadUrl: "https://inbound-cdn.resend.com/signed", ...overrides };
}

beforeEach(() => {
  vi.mocked(getResendClient).mockReset().mockReturnValue({} as never);
  vi.mocked(fetchAttachmentMetadata).mockReset();
  vi.mocked(downloadAttachmentBytes).mockReset().mockResolvedValue(new ArrayBuffer(8));
  vi.mocked(webhookEventRepo.findResendWebhookEvent).mockReset().mockResolvedValue(null);
  vi.mocked(webhookEventRepo.insertResendWebhookEvent).mockReset().mockResolvedValue({ record: webhookEventRecord(), inserted: true });
  vi.mocked(webhookEventRepo.setResendWebhookEventCompany).mockReset().mockResolvedValue(undefined);
  vi.mocked(webhookEventRepo.completeResendWebhookEvent).mockReset().mockResolvedValue(undefined);
  vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockReset().mockResolvedValue(identity());
  vi.mocked(identityAdminRepo.recordBankStatementEmailReceived).mockReset().mockResolvedValue(undefined);
  vi.mocked(identityAdminRepo.recordBankStatementEmailImportSucceeded).mockReset().mockResolvedValue(undefined);
  vi.mocked(identityAdminRepo.recordBankStatementEmailImportFailed).mockReset().mockResolvedValue(undefined);
  vi.mocked(importBankStatement).mockReset();
  vi.mocked(previewPdfBankStatement).mockReset();
  vi.mocked(confirmPdfBankStatementImport).mockReset();
  vi.mocked(createNotification).mockReset().mockResolvedValue({ id: 99 } as never);
  vi.mocked(createAlert).mockReset().mockResolvedValue({} as never);
  vi.mocked(createAdminClient).mockReset().mockReturnValue(FAKE_ADMIN_CLIENT);
  vi.mocked(isSupabaseAdminConfigured).mockReset().mockReturnValue(true);
  vi.mocked(isImapConfigured).mockReset().mockReturnValue(true);
  vi.mocked(getImapConnectionConfig).mockReset().mockReturnValue({
    host: "mail.vyronsoft.co.za", port: 993, secure: true, user: "bankstatements@vyronsoft.co.za", pass: "x",
    mailbox: "INBOX", processedMailbox: "Processed", failedMailbox: "Failed",
  });
  vi.mocked(createImapClient).mockReset().mockReturnValue(FAKE_IMAP_CLIENT);
  vi.mocked(FAKE_IMAP_CLIENT.connect).mockReset().mockResolvedValue(undefined);
  vi.mocked(FAKE_IMAP_CLIENT.logout).mockReset().mockResolvedValue(undefined);
  vi.mocked(listCandidateMessages).mockReset().mockResolvedValue({ uidValidity: BigInt(999), candidates: [] });
  vi.mocked(fetchMessageSource).mockReset();
  vi.mocked(moveMessage).mockReset().mockResolvedValue(undefined);
  vi.mocked(parseImapMessageToInboundEmailMessage).mockReset();
  process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
});

afterEach(() => {
  if (ORIGINAL_DOMAIN === undefined) delete process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;
  else process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = ORIGINAL_DOMAIN;
});

describe("idempotency", () => {
  it("processes a new event exactly once (same event ID processed once)", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 5, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("processed");
    expect(webhookEventRepo.insertResendWebhookEvent).toHaveBeenCalledTimes(1);
    expect(confirmPdfBankStatementImport).toHaveBeenCalledTimes(1);
  });

  it("a duplicate webhook delivery of an already-processed event does not create a second import", async () => {
    vi.mocked(webhookEventRepo.findResendWebhookEvent).mockResolvedValue(webhookEventRecord({ status: "processed", companyId: "company-a" }));

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("already-processed");
    expect(previewPdfBankStatement).not.toHaveBeenCalled();
    expect(confirmPdfBankStatementImport).not.toHaveBeenCalled();
    expect(importBankStatement).not.toHaveBeenCalled();
  });

  it("a duplicate webhook delivery of an already-rejected event does not reprocess or re-notify", async () => {
    vi.mocked(webhookEventRepo.findResendWebhookEvent).mockResolvedValue(webhookEventRecord({ status: "rejected", companyId: null }));

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("already-processed");
    expect(createNotification).not.toHaveBeenCalled();
    expect(webhookEventRepo.insertResendWebhookEvent).not.toHaveBeenCalled();
  });

  it("a genuine race between two concurrent deliveries of the SAME event (both pass findResendWebhookEvent's null check) never runs the import twice (Phase 25H)", async () => {
    // Both requests see `findResendWebhookEvent` return null (neither has
    // inserted yet), but only one INSERT can win the unique constraint —
    // the repository surfaces the loser as `inserted: false` rather than
    // throwing an uncaught 23505.
    vi.mocked(webhookEventRepo.insertResendWebhookEvent).mockResolvedValue({
      record: webhookEventRecord({ status: "received", companyId: "company-a" }),
      inserted: false,
    });

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("already-processed");
    expect(outcome.companyId).toBe("company-a");
    expect(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).not.toHaveBeenCalled();
    expect(previewPdfBankStatement).not.toHaveBeenCalled();
    expect(importBankStatement).not.toHaveBeenCalled();
  });
});

describe("tenant isolation", () => {
  it("Company A's recipient resolves only to Company A", async () => {
    vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockResolvedValue(identity({ companyId: "company-a" }));
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    const outcome = await processResendInboundEmail(event({ to: ["company-a-a7k3.bank@imports.vyronfinance.co.za"] }), "msg_1");

    expect(outcome.companyId).toBe("company-a");
    expect(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).toHaveBeenCalledWith("company-a-a7k3");
    expect(confirmPdfBankStatementImport).toHaveBeenCalledWith("company-a", expect.anything(), expect.anything());
  });

  it("Company B's recipient resolves only to Company B", async () => {
    vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockResolvedValue(identity({ companyId: "company-b", stableIdentifier: "company-b-x9q2" }));
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    const outcome = await processResendInboundEmail(event({ to: ["company-b-x9q2.bank@imports.vyronfinance.co.za"] }), "msg_1");

    expect(outcome.companyId).toBe("company-b");
    expect(confirmPdfBankStatementImport).toHaveBeenCalledWith("company-b", expect.anything(), expect.anything());
    expect(confirmPdfBankStatementImport).not.toHaveBeenCalledWith("company-a", expect.anything(), expect.anything());
  });

  it("rejects an unknown recipient — never falls back to another company", async () => {
    const outcome = await processResendInboundEmail(event({ to: ["someone@unrelated-domain.com"] }), "msg_1");

    expect(outcome.status).toBe("rejected");
    expect(outcome.companyId).toBeNull();
    expect(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).not.toHaveBeenCalled();
    expect(previewPdfBankStatement).not.toHaveBeenCalled();
  });

  it("rejects a disabled recipient (the admin repo already filters to active identities, so this returns null)", async () => {
    vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockResolvedValue(null);

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("rejected");
    expect(outcome.companyId).toBeNull();
    expect(previewPdfBankStatement).not.toHaveBeenCalled();
  });

  it("never causes an import into a different company than the one the recipient resolved to", async () => {
    vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockResolvedValue(identity({ companyId: "company-a" }));
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    await processResendInboundEmail(event(), "msg_1");

    for (const call of vi.mocked(confirmPdfBankStatementImport).mock.calls) expect(call[0]).toBe("company-a");
    for (const call of vi.mocked(webhookEventRepo.setResendWebhookEventCompany).mock.calls) expect(call[1]).toBe("company-a");
  });
});

describe("attachment handling", () => {
  function expectDispatchToPdfPath() {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata({ filename: "statement.pdf" }));
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });
  }

  it("accepts a PDF attachment, dispatching through preview + confirm", async () => {
    expectDispatchToPdfPath();
    const outcome = await processResendInboundEmail(event({ attachments: [attachment({ filename: "statement.pdf", content_type: "application/pdf" })] }), "msg_1");
    expect(outcome.status).toBe("processed");
    expect(previewPdfBankStatement).toHaveBeenCalledTimes(1);
    expect(confirmPdfBankStatementImport).toHaveBeenCalledTimes(1);
    expect(importBankStatement).not.toHaveBeenCalled();
  });

  it.each([
    ["statement.csv", "text/csv"],
    ["statement.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["statement.ofx", "application/x-ofx"],
    ["statement.qif", "application/qif"],
  ])("accepts a %s attachment, dispatching through the direct-commit path", async (filename, contentType) => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata({ filename, contentType }));
    vi.mocked(importBankStatement).mockResolvedValue({ batch: { importedCount: 3, duplicateCount: 1, exceptionCount: 0 } as never, exceptions: [], rulesAutoAllocated: 0 });

    const outcome = await processResendInboundEmail(event({ attachments: [attachment({ filename, content_type: contentType })] }), "msg_1");

    expect(outcome.status).toBe("processed");
    expect(importBankStatement).toHaveBeenCalledTimes(1);
    expect(previewPdfBankStatement).not.toHaveBeenCalled();
  });

  it("rejects an unsupported attachment extension", async () => {
    const outcome = await processResendInboundEmail(event({ attachments: [attachment({ filename: "invoice.zip", content_type: "application/zip" })] }), "msg_1");
    expect(outcome.status).toBe("rejected");
    expect(fetchAttachmentMetadata).not.toHaveBeenCalled();
  });

  it("rejects an oversized attachment without downloading its bytes", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata({ sizeBytes: 26 * 1024 * 1024 }));
    const outcome = await processResendInboundEmail(event(), "msg_1");
    expect(outcome.status).toBe("rejected");
    expect(downloadAttachmentBytes).not.toHaveBeenCalled();
  });

  it("rejects a missing attachment (no supported attachment at all)", async () => {
    const outcome = await processResendInboundEmail(event({ attachments: [] }), "msg_1");
    expect(outcome.status).toBe("rejected");
  });

  it("rejects an empty (zero-byte) attachment", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata({ sizeBytes: 0 }));
    const outcome = await processResendInboundEmail(event(), "msg_1");
    expect(outcome.status).toBe("rejected");
    expect(downloadAttachmentBytes).not.toHaveBeenCalled();
  });

  it("never processes an inline image as a bank statement", async () => {
    const outcome = await processResendInboundEmail(event({ attachments: [attachment({ filename: "logo.png", content_type: "image/png", content_disposition: "inline" })] }), "msg_1");
    expect(outcome.status).toBe("rejected");
    expect(fetchAttachmentMetadata).not.toHaveBeenCalled();
  });
});

describe("import pipeline integration", () => {
  it("passes a real File built from the downloaded bytes into the existing import pipeline", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata({ filename: "statement.csv", contentType: "text/csv" }));
    vi.mocked(downloadAttachmentBytes).mockResolvedValue(new TextEncoder().encode("date,amount\n").buffer);
    vi.mocked(importBankStatement).mockResolvedValue({ batch: { importedCount: 2, duplicateCount: 0, exceptionCount: 0 } as never, exceptions: [], rulesAutoAllocated: 1 });

    await processResendInboundEmail(event({ attachments: [attachment({ filename: "statement.csv", content_type: "text/csv" })] }), "msg_1");

    const [companyId, file] = vi.mocked(importBankStatement).mock.calls[0]!;
    expect(companyId).toBe("company-a");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("statement.csv");
  });

  it("returns the real imported/duplicate/exception counts from the existing pipeline — never fabricated figures", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata({ filename: "statement.csv", contentType: "text/csv" }));
    vi.mocked(importBankStatement).mockResolvedValue({ batch: { importedCount: 7, duplicateCount: 3, exceptionCount: 1 } as never, exceptions: [{}] as never, rulesAutoAllocated: 2 });

    const outcome = await processResendInboundEmail(event({ attachments: [attachment({ filename: "statement.csv", content_type: "text/csv" })] }), "msg_1");

    expect(outcome.result).toEqual({ filename: "statement.csv", importedCount: 7, duplicateCount: 3, exceptionCount: 1 });
  });

  it("marks the webhook event processed and records a successful-import timestamp", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    await processResendInboundEmail(event(), "msg_1");

    expect(webhookEventRepo.completeResendWebhookEvent).toHaveBeenCalledWith(1, "processed", null);
    expect(identityAdminRepo.recordBankStatementEmailImportSucceeded).toHaveBeenCalledWith("company-a", expect.any(String));
  });
});

describe("failure handling", () => {
  it("returns a retryable 'failed' status when the attachment download fails", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(downloadAttachmentBytes).mockRejectedValue(new AttachmentFetchError("Could not download."));

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("failed");
    expect(webhookEventRepo.completeResendWebhookEvent).toHaveBeenCalledWith(1, "failed", expect.any(String));
  });

  it("returns a retryable 'failed' status (never leaves the event stuck at 'received') when recipient-identity resolution fails transiently (Phase 25I)", async () => {
    vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockRejectedValue(new Error("company_bank_statement_email table unreachable"));

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("failed");
    expect(webhookEventRepo.completeResendWebhookEvent).toHaveBeenCalledWith(1, "failed", expect.stringContaining("unreachable"));
    expect(previewPdfBankStatement).not.toHaveBeenCalled();
  });

  it("returns a retryable 'failed' status when stamping the resolved company on the event fails transiently (Phase 25I)", async () => {
    vi.mocked(webhookEventRepo.setResendWebhookEventCompany).mockRejectedValue(new Error("resend_webhook_events table unreachable"));

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("failed");
    expect(outcome.companyId).toBe("company-a");
    expect(webhookEventRepo.completeResendWebhookEvent).toHaveBeenCalledWith(1, "failed", expect.stringContaining("unreachable"));
    expect(previewPdfBankStatement).not.toHaveBeenCalled();
  });

  it("handles a corrupt/unrecognized PDF honestly as a permanent rejection (never fabricates success)", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockRejectedValue(new ValidationError("This PDF is password-protected and cannot be read."));

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("rejected");
    expect(outcome.reason).toContain("password-protected");
  });

  it("handles an unexpected import engine failure honestly as a retryable failure", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockRejectedValue(new Error("database connection reset"));

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("failed");
  });

  it("records a partial import's real duplicate/exception counts rather than treating it as an all-or-nothing failure", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata({ filename: "statement.csv", contentType: "text/csv" }));
    vi.mocked(importBankStatement).mockResolvedValue({ batch: { importedCount: 4, duplicateCount: 6, exceptionCount: 2 } as never, exceptions: [{}, {}] as never, rulesAutoAllocated: 0 });

    const outcome = await processResendInboundEmail(event({ attachments: [attachment({ filename: "statement.csv", content_type: "text/csv" })] }), "msg_1");

    expect(outcome.status).toBe("processed");
    expect(outcome.result).toEqual({ filename: "statement.csv", importedCount: 4, duplicateCount: 6, exceptionCount: 2 });
  });

  it("notifies the company (following the existing AutomationFailure convention) on a real failure, and never on success", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockRejectedValue(new Error("transient failure"));

    await processResendInboundEmail(event(), "msg_1");

    expect(createNotification).toHaveBeenCalledWith("company-a", expect.objectContaining({ notificationType: "AutomationFailure" }));
    expect(createAlert).toHaveBeenCalledTimes(1);
  });

  it("never sends a notification for a successful import", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    await processResendInboundEmail(event(), "msg_1");

    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe("Phase 21D — server-to-server admin execution context", () => {
  it("runs the existing import pipeline with the admin client active via the execution context — not the (unavailable) session client", async () => {
    let capturedClient: unknown;
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockImplementation(async () => {
      capturedClient = getServerExecutionContextClient();
      return { batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never;
    });
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    await processResendInboundEmail(event(), "msg_1");

    expect(capturedClient).toBe(FAKE_ADMIN_CLIENT);
  });

  it("runs notification/alert calls with the admin client active too", async () => {
    let capturedClient: unknown;
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockRejectedValue(new Error("transient failure"));
    vi.mocked(createNotification).mockImplementation(async () => {
      capturedClient = getServerExecutionContextClient();
      return { id: 1 } as never;
    });

    await processResendInboundEmail(event(), "msg_1");

    expect(capturedClient).toBe(FAKE_ADMIN_CLIENT);
  });

  it("no execution context is active before or after processing a webhook (never leaks)", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    expect(getServerExecutionContextClient()).toBeUndefined();
    await processResendInboundEmail(event(), "msg_1");
    expect(getServerExecutionContextClient()).toBeUndefined();
  });

  it("returns an honest 'failed' outcome (never a fabricated success) when the admin client isn't configured", async () => {
    vi.mocked(isSupabaseAdminConfigured).mockReturnValue(false);

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(outcome.status).toBe("failed");
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(webhookEventRepo.findResendWebhookEvent).not.toHaveBeenCalled();
    expect(previewPdfBankStatement).not.toHaveBeenCalled();
  });

  it("never includes the service-role key in a returned outcome", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    const outcome = await processResendInboundEmail(event(), "msg_1");

    expect(JSON.stringify(outcome)).not.toMatch(/service[_-]?role/i);
  });

  it("Phase 21K regression: the Resend path still queries/inserts webhook events scoped to provider='resend', unchanged by the IMAP provider widening", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    await processResendInboundEmail(event(), "msg_1");

    expect(webhookEventRepo.findResendWebhookEvent).toHaveBeenCalledWith("msg_1", "resend");
    expect(webhookEventRepo.insertResendWebhookEvent).toHaveBeenCalledWith("msg_1", "email.received", "resend");
  });
});

describe("pollBankStatementImapMailbox — Phase 21K", () => {
  it("returns configured:false and never attempts a connection when IMAP env vars aren't set", async () => {
    vi.mocked(isImapConfigured).mockReturnValue(false);
    const outcome = await pollBankStatementImapMailbox();
    expect(outcome.configured).toBe(false);
    expect(FAKE_IMAP_CLIENT.connect).not.toHaveBeenCalled();
  });

  it("returns configured:false when the Supabase admin client isn't configured", async () => {
    vi.mocked(isSupabaseAdminConfigured).mockReturnValue(false);
    const outcome = await pollBankStatementImapMailbox();
    expect(outcome.configured).toBe(false);
    expect(FAKE_IMAP_CLIENT.connect).not.toHaveBeenCalled();
  });

  it("propagates (never swallows) a real IMAP connection failure", async () => {
    vi.mocked(FAKE_IMAP_CLIENT.connect).mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(pollBankStatementImapMailbox()).rejects.toThrow("ECONNREFUSED");
  });

  it("propagates a real IMAP authentication failure the same way — never reported as a false 'nothing to do' success", async () => {
    vi.mocked(FAKE_IMAP_CLIENT.connect).mockRejectedValue(new Error("Invalid credentials (Failure)"));
    await expect(pollBankStatementImapMailbox()).rejects.toThrow("Invalid credentials");
  });

  it("returns an all-zero outcome for an empty mailbox, without error, and still disconnects", async () => {
    const outcome = await pollBankStatementImapMailbox();
    expect(outcome).toEqual({ configured: true, candidates: 0, processed: 0, rejected: 0, failed: 0, duplicate: 0, elapsedMs: expect.any(Number) });
    expect(FAKE_IMAP_CLIENT.logout).toHaveBeenCalledTimes(1);
  });

  it("processes one valid message end-to-end (real company resolution, real import pipeline) and moves it to Processed", async () => {
    vi.mocked(listCandidateMessages).mockResolvedValue({ uidValidity: BigInt(999), candidates: [{ uid: 1, size: 5000 }] });
    vi.mocked(fetchMessageSource).mockResolvedValue({ internalDate: new Date("2026-08-01T10:00:00.000Z"), source: Buffer.from("raw") });
    vi.mocked(parseImapMessageToInboundEmailMessage).mockResolvedValue(imapMessage({ providerEventId: "999:1" }));
    vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockResolvedValue(identity({ companyId: "company-a", stableIdentifier: "company-a-a7k3" }));
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 3, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    const outcome = await pollBankStatementImapMailbox();

    expect(outcome).toMatchObject({ configured: true, candidates: 1, processed: 1, rejected: 0, failed: 0, duplicate: 0 });
    expect(confirmPdfBankStatementImport).toHaveBeenCalledWith("company-a", expect.anything(), expect.anything());
    expect(moveMessage).toHaveBeenCalledWith(FAKE_IMAP_CLIENT, "INBOX", 1, "Processed");
  });

  it("handles multiple candidates with mixed outcomes (success / unknown-recipient rejection / transient failure) in one poll", async () => {
    vi.mocked(listCandidateMessages).mockResolvedValue({
      uidValidity: BigInt(999),
      candidates: [{ uid: 1, size: 1000 }, { uid: 2, size: 1000 }, { uid: 3, size: 1000 }],
    });
    vi.mocked(fetchMessageSource).mockResolvedValue({ internalDate: new Date(), source: Buffer.from("raw") });
    vi.mocked(parseImapMessageToInboundEmailMessage)
      .mockResolvedValueOnce(imapMessage({ providerEventId: "999:1", headers: { "x-original-to": "company-a-a7k3.bank@imports.vyronfinance.co.za" } }))
      .mockResolvedValueOnce(imapMessage({ providerEventId: "999:2", headers: { "x-original-to": "unknown-identifier.bank@imports.vyronfinance.co.za" } }))
      .mockResolvedValueOnce(imapMessage({ providerEventId: "999:3", headers: { "x-original-to": "company-a-a7k3.bank@imports.vyronfinance.co.za" } }));
    vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockImplementation(async (id) =>
      id === "company-a-a7k3" ? identity({ companyId: "company-a", stableIdentifier: "company-a-a7k3" }) : null,
    );
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport)
      .mockResolvedValueOnce({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] })
      .mockRejectedValueOnce(new Error("database connection reset"));

    const outcome = await pollBankStatementImapMailbox();

    expect(outcome.candidates).toBe(3);
    expect(outcome.processed).toBe(1);
    expect(outcome.rejected).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(moveMessage).toHaveBeenCalledWith(FAKE_IMAP_CLIENT, "INBOX", 1, "Processed");
    expect(moveMessage).toHaveBeenCalledWith(FAKE_IMAP_CLIENT, "INBOX", 2, "Failed");
    expect(moveMessage).not.toHaveBeenCalledWith(FAKE_IMAP_CLIENT, "INBOX", 3, expect.anything());
  });

  it("rejects an oversized candidate without ever fetching its body — moves to Failed, records the rejection, never calls fetchMessageSource", async () => {
    vi.mocked(listCandidateMessages).mockResolvedValue({ uidValidity: BigInt(999), candidates: [{ uid: 1, size: MAX_RAW_MESSAGE_SIZE_BYTES + 1 }] });

    const outcome = await pollBankStatementImapMailbox();

    expect(outcome.rejected).toBe(1);
    expect(fetchMessageSource).not.toHaveBeenCalled();
    expect(moveMessage).toHaveBeenCalledWith(FAKE_IMAP_CLIENT, "INBOX", 1, "Failed");
    expect(webhookEventRepo.insertResendWebhookEvent).toHaveBeenCalledWith("999:1", "email.received", "imap");
    expect(webhookEventRepo.completeResendWebhookEvent).toHaveBeenCalledWith(expect.anything(), "rejected", expect.stringContaining("exceeds"));
  });

  it("leaves a message in INBOX (never moves it) when raw-fetch or MIME parsing fails — transient, retryable on the next poll", async () => {
    vi.mocked(listCandidateMessages).mockResolvedValue({ uidValidity: BigInt(999), candidates: [{ uid: 1, size: 1000 }] });
    vi.mocked(fetchMessageSource).mockRejectedValue(new Error("connection reset mid-fetch"));

    const outcome = await pollBankStatementImapMailbox();

    expect(outcome.failed).toBe(1);
    expect(moveMessage).not.toHaveBeenCalled();
  });

  it("a concurrent/overlapping poll racing to process the same UID does not double-import — the loser's insert loses the DB race, exactly like Resend's own at-least-once redelivery", async () => {
    vi.mocked(listCandidateMessages).mockResolvedValue({ uidValidity: BigInt(999), candidates: [{ uid: 1, size: 1000 }] });
    vi.mocked(fetchMessageSource).mockResolvedValue({ internalDate: new Date(), source: Buffer.from("raw") });
    vi.mocked(parseImapMessageToInboundEmailMessage).mockResolvedValue(imapMessage({ providerEventId: "999:1" }));
    // Both "pollers" see findResendWebhookEvent return null (neither has
    // inserted yet — beforeEach's default) but only one INSERT can win
    // the unique constraint; the repository surfaces the loser as
    // `inserted: false` rather than throwing an uncaught 23505 — the
    // exact same shape as the already-proven Resend-level race test above.
    vi.mocked(webhookEventRepo.insertResendWebhookEvent).mockResolvedValue({
      record: webhookEventRecord({ provider: "imap", providerEventId: "999:1", status: "received", companyId: "company-a" }),
      inserted: false,
    });

    const outcome = await pollBankStatementImapMailbox();

    expect(outcome.duplicate).toBe(1);
    expect(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).not.toHaveBeenCalled();
    expect(previewPdfBankStatement).not.toHaveBeenCalled();
    expect(confirmPdfBankStatementImport).not.toHaveBeenCalled();
    expect(moveMessage).not.toHaveBeenCalled(); // still "received" — genuinely in progress, nothing to move yet
  });

  it("retries a message stuck at 'received' from a crashed earlier attempt, reusing the existing idempotency row rather than inserting a new one (stale-claim recovery)", async () => {
    vi.mocked(listCandidateMessages).mockResolvedValue({ uidValidity: BigInt(999), candidates: [{ uid: 1, size: 1000 }] });
    vi.mocked(fetchMessageSource).mockResolvedValue({ internalDate: new Date(), source: Buffer.from("raw") });
    vi.mocked(parseImapMessageToInboundEmailMessage).mockResolvedValue(imapMessage({ providerEventId: "999:1" }));
    vi.mocked(webhookEventRepo.findResendWebhookEvent).mockResolvedValue(webhookEventRecord({ id: 55, provider: "imap", providerEventId: "999:1", status: "received", companyId: null }));
    vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockResolvedValue(identity({ companyId: "company-a", stableIdentifier: "company-a-a7k3" }));
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    const outcome = await pollBankStatementImapMailbox();

    expect(webhookEventRepo.insertResendWebhookEvent).not.toHaveBeenCalled();
    expect(outcome.processed).toBe(1);
    expect(webhookEventRepo.completeResendWebhookEvent).toHaveBeenCalledWith(55, "processed", null);
  });

  it("the sender address alone can never resolve a company, even when it looks exactly like a valid identifier", async () => {
    vi.mocked(listCandidateMessages).mockResolvedValue({ uidValidity: BigInt(999), candidates: [{ uid: 1, size: 1000 }] });
    vi.mocked(fetchMessageSource).mockResolvedValue({ internalDate: new Date(), source: Buffer.from("raw") });
    vi.mocked(parseImapMessageToInboundEmailMessage).mockResolvedValue(
      imapMessage({ providerEventId: "999:1", from: "company-a-a7k3.bank@imports.vyronfinance.co.za", to: ["someone@unrelated.com"], cc: [], headers: undefined }),
    );

    const outcome = await pollBankStatementImapMailbox();

    expect(outcome.rejected).toBe(1);
    expect(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).not.toHaveBeenCalled();
  });

  it("the attachment filename alone can never resolve a company", async () => {
    vi.mocked(listCandidateMessages).mockResolvedValue({ uidValidity: BigInt(999), candidates: [{ uid: 1, size: 1000 }] });
    vi.mocked(fetchMessageSource).mockResolvedValue({ internalDate: new Date(), source: Buffer.from("raw") });
    vi.mocked(parseImapMessageToInboundEmailMessage).mockResolvedValue(
      imapMessage({
        providerEventId: "999:1",
        to: ["someone@unrelated.com"],
        cc: [],
        headers: undefined,
        attachments: [
          {
            filename: "company-a-a7k3.bank@imports.vyronfinance.co.za.pdf",
            contentType: "application/pdf",
            contentDisposition: "attachment",
            getMetadata: async () => ({ sizeBytes: 100, filename: "x.pdf" }),
            getBytes: async () => new ArrayBuffer(8),
          },
        ],
      }),
    );

    const outcome = await pollBankStatementImapMailbox();

    expect(outcome.rejected).toBe(1);
    expect(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).not.toHaveBeenCalled();
  });

  it("caps candidate listing at the serverless batch limit (20) — a conservative bound against Vercel's ~300s function timeout", async () => {
    await pollBankStatementImapMailbox();
    expect(listCandidateMessages).toHaveBeenCalledWith(FAKE_IMAP_CLIENT, "INBOX", 20);
  });

  it("never includes IMAP host/username/password or the configured mailbox address in the returned outcome", async () => {
    const outcome = await pollBankStatementImapMailbox();
    expect(Object.keys(outcome).sort()).toEqual(["candidates", "configured", "duplicate", "elapsedMs", "failed", "processed", "rejected"].sort());
    expect(JSON.stringify(outcome)).not.toMatch(/vyronsoft|bankstatements@|password/i);
  });

  it("KNOWN LIMITATION (Phase 21L finding, not fixed) — two genuinely concurrent invocations that BOTH observe the same stuck 'received' row (from an earlier crashed attempt) both re-run the import; the 'reuse existing row' branch has no atomic claim, unlike the fresh-insert branch's real DB-constraint-backed race protection", async () => {
    vi.mocked(listCandidateMessages).mockResolvedValue({ uidValidity: BigInt(999), candidates: [{ uid: 1, size: 1000 }] });
    vi.mocked(fetchMessageSource).mockResolvedValue({ internalDate: new Date(), source: Buffer.from("raw") });
    vi.mocked(parseImapMessageToInboundEmailMessage).mockResolvedValue(imapMessage({ providerEventId: "999:1" }));
    vi.mocked(webhookEventRepo.findResendWebhookEvent).mockResolvedValue(webhookEventRecord({ id: 77, provider: "imap", providerEventId: "999:1", status: "received", companyId: null }));
    vi.mocked(identityAdminRepo.findActiveCompanyBankStatementEmailByIdentifier).mockResolvedValue(identity({ companyId: "company-a", stableIdentifier: "company-a-a7k3" }));
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });

    await Promise.all([pollBankStatementImapMailbox(), pollBankStatementImapMailbox()]);

    // This IS the demonstrated gap — pre-existing in the shared
    // `processInboundEmailMessage()` orchestrator (predates Phase 21K,
    // applies equally to a redelivered Resend webhook stuck the same
    // way), not something the IMAP work introduced. Reachability is
    // narrow: it requires a row ALREADY stuck at 'received' from a real
    // prior crash, PLUS a second genuinely-concurrent poll/delivery
    // landing on that exact row in the same window. The existing
    // ae_bank_transactions natural-key constraint (unchanged, untouched)
    // still prevents the transactions themselves from being double-
    // counted — both `confirmPdfBankStatementImport` calls parse the
    // identical attachment content, so the second call's inserts collide
    // with the first's on their natural key and are marked duplicates,
    // not double-posted. The real cost of this gap is a confusing
    // duplicate `import_batches` audit-trail artifact (two batches
    // recorded for one statement), not silent financial corruption.
    // Deliberately NOT fixed this phase — see the Phase 21L report for
    // why (a correct fix needs a genuine claim marker with staleness
    // detection, not a one-line change, and this phase's own scope is
    // verification, not new mechanism-building).
    expect(vi.mocked(confirmPdfBankStatementImport).mock.calls.length).toBe(2);
  });

  it("documents: the SAME real statement delivered via both Resend and IMAP gets independent transport-level idempotency records — the EXISTING accounting-level natural-key constraint (unchanged, untouched by this phase) is the real backstop against a genuine cross-channel duplicate import, not this table (Phase 21K Part 13)", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue(attachmentMetadata());
    vi.mocked(previewPdfBankStatement).mockResolvedValue({ batchId: "B1", sourceFilename: "statement.pdf", metadata: {} as never, transactions: [], expectedTransactionCount: null } as never);
    vi.mocked(confirmPdfBankStatementImport).mockResolvedValue({ batch: {} as never, importedCount: 1, duplicateCount: 0, rulesAutoAllocated: 0, validation: {} as never, exceptions: [] });
    const resendOutcome = await processResendInboundEmail(event(), "resend-delivery-1");
    expect(resendOutcome.status).toBe("processed");
    expect(webhookEventRepo.insertResendWebhookEvent).toHaveBeenCalledWith("resend-delivery-1", "email.received", "resend");

    vi.mocked(listCandidateMessages).mockResolvedValue({ uidValidity: BigInt(999), candidates: [{ uid: 1, size: 1000 }] });
    vi.mocked(fetchMessageSource).mockResolvedValue({ internalDate: new Date(), source: Buffer.from("raw") });
    vi.mocked(parseImapMessageToInboundEmailMessage).mockResolvedValue(imapMessage({ providerEventId: "999:1" }));
    const imapOutcome = await pollBankStatementImapMailbox();

    // Transport-level idempotency does NOT catch this on its own — both
    // "succeed" independently at this layer since a Resend svix-id and
    // an IMAP "uidValidity:uid" live in separate provider namespaces.
    // The real accounting-level protection (ae_bank_transactions'
    // existing natural-key constraint, exercised inside
    // confirmPdfBankStatementImport/importBankStatement — unchanged,
    // already covered by that pipeline's own dedup tests) applies
    // identically regardless of which transport delivered the statement.
    expect(imapOutcome.processed).toBe(1);
    expect(webhookEventRepo.insertResendWebhookEvent).toHaveBeenCalledWith("999:1", "email.received", "imap");
  });
});
