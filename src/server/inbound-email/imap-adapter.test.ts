/**
 * Phase 21K — tests for the Virtualmin/IMAP transport adapter. The
 * translation function (`parseImapMessageToInboundEmailMessage`) is
 * tested against REAL `mailparser` output over real, hand-built RFC822
 * message strings — no mocking of MIME parsing itself, so these tests
 * genuinely prove the translation is correct, not just that mocked
 * calls happened. The IMAP-mechanics functions
 * (`listCandidateMessages`/`fetchMessageSource`/`moveMessage`) are
 * tested against a fake object implementing only the `ImapFlow` surface
 * this file actually calls — no real network connection, matching this
 * codebase's established convention for external-service adapters
 * (e.g. `bank-sync-service.test.ts`'s `mockProvider`).
 */
import { describe, expect, it, vi } from "vitest";
import {
  listCandidateMessages,
  fetchMessageSource,
  moveMessage,
  parseImapMessageToInboundEmailMessage,
  MAX_RAW_MESSAGE_SIZE_BYTES,
  ImapCandidateFetchError,
} from "./imap-adapter";
import type { ImapFlow } from "imapflow";

function rawMessage(overrides: { headers?: string; body?: string } = {}): Buffer {
  const attachmentBytes = Buffer.from("dummy pdf bytes for testing").toString("base64");
  const headers =
    overrides.headers ??
    [
      "From: statements@thebank.co.za",
      "To: bankstatements@vyronsoft.co.za",
      "Subject: Your monthly statement",
      "Message-ID: <abc123@thebank.co.za>",
      "X-Original-To: acme-ltd-a7k3.bank@vyronsoft.co.za",
      "Delivered-To: bankstatements@vyronsoft.co.za",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="BOUNDARY"',
    ].join("\r\n");
  const body =
    overrides.body ??
    [
      "",
      "--BOUNDARY",
      "Content-Type: text/plain",
      "",
      "Please find attached your statement.",
      "",
      "--BOUNDARY",
      'Content-Type: application/pdf; name="statement.pdf"',
      'Content-Disposition: attachment; filename="statement.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      attachmentBytes,
      "",
      "--BOUNDARY--",
      "",
    ].join("\r\n");
  return Buffer.from(`${headers}\r\n${body}`);
}

describe("parseImapMessageToInboundEmailMessage — real MIME parsing", () => {
  it("builds the provider identity from uidValidity and uid, never from message content", async () => {
    const message = await parseImapMessageToInboundEmailMessage(BigInt(12345), 77, new Date("2026-08-01T10:00:00.000Z"), rawMessage());
    expect(message.provider).toBe("imap");
    expect(message.providerEventId).toBe("12345:77");
  });

  it("extracts the Message-ID header", async () => {
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage());
    expect(message.messageId).toBe("<abc123@thebank.co.za>");
  });

  it("returns null messageId when the header is genuinely absent — never fabricated", async () => {
    const headers = ["From: statements@thebank.co.za", "To: bankstatements@vyronsoft.co.za", "Subject: No Message-ID here"].join("\r\n");
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage({ headers, body: "\r\nHello." }));
    expect(message.messageId).toBeNull();
  });

  it("extracts from/to/subject", async () => {
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage());
    expect(message.from).toBe("statements@thebank.co.za");
    expect(message.to).toEqual(["bankstatements@vyronsoft.co.za"]);
    expect(message.subject).toBe("Your monthly statement");
  });

  it("extracts cc when present", async () => {
    const headers = [
      "From: statements@thebank.co.za",
      "To: bankstatements@vyronsoft.co.za",
      "Cc: accountant@acme-ltd.co.za",
      "Subject: Statement",
    ].join("\r\n");
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage({ headers, body: "\r\nHello." }));
    expect(message.cc).toEqual(["accountant@acme-ltd.co.za"]);
  });

  it("returns an empty cc array (never undefined) when Cc: is absent", async () => {
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage());
    expect(message.cc).toEqual([]);
  });

  it("uses the IMAP-reported internalDate for receivedAt (server-generated, more trustworthy than the sender's own Date: header)", async () => {
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date("2026-08-01T10:00:00.000Z"), rawMessage());
    expect(message.receivedAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("falls back to the message's own Date: header when internalDate is unavailable", async () => {
    const headers = ["From: statements@thebank.co.za", "To: bankstatements@vyronsoft.co.za", "Subject: S", "Date: Sat, 01 Aug 2026 09:00:00 +0000"].join("\r\n");
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, null, rawMessage({ headers, body: "\r\nHello." }));
    expect(message.receivedAt).toBe("2026-08-01T09:00:00.000Z");
  });

  it("normalizes X-Original-To and Delivered-To into the headers Record with lowercase keys", async () => {
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage());
    expect(message.headers?.["x-original-to"]).toBe("acme-ltd-a7k3.bank@vyronsoft.co.za");
    expect(message.headers?.["delivered-to"]).toBe("bankstatements@vyronsoft.co.za");
  });

  it("never populates rawMessage — the caller already holds the source buffer, and nothing downstream reads this field", async () => {
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage());
    expect(message.rawMessage).toBeUndefined();
  });

  it("normalizes the PDF attachment with the correct filename/contentType/contentDisposition", async () => {
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage());
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]!.filename).toBe("statement.pdf");
    expect(message.attachments[0]!.contentType).toBe("application/pdf");
    expect(message.attachments[0]!.contentDisposition).toBe("attachment");
  });

  it("the attachment's getMetadata()/getBytes() resolve the real parsed content", async () => {
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage());
    const metadata = await message.attachments[0]!.getMetadata();
    expect(metadata.filename).toBe("statement.pdf");
    expect(metadata.sizeBytes).toBeGreaterThan(0);
    const bytes = await message.attachments[0]!.getBytes();
    expect(new TextDecoder().decode(bytes)).toBe("dummy pdf bytes for testing");
  });

  it("returns an empty attachments array (never undefined, never fabricated) when the message has no attachment", async () => {
    const headers = ["From: statements@thebank.co.za", "To: bankstatements@vyronsoft.co.za", "Subject: No attachment"].join("\r\n");
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage({ headers, body: "\r\nJust text, no statement attached." }));
    expect(message.attachments).toEqual([]);
  });

  it("marks an inline image as inline, not attachment — never treated as a candidate bank statement", async () => {
    const headers = [
      "From: statements@thebank.co.za",
      "To: bankstatements@vyronsoft.co.za",
      "Subject: Statement",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="B2"',
    ].join("\r\n");
    const body = [
      "",
      "--B2",
      "Content-Type: image/png",
      'Content-Disposition: inline; filename="logo.png"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("fake png bytes").toString("base64"),
      "",
      "--B2--",
      "",
    ].join("\r\n");
    const message = await parseImapMessageToInboundEmailMessage(BigInt(1), 1, new Date(), rawMessage({ headers, body }));
    expect(message.attachments[0]!.contentDisposition).toBe("inline");
  });
});

function fakeFetchMessage(overrides: Partial<{ uid: number; size: number; internalDate: Date; source: Buffer }> = {}) {
  return { seq: 1, uid: overrides.uid ?? 1, size: overrides.size, internalDate: overrides.internalDate, source: overrides.source };
}

function fakeClient(overrides: Partial<ImapFlow> = {}): ImapFlow {
  return {
    mailbox: { path: "INBOX", uidValidity: BigInt(999) } as never,
    getMailboxLock: vi.fn().mockResolvedValue({ path: "INBOX", release: vi.fn() }),
    search: vi.fn(),
    fetch: vi.fn(),
    fetchOne: vi.fn(),
    messageMove: vi.fn(),
    ...overrides,
  } as unknown as ImapFlow;
}

describe("listCandidateMessages", () => {
  it("returns the mailbox's real uidValidity and up to maxMessages candidates, oldest UID first", async () => {
    const sizeByUid = new Map([
      [30, 100],
      [10, 200],
      [20, 300],
    ]);
    async function* fetchIterable() {
      for (const [uid, size] of sizeByUid) yield fakeFetchMessage({ uid, size });
    }
    const client = fakeClient({
      search: vi.fn().mockResolvedValue([30, 10, 20]),
      fetch: vi.fn().mockReturnValue(fetchIterable()),
    });

    const result = await listCandidateMessages(client, "INBOX", 10);

    expect(result.uidValidity).toBe(BigInt(999));
    expect(result.candidates.map((c) => c.uid)).toEqual([10, 20, 30]);
  });

  it("never lists more than maxMessages candidates — the serverless batch cap is enforced at the IMAP-fetch level", async () => {
    async function* fetchIterable() {
      for (let uid = 1; uid <= 5; uid++) yield fakeFetchMessage({ uid, size: 10 });
    }
    const client = fakeClient({
      search: vi.fn().mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      fetch: vi.fn().mockReturnValue(fetchIterable()),
    });

    const result = await listCandidateMessages(client, "INBOX", 5);

    expect(result.candidates).toHaveLength(5);
    expect(vi.mocked(client.fetch)).toHaveBeenCalledWith([1, 2, 3, 4, 5], expect.anything(), { uid: true });
  });

  it("returns an empty candidate list (never throws) for an empty mailbox", async () => {
    const client = fakeClient({ search: vi.fn().mockResolvedValue([]) });
    const result = await listCandidateMessages(client, "INBOX", 20);
    expect(result.candidates).toEqual([]);
  });

  it("always releases the mailbox lock, even when search throws", async () => {
    const release = vi.fn();
    const client = fakeClient({
      getMailboxLock: vi.fn().mockResolvedValue({ path: "INBOX", release }),
      search: vi.fn().mockRejectedValue(new Error("IMAP command failed")),
    });

    await expect(listCandidateMessages(client, "INBOX", 20)).rejects.toThrow("IMAP command failed");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("fetchMessageSource", () => {
  it("returns the real internalDate and raw source for the requested UID", async () => {
    const source = rawMessage();
    const client = fakeClient({ fetchOne: vi.fn().mockResolvedValue(fakeFetchMessage({ uid: 42, internalDate: new Date("2026-08-01T10:00:00.000Z"), source })) });

    const result = await fetchMessageSource(client, "INBOX", 42);

    expect(result.internalDate).toEqual(new Date("2026-08-01T10:00:00.000Z"));
    expect(result.source).toBe(source);
  });

  it("throws ImapCandidateFetchError (never silently returns empty) when the message can't be fetched — e.g. removed by a concurrent process", async () => {
    const client = fakeClient({ fetchOne: vi.fn().mockResolvedValue(false) });
    await expect(fetchMessageSource(client, "INBOX", 42)).rejects.toThrow(ImapCandidateFetchError);
  });

  it("always releases the mailbox lock even when the fetch fails", async () => {
    const release = vi.fn();
    const client = fakeClient({
      getMailboxLock: vi.fn().mockResolvedValue({ path: "INBOX", release }),
      fetchOne: vi.fn().mockRejectedValue(new Error("connection reset")),
    });
    await expect(fetchMessageSource(client, "INBOX", 42)).rejects.toThrow("connection reset");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("moveMessage", () => {
  it("calls messageMove with the UID and destination mailbox, scoped by uid:true", async () => {
    const client = fakeClient({ messageMove: vi.fn().mockResolvedValue({}) });
    await moveMessage(client, "INBOX", 42, "Processed");
    expect(client.messageMove).toHaveBeenCalledWith("42", "Processed", { uid: true });
  });

  it("always releases the mailbox lock even when the move fails", async () => {
    const release = vi.fn();
    const client = fakeClient({
      getMailboxLock: vi.fn().mockResolvedValue({ path: "INBOX", release }),
      messageMove: vi.fn().mockRejectedValue(new Error("destination mailbox does not exist")),
    });
    await expect(moveMessage(client, "INBOX", 42, "Processed")).rejects.toThrow("destination mailbox does not exist");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("MAX_RAW_MESSAGE_SIZE_BYTES", () => {
  it("is generously larger than the existing 25MB per-attachment ceiling, to account for MIME/base64 overhead", () => {
    expect(MAX_RAW_MESSAGE_SIZE_BYTES).toBeGreaterThan(25 * 1024 * 1024);
  });
});
