import type { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { InboundEmailMessage, NormalizedInboundAttachment } from "./types";

/**
 * Phase 21K — Virtualmin/IMAP transport adapter. Mirrors the exact role
 * `resend-adapter.ts` plays for Resend: this file ONLY translates a
 * provider-specific representation (here, raw RFC822 bytes fetched over
 * IMAP) into the provider-neutral `InboundEmailMessage` shape. No
 * recipient resolution, no idempotency, no attachment-security
 * filtering, no pipeline dispatch lives here — all of that stays in
 * `inbound-bank-statement-email-service.ts`, unchanged, operating on
 * whatever `InboundEmailMessage` this file hands it.
 *
 * Connections are always short-lived: connect -> lock mailbox -> search
 * -> fetch -> disconnect, once per poll invocation. Nothing here uses
 * IMAP IDLE or holds a connection open between invocations — this app
 * runs on serverless infrastructure with no persistent process to keep
 * a long-lived socket alive.
 */

export class ImapCandidateFetchError extends Error {}

/** Rejects (never even attempts to fetch the full body of) a message
 * whose total RFC822 size already exceeds this — a defensive,
 * IMAP-transport-specific gate, distinct from (not a duplicate of) the
 * EXISTING per-attachment `MAX_ATTACHMENT_SIZE_BYTES` check in
 * `inbound-bank-statement-email-service.ts`. Resend's own two-step
 * Receiving API inherently avoids ever downloading an oversized
 * attachment's bytes; a raw IMAP FETCH has no equivalent built-in
 * protection, so this exists specifically to avoid pulling an absurdly
 * large message fully into function memory before the existing,
 * attachment-level size logic ever gets a chance to run. Deliberately
 * generous relative to the 25MB attachment ceiling, to account for
 * MIME/base64 overhead (~37% larger than raw binary) and multiple small
 * attachments in one message — this is a coarse safety backstop against
 * a genuinely oversized/abusive message, not a tight limit. */
export const MAX_RAW_MESSAGE_SIZE_BYTES = 40 * 1024 * 1024;

export type ImapCandidateSummary = {
  uid: number;
  size: number;
};

/** Opens `mailboxPath` and returns its current `UIDVALIDITY` plus up to
 * `maxMessages` candidate messages (oldest UID first — FIFO fairness),
 * with only cheap metadata (uid, size) fetched — never the full body at
 * this stage. A message that was already successfully processed or
 * permanently rejected on an earlier poll has, by design, already been
 * moved out of `mailboxPath` (see the orchestrator's mailbox-state
 * handling) — so it never reappears as a candidate here; nothing in
 * this function needs to know about already-processed messages itself.
 * `maxMessages` bounds this call's own work — the serverless batch-cap
 * boundary (`MAX_MESSAGES_PER_POLL` in the orchestrator) is enforced at
 * this earliest possible point, not downstream, so a large backlog never
 * causes this single invocation to even list more than it's willing to
 * actually process. */
export async function listCandidateMessages(
  client: ImapFlow,
  mailboxPath: string,
  maxMessages: number,
): Promise<{ uidValidity: bigint; candidates: ImapCandidateSummary[] }> {
  const lock = await client.getMailboxLock(mailboxPath);
  try {
    const mailbox = client.mailbox;
    if (!mailbox) throw new ImapCandidateFetchError(`Could not open mailbox "${mailboxPath}".`);
    const uidValidity = mailbox.uidValidity;

    const allUids = await client.search({ all: true }, { uid: true });
    if (!allUids || allUids.length === 0) return { uidValidity, candidates: [] };

    const candidateUids = [...allUids].sort((a, b) => a - b).slice(0, maxMessages);
    if (candidateUids.length === 0) return { uidValidity, candidates: [] };

    const sizeByUid = new Map<number, number>();
    for await (const message of client.fetch(candidateUids, { uid: true, size: true }, { uid: true })) {
      sizeByUid.set(message.uid, message.size ?? 0);
    }

    const candidates = candidateUids.map((uid) => ({ uid, size: sizeByUid.get(uid) ?? 0 }));
    return { uidValidity, candidates };
  } finally {
    lock.release();
  }
}

/** Fetches ONE message's raw RFC822 source and IMAP-reported internal
 * (arrival) date. Only ever called for a candidate already confirmed to
 * be within `MAX_RAW_MESSAGE_SIZE_BYTES` — the orchestrator checks
 * `ImapCandidateSummary.size` before calling this, mirroring exactly how
 * the Resend path checks `metadata.sizeBytes` before ever calling
 * `getBytes()`. */
export async function fetchMessageSource(client: ImapFlow, mailboxPath: string, uid: number): Promise<{ internalDate: Date | null; source: Buffer }> {
  const lock = await client.getMailboxLock(mailboxPath);
  try {
    const message = await client.fetchOne(String(uid), { uid: true, internalDate: true, source: true }, { uid: true });
    if (!message || !message.source) throw new ImapCandidateFetchError(`Could not fetch message UID ${uid} — it may have been removed by another process.`);
    const internalDate = message.internalDate instanceof Date ? message.internalDate : message.internalDate ? new Date(message.internalDate) : null;
    return { internalDate, source: message.source };
  } finally {
    lock.release();
  }
}

/** Moves a message to `destinationMailbox` (e.g. "Processed"/"Failed") —
 * only ever called by the orchestrator AFTER it has recorded the real
 * processing outcome in the application-level idempotency record. Never
 * called merely because a message was fetched (see this module's own
 * docstring and the orchestrator's mailbox-state handling). */
export async function moveMessage(client: ImapFlow, mailboxPath: string, uid: number, destinationMailbox: string): Promise<void> {
  const lock = await client.getMailboxLock(mailboxPath);
  try {
    await client.messageMove(String(uid), destinationMailbox, { uid: true });
  } finally {
    lock.release();
  }
}

/** A `Buffer`'s own `.buffer` is typed `ArrayBuffer | SharedArrayBuffer`
 * (Node's pooled-allocation typings) — copying into a fresh `Uint8Array`
 * guarantees a genuine, non-shared `ArrayBuffer`, matching
 * `NormalizedInboundAttachment.getBytes()`'s declared return type. */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

/** Best-effort flattening of mailparser's `AddressObject | AddressObject[]
 * | undefined` shape into a plain `string[]` of addresses — mirrors what
 * `resend-adapter.ts` gets for free from Resend's already-flat `to`/`cc`
 * arrays. Group addresses (RFC 2822 group syntax) are rare in real bank/
 * customer mail; their member addresses are still included via `.group`
 * for correctness, not skipped. */
function flattenAddresses(value: import("mailparser").AddressObject | import("mailparser").AddressObject[] | undefined): string[] {
  if (!value) return [];
  const objects = Array.isArray(value) ? value : [value];
  const addresses: string[] = [];
  for (const obj of objects) {
    for (const entry of obj.value) {
      if (entry.address) addresses.push(entry.address);
      if (entry.group) for (const grouped of entry.group) if (grouped.address) addresses.push(grouped.address);
    }
  }
  return addresses;
}

function isAddressObject(value: unknown): value is import("mailparser").AddressObject {
  return typeof value === "object" && value !== null && "value" in value && "text" in value;
}

/** Best-effort conversion of mailparser's `Headers` map (values can be
 * strings, string arrays, address objects, dates, or structured header
 * objects) into the plain `Record<string, string>` shape
 * `InboundEmailMessage.headers` expects. mailparser resolves several
 * headers it recognizes as address-shaped — NOT just `To`/`Cc`/`From`,
 * but also `Delivered-To`/`Return-Path` (confirmed directly: a raw
 * `Delivered-To:` header comes back as an `AddressObject`, not a plain
 * string) — into structured objects rather than leaving them as text;
 * `X-Original-To` is not on mailparser's recognized list and stays a
 * plain string. Both shapes are handled here, extracting the bare
 * address (`.value[0].address`, never the display-name-formatted
 * `.text`, since `extractStableIdentifierFromRecipient` expects a bare
 * address) for the address-object case. A genuinely unrecognized
 * structured value (e.g. `date`) is intentionally left out rather than
 * force-coerced — nothing downstream reads any header this would have
 * dropped. */
function normalizeHeaders(headers: import("mailparser").Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers) {
    if (typeof value === "string") {
      result[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      result[key] = (value as string[])[0] ?? "";
    } else if (isAddressObject(value)) {
      const address = value.value[0]?.address;
      if (address) result[key] = address;
    } else if (Array.isArray(value) && value.length > 0 && isAddressObject(value[0])) {
      const address = (value[0] as import("mailparser").AddressObject).value[0]?.address;
      if (address) result[key] = address;
    }
  }
  return result;
}

/** Translates one fetched IMAP candidate into the provider-neutral
 * `InboundEmailMessage` — the IMAP-side equivalent of
 * `resend-adapter.ts::resendEventToInboundEmailMessage`. `rawMessage` is
 * deliberately left unset: unlike Resend (which never supplies raw MIME
 * at all), the full source is already held in memory as `source` for
 * this call — copying it a second time into a string field nothing
 * downstream reads would double this function's memory footprint for no
 * benefit (and Part 16 of this phase explicitly forbids ever logging raw
 * MIME content, which is the only thing that field exists for). */
export async function parseImapMessageToInboundEmailMessage(
  uidValidity: bigint,
  uid: number,
  internalDate: Date | null,
  source: Buffer,
): Promise<InboundEmailMessage> {
  const parsed = await simpleParser(source);

  const attachments: NormalizedInboundAttachment[] = parsed.attachments.map((attachment) => ({
    filename: attachment.filename ?? "",
    contentType: attachment.contentType,
    contentDisposition: attachment.contentDisposition === "attachment" ? "attachment" : "inline",
    async getMetadata() {
      return { sizeBytes: attachment.size, filename: attachment.filename ?? "" };
    },
    async getBytes() {
      return toArrayBuffer(attachment.content);
    },
  }));

  const fromAddress = flattenAddresses(parsed.from)[0] ?? "";
  const receivedAt = (internalDate ?? parsed.date ?? new Date(0)).toISOString();

  return {
    provider: "imap",
    providerEventId: `${uidValidity}:${uid}`,
    messageId: parsed.messageId ?? null,
    from: fromAddress,
    to: flattenAddresses(parsed.to),
    cc: flattenAddresses(parsed.cc),
    subject: parsed.subject ?? null,
    receivedAt,
    headers: normalizeHeaders(parsed.headers),
    attachments,
  };
}
