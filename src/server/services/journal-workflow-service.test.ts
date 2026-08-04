import { describe, expect, it } from "vitest";
import { canTransitionJournalStatus } from "./journal-workflow-service";
import type { JournalStatus } from "@/server/accounting/types";

const ALL_STATUSES: JournalStatus[] = ["Draft", "Submitted", "Approved", "Rejected", "Posted", "Cancelled"];

describe("canTransitionJournalStatus", () => {
  it("allows the full Draft -> Submitted -> Approved -> Posted happy path", () => {
    expect(canTransitionJournalStatus("Draft", "Submitted")).toBe(true);
    expect(canTransitionJournalStatus("Submitted", "Approved")).toBe(true);
    expect(canTransitionJournalStatus("Approved", "Posted")).toBe(true);
  });

  it("allows rejecting a Submitted journal", () => {
    expect(canTransitionJournalStatus("Submitted", "Rejected")).toBe(true);
  });

  it("allows cancelling from Draft, Submitted, or Approved", () => {
    expect(canTransitionJournalStatus("Draft", "Cancelled")).toBe(true);
    expect(canTransitionJournalStatus("Submitted", "Cancelled")).toBe(true);
    expect(canTransitionJournalStatus("Approved", "Cancelled")).toBe(true);
  });

  it("treats Rejected, Posted, and Cancelled as terminal — no outbound transitions", () => {
    for (const from of ["Rejected", "Posted", "Cancelled"] as JournalStatus[]) {
      for (const to of ALL_STATUSES) {
        expect(canTransitionJournalStatus(from, to)).toBe(false);
      }
    }
  });

  it("rejects skipping Submitted (Draft cannot go straight to Approved or Posted)", () => {
    expect(canTransitionJournalStatus("Draft", "Approved")).toBe(false);
    expect(canTransitionJournalStatus("Draft", "Posted")).toBe(false);
  });

  it("rejects posting a journal that hasn't been Approved", () => {
    expect(canTransitionJournalStatus("Submitted", "Posted")).toBe(false);
    expect(canTransitionJournalStatus("Draft", "Posted")).toBe(false);
  });

  it("rejects a no-op self-transition", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransitionJournalStatus(status, status)).toBe(false);
    }
  });
});
