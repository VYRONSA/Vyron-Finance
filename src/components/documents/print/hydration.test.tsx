/**
 * React error #418 — server HTML vs the browser's first render.
 *
 * Each case renders on the "server" (this process's default locale and time
 * zone), then hydrates the SAME element in a "browser" whose runtime locale
 * APIs behave like a South African user's (en-ZA, Africa/Johannesburg) —
 * exactly the production situation that raised #418 on Sales. Any markup
 * difference makes React report a recoverable hydration error.
 *
 * The first case is the control: a component still using
 * `toLocaleString(undefined, …)` MUST be caught, proving the harness really
 * detects the defect. Every VYRON case after it must hydrate cleanly.
 */
import { act, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatAmount, formatCount, formatDate, formatDateTime } from "@/lib/format";
import type { SalesInvoice } from "@/server/sales/types";
import type { StatementEntry } from "@/server/matching/customer-statement-engine";
import { InvoiceDocumentBody } from "./invoice-body";
import { StatementDocumentBody } from "./statement-body";
import { DocumentBrandingBlock } from "./branding-block";

const numberToLocale = Number.prototype.toLocaleString;
const dateToLocale = Date.prototype.toLocaleString;
const dateToLocaleDate = Date.prototype.toLocaleDateString;
const dateToLocaleTime = Date.prototype.toLocaleTimeString;

/** Runs `work` with the runtime-default locale APIs answering as `locale`
 * in `timeZone` — i.e. as that runtime would, whatever this test machine's
 * own default is. */
async function asRuntime<T>(locale: string, timeZone: string, work: () => T | Promise<T>): Promise<T> {
  Number.prototype.toLocaleString = function (this: number, _l?: unknown, o?: Intl.NumberFormatOptions) {
    return numberToLocale.call(this, locale, o);
  };
  Date.prototype.toLocaleString = function (this: Date, _l?: unknown, o?: Intl.DateTimeFormatOptions) {
    return dateToLocale.call(this, locale, { timeZone, ...o });
  };
  Date.prototype.toLocaleDateString = function (this: Date, _l?: unknown, o?: Intl.DateTimeFormatOptions) {
    return dateToLocaleDate.call(this, locale, { timeZone, ...o });
  };
  Date.prototype.toLocaleTimeString = function (this: Date, _l?: unknown, o?: Intl.DateTimeFormatOptions) {
    return dateToLocaleTime.call(this, locale, { timeZone, ...o });
  };
  try {
    return await work();
  } finally {
    Number.prototype.toLocaleString = numberToLocale;
    Date.prototype.toLocaleString = dateToLocale;
    Date.prototype.toLocaleDateString = dateToLocaleDate;
    Date.prototype.toLocaleTimeString = dateToLocaleTime;
  }
}

/** Server render as the Vercel server (en-US, UTC); hydrate as a South
 * African browser (en-ZA, Africa/Johannesburg). Returns React's
 * recoverable hydration errors. */
async function hydrationErrorsInSouthAfricanBrowser(element: ReactElement): Promise<unknown[]> {
  const serverHtml = await asRuntime("en-US", "UTC", () => renderToString(element));
  const container = document.createElement("div");
  container.innerHTML = serverHtml;
  document.body.appendChild(container);
  const errors: unknown[] = [];
  try {
    await asRuntime("en-ZA", "Africa/Johannesburg", () =>
      act(async () => {
        hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
      }),
    );
  } finally {
    container.remove();
  }
  return errors;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const invoice = {
  id: 17,
  documentType: "Invoice",
  invoiceNumber: "INV-0017",
  customerId: 5,
  invoiceDate: "2026-07-31",
  dueDate: "2026-08-31",
  reference: "PO-88",
  status: "Draft",
  subtotal: 20000,
  vatAmount: 3000,
  total: 23000,
  outstanding: 23000,
  notes: "",
  lines: [{ id: 1, description: "Catering — July", quantity: 1, unitPrice: 20000, vatAmount: 3000, lineTotal: 23000 }],
} as unknown as SalesInvoice;

const entries = [
  { date: "2026-07-31", type: "Invoice", reference: "INV-0017", debit: 23000, credit: 0, balance: 23000 },
  { date: "2026-08-15", type: "Receipt", reference: "RCT-0004", debit: 0, credit: 1234.5, balance: 21765.5 },
] as unknown as StatementEntry[];

describe("server HTML matches a South African browser's first render", () => {
  it("CONTROL: runtime-locale formatting IS detected (the production #418)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function RuntimeLocaleAmount({ value }: { value: number }) {
      return <p>{value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>;
    }
    expect((await hydrationErrorsInSouthAfricanBrowser(<RuntimeLocaleAmount value={20000} />)).length).toBeGreaterThan(0);
  });

  it("the shared formatters hydrate cleanly", async () => {
    function Figures() {
      return (
        <p>
          {formatAmount(20000)} · {formatCount(1234)} · {formatDate("2026-09-14T22:30:00Z")} · {formatDateTime("2026-09-14T16:09:21Z")}
        </p>
      );
    }
    expect(await hydrationErrorsInSouthAfricanBrowser(<Figures />)).toEqual([]);
  });

  it("the invoice document hydrates cleanly", async () => {
    const element = (
      <InvoiceDocumentBody
        invoice={invoice}
        customer={{ name: "Kingdom Foods", vatNumber: "4123456789", registrationNumber: "" }}
        addressLine="1 Main Road, Cape Town"
        letterhead={<DocumentBrandingBlock company={null} logoSrc={null} />}
      />
    );
    expect(await hydrationErrorsInSouthAfricanBrowser(element)).toEqual([]);
    expect(renderToString(element)).toContain("20,000.00");
  });

  it("the customer statement hydrates cleanly", async () => {
    const element = (
      <StatementDocumentBody
        customer={{ id: 5, name: "Kingdom Foods" }}
        entries={entries}
        addressLine={null}
        statementDate="2026-09-14"
        letterhead={<DocumentBrandingBlock company={null} logoSrc={null} />}
      />
    );
    expect(await hydrationErrorsInSouthAfricanBrowser(element)).toEqual([]);
    expect(renderToString(element)).toContain("21,765.50");
  });
});
