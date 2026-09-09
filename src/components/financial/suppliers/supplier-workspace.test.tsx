/**
 * Phase 32 — the exact workflow from the screenshot: "Import CSV" with
 * no template, producing "Could not find a 'Name' column in the file."
 * with no way forward. This is the first test file for
 * `SupplierWorkspace` — it proves the Suppliers-specific requirements
 * verbatim from the spec: "Download Template is available from the
 * Suppliers UI," using the real, exported parser contract (never a
 * hand-copied header list).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SupplierWorkspace } from "./supplier-workspace";
import { MOCK_SUPPLIERS } from "@/lib/mock/supplier-reconciliation-data";
import { SUPPLIER_IMPORT_TEMPLATE_HEADERS } from "@/server/import-centre/customer-supplier-import-parser";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/test",
  useSearchParams: () => new URLSearchParams(),
}));

const { downloadCsvMock } = vi.hoisted(() => ({ downloadCsvMock: vi.fn() }));
vi.mock("@/lib/csv-export", () => ({ downloadCsv: downloadCsvMock }));

describe("SupplierWorkspace — Download Template (Phase 32)", () => {
  it("shows a Download Template button in the Suppliers toolbar, next to Import CSV", () => {
    render(<SupplierWorkspace companyId="co_1" suppliers={MOCK_SUPPLIERS} previewMode={false} />);
    expect(screen.getByRole("button", { name: /download template/i })).toBeInTheDocument();
    expect(screen.getByText(/import csv/i)).toBeInTheDocument();
  });

  it("downloads a template using the parser's OWN exported header contract — Name included, in a real .csv file", () => {
    downloadCsvMock.mockClear();
    render(<SupplierWorkspace companyId="co_1" suppliers={MOCK_SUPPLIERS} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /download template/i }));

    expect(downloadCsvMock).toHaveBeenCalledTimes(1);
    const [filename, headers, rows] = downloadCsvMock.mock.calls[0];
    expect(filename).toBe("VYRON_Supplier_Import_Template.csv");
    expect(headers).toEqual(SUPPLIER_IMPORT_TEMPLATE_HEADERS);
    expect(headers).toContain("Name");
    expect(rows).toEqual([]); // headers only — never fabricated accounting data
  });

  it("tells the user to download the template, complete it, and upload it here", () => {
    render(<SupplierWorkspace companyId="co_1" suppliers={MOCK_SUPPLIERS} previewMode={false} />);
    expect(screen.getByText(/download the template, complete it, and upload it here/i)).toBeInTheDocument();
  });
});
