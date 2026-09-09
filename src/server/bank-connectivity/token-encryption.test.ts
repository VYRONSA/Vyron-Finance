import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken, TokenEncryptionError } from "./token-encryption";

const ORIGINAL_KEY = process.env.BANK_TOKEN_ENCRYPTION_KEY;

beforeEach(() => {
  process.env.BANK_TOKEN_ENCRYPTION_KEY = "a-test-only-secret-never-used-in-production";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
  else process.env.BANK_TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe("encryptToken / decryptToken", () => {
  it("round-trips a plaintext token exactly (successful response)", () => {
    const envelope = encryptToken("a-real-access-token-value-12345");
    expect(decryptToken(envelope)).toBe("a-real-access-token-value-12345");
  });

  it("round-trips an empty string", () => {
    expect(decryptToken(encryptToken(""))).toBe("");
  });

  it("never stores the plaintext token verbatim inside the envelope (tokens never appear in logs/storage)", () => {
    const plaintext = "super-secret-refresh-token-do-not-leak";
    const envelope = encryptToken(plaintext);
    expect(envelope).not.toContain(plaintext);
  });

  it("produces a different envelope for the same plaintext on each call (random IV — never a deterministic, guessable ciphertext)", () => {
    const a = encryptToken("same-value");
    const b = encryptToken("same-value");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("same-value");
    expect(decryptToken(b)).toBe("same-value");
  });

  it("fails to decrypt with the wrong key (GCM authentication failure)", () => {
    const envelope = encryptToken("a-real-token");
    process.env.BANK_TOKEN_ENCRYPTION_KEY = "a-completely-different-secret";
    expect(() => decryptToken(envelope)).toThrow(TokenEncryptionError);
  });

  it("fails to decrypt a tampered envelope rather than silently returning garbage", () => {
    const envelope = encryptToken("a-real-token");
    const tampered = envelope.slice(0, -4) + "abcd";
    expect(() => decryptToken(tampered)).toThrow(TokenEncryptionError);
  });

  it("throws a clear, specific error for a malformed envelope shape (error handling)", () => {
    expect(() => decryptToken("not-a-real-envelope")).toThrow(TokenEncryptionError);
    expect(() => decryptToken("only.two")).toThrow(TokenEncryptionError);
  });

  it("throws a clear error naming the missing configuration when BANK_TOKEN_ENCRYPTION_KEY is unset — never silently falls back to an insecure default (error handling)", () => {
    delete process.env.BANK_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(TokenEncryptionError);
    expect(() => encryptToken("x")).toThrow(/BANK_TOKEN_ENCRYPTION_KEY/);
  });
});
