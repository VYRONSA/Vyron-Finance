import { describe, expect, it, afterEach } from "vitest";
import { extractStableIdentifierFromRecipient, findStableIdentifierAmongRecipients, resolveStableIdentifierForMessage } from "./recipient-resolution";

const ORIGINAL_DOMAIN = process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;

afterEach(() => {
  if (ORIGINAL_DOMAIN === undefined) delete process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;
  else process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = ORIGINAL_DOMAIN;
});

describe("extractStableIdentifierFromRecipient", () => {
  it("extracts the stable identifier from a well-formed address on the configured domain", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    expect(extractStableIdentifierFromRecipient("northwood-management-investments-a7k3.bank@imports.vyronfinance.co.za")).toBe(
      "northwood-management-investments-a7k3",
    );
  });

  it("Company A's recipient resolves only to Company A's own identifier, never Company B's", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const a = extractStableIdentifierFromRecipient("company-a-a7k3.bank@imports.vyronfinance.co.za");
    const b = extractStableIdentifierFromRecipient("company-b-x9q2.bank@imports.vyronfinance.co.za");
    expect(a).toBe("company-a-a7k3");
    expect(b).toBe("company-b-x9q2");
    expect(a).not.toBe(b);
  });

  it("is case-insensitive (email addresses are case-insensitive)", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    expect(extractStableIdentifierFromRecipient("Acme-Ltd-A7K3.BANK@Imports.VyronFinance.co.za")).toBe("acme-ltd-a7k3");
  });

  it("returns null for a recipient on a different/lookalike domain", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    expect(extractStableIdentifierFromRecipient("acme-ltd-a7k3.bank@imports.vyronfinance.co.za.evil.com")).toBeNull();
    expect(extractStableIdentifierFromRecipient("acme-ltd-a7k3.bank@notvyronfinance.co.za")).toBeNull();
  });

  it("returns null when the address isn't shaped like a bank statement identity at all", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    expect(extractStableIdentifierFromRecipient("someone@imports.vyronfinance.co.za")).toBeNull();
    expect(extractStableIdentifierFromRecipient("acme-ltd-a7k3@imports.vyronfinance.co.za")).toBeNull();
    expect(extractStableIdentifierFromRecipient("not-an-email")).toBeNull();
  });

  it("returns null for an extracted candidate that isn't a valid identifier shape", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    expect(extractStableIdentifierFromRecipient(".bank@imports.vyronfinance.co.za")).toBeNull();
    expect(extractStableIdentifierFromRecipient("has spaces.bank@imports.vyronfinance.co.za")).toBeNull();
  });

  it("returns null (never a fabricated match) when the domain isn't configured", () => {
    delete process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;
    expect(extractStableIdentifierFromRecipient("acme-ltd-a7k3.bank@imports.vyronfinance.co.za")).toBeNull();
  });
});

describe("findStableIdentifierAmongRecipients", () => {
  it("finds the one matching recipient among several unrelated addresses", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = findStableIdentifierAmongRecipients(["accounts@thebank.co.za", "acme-ltd-a7k3.bank@imports.vyronfinance.co.za", "cc@thebank.co.za"]);
    expect(result).toBe("acme-ltd-a7k3");
  });

  it("returns null when no recipient matches (unknown recipient rejected)", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    expect(findStableIdentifierAmongRecipients(["someone@example.com", "another@example.com"])).toBeNull();
  });

  it("returns null for an empty recipient list", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    expect(findStableIdentifierAmongRecipients([])).toBeNull();
  });
});

describe("resolveStableIdentifierForMessage — Phase 21K routing-header-first resolution", () => {
  it("resolves from X-Original-To when present, ahead of To:/Cc: content", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = resolveStableIdentifierForMessage({
      to: ["bankstatements@vyronfinance.co.za"],
      cc: [],
      headers: { "x-original-to": "acme-ltd-a7k3.bank@imports.vyronfinance.co.za" },
    });
    expect(result).toBe("acme-ltd-a7k3");
  });

  it("falls back to Delivered-To when X-Original-To is absent", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = resolveStableIdentifierForMessage({
      to: ["bankstatements@vyronfinance.co.za"],
      cc: [],
      headers: { "delivered-to": "acme-ltd-a7k3.bank@imports.vyronfinance.co.za" },
    });
    expect(result).toBe("acme-ltd-a7k3");
  });

  it("prefers X-Original-To over Delivered-To when both are present", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = resolveStableIdentifierForMessage({
      to: [],
      cc: [],
      headers: {
        "x-original-to": "company-a-a7k3.bank@imports.vyronfinance.co.za",
        "delivered-to": "bankstatements@vyronfinance.co.za",
      },
    });
    expect(result).toBe("company-a-a7k3");
  });

  it("falls back to To:/Cc: exactly as before when no routing header is present at all (Resend today)", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = resolveStableIdentifierForMessage({ to: ["acme-ltd-a7k3.bank@imports.vyronfinance.co.za"], cc: [], headers: undefined });
    expect(result).toBe("acme-ltd-a7k3");
  });

  it("falls back to To:/Cc: when headers are present but don't contain a usable routing header", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = resolveStableIdentifierForMessage({
      to: ["acme-ltd-a7k3.bank@imports.vyronfinance.co.za"],
      cc: [],
      headers: { subject: "Your statement", "message-id": "<abc@bank.co.za>" },
    });
    expect(result).toBe("acme-ltd-a7k3");
  });

  it("now also checks Cc:, closing a real pre-existing gap (the module previously only ever received To:)", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = resolveStableIdentifierForMessage({ to: ["someone-else@example.com"], cc: ["acme-ltd-a7k3.bank@imports.vyronfinance.co.za"], headers: undefined });
    expect(result).toBe("acme-ltd-a7k3");
  });

  it("rejects (null) when no signal — routing header, To:, or Cc: — resolves to a known identifier (unknown identifier)", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = resolveStableIdentifierForMessage({
      to: ["randomperson@imports.vyronfinance.co.za"],
      cc: [],
      headers: { "x-original-to": "randomperson@imports.vyronfinance.co.za" },
    });
    expect(result).toBeNull();
  });

  it("Company A's routing header resolves only to Company A's identifier, never Company B's — cross-company identifiers cannot leak", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const a = resolveStableIdentifierForMessage({ to: [], cc: [], headers: { "x-original-to": "company-a-a7k3.bank@imports.vyronfinance.co.za" } });
    const b = resolveStableIdentifierForMessage({ to: [], cc: [], headers: { "x-original-to": "company-b-x9q2.bank@imports.vyronfinance.co.za" } });
    expect(a).toBe("company-a-a7k3");
    expect(b).toBe("company-b-x9q2");
    expect(a).not.toBe(b);
  });

  it("a malformed/lookalike-domain routing header never falls through to a fabricated match — resolves null, not a guess", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = resolveStableIdentifierForMessage({
      to: [],
      cc: [],
      headers: { "x-original-to": "acme-ltd-a7k3.bank@imports.vyronfinance.co.za.evil.com" },
    });
    expect(result).toBeNull();
  });

  it("a malformed routing header value still correctly falls through to the To:/Cc: check rather than throwing or leaking cross-company", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    const result = resolveStableIdentifierForMessage({
      to: ["acme-ltd-a7k3.bank@imports.vyronfinance.co.za"],
      cc: [],
      headers: { "x-original-to": "not a valid email at all" },
    });
    expect(result).toBe("acme-ltd-a7k3");
  });

  it("the sender is never consulted — only recipient-shaped fields (routing headers, To:, Cc:) can ever resolve a company", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    // A malicious/careless sender address that happens to look like a
    // valid identifier must never resolve a company — `from` isn't even
    // a parameter this function accepts, by construction.
    const result = resolveStableIdentifierForMessage({ to: ["someone@unrelated-domain.com"], cc: [], headers: undefined });
    expect(result).toBeNull();
  });
});
