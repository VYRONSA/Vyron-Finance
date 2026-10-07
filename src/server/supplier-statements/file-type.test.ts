/**
 * @vitest-environment node
 *
 * SD-3C — statement file kinds come from the bytes, never the declared type.
 */
import { describe, expect, it } from "vitest";
import { detectStatementFileType } from "./file-type";
import { parseCsvGrid, readTabularStatement } from "./tabular";

const ascii = (s: string) => new TextEncoder().encode(s);

describe("detectStatementFileType", () => {
  it("PDF, JPEG and PNG from their signatures, whatever the name", () => {
    expect(detectStatementFileType(ascii("%PDF-1.7\n..."), "statement.csv")).toBe("pdf");
    expect(detectStatementFileType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "x.pdf")).toBe("image");
    expect(detectStatementFileType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "x")).toBe("image");
  });
  it("XLSX only when the ZIP holds a workbook", () => {
    expect(detectStatementFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...ascii("....xl/workbook.xml")]), "s.xlsx")).toBe("xlsx");
    expect(detectStatementFileType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...ascii("word/document.xml")]), "s.docx")).toBeNull();
  });
  it("CSV needs a .csv name, text and a delimiter", () => {
    expect(detectStatementFileType(ascii("Date;Ref;Debit\n"), "s.csv")).toBe("csv");
    expect(detectStatementFileType(ascii("Date;Ref;Debit\n"), "s.html")).toBeNull();
    expect(detectStatementFileType(new Uint8Array([0x44, 0x00, 0x3b]), "s.csv")).toBeNull();
  });
  it("HTML or anything else is refused", () => {
    expect(detectStatementFileType(ascii("<html><script>alert(1)</script>"), "statement.pdf")).toBeNull();
  });
});

describe("CSV statements (secondary path, same reader)", () => {
  it("detects ';' and reads decimal commas through the shared reader", () => {
    const grid = parseCsvGrid('Date;Ref;Description;Debit;Credit;Balance\r\n01/09/2026;;Balance brought forward;;;"1 000,00"\r\n02/09/2026;00042;Invoice;"1 234,50";;"2 234,50"\r\n');
    const read = readTabularStatement(grid);
    expect(read.header.openingBalance).toBe(1000);
    const tx = read.lines.filter((l) => !l.isExcluded);
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ referenceText: "00042", debit: 1234.5, runningBalance: 2234.5, transactionType: "invoice", pageNumber: null });
  });
  it("a sheet with no recognisable table says so and extracts nothing", () => {
    const read = readTabularStatement(parseCsvGrid("hello,world\nfoo,bar\n"));
    expect(read.lines).toHaveLength(0);
    expect(read.warnings.join(" ")).toMatch(/No transaction table/);
  });
});
