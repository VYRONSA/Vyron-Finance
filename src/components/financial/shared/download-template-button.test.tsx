/**
 * Phase 32 — "every import function must provide a downloadable
 * template." `DownloadTemplateButton` is the one reusable piece every
 * importer's "Download Template" button goes through — tested directly
 * here (mocking `downloadCsv` itself, not jsdom's Blob/URL machinery,
 * which this codebase has no existing precedent for exercising in
 * tests) so every consumer's own test doesn't need to re-prove the same
 * mechanics.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DownloadTemplateButton } from "./download-template-button";

const { downloadCsvMock } = vi.hoisted(() => ({ downloadCsvMock: vi.fn() }));
vi.mock("@/lib/csv-export", () => ({ downloadCsv: downloadCsvMock }));

describe("DownloadTemplateButton (Phase 32)", () => {
  it("1/2/3 — clicking it downloads a CSV with the exact filename and headers passed in", () => {
    downloadCsvMock.mockClear();
    render(<DownloadTemplateButton filename="VYRON_Supplier_Import_Template.csv" headers={["Name", "Supplier Code"]} />);
    fireEvent.click(screen.getByRole("button", { name: /download template/i }));
    expect(downloadCsvMock).toHaveBeenCalledWith("VYRON_Supplier_Import_Template.csv", ["Name", "Supplier Code"], []);
  });

  it("6 — never includes a data row, only headers — no fabricated accounting data", () => {
    downloadCsvMock.mockClear();
    render(<DownloadTemplateButton filename="t.csv" headers={["A", "B"]} />);
    fireEvent.click(screen.getByRole("button", { name: /download template/i }));
    const rows = downloadCsvMock.mock.calls[0][2];
    expect(rows).toEqual([]);
  });

  it("accepts a custom label", () => {
    render(<DownloadTemplateButton filename="t.csv" headers={["A"]} label="Download CSV Template" />);
    expect(screen.getByRole("button", { name: "Download CSV Template" })).toBeInTheDocument();
  });

  it("respects disabled (e.g. preview mode)", () => {
    render(<DownloadTemplateButton filename="t.csv" headers={["A"]} disabled />);
    expect(screen.getByRole("button", { name: /download template/i })).toBeDisabled();
  });
});
