import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/journal-repository", () => ({
  getJournal: vi.fn(),
  getJournalBySource: vi.fn(),
  createJournal: vi.fn(),
  markJournalReversed: vi.fn(),
  listJournals: vi.fn(),
  listManualJournalHeaders: vi.fn(),
}));

import { canTransitionJournalStatus, reverseJournal, ValidationError } from "./journal-workflow-service";
import * as journalRepo from "@/server/repositories/journal-repository";
import type { Journal, JournalStatus } from "@/server/accounting/types";

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

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    id: 500, companyId: "co_1", journalNumber: "JR000500", journalDate: "2026-07-01", journalType: "Bank Transactions",
    description: "", reference: "REF-1", sourceType: "bank_transactions_bulk", sourceId: null, status: "Posted",
    totalDebit: 500, totalCredit: 500, createdAt: "2026-07-01T00:00:00Z", postedAt: "2026-07-01T00:00:01Z",
    submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null,
    cancelledBy: null, cancelledAt: null, isReversed: false, reversalOfJournalId: null, reversedByJournalId: null,
    lines: [{ id: 1, journalId: 500, accountCode: "6000", debit: 500, credit: 0, description: "x", lineOrder: 0 }],
    ...overrides,
  } as Journal;
}

describe("reverseJournal — duplicate-reversal race guard (Phase 25K)", () => {
  beforeEach(() => {
    vi.mocked(journalRepo.getJournal).mockReset().mockResolvedValue(journal());
    vi.mocked(journalRepo.getJournalBySource).mockReset().mockResolvedValue(null);
    vi.mocked(journalRepo.createJournal).mockReset().mockResolvedValue(journal({ id: 600, journalType: "Reversal", sourceType: "journal_reversal", sourceId: 500 }));
    vi.mocked(journalRepo.markJournalReversed).mockReset().mockResolvedValue(undefined);
  });

  it("creates a real reversal journal normally when none already exists (baseline, unchanged behavior)", async () => {
    const outcome = await reverseJournal("co_1", 500);

    expect(journalRepo.getJournalBySource).toHaveBeenCalledWith("co_1", "journal_reversal", 500);
    expect(journalRepo.createJournal).toHaveBeenCalledTimes(1);
    expect(journalRepo.markJournalReversed).toHaveBeenCalledWith("co_1", 500, 600);
    expect(outcome.reversal.id).toBe(600);
  });

  it("does NOT create a second reversal journal when one already exists for this original (the core fix — double-click/retry safety)", async () => {
    vi.mocked(journalRepo.getJournalBySource).mockResolvedValue(journal({ id: 601, journalType: "Reversal", sourceType: "journal_reversal", sourceId: 500 }));

    const outcome = await reverseJournal("co_1", 500);

    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(journalRepo.markJournalReversed).not.toHaveBeenCalled();
    expect(outcome.reversal.id).toBe(601);
  });

  it("rejects reversing a journal that isn't Posted", async () => {
    vi.mocked(journalRepo.getJournal).mockResolvedValue(journal({ status: "Approved" }));
    await expect(reverseJournal("co_1", 500)).rejects.toThrow(ValidationError);
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
  });

  it("rejects reversing an already-flagged-reversed journal", async () => {
    vi.mocked(journalRepo.getJournal).mockResolvedValue(journal({ isReversed: true }));
    await expect(reverseJournal("co_1", 500)).rejects.toThrow(ValidationError);
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
  });
});
