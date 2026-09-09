/**
 * Email EXTENSION POINT — a real, pluggable interface, not a fabricated
 * "delivered" claim. No email provider is installed anywhere in this
 * codebase (no `resend`/`sendgrid`/`nodemailer`/SMTP env var exists) —
 * the default implementation honestly fails every send with a stated
 * reason, matching this platform's established "no fabrication" posture
 * (the same shape as the Document Platform's `NoOpVirusScanner`). A real
 * provider implements `EmailSender` and is wired in at
 * `communication-service.ts`'s one injection point; nothing else in the
 * Communication Platform needs to change when that happens.
 *
 * Phase 24B — `send()` gained an OPTIONAL `attachments` parameter,
 * additive and backward-compatible with every existing caller (none of
 * which pass it). This was genuinely necessary, not speculative: before
 * this phase, `communication_attachments` only ever recorded WHICH
 * documents were meant to be attached (for audit/history display) —
 * `deliverAndFinalize`'s Email branch never actually read them or
 * forwarded any bytes to `EmailSender`, so no attachment could ever
 * really be delivered even once a real provider is wired in. See
 * `communication-service.ts::resolveEmailAttachments`.
 *
 * Phase 25J — `send()` gained two more OPTIONAL fields, `idempotencyKey`
 * and `messageId`, both computed server-side by `communication-service.ts`
 * from the communication's own stable id
 * (`@/server/communications/idempotency.ts`) and unchanged across every
 * retry/reclaim of that same row. Deliberately provider-neutral: no
 * Resend-specific field, no SMTP-specific field. A future real
 * `EmailSender` implementation MAY forward `idempotencyKey` to a
 * provider that supports one (e.g. as an `Idempotency-Key` header) and/or
 * set the outgoing message's `Message-ID` header to `messageId` — this
 * interface does not require either, since not every provider supports
 * idempotency, and SMTP itself has no universal idempotency mechanism.
 * `NoOpEmailSender` ignores both, same as it already ignores
 * `attachments`.
 */

export type EmailAttachment = { filename: string; contentType: string; content: Buffer };

export type EmailSendResult = { delivered: boolean; providerMessageId?: string; failureReason?: string };

export interface EmailSender {
  send(
    to: string,
    subject: string,
    body: string,
    options?: { attachments?: EmailAttachment[]; idempotencyKey?: string; messageId?: string },
  ): Promise<EmailSendResult>;
}

/** The only Email sender wired in today. Honest by construction — it
 * cannot report `delivered: true`, because nothing was actually sent. */
export class NoOpEmailSender implements EmailSender {
  async send(): Promise<EmailSendResult> {
    return { delivered: false, failureReason: "No email provider is configured for this deployment." };
  }
}

export const defaultEmailSender: EmailSender = new NoOpEmailSender();
