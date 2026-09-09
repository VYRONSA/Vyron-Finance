import { describe, expect, it } from "vitest";
import { buildStoragePath, findExpiredForRetention, groupVersions, isRetentionExpired, isValidDocumentCategory, latestVersionsOnly, nextVersionNumber } from "./document-engine";
import type { DocumentRecord } from "./types";

function doc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 1, companyId: "co_1", entityType: "Customer", entityId: 1, documentGroupId: null, versionNumber: 1,
    isCurrent: true, category: "General", filename: "invoice.pdf", storagePath: "co_1/Customer/1/x-invoice.pdf",
    mimeType: "application/pdf", sizeBytes: 1024, virusScanStatus: "pending", ocrStatus: "pending", ocrMetadata: null,
    retentionUntil: null, uploadedBy: "System", uploadedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("nextVersionNumber", () => {
  it("returns 1 for a document with no prior versions", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("returns one more than the highest existing version", () => {
    expect(nextVersionNumber([doc({ versionNumber: 1 }), doc({ versionNumber: 2 })])).toBe(3);
  });
});

describe("buildStoragePath", () => {
  it("puts companyId first, matching the RLS policy's own path convention", () => {
    const path = buildStoragePath("co_1", "Customer", 42, "Invoice 2026.pdf", "2026-06-01T10:30:00.000Z");
    expect(path.startsWith("co_1/Customer/42/")).toBe(true);
  });

  it("sanitizes unsafe filename characters", () => {
    const path = buildStoragePath("co_1", "Customer", 42, "in voice/2026?.pdf", "2026-06-01T10:30:00.000Z");
    expect(path).not.toContain(" ");
    expect(path).not.toContain("/2026?");
  });
});

describe("isValidDocumentCategory", () => {
  it("accepts a real category", () => {
    expect(isValidDocumentCategory("Contract")).toBe(true);
  });

  it("rejects an arbitrary string", () => {
    expect(isValidDocumentCategory("NotACategory")).toBe(false);
  });
});

describe("isRetentionExpired / findExpiredForRetention", () => {
  it("never treats a null retentionUntil (keep forever) as expired", () => {
    expect(isRetentionExpired(doc({ retentionUntil: null }), "2030-01-01")).toBe(false);
  });

  it("flags a document whose retention date has passed", () => {
    expect(isRetentionExpired(doc({ retentionUntil: "2026-01-01" }), "2026-06-01")).toBe(true);
  });

  it("does not flag a document whose retention date is still in the future", () => {
    expect(isRetentionExpired(doc({ retentionUntil: "2027-01-01" }), "2026-06-01")).toBe(false);
  });

  it("findExpiredForRetention filters a mixed list correctly", () => {
    const docs = [doc({ id: 1, retentionUntil: "2026-01-01" }), doc({ id: 2, retentionUntil: null }), doc({ id: 3, retentionUntil: "2027-01-01" })];
    expect(findExpiredForRetention(docs, "2026-06-01").map((d) => d.id)).toEqual([1]);
  });
});

describe("groupVersions / latestVersionsOnly", () => {
  it("groups multiple versions of the same logical document together", () => {
    const v1 = doc({ id: 1, documentGroupId: null, versionNumber: 1, isCurrent: false });
    const v2 = doc({ id: 2, documentGroupId: 1, versionNumber: 2, isCurrent: true });
    const groups = groupVersions([v1, v2]);
    expect(groups.get(1)?.map((d) => d.id)).toEqual([2, 1]); // most recent version first
  });

  it("latestVersionsOnly returns only the current version of each document", () => {
    const v1 = doc({ id: 1, isCurrent: false });
    const v2 = doc({ id: 2, isCurrent: true });
    const other = doc({ id: 3, isCurrent: true, entityId: 2 });
    expect(latestVersionsOnly([v1, v2, other]).map((d) => d.id).sort()).toEqual([2, 3]);
  });
});
