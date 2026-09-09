import { ImapFlow } from "imapflow";

/**
 * Phase 21K — the ONE place `BANK_STATEMENT_IMAP_*` env vars are read.
 * Fails honestly (never silently no-ops, never fabricates a working
 * connection) when the mailbox isn't configured — same posture as
 * `resend-client.ts::getResendClient()`/`NoOpEmailSender` elsewhere in
 * this codebase. Connections are always short-lived (connect → fetch →
 * disconnect, per invocation) — this app runs on serverless
 * infrastructure with no persistent process, so nothing here ever uses
 * IMAP IDLE or holds a connection open between invocations.
 */

export class ImapNotConfiguredError extends Error {}

export type ImapConnectionConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
  /** Destination mailbox a successfully-imported message is moved to —
   * never deleted (financial source documents stay recoverable). Not a
   * secret; a sensible non-secret default is used when unset. Must
   * exist on the real server before mailbox housekeeping can move
   * anything into it — the poller does not attempt to auto-create it
   * (see this phase's own "no production Virtualmin changes" boundary);
   * a move that fails because the folder doesn't exist yet simply
   * leaves the message in place, never treated as a processing error. */
  processedMailbox: string;
  /** Destination mailbox a permanently-rejected message is moved to.
   * Same non-auto-creation caveat as `processedMailbox` above. */
  failedMailbox: string;
};

export function isImapConfigured(): boolean {
  return Boolean(process.env.BANK_STATEMENT_IMAP_HOST && process.env.BANK_STATEMENT_IMAP_USERNAME && process.env.BANK_STATEMENT_IMAP_PASSWORD);
}

/** Throws `ImapNotConfiguredError` rather than returning a partially-filled
 * config — a caller can never accidentally attempt a connection with a
 * missing host/credential. `port`/`tls`/`mailbox` have safe, non-secret
 * defaults (993, TLS on, "INBOX") since only host/username/password are
 * genuinely required from the operator to identify a specific mailbox. */
export function getImapConnectionConfig(): ImapConnectionConfig {
  const host = process.env.BANK_STATEMENT_IMAP_HOST;
  const user = process.env.BANK_STATEMENT_IMAP_USERNAME;
  const pass = process.env.BANK_STATEMENT_IMAP_PASSWORD;
  if (!host || !user || !pass) {
    throw new ImapNotConfiguredError(
      "BANK_STATEMENT_IMAP_HOST / BANK_STATEMENT_IMAP_USERNAME / BANK_STATEMENT_IMAP_PASSWORD are not fully configured.",
    );
  }
  const port = process.env.BANK_STATEMENT_IMAP_PORT ? Number(process.env.BANK_STATEMENT_IMAP_PORT) : 993;
  // Secure (implicit TLS) by default — only an explicit "false" opts out,
  // so a missing/misconfigured value never silently downgrades to plaintext.
  const secure = process.env.BANK_STATEMENT_IMAP_TLS !== "false";
  const mailbox = process.env.BANK_STATEMENT_IMAP_MAILBOX || "INBOX";
  const processedMailbox = process.env.BANK_STATEMENT_IMAP_PROCESSED_MAILBOX || "Processed";
  const failedMailbox = process.env.BANK_STATEMENT_IMAP_FAILED_MAILBOX || "Failed";
  return { host, port, secure, user, pass, mailbox, processedMailbox, failedMailbox };
}

/** `logger: false` — imapflow's default logger would otherwise write
 * connection/command traces (which can include header content) to
 * stdout; explicitly disabled so nothing from this client ever reaches
 * application logs, matching this phase's "never log credentials, full
 * email body, or raw MIME" requirement. */
export function createImapClient(config: ImapConnectionConfig): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });
}
