import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DocumentsPanel } from "./documents-panel";
import type { DocumentRecord } from "@/server/documents/types";

function doc(overrides: Partial<DocumentRecord> & Pick<DocumentRecord, "id" | "filename">): DocumentRecord {
  return {
    companyId: "co_1",
    entityType: "Asset",
    entityId: 1,
    documentGroupId: null,
    versionNumber: 1,
    isCurrent: true,
    category: "General",
    storagePath: "co_1/asset/1/file.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    virusScanStatus: "clean",
    ocrStatus: "skipped",
    ocrMetadata: null,
    retentionUntil: null,
    uploadedBy: "tester@vyron.test",
    uploadedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

describe("DocumentsPanel — Finding #228 (RC-3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requires confirmation before calling the delete API", async () => {
    const documents = [doc({ id: 1, filename: "lease-agreement.pdf" })];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ documents }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentsPanel companyId="co_1" entityType="Asset" entityId={1} previewMode={false} />);
    await waitFor(() => expect(screen.getByText("lease-agreement.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(screen.getByText(/delete "lease-agreement\.pdf"\?/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the initial list load — no DELETE yet

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(screen.queryByText(/delete "lease-agreement\.pdf"\?/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls the delete API and refreshes the list once confirmed", async () => {
    const documents = [doc({ id: 1, filename: "lease-agreement.pdf" })];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ documents }) }) // initial load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }) // DELETE
      .mockResolvedValueOnce({ ok: true, json: async () => ({ documents: [] }) }); // refresh() after delete
    vi.stubGlobal("fetch", fetchMock);

    render(<DocumentsPanel companyId="co_1" entityType="Asset" entityId={1} previewMode={false} />);
    await waitFor(() => expect(screen.getByText("lease-agreement.pdf")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/documents/1", { method: "DELETE" }));
    await waitFor(() => expect(screen.queryByText("lease-agreement.pdf")).not.toBeInTheDocument());
  });
});
