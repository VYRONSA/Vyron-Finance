import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/repositories/recurring-template-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/recurring-template-repository")>();
  return {
    ...actual,
    findGeneratedDocumentSince: vi.fn(),
    recordGeneratedDocument: vi.fn(),
    advanceRecurringTemplate: vi.fn(),
  };
});
vi.mock("@/server/services/automation-audit-service", () => ({ recordAuditEntry: vi.fn() }));
vi.mock("@/server/services/notification-service", () => ({ createNotification: vi.fn() }));
vi.mock("@/server/repositories/journal-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/repositories/journal-repository")>();
  return { ...actual, createJournal: vi.fn() };
});
vi.mock("@/server/services/posting-engine-service", () => ({ postApprovedJournals: vi.fn() }));

import { generateFromTemplate } from "./recurring-template-service";
import * as repo from "@/server/repositories/recurring-template-repository";
import * as auditService from "@/server/services/automation-audit-service";
import * as journalRepo from "@/server/repositories/journal-repository";
import { postApprovedJournals } from "@/server/services/posting-engine-service";
import type { RecurringTemplate, GeneratedDocument } from "@/server/automation/types";
import type { Journal } from "@/server/accounting/types";

function template(overrides: Partial<RecurringTemplate> = {}): RecurringTemplate {
  return {
    id: 1,
    companyId: "co_1",
    documentType: "Journal",
    name: "Monthly Depreciation",
    frequency: "Monthly",
    intervalCount: 1,
    startDate: "2026-01-01",
    endDate: null,
    maxOccurrences: null,
    occurrencesGenerated: 3,
    skipWeekends: false,
    skipPublicHolidays: false,
    nextRunDate: "2026-04-01",
    lastRunDate: "2026-03-01",
    isActive: true,
    numberingPrefix: "",
    documentPayload: { journalType: "General", description: "Monthly depreciation", lines: [{ accountCode: "5100", debit: 1000, credit: 0 }, { accountCode: "1600", debit: 0, credit: 1000 }] },
    workflowDefinitionId: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    createdBy: "System",
    updatedBy: "System",
    ...overrides,
  };
}

function generatedDocument(overrides: Partial<GeneratedDocument> = {}): GeneratedDocument {
  return {
    id: 99,
    companyId: "co_1",
    recurringTemplateId: 1,
    documentType: "Journal",
    generatedAt: "2026-04-01T00:00:05Z",
    referenceType: "Journal",
    referenceId: 500,
    status: "Success",
    errorMessage: null,
    summary: "Journal JNL-0500 posted",
    ...overrides,
  };
}

function journal(overrides: Partial<Journal> = {}): Journal {
  return {
    id: 500,
    companyId: "co_1",
    journalNumber: "JNL-0500",
    journalDate: "2026-04-01",
    journalType: "General",
    description: "Monthly depreciation (recurring: Monthly Depreciation)",
    reference: "Monthly Depreciation",
    sourceType: "recurring_template",
    sourceId: 1,
    status: "Approved",
    totalDebit: 1000,
    totalCredit: 1000,
    createdAt: "2026-04-01T00:00:00Z",
    postedAt: null,
    submittedBy: null,
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    isReversed: false,
    reversalOfJournalId: null,
    reversedByJournalId: null,
    postingBatchId: null,
    lines: [],
    ...overrides,
  };
}

describe("generateFromTemplate — crash-recovery guard against duplicate generation (Phase 25K)", () => {
  beforeEach(() => {
    vi.mocked(repo.findGeneratedDocumentSince).mockReset();
    vi.mocked(repo.recordGeneratedDocument).mockReset().mockResolvedValue(generatedDocument());
    vi.mocked(repo.advanceRecurringTemplate).mockReset().mockResolvedValue(template());
    vi.mocked(auditService.recordAuditEntry).mockReset().mockResolvedValue(undefined as never);
    vi.mocked(journalRepo.createJournal).mockReset().mockResolvedValue(journal());
    vi.mocked(postApprovedJournals).mockReset().mockResolvedValue({ batch: null, posted: [{ journalId: 500, journalNumber: "JNL-0500" }], skipped: [] });
  });

  it("does not re-dispatch (does not create a second journal) when a dangling Success record already exists from an interrupted prior run", async () => {
    const dangling = generatedDocument();
    vi.mocked(repo.findGeneratedDocumentSince).mockResolvedValue(dangling);

    const outcome = await generateFromTemplate("co_1", template(), "2026-04-01");

    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(repo.recordGeneratedDocument).not.toHaveBeenCalled();
    expect(repo.advanceRecurringTemplate).toHaveBeenCalledWith("co_1", 1, "2026-04-01", expect.any(String));
    expect(outcome).toEqual({ status: "Success", document: dangling });
  });

  it("checks for a dangling record using the template's last confirmed run date", async () => {
    vi.mocked(repo.findGeneratedDocumentSince).mockResolvedValue(null);

    await generateFromTemplate("co_1", template({ lastRunDate: "2026-03-01" }), "2026-04-01");

    expect(repo.findGeneratedDocumentSince).toHaveBeenCalledWith("co_1", 1, "2026-03-01");
  });

  it("passes null when the template has never successfully run before (first-ever occurrence)", async () => {
    vi.mocked(repo.findGeneratedDocumentSince).mockResolvedValue(null);

    await generateFromTemplate("co_1", template({ lastRunDate: null, occurrencesGenerated: 0 }), "2026-04-01");

    expect(repo.findGeneratedDocumentSince).toHaveBeenCalledWith("co_1", 1, null);
  });

  it("dispatches generation normally (creates and posts one journal) when no dangling record exists — regression", async () => {
    vi.mocked(repo.findGeneratedDocumentSince).mockResolvedValue(null);

    const outcome = await generateFromTemplate("co_1", template(), "2026-04-01");

    expect(journalRepo.createJournal).toHaveBeenCalledTimes(1);
    expect(repo.recordGeneratedDocument).toHaveBeenCalledWith("co_1", expect.objectContaining({ status: "Success", referenceId: 500 }));
    expect(repo.advanceRecurringTemplate).toHaveBeenCalledWith("co_1", 1, "2026-04-01", expect.any(String));
    expect(outcome.status).toBe("Success");
  });

  it("still advances the template when the template isn't due — no dangling check, no dispatch", async () => {
    const notDue = template({ nextRunDate: "2026-05-01" });

    const outcome = await generateFromTemplate("co_1", notDue, "2026-04-01");

    expect(repo.findGeneratedDocumentSince).not.toHaveBeenCalled();
    expect(journalRepo.createJournal).not.toHaveBeenCalled();
    expect(outcome.status).toBe("Skipped");
  });
});
