/**
 * Phase 25J — Outbound Email Idempotency Hardening. Pure-function tests
 * for the ONE place a communication's stable send identity is computed.
 * No mocking needed — no I/O in this module.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildCommunicationIdempotencyIdentity } from "./idempotency";

const ORIGINAL_DOMAIN = process.env.VYRON_MESSAGE_ID_DOMAIN;

beforeEach(() => {
  delete process.env.VYRON_MESSAGE_ID_DOMAIN;
});

afterEach(() => {
  if (ORIGINAL_DOMAIN === undefined) delete process.env.VYRON_MESSAGE_ID_DOMAIN;
  else process.env.VYRON_MESSAGE_ID_DOMAIN = ORIGINAL_DOMAIN;
});

describe("buildCommunicationIdempotencyIdentity — determinism", () => {
  it("is deterministic: the same communication id always produces the exact same identity", () => {
    const first = buildCommunicationIdempotencyIdentity(501);
    const second = buildCommunicationIdempotencyIdentity(501);
    expect(first).toEqual(second);
  });

  it("calling it many times (simulating many retries) never drifts", () => {
    const results = Array.from({ length: 10 }, () => buildCommunicationIdempotencyIdentity(501));
    expect(new Set(results.map((r) => r.idempotencyKey)).size).toBe(1);
    expect(new Set(results.map((r) => r.messageId)).size).toBe(1);
  });

  it("produces a genuinely different identity for a different communication id (a real resend)", () => {
    const a = buildCommunicationIdempotencyIdentity(501);
    const b = buildCommunicationIdempotencyIdentity(502);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(a.messageId).not.toBe(b.messageId);
  });

  it("never depends on the current time (no Date.now/timestamp baked in)", () => {
    const before = buildCommunicationIdempotencyIdentity(501);
    // A real Date.now() call would differ across two invocations at
    // different wall-clock instants; assert equality holds regardless.
    const after = buildCommunicationIdempotencyIdentity(501);
    expect(before).toEqual(after);
  });
});

describe("buildCommunicationIdempotencyIdentity — format safety", () => {
  it("idempotencyKey contains only safe, provider-agnostic characters (no @, no angle brackets, no whitespace)", () => {
    const { idempotencyKey } = buildCommunicationIdempotencyIdentity(501);
    expect(idempotencyKey).toMatch(/^[a-z0-9-]+$/);
  });

  it("messageId is a well-formed RFC 5322 <local-part@domain> token", () => {
    const { messageId } = buildCommunicationIdempotencyIdentity(501);
    expect(messageId).toMatch(/^<[a-z0-9-]+@[a-z0-9.-]+>$/);
  });

  it("messageId's domain part is a VYRON-controlled default, not derived from any customer/provider input", () => {
    const { messageId } = buildCommunicationIdempotencyIdentity(501);
    expect(messageId).toContain("@communications.vyronfinance.co.za>");
  });

  it("respects VYRON_MESSAGE_ID_DOMAIN when explicitly configured", () => {
    process.env.VYRON_MESSAGE_ID_DOMAIN = "mail.example-deployment.co.za";
    const { messageId } = buildCommunicationIdempotencyIdentity(501);
    expect(messageId).toBe("<vyron-communication-501@mail.example-deployment.co.za>");
  });

  it("never throws when VYRON_MESSAGE_ID_DOMAIN is unset — falls back to a safe built-in default", () => {
    delete process.env.VYRON_MESSAGE_ID_DOMAIN;
    expect(() => buildCommunicationIdempotencyIdentity(501)).not.toThrow();
  });
});

describe("buildCommunicationIdempotencyIdentity — no PII / no secrets", () => {
  it("contains no email address (never derives from a customer's address)", () => {
    const { idempotencyKey, messageId } = buildCommunicationIdempotencyIdentity(501);
    expect(idempotencyKey).not.toMatch(/@/);
    // messageId legitimately contains ONE @ (its own RFC 5322 structure) —
    // assert it's not a second, customer-address-shaped @ shows up.
    expect(messageId.match(/@/g)?.length).toBe(1);
  });

  it("the identity is built ONLY from the numeric communication id — no other field can leak through", () => {
    const identity = buildCommunicationIdempotencyIdentity(501);
    expect(identity.idempotencyKey).toBe("vyron-communication-501");
  });
});
