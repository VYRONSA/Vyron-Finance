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
 */

export type EmailSendResult = { delivered: boolean; providerMessageId?: string; failureReason?: string };

export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<EmailSendResult>;
}

/** The only Email sender wired in today. Honest by construction — it
 * cannot report `delivered: true`, because nothing was actually sent. */
export class NoOpEmailSender implements EmailSender {
  async send(): Promise<EmailSendResult> {
    return { delivered: false, failureReason: "No email provider is configured for this deployment." };
  }
}

export const defaultEmailSender: EmailSender = new NoOpEmailSender();
