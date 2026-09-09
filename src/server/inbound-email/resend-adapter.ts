/**
 * Phase 21F — converts an already-verified Resend `email.received` event
 * into the provider-neutral `InboundEmailMessage` the inbound service
 * consumes. This is a pure representation translation: no business logic
 * (recipient resolution, attachment filtering, idempotency) lives here —
 * that all stays in `inbound-bank-statement-email-service.ts`, unchanged,
 * now operating on the common shape instead of a Resend-specific one.
 *
 * Reuses Resend's existing two-step Receiving/Attachments API exactly as
 * Phase 21C built it (`resend-client.ts`/`attachment-fetcher.ts`) — never
 * rewritten here. Each attachment's metadata fetch is memoized so calling
 * both `getMetadata()` and `getBytes()` on the same attachment costs
 * exactly one Resend API call for metadata, matching the original
 * behavior; attachments the service never touches (filtered out by
 * disposition/extension) never trigger a Resend API call at all.
 */

import type { EmailReceivedEvent } from "resend";
import { getResendClient } from "./resend-client";
import { fetchAttachmentMetadata, downloadAttachmentBytes, type FetchedAttachmentMetadata } from "./attachment-fetcher";
import type { InboundEmailMessage, NormalizedInboundAttachment } from "./types";

type ReceivedEmailAttachment = EmailReceivedEvent["data"]["attachments"][number];

function toNormalizedAttachment(emailId: string, attachment: ReceivedEmailAttachment): NormalizedInboundAttachment {
  let cachedMetadata: Promise<FetchedAttachmentMetadata> | null = null;
  function ensureMetadata(): Promise<FetchedAttachmentMetadata> {
    if (!cachedMetadata) {
      cachedMetadata = fetchAttachmentMetadata(getResendClient(), emailId, attachment.id);
    }
    return cachedMetadata;
  }

  return {
    filename: attachment.filename ?? "",
    contentType: attachment.content_type,
    // Resend's webhook payload types `content_disposition` as
    // `string | null` (unlike the narrower Attachments API response) —
    // anything other than the literal "attachment" is treated as
    // non-attachment content, matching the exact-equality filter this
    // codebase's service layer already applies.
    contentDisposition: attachment.content_disposition === "attachment" ? "attachment" : "inline",
    async getMetadata() {
      const metadata = await ensureMetadata();
      return { sizeBytes: metadata.sizeBytes, filename: metadata.filename ?? attachment.filename ?? "" };
    },
    async getBytes() {
      const metadata = await ensureMetadata();
      return downloadAttachmentBytes(metadata.downloadUrl);
    },
  };
}

/** `providerEventId` is passed in rather than derived from the event
 * itself — it is the webhook delivery's `svix-id` header, which is not
 * part of the Resend event payload (see the webhook route). */
export function resendEventToInboundEmailMessage(event: EmailReceivedEvent, providerEventId: string): InboundEmailMessage {
  const { data } = event;
  return {
    provider: "resend",
    providerEventId,
    messageId: data.message_id ?? null,
    from: data.from,
    to: data.to,
    cc: data.cc ?? [],
    subject: data.subject ?? null,
    receivedAt: data.created_at,
    attachments: data.attachments.map((attachment) => toNormalizedAttachment(data.email_id, attachment)),
  };
}
