import { describe, expect, it } from "vitest";
import { buildCommunicationDashboardSummary } from "./dashboard-engine";
import type { CommunicationRecord } from "./types";

function comm(overrides: Partial<CommunicationRecord>): CommunicationRecord {
  return {
    id: 1, companyId: "co_1", module: "Sales", businessObjectType: null, businessObjectId: null, templateId: null,
    channel: "Email", recipients: [], subject: "S", body: "B", variables: {}, status: "Queued", priority: "Normal",
    scheduledFor: "2026-01-01T00:00:00.000Z", expiresAt: null, retryCount: 0, maxRetries: 3, nextRetryAt: null,
    sentAt: null, deliveryResult: null, failureReason: null, approvalWorkflowInstanceId: null, relatedNotificationId: null,
    auditRef: null, createdBy: "System", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const now = "2026-01-05T00:00:00.000Z";

describe("buildCommunicationDashboardSummary", () => {
  it("counts each status bucket correctly", () => {
    const summary = buildCommunicationDashboardSummary(
      [
        comm({ status: "Queued", scheduledFor: "2026-01-01T00:00:00.000Z" }),
        comm({ status: "Queued", scheduledFor: "2099-01-01T00:00:00.000Z" }),
        comm({ status: "Sent", sentAt: "2026-01-01T00:00:10.000Z", createdAt: "2026-01-01T00:00:00.000Z" }),
        comm({ status: "Failed", retryCount: 3, maxRetries: 3 }),
        comm({ status: "Failed", retryCount: 1, maxRetries: 3 }),
        comm({ status: "PendingApproval" }),
        comm({ status: "Cancelled" }),
        comm({ status: "Expired" }),
        comm({ status: "Rejected" }),
        comm({ status: "Draft" }),
      ],
      now,
    );
    expect(summary.queued).toBe(2);
    expect(summary.scheduled).toBe(1);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.retrying).toBe(1);
    expect(summary.awaitingApproval).toBe(1);
    expect(summary.cancelled).toBe(1);
    expect(summary.expired).toBe(1);
    expect(summary.delivered).toBe(0);
  });

  it("computes the average delivery time in seconds across Sent rows", () => {
    const summary = buildCommunicationDashboardSummary(
      [
        comm({ status: "Sent", createdAt: "2026-01-01T00:00:00.000Z", sentAt: "2026-01-01T00:00:10.000Z" }),
        comm({ status: "Sent", createdAt: "2026-01-01T00:00:00.000Z", sentAt: "2026-01-01T00:00:20.000Z" }),
      ],
      now,
    );
    expect(summary.averageDeliverySeconds).toBe(15);
  });

  it("returns null average delivery time when nothing has sent yet", () => {
    const summary = buildCommunicationDashboardSummary([comm({ status: "Queued" })], now);
    expect(summary.averageDeliverySeconds).toBeNull();
  });

  it("ranks failure reasons by frequency, top 5", () => {
    const summary = buildCommunicationDashboardSummary(
      [
        comm({ status: "Failed", retryCount: 3, maxRetries: 3, failureReason: "No provider configured." }),
        comm({ status: "Failed", retryCount: 3, maxRetries: 3, failureReason: "No provider configured." }),
        comm({ status: "Failed", retryCount: 1, maxRetries: 3, failureReason: "No recipient email address on file." }),
      ],
      now,
    );
    expect(summary.topFailureReasons).toEqual([
      { reason: "No provider configured.", count: 2 },
      { reason: "No recipient email address on file.", count: 1 },
    ]);
  });

  it("returns all zeros for an empty list", () => {
    const summary = buildCommunicationDashboardSummary([], now);
    expect(summary.queued).toBe(0);
    expect(summary.sent).toBe(0);
    expect(summary.topFailureReasons).toEqual([]);
  });
});
