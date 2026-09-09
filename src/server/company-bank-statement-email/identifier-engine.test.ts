import { describe, expect, it, afterEach } from "vitest";
import {
  slugifyCompanyName,
  generateRandomSuffix,
  generateStableIdentifierCandidate,
  isValidStableIdentifier,
  buildBankStatementEmailAddress,
  BankStatementEmailConfigurationError,
} from "./identifier-engine";

describe("slugifyCompanyName", () => {
  it("lowercases and hyphenates a normal company name", () => {
    expect(slugifyCompanyName("Northwood Management Investments")).toBe("northwood-management-investments");
  });

  it("strips special characters and collapses whitespace/punctuation to single hyphens", () => {
    expect(slugifyCompanyName("Fenwick & Rowe (Pty) Ltd.")).toBe("fenwick-rowe-pty-ltd");
  });

  it("strips accents/diacritics", () => {
    expect(slugifyCompanyName("Café Résumé")).toBe("cafe-resume");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugifyCompanyName("  --Acme--  ")).toBe("acme");
  });

  it("falls back to a safe default when the name has no usable characters", () => {
    expect(slugifyCompanyName("🎉🎉🎉")).toBe("company");
    expect(slugifyCompanyName("")).toBe("company");
  });

  it("truncates very long names to a sane length", () => {
    const longName = "A".repeat(200);
    const slug = slugifyCompanyName(longName);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("generateRandomSuffix", () => {
  it("produces a 4-character lowercase alphanumeric suffix", () => {
    const suffix = generateRandomSuffix();
    expect(suffix).toMatch(/^[a-z0-9]{4}$/);
  });

  it("produces different values across calls (not hard-coded)", () => {
    const suffixes = new Set(Array.from({ length: 20 }, () => generateRandomSuffix()));
    expect(suffixes.size).toBeGreaterThan(1);
  });
});

describe("generateStableIdentifierCandidate", () => {
  it("combines the slug and a random suffix, always valid", () => {
    const candidate = generateStableIdentifierCandidate("Northwood Management Investments");
    expect(candidate).toMatch(/^northwood-management-investments-[a-z0-9]{4}$/);
    expect(isValidStableIdentifier(candidate)).toBe(true);
  });

  it("never produces the bare slug alone — the random suffix is always present", () => {
    const a = generateStableIdentifierCandidate("Acme Ltd");
    const b = generateStableIdentifierCandidate("Acme Ltd");
    expect(a).not.toBe("acme-ltd");
    expect(a).not.toBe(b); // different random suffixes, overwhelmingly likely
  });
});

describe("isValidStableIdentifier", () => {
  it("accepts well-formed identifiers", () => {
    expect(isValidStableIdentifier("northwood-management-investments-a7k3")).toBe(true);
    expect(isValidStableIdentifier("a")).toBe(true);
    expect(isValidStableIdentifier("company-1234")).toBe(true);
  });

  it("rejects empty, over-length, or malformed identifiers (invalid identifiers cannot be generated)", () => {
    expect(isValidStableIdentifier("")).toBe(false);
    expect(isValidStableIdentifier("-leading-hyphen")).toBe(false);
    expect(isValidStableIdentifier("trailing-hyphen-")).toBe(false);
    expect(isValidStableIdentifier("has spaces")).toBe(false);
    expect(isValidStableIdentifier("Has_Underscore")).toBe(false);
    expect(isValidStableIdentifier("UPPERCASE")).toBe(false);
    expect(isValidStableIdentifier("a".repeat(65))).toBe(false);
  });
});

describe("buildBankStatementEmailAddress", () => {
  const ORIGINAL_DOMAIN = process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;

  afterEach(() => {
    if (ORIGINAL_DOMAIN === undefined) delete process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;
    else process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = ORIGINAL_DOMAIN;
  });

  it("constructs the address from the identifier and the configured domain", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "imports.vyronfinance.co.za";
    expect(buildBankStatementEmailAddress("northwood-management-investments-a7k3")).toBe(
      "northwood-management-investments-a7k3.bank@imports.vyronfinance.co.za",
    );
  });

  it("fails honestly (never fabricates a placeholder domain) when the domain isn't configured", () => {
    delete process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN;
    expect(() => buildBankStatementEmailAddress("acme-ltd-a7k3")).toThrow(BankStatementEmailConfigurationError);
  });

  it("also fails honestly when the domain is set to an empty string", () => {
    process.env.VYRON_BANK_IMPORT_EMAIL_DOMAIN = "";
    expect(() => buildBankStatementEmailAddress("acme-ltd-a7k3")).toThrow(BankStatementEmailConfigurationError);
  });
});
