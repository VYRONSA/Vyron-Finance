import { describe, expect, it } from "vitest";
import { validateJournalLines, ValidationError } from "./journal-crud-service";

describe("validateJournalLines", () => {
  it("accepts a balanced two-line journal", () => {
    expect(() =>
      validateJournalLines([
        { accountCode: "1000", debit: 500, credit: 0, description: "Bank" },
        { accountCode: "6100", debit: 0, credit: 500, description: "Fees" },
      ]),
    ).not.toThrow();
  });

  it("accepts a balanced multi-line journal", () => {
    expect(() =>
      validateJournalLines([
        { accountCode: "1100", debit: 1150, credit: 0, description: "Debtors" },
        { accountCode: "4000", debit: 0, credit: 1000, description: "Sales" },
        { accountCode: "2200", debit: 0, credit: 150, description: "VAT" },
      ]),
    ).not.toThrow();
  });

  it("rejects fewer than two lines", () => {
    expect(() => validateJournalLines([{ accountCode: "1000", debit: 500, credit: 0, description: "" }])).toThrow(ValidationError);
  });

  it("rejects a blank account code", () => {
    expect(() =>
      validateJournalLines([
        { accountCode: "", debit: 500, credit: 0, description: "" },
        { accountCode: "6100", debit: 0, credit: 500, description: "" },
      ]),
    ).toThrow(ValidationError);
  });

  it("rejects a line with both debit and credit set", () => {
    expect(() =>
      validateJournalLines([
        { accountCode: "1000", debit: 500, credit: 500, description: "" },
        { accountCode: "6100", debit: 0, credit: 500, description: "" },
      ]),
    ).toThrow(ValidationError);
  });

  it("rejects a line with neither debit nor credit", () => {
    expect(() =>
      validateJournalLines([
        { accountCode: "1000", debit: 0, credit: 0, description: "" },
        { accountCode: "6100", debit: 0, credit: 500, description: "" },
      ]),
    ).toThrow(ValidationError);
  });

  it("rejects a negative amount", () => {
    expect(() =>
      validateJournalLines([
        { accountCode: "1000", debit: -500, credit: 0, description: "" },
        { accountCode: "6100", debit: 0, credit: 500, description: "" },
      ]),
    ).toThrow(ValidationError);
  });

  it("rejects an unbalanced journal", () => {
    expect(() =>
      validateJournalLines([
        { accountCode: "1000", debit: 500, credit: 0, description: "" },
        { accountCode: "6100", debit: 0, credit: 400, description: "" },
      ]),
    ).toThrow(ValidationError);
  });
});
