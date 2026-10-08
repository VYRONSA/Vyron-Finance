/**
 * @vitest-environment node
 *
 * SD-3G — reader corrections found by production UAT (a real supplier's
 * statement): minus-signed credits, period subtotals, the ageing block, the
 * statement date and the letterhead. The full layout is in the corpus
 * ("monthly-negative-credits"); these isolate each rule, including the cases
 * where the reader must still REFUSE to guess.
 */
import { describe, expect, it } from "vitest";
import { readStatementLayout, type LayoutPage, type LayoutToken } from "./layout";
import { readTabularStatement, type TabularCell } from "./tabular";

const grid = (rows: string[][]): TabularCell[][] => rows.map((r) => r.map((text) => ({ text })));
const HEAD = ["Date", "Invoice", "Our Reference", "Debit", "Credit", "Balance"];
const transactions = (rows: string[][]) => readTabularStatement(grid(rows)).lines.filter((l) => !l.isExcluded);

describe("credits printed with a minus sign in the Credit column", () => {
  it("are read as credits when EVERY credit on the statement is printed that way (and the reader says so)", () => {
    const read = readTabularStatement(grid([
      HEAD,
      ["06/10/2026", "000000002293957", "PO-1", "R 12 669,26", "", "R 23 251,95"],
      ["01/10/2026", "000000002252003", "Payment", "", "-R 2 000,00", "R 10 582,69"],
      ["22/09/2026", "000000002247200", "Credit Note", "", "-R 239,55", "R 12 582,69"],
    ]));
    const lines = read.lines.filter((l) => !l.isExcluded);
    expect(lines.map((l) => [l.credit, l.unresolvedFields])).toEqual([[null, []], [2000, []], [239.55, []]]);
    expect(lines[1].rawText).toContain("-R 2 000,00"); // the printed text is kept
    expect(read.warnings.join(" ")).toMatch(/prints signed amounts in its Credit column: 2 values with a minus were read as credits/);
  });

  it("stay UNREAD when the statement is not consistent (some credits printed without a minus)", () => {
    const lines = transactions([
      HEAD,
      ["01/10/2026", "P1", "Payment", "", "-R 2 000,00", "R 1,00"],
      ["02/10/2026", "P2", "Payment", "", "-R 1 000,00", "R 1,00"],
      ["03/10/2026", "P3", "Payment", "", "R 500,00", "R 1,00"],
    ]);
    expect(lines.map((l) => l.unresolvedFields)).toEqual([["credit"], ["credit"], []]);
    expect(lines[0].credit).toBeNull();
  });

  it("a single negative credit is not a convention — it stays unread", () => {
    const lines = transactions([HEAD, ["01/10/2026", "P1", "Payment", "", "-R 2 000,00", "R 1,00"]]);
    expect(lines[0].unresolvedFields).toEqual(["credit"]);
  });

  it("a negative DEBIT is never re-signed", () => {
    const lines = transactions([HEAD, ["01/10/2026", "X1", "Inv", "-R 5,00", "", "R 1,00"], ["02/10/2026", "P1", "Pay", "", "-R 1,00", "R 1,00"], ["03/10/2026", "P2", "Pay", "", "-R 1,00", "R 1,00"]]);
    expect(lines[0].unresolvedFields).toContain("debit");
  });
});

describe("period subtotals are not the statement's totals", () => {
  it("'Total: October 2026' rows are excluded PERIOD totals and set no printed statement totals", () => {
    const read = readTabularStatement(grid([
      HEAD,
      ["06/10/2026", "A1", "PO-1", "R 100,00", "", "R 100,00"],
      ["Total:", "October 2026", "", "R 100,00", "R 0,00", "R 100,00"],
      ["28/09/2026", "A0", "PO-0", "R 50,00", "", "R 50,00"],
      ["Total:", "September 2026", "", "R 50,00", "R 0,00", "R 50,00"],
    ]));
    expect(read.lines.filter((l) => l.isExcluded).map((l) => l.exclusionReason)).toEqual(["period-total", "period-total"]);
    expect(read.header.printedTotalDebits).toBeNull();
    expect(read.header.printedTotalCredits).toBeNull();
  });

  it("a real statement total is still a statement total", () => {
    const read = readTabularStatement(grid([HEAD, ["03/09/2026", "A1", "x", "100.00", "", "100.00"], ["Totals", "", "", "100.00", "0.00", ""]]));
    expect(read.lines.filter((l) => l.isExcluded).map((l) => l.exclusionReason)).toEqual(["statement-total"]);
    expect(read.header.printedTotalDebits).toBe(100);
  });
});

describe("the ageing block", () => {
  const AGEING_ROWS = [
    ["90+ Days", "60 Days", "30 Days", "Current", "Total Due", "Overdue"],
    ["R 0,00", "R 60 547,10", "R 109 484,66", "R 27 525,03", "197 556,79", "R 170 031,76"],
  ];
  it("reads 90+ Days, ignores Overdue as a bucket, and takes Total Due from BENEATH its heading", () => {
    const read = readTabularStatement(grid([...AGEING_ROWS, [], HEAD, ["06/10/2026", "A1", "PO-1", "R 1,00", "", "R 1,00"]]));
    expect(read.header.printedAgeing).toEqual({ current: 27525.03, days30: 109484.66, days60: 60547.1, days90: 0, days120Plus: null });
    expect(read.header.closingBalance).toBe(197556.79);
  });

  it("an ageing block after the table (and a second copy) never becomes a transaction line", () => {
    const read = readTabularStatement(grid([...AGEING_ROWS, [], HEAD, ["06/10/2026", "A1", "PO-1", "R 1,00", "", "R 1,00"], [], ...AGEING_ROWS]));
    const lines = read.lines.filter((l) => !l.isExcluded);
    expect(lines).toHaveLength(1);
    expect(lines[0].referenceText).toBe("A1");
  });

  it("a 'Total Due' beside a heading is not read as its value (no label text becomes an amount)", () => {
    const read = readTabularStatement(grid([["Current", "Total Due"], [], HEAD, ["06/10/2026", "A1", "PO-1", "R 1,00", "", "R 1,00"]]));
    expect(read.header.closingBalance).toBeNull();
  });
});

describe("the statement date", () => {
  const TABLE = [HEAD, ["01/10/2026", "A1", "x", "R 1,00", "", "R 1,00"]];
  it("a bare 'Date:' label in the header is the statement date", () => {
    expect(readTabularStatement(grid([["Account No: 40-1234-5678"], ["Date: 06/10/2026"], [], ...TABLE])).header.statementDate).toBe("2026-10-06");
    expect(readTabularStatement(grid([["Date", "06/10/2026"], [], ...TABLE])).header.statementDate).toBe("2026-10-06");
  });
  it("'Statement Date:' inside a longer cell is read", () => {
    expect(readTabularStatement(grid([["Riverbend Trading  Statement Date: 06/10/2026"], [], ...TABLE])).header.statementDate).toBe("2026-10-06");
  });
  it("a bare 'Date' that is not followed by a date is ignored, and the table's Date column is never a label", () => {
    expect(readTabularStatement(grid([["Date: to be confirmed"], [], ...TABLE])).header.statementDate).toBeNull();
    expect(readTabularStatement(grid(TABLE)).header.statementDate).toBeNull();
  });
  it("no opening balance is manufactured when the statement prints none", () => {
    expect(readTabularStatement(grid([["Date: 06/10/2026"], [], ...TABLE])).header.openingBalance).toBeNull();
  });
});

describe("the letterhead", () => {
  const token = (text: string, y: number, height: number, x = 40): LayoutToken => ({ text, x, y, width: text.length * height * 0.5, height });
  const page = (tokens: LayoutToken[]): LayoutPage => ({ pageNumber: 1, width: 595, height: 842, tokens });
  const body = [
    token("Date", 300, 9), token("Reference", 300, 9, 120), token("Debit", 300, 9, 300), token("Balance", 300, 9, 420),
    token("01/10/2026", 320, 9), token("A1", 320, 9, 120), token("10.00", 320, 9, 300), token("10.00", 320, 9, 420),
  ];

  it("a telephone line is never the supplier's name, however large", () => {
    const read = readStatementLayout([page([token("T 021 555 0199", 40, 22), token("Cape Harbour Fine Foods (Pty) Ltd", 64, 11), token("Unit 4, Harbour Park", 78, 9), ...body])]);
    expect(read.header.supplierName).toBe("Cape Harbour Fine Foods (Pty) Ltd");
  });

  it.each([["Tel: 021 555 0199"], ["+27 21 555 0199"], ["accounts@capeharbour.example"], ["www.capeharbour.example"], ["021 555 0199"]])(
    "%s is a contact detail, not a name",
    (contact) => {
      const read = readStatementLayout([page([token(contact, 40, 22), token("Cape Harbour Fine Foods", 64, 11), ...body])]);
      expect(read.header.supplierName).toBe("Cape Harbour Fine Foods");
    },
  );

  it("a letter-spaced title is not the name", () => {
    const read = readStatementLayout([page([token("S T A T E M E N T", 40, 16, 400), token("Cape Harbour Fine Foods", 64, 11), ...body])]);
    expect(read.header.supplierName).toBe("Cape Harbour Fine Foods");
  });
});

// ---------------------------------------------------------------------
// SD-3G (real-PDF diagnosis) — the positional header layer, bank details,
// a signed Credit column proven by period totals, and a proven 0.00 opening.
// ---------------------------------------------------------------------

describe("header fields by POSITION (the real statement's layout)", () => {
  const TABLE = [HEAD, ["01/10/2026", "A1", "x", "R 1,00", "", "R 1,00"]];
  it("'Date' with its value BELOW it (a Date | Page box) is the statement date", () => {
    const read = readTabularStatement(grid([["", "", "", "Date", "Page"], ["", "", "", "06/10/2026", "1 of 1"], [], ...TABLE]));
    expect(read.header.statementDate).toBe("2026-10-06");
  });
  it("'Statement Date' with its value below, and with other text between label and value", () => {
    expect(readTabularStatement(grid([["Statement Date"], ["06/10/2026"], [], ...TABLE])).header.statementDate).toBe("2026-10-06");
    expect(readTabularStatement(grid([["Statement Date:", "(see terms)", "06/10/2026"], [], ...TABLE])).header.statementDate).toBe("2026-10-06");
  });
  it("a value below that does not look like a date is never taken (no neighbouring heading becomes a date)", () => {
    expect(readTabularStatement(grid([["Date", "Page"], ["see overleaf", "1 of 1"], [], ...TABLE])).header.statementDate).toBeNull();
  });
  it("'V.A.T. REG. No.' (dotted) is the VAT number", () => {
    expect(readTabularStatement(grid([["V.A.T. REG. No. 4350250850"], [], ...TABLE])).header.supplierVatNumber).toBe("4350250850");
  });
});

describe("the supplier's bank details", () => {
  const TABLE = [HEAD, ["01/10/2026", "A1", "x", "R 1,00", "", "R 1,00"]];
  const BLOCK = [["Atlantic Gourmet Foods"], ["Example Bank"], ["Business Banking"], ["Account Number: 40-0000-1234"], ["Branch Code: 600000"]];
  it("the account number there is the SUPPLIER's bank account — never our account number — and the reader says so", () => {
    const read = readTabularStatement(grid([...BLOCK, [], ...TABLE]));
    expect(read.header.accountNumber).toBeNull();
    expect(read.warnings.join(" ")).toMatch(/40-0000-1234 is printed with the supplier's bank details \(Atlantic Gourmet Foods\)/);
  });
  it("our account number printed elsewhere is still read", () => {
    expect(readTabularStatement(grid([["Account No: 000123"], [], ...BLOCK, [], ...TABLE])).header.accountNumber).toBe("000123");
  });
});

describe("the supplier name when the letterhead is a logo", () => {
  const token = (text: string, y: number, height: number, x = 40): LayoutToken => ({ text, x, y, width: text.length * height * 0.5, height });
  const page = (tokens: LayoutToken[]): LayoutPage => ({ pageNumber: 1, width: 595, height: 842, tokens });
  const body = [
    token("Date", 329, 9, 17), token("Invoice", 329, 9, 74), token("Debit", 329, 9, 409), token("Balance", 329, 9, 544),
    token("01/10/2026", 342, 9, 17), token("A1", 342, 9, 74), token("10.00", 342, 9, 409), token("10.00", 342, 9, 544),
  ];
  const letterhead = [
    token("T 021 555 0100", 32, 10, 262), token("E accounts@atlanticgourmet.example", 52, 10, 232),
    token("Liquor Licence No: 99999", 82, 10, 240), token("SUITE No. 12", 102, 10, 264), token("PRIVATE BAG X99", 112, 10, 256), token("SEAPOINT 8005", 122, 10, 261),
    token("Date", 80, 10, 421), token("Page", 80, 10, 519), token("06/10/2026", 94, 10, 407), token("1 of 1", 94, 10, 518),
  ];
  it("is the payee of the bank details — not a licence, address, contact, label or the customer", () => {
    const read = readStatementLayout([page([
      ...letterhead,
      token("Riverbend Trading (Pty) Ltd", 158, 9, 22), token("Atlantic Gourmet Foods", 158, 9, 389),
      token("Example Bank", 171, 9, 389), token("Account Number: 40-0000-1234", 210, 9, 389), token("Branch Code: 600000", 223, 9, 389),
      ...body,
    ])]);
    expect(read.header.supplierName).toBe("Atlantic Gourmet Foods");
    expect(read.header.statementDate).toBe("2026-10-06");
  });
  it("a printed letterhead name still wins over the bank payee", () => {
    const read = readStatementLayout([page([token("Karoo Building Supplies (Pty) Ltd", 40, 18), ...letterhead.slice(1),
      token("Karoo Trading Account", 158, 9, 389), token("Example Bank", 171, 9, 389), token("Account Number: 1", 210, 9, 389), ...body])]);
    expect(read.header.supplierName).toBe("Karoo Building Supplies (Pty) Ltd");
  });
});

describe("a SIGNED Credit column (values without a minus increase the balance)", () => {
  it("is read when the period totals prove it; the raw text is kept", () => {
    const read = readTabularStatement(grid([
      HEAD,
      ["09/09/2026", "P1", "Payment", "", "-R 700,00", "R 1,00"],
      ["09/09/2026", "_CR2", "Payment", "", "R 1 000,00", "R 1,00"],
      ["08/09/2026", "_CR2", "Payment", "", "-R 1 000,00", "R 1,00"],
      ["01/09/2026", "I1", "PO-1", "R 700,00", "", "R 1,00"],
      ["Total:", "September 2026", "", "R 700,00", "-R 700,00", "R 0,00"],
    ]));
    const tx = read.lines.filter((l) => !l.isExcluded);
    expect(tx.map((l) => [l.debit, l.credit, l.unresolvedFields])).toEqual([[null, 700, []], [1000, null, []], [null, 1000, []], [700, null, []]]);
    expect(tx[1].rawText).toContain("R 1 000,00");
    expect(read.warnings.join(" ")).toMatch(/1 printed without a minus was read as increasing the balance, as each period's printed total proves/);
  });
  it("a value without a minus that NO period total proves stays unread (never guessed)", () => {
    const read = readTabularStatement(grid([
      HEAD,
      ["09/09/2026", "P1", "Payment", "", "-R 700,00", "R 1,00"],
      ["09/09/2026", "_CR2", "Payment", "", "R 1 000,00", "R 1,00"],
      ["Total:", "September 2026", "", "R 0,00", "-R 999,00", "R 0,00"],
    ]));
    const cr = read.lines.find((l) => l.referenceText === "_CR2")!;
    expect(cr.unresolvedFields).toEqual(["credit"]);
    expect(cr.debit).toBeNull();
    expect(cr.credit).toBeNull();
  });
  it("an ordinary statement with unsigned credits is unaffected", () => {
    const tx = transactions([HEAD, ["01/10/2026", "P1", "Payment", "", "R 500,00", "R 1,00"], ["02/10/2026", "I1", "Inv", "R 9,00", "", "R 1,00"]]);
    expect(tx.map((l) => [l.debit, l.credit])).toEqual([[null, 500], [9, null]]);
  });
});

describe("the opening balance", () => {
  it("is 0.00 ONLY when no brought-forward is printed and the lines add up exactly to the closing balance", () => {
    const proven = readTabularStatement(grid([["Total Due"], ["R 300,00"], [], HEAD, ["01/10/2026", "I1", "x", "R 300,00", "", "R 300,00"]]));
    expect(proven.header.openingBalance).toBe(0);
    expect(proven.warnings.join(" ")).toMatch(/add up exactly to its closing balance from nothing/);
    const notProven = readTabularStatement(grid([["Total Due"], ["R 400,00"], [], HEAD, ["01/10/2026", "I1", "x", "R 300,00", "", "R 300,00"]]));
    expect(notProven.header.openingBalance).toBeNull();
  });
  it("is never set when a value is unread", () => {
    const read = readTabularStatement(grid([["Total Due"], ["R 300,00"], [], HEAD, ["01/10/2026", "I1", "x", "R 3?0,00", "", "R 300,00"]]));
    expect(read.header.openingBalance).toBeNull();
  });
});
