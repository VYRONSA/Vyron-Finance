/**
 * Phase 32 — same fix as `SupplierWorkspace`'s own test file (the
 * Customers importer had the identical "no template, bare 'Could not
 * find a Name column' error" gap).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomerWorkspace } from "./customer-workspace";
import { MOCK_CUSTOMERS } from "@/lib/mock/customer-management-data";
import { CUSTOMER_IMPORT_TEMPLATE_HEADERS } from "@/server/import-centre/customer-supplier-import-parser";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/test",
  useSearchParams: () => new URLSearchParams(),
}));

const { downloadCsvMock } = vi.hoisted(() => ({ downloadCsvMock: vi.fn() }));
vi.mock("@/lib/csv-export", () => ({ downloadCsv: downloadCsvMock }));

describe("CustomerWorkspace — Download Template (Phase 32)", () => {
  it("shows a Download Template button in the Customers toolbar, next to Import CSV", () => {
    render(<CustomerWorkspace companyId="co_1" customers={MOCK_CUSTOMERS} previewMode={false} />);
    expect(screen.getByRole("button", { name: /download template/i })).toBeInTheDocument();
    expect(screen.getByText(/import csv/i)).toBeInTheDocument();
  });

  it("downloads a template using the parser's OWN exported header contract — Name included, in a real .csv file", () => {
    downloadCsvMock.mockClear();
    render(<CustomerWorkspace companyId="co_1" customers={MOCK_CUSTOMERS} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /download template/i }));

    expect(downloadCsvMock).toHaveBeenCalledTimes(1);
    const [filename, headers, rows] = downloadCsvMock.mock.calls[0];
    expect(filename).toBe("VYRON_Customer_Import_Template.csv");
    expect(headers).toEqual(CUSTOMER_IMPORT_TEMPLATE_HEADERS);
    expect(headers).toContain("Name");
    expect(rows).toEqual([]);
  });
});
