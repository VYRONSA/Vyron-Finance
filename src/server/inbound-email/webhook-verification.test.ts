import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));
vi.mock("resend", () => ({
  Resend: class {
    webhooks = { verify: verifyMock };
  },
}));

import { verifyResendWebhookRequest, MissingWebhookSecretError, InvalidWebhookSignatureError } from "./webhook-verification";

const ORIGINAL_API_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_SECRET = process.env.RESEND_WEBHOOK_SECRET;

function headers(overrides: Partial<{ svixId: string | null; svixTimestamp: string | null; svixSignature: string | null }> = {}) {
  return { svixId: "msg_1", svixTimestamp: "1730000000", svixSignature: "v1,abc123", ...overrides };
}

beforeEach(() => {
  verifyMock.mockReset();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test_secret";
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_API_KEY;
  if (ORIGINAL_SECRET === undefined) delete process.env.RESEND_WEBHOOK_SECRET;
  else process.env.RESEND_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

describe("verifyResendWebhookRequest — valid signature accepted", () => {
  it("returns the parsed payload from the official resend.webhooks.verify() call", () => {
    const payload = { type: "email.received", data: { email_id: "e1" } };
    verifyMock.mockReturnValue(payload);

    const result = verifyResendWebhookRequest("raw-body-text", headers());

    expect(result).toBe(payload);
    expect(verifyMock).toHaveBeenCalledWith({
      payload: "raw-body-text",
      headers: { id: "msg_1", timestamp: "1730000000", signature: "v1,abc123" },
      webhookSecret: "whsec_test_secret",
    });
  });

  it("passes the exact raw body string through — never a re-serialized JSON version", () => {
    verifyMock.mockReturnValue({ type: "email.received", data: {} });
    const raw = '{"weird":  "spacing",\n"preserved":true}';

    verifyResendWebhookRequest(raw, headers());

    expect(verifyMock).toHaveBeenCalledWith(expect.objectContaining({ payload: raw }));
  });
});

describe("verifyResendWebhookRequest — invalid signature rejected", () => {
  it("throws InvalidWebhookSignatureError when resend.webhooks.verify() throws", () => {
    verifyMock.mockImplementation(() => {
      throw new Error("No matching signature found");
    });

    expect(() => verifyResendWebhookRequest("raw-body", headers())).toThrow(InvalidWebhookSignatureError);
  });
});

describe("verifyResendWebhookRequest — missing signature rejected", () => {
  it("rejects without calling verify() when svix-id is missing", () => {
    expect(() => verifyResendWebhookRequest("raw", headers({ svixId: null }))).toThrow(InvalidWebhookSignatureError);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("rejects without calling verify() when svix-timestamp is missing", () => {
    expect(() => verifyResendWebhookRequest("raw", headers({ svixTimestamp: null }))).toThrow(InvalidWebhookSignatureError);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("rejects without calling verify() when svix-signature is missing", () => {
    expect(() => verifyResendWebhookRequest("raw", headers({ svixSignature: null }))).toThrow(InvalidWebhookSignatureError);
    expect(verifyMock).not.toHaveBeenCalled();
  });
});

describe("verifyResendWebhookRequest — configuration", () => {
  it("throws MissingWebhookSecretError, never calling verify(), when RESEND_WEBHOOK_SECRET isn't configured", () => {
    delete process.env.RESEND_WEBHOOK_SECRET;

    expect(() => verifyResendWebhookRequest("raw", headers())).toThrow(MissingWebhookSecretError);
    expect(verifyMock).not.toHaveBeenCalled();
  });
});

describe("verifyResendWebhookRequest — secret never leaks", () => {
  it("never includes the webhook secret value in a thrown error's message", () => {
    process.env.RESEND_WEBHOOK_SECRET = "whsec_should_never_appear_anywhere";
    verifyMock.mockImplementation(() => {
      throw new Error("some underlying library error mentioning whsec_should_never_appear_anywhere");
    });

    let thrown: unknown;
    try {
      verifyResendWebhookRequest("raw", headers());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(InvalidWebhookSignatureError);
    expect(String(thrown)).not.toContain("whsec_should_never_appear_anywhere");
  });
});
