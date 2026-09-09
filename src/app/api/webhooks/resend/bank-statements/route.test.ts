/**
 * Phase 21C — webhook route tests: signature verification enforcement
 * and correct HTTP status codes. Every dependency is mocked; this never
 * touches a real Supabase project or the real Resend API.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/server/inbound-email/webhook-verification", () => ({
  verifyResendWebhookRequest: vi.fn(),
  MissingWebhookSecretError: class MissingWebhookSecretError extends Error {},
  InvalidWebhookSignatureError: class InvalidWebhookSignatureError extends Error {},
}));
vi.mock("@/server/services/inbound-bank-statement-email-service", () => ({ processResendInboundEmail: vi.fn() }));

import { POST } from "./route";
import { verifyResendWebhookRequest, MissingWebhookSecretError, InvalidWebhookSignatureError } from "@/server/inbound-email/webhook-verification";
import { processResendInboundEmail } from "@/server/services/inbound-bank-statement-email-service";

function webhookRequest(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/webhooks/resend/bank-statements", {
    method: "POST",
    body,
    headers: { "svix-id": "msg_1", "svix-timestamp": "1730000000", "svix-signature": "v1,abc", ...headers },
  });
}

beforeEach(() => {
  vi.mocked(verifyResendWebhookRequest).mockReset();
  vi.mocked(processResendInboundEmail).mockReset();
});

describe("POST /api/webhooks/resend/bank-statements — signature verification", () => {
  it("returns 401 when the signature is invalid, without ever processing the event", async () => {
    vi.mocked(verifyResendWebhookRequest).mockImplementation(() => {
      throw new InvalidWebhookSignatureError("bad signature");
    });

    const response = await POST(webhookRequest('{"type":"email.received"}'));

    expect(response.status).toBe(401);
    expect(processResendInboundEmail).not.toHaveBeenCalled();
  });

  it("returns 500 (not a fabricated success) when the webhook secret isn't configured", async () => {
    vi.mocked(verifyResendWebhookRequest).mockImplementation(() => {
      throw new MissingWebhookSecretError("not configured");
    });

    const response = await POST(webhookRequest('{"type":"email.received"}'));

    expect(response.status).toBe(500);
    expect(processResendInboundEmail).not.toHaveBeenCalled();
  });

  it("passes the exact raw request body text to verification, never a re-parsed version", async () => {
    const raw = '{"type":"email.received","data":{"to":["x"]}}';
    vi.mocked(verifyResendWebhookRequest).mockReturnValue({ type: "email.received", data: { to: ["x"], attachments: [] } } as never);
    vi.mocked(processResendInboundEmail).mockResolvedValue({ status: "rejected", reason: "no match", companyId: null });

    await POST(webhookRequest(raw));

    expect(verifyResendWebhookRequest).toHaveBeenCalledWith(raw, { svixId: "msg_1", svixTimestamp: "1730000000", svixSignature: "v1,abc" });
  });
});

describe("POST /api/webhooks/resend/bank-statements — event handling", () => {
  it("acknowledges (200) and ignores any event type other than email.received", async () => {
    vi.mocked(verifyResendWebhookRequest).mockReturnValue({ type: "email.delivered", data: {} } as never);

    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(processResendInboundEmail).not.toHaveBeenCalled();
  });

  it("uses the svix-id header as the idempotency key passed to the service", async () => {
    vi.mocked(verifyResendWebhookRequest).mockReturnValue({ type: "email.received", data: { to: ["x"], attachments: [] } } as never);
    vi.mocked(processResendInboundEmail).mockResolvedValue({ status: "processed", reason: "ok", companyId: "company-a" });

    await POST(webhookRequest("{}", { "svix-id": "unique-delivery-id" }));

    expect(processResendInboundEmail).toHaveBeenCalledWith(expect.anything(), "unique-delivery-id");
  });

  it("returns 200 for a processed outcome", async () => {
    vi.mocked(verifyResendWebhookRequest).mockReturnValue({ type: "email.received", data: { to: ["x"], attachments: [] } } as never);
    vi.mocked(processResendInboundEmail).mockResolvedValue({ status: "processed", reason: "ok", companyId: "company-a" });

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(200);
  });

  it("returns 200 for a permanently-rejected outcome (do not create endless retries for a permanent failure)", async () => {
    vi.mocked(verifyResendWebhookRequest).mockReturnValue({ type: "email.received", data: { to: ["x"], attachments: [] } } as never);
    vi.mocked(processResendInboundEmail).mockResolvedValue({ status: "rejected", reason: "unknown recipient", companyId: null });

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(200);
  });

  it("returns 200 for an already-processed (duplicate) outcome", async () => {
    vi.mocked(verifyResendWebhookRequest).mockReturnValue({ type: "email.received", data: { to: ["x"], attachments: [] } } as never);
    vi.mocked(processResendInboundEmail).mockResolvedValue({ status: "already-processed", reason: "dup", companyId: "company-a" });

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBe(200);
  });

  it("returns a non-2xx (retryable) status for a transient failure, so Resend retries", async () => {
    vi.mocked(verifyResendWebhookRequest).mockReturnValue({ type: "email.received", data: { to: ["x"], attachments: [] } } as never);
    vi.mocked(processResendInboundEmail).mockResolvedValue({ status: "failed", reason: "transient DB error", companyId: "company-a" });

    const response = await POST(webhookRequest("{}"));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.status).toBeLessThan(600);
  });
});
