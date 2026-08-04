import { describe, expect, it } from "vitest";
import { computeNextRetryAt, isExpired, isRetryExhausted, selectDueCommunications, selectExpiredCommunications } from "./queue-engine";
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

describe("computeNextRetryAt", () => {
  it("waits 5 minutes after the first failure", () => {
    expect(computeNextRetryAt(1, "2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:05:00.000Z");
  });

  it("doubles the wait after the second failure", () => {
    expect(computeNextRetryAt(2, "2026-01-01T00:00:00.000Z")).toBe("2026-01-01T00:10:00.000Z");
  });

  it("caps the wait at 60 minutes", () => {
    expect(computeNextRetryAt(10, "2026-01-01T00:00:00.000Z")).toBe("2026-01-01T01:00:00.000Z");
  });
});

describe("isExpired / isRetryExhausted", () => {
  it("is expired once now passes expiresAt", () => {
    expect(isExpired(comm({ expiresAt: "2026-01-01T00:00:00.000Z" }), "2026-01-01T00:00:01.000Z")).toBe(true);
    expect(isExpired(comm({ expiresAt: "2026-01-02T00:00:00.000Z" }), "2026-01-01T00:00:01.000Z")).toBe(false);
    expect(isExpired(comm({ expiresAt: null }), "2099-01-01T00:00:00.000Z")).toBe(false);
  });

  it("is exhausted once retryCount reaches maxRetries", () => {
    expect(isRetryExhausted(comm({ retryCount: 3, maxRetries: 3 }))).toBe(true);
    expect(isRetryExhausted(comm({ retryCount: 2, maxRetries: 3 }))).toBe(false);
  });
});

describe("selectDueCommunications", () => {
  const now = "2026-01-05T00:00:00.000Z";

  it("selects a Queued communication whose scheduled_for has arrived", () => {
    const due = selectDueCommunications([comm({ status: "Queued", scheduledFor: "2026-01-01T00:00:00.000Z" })], now);
    expect(due).toHaveLength(1);
  });

  it("excludes a Queued communication scheduled in the future", () => {
    const due = selectDueCommunications([comm({ status: "Queued", scheduledFor: "2099-01-01T00:00:00.000Z" })], now);
    expect(due).toHaveLength(0);
  });

  it("selects a Failed communication whose backoff has elapsed and retries remain", () => {
    const due = selectDueCommunications(
      [comm({ status: "Failed", retryCount: 1, maxRetries: 3, nextRetryAt: "2026-01-04T00:00:00.000Z" })],
      now,
    );
    expect(due).toHaveLength(1);
  });

  it("excludes a Failed communication that has exhausted its retries", () => {
    const due = selectDueCommunications(
      [comm({ status: "Failed", retryCount: 3, maxRetries: 3, nextRetryAt: "2026-01-04T00:00:00.000Z" })],
      now,
    );
    expect(due).toHaveLength(0);
  });

  it("excludes an expired communication even if otherwise due", () => {
    const due = selectDueCommunications([comm({ status: "Queued", scheduledFor: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z" })], now);
    expect(due).toHaveLength(0);
  });

  it("excludes Draft/PendingApproval/Sent/Cancelled rows", () => {
    const due = selectDueCommunications(
      (["Draft", "PendingApproval", "Sent", "Cancelled", "Rejected", "Expired"] as const).map((status) => comm({ status, scheduledFor: "2026-01-01T00:00:00.000Z" })),
      now,
    );
    expect(due).toHaveLength(0);
  });

  it("orders Urgent before Normal before Low, then oldest scheduled_for first", () => {
    const low = comm({ id: 1, priority: "Low", scheduledFor: "2026-01-01T00:00:00.000Z" });
    const urgent = comm({ id: 2, priority: "Urgent", scheduledFor: "2026-01-03T00:00:00.000Z" });
    const normalOld = comm({ id: 3, priority: "Normal", scheduledFor: "2026-01-01T00:00:00.000Z" });
    const normalNew = comm({ id: 4, priority: "Normal", scheduledFor: "2026-01-02T00:00:00.000Z" });
    const due = selectDueCommunications([low, urgent, normalOld, normalNew], now);
    expect(due.map((c) => c.id)).toEqual([2, 3, 4, 1]);
  });
});

describe("selectExpiredCommunications", () => {
  it("selects Queued or Failed rows past their expiry", () => {
    const expired = selectExpiredCommunications(
      [
        comm({ id: 1, status: "Queued", expiresAt: "2026-01-01T00:00:00.000Z" }),
        comm({ id: 2, status: "Failed", expiresAt: "2026-01-01T00:00:00.000Z" }),
        comm({ id: 3, status: "Sent", expiresAt: "2026-01-01T00:00:00.000Z" }),
        comm({ id: 4, status: "Queued", expiresAt: null }),
      ],
      "2026-01-05T00:00:00.000Z",
    );
    expect(expired.map((c) => c.id)).toEqual([1, 2]);
  });
});
