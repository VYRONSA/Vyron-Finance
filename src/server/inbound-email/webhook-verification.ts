import type { WebhookEventPayload } from "resend";
import { getResendClient } from "./resend-client";

/**
 * Phase 21C — webhook signature verification. Uses ONLY the official
 * `resend` SDK's `webhooks.verify()` (Svix format under the hood) —
 * never a homemade HMAC check. The raw request body text is required
 * as input (never a re-serialized/parsed-then-stringified version —
 * Svix verification is sensitive to exact byte content), which is why
 * the API route reads the body with `request.text()` before anything
 * else touches it.
 */

export class MissingWebhookSecretError extends Error {}
export class InvalidWebhookSignatureError extends Error {}

export type SvixHeaders = {
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
};

/** Verifies the request and returns the trusted, parsed event payload.
 * Throws `MissingWebhookSecretError`/`InvalidWebhookSignatureError`
 * rather than returning a falsy value — a caller can never accidentally
 * fall through to treating an unverified payload as trusted. Error
 * messages are deliberately generic — never echoing the secret, the raw
 * signature, or the payload back into the thrown error. */
export function verifyResendWebhookRequest(rawBody: string, headers: SvixHeaders): WebhookEventPayload {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new MissingWebhookSecretError("RESEND_WEBHOOK_SECRET is not configured.");
  }
  if (!headers.svixId || !headers.svixTimestamp || !headers.svixSignature) {
    throw new InvalidWebhookSignatureError("Missing required webhook signature headers.");
  }

  const resend = getResendClient();
  try {
    return resend.webhooks.verify({
      payload: rawBody,
      headers: { id: headers.svixId, timestamp: headers.svixTimestamp, signature: headers.svixSignature },
      webhookSecret,
    });
  } catch {
    throw new InvalidWebhookSignatureError("Webhook signature verification failed.");
  }
}
