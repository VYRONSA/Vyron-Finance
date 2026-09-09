/**
 * Phase 21F — proves `resendEventToInboundEmailMessage` faithfully
 * converts an already-verified Resend event into the provider-neutral
 * `InboundEmailMessage`, and that the normalized attachments' lazy
 * `getMetadata`/`getBytes` reuse Resend's existing two-step API exactly
 * (one metadata call per attachment actually touched, never eagerly for
 * attachments the service never looks at).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./resend-client", () => ({ getResendClient: vi.fn() }));
vi.mock("./attachment-fetcher", () => ({
  fetchAttachmentMetadata: vi.fn(),
  downloadAttachmentBytes: vi.fn(),
}));

import { resendEventToInboundEmailMessage } from "./resend-adapter";
import { getResendClient } from "./resend-client";
import { fetchAttachmentMetadata, downloadAttachmentBytes } from "./attachment-fetcher";
import type { EmailReceivedEvent } from "resend";

type ReceivedEmailAttachment = EmailReceivedEvent["data"]["attachments"][number];

function attachment(overrides: Partial<ReceivedEmailAttachment> = {}): ReceivedEmailAttachment {
  return { id: "att_1", filename: "statement.pdf", content_type: "application/pdf", content_disposition: "attachment", content_id: null, ...overrides };
}

function event(overrides: Partial<EmailReceivedEvent["data"]> = {}): EmailReceivedEvent {
  return {
    type: "email.received",
    created_at: "2026-08-01T10:00:00.000Z",
    data: {
      email_id: "email_1",
      created_at: "2026-08-01T10:00:00.000Z",
      from: "statements@thebank.co.za",
      to: ["northwood-a7k3.bank@banking.vyronsoft.co.za"],
      bcc: [],
      cc: [],
      received_for: [],
      message_id: "<abc@thebank.co.za>",
      subject: "Your monthly statement",
      attachments: [attachment()],
      ...overrides,
    },
  };
}

const FAKE_RESEND = { __label: "fake-resend-client" } as never;

beforeEach(() => {
  vi.mocked(getResendClient).mockReset().mockReturnValue(FAKE_RESEND);
  vi.mocked(fetchAttachmentMetadata).mockReset();
  vi.mocked(downloadAttachmentBytes).mockReset();
});

describe("resendEventToInboundEmailMessage — field preservation", () => {
  it("converts a Resend event into a common InboundEmailMessage", () => {
    const message = resendEventToInboundEmailMessage(event(), "svix_1");
    expect(message.provider).toBe("resend");
    expect(message.providerEventId).toBe("svix_1");
  });

  it("preserves from", () => {
    const message = resendEventToInboundEmailMessage(event({ from: "statements@examplebank.co.za" }), "svix_1");
    expect(message.from).toBe("statements@examplebank.co.za");
  });

  it("preserves to", () => {
    const message = resendEventToInboundEmailMessage(event({ to: ["northwood-a7k3.bank@banking.vyronsoft.co.za", "cc-recipient@elsewhere.com"] }), "svix_1");
    expect(message.to).toEqual(["northwood-a7k3.bank@banking.vyronsoft.co.za", "cc-recipient@elsewhere.com"]);
  });

  it("preserves subject", () => {
    const message = resendEventToInboundEmailMessage(event({ subject: "August statement" }), "svix_1");
    expect(message.subject).toBe("August statement");
  });

  it("preserves the Message-ID", () => {
    const message = resendEventToInboundEmailMessage(event({ message_id: "<real-message-id@thebank.co.za>" }), "svix_1");
    expect(message.messageId).toBe("<real-message-id@thebank.co.za>");
  });

  it("preserves the received timestamp", () => {
    const message = resendEventToInboundEmailMessage(event({ created_at: "2026-03-14T09:30:00.000Z" }), "svix_1");
    expect(message.receivedAt).toBe("2026-03-14T09:30:00.000Z");
  });

  it("preserves cc when present", () => {
    const message = resendEventToInboundEmailMessage(event({ cc: ["accountant@northwood.co.za"] }), "svix_1");
    expect(message.cc).toEqual(["accountant@northwood.co.za"]);
  });

  it("never fabricates a raw message or headers Resend doesn't provide", () => {
    const message = resendEventToInboundEmailMessage(event(), "svix_1");
    expect(message.rawMessage).toBeUndefined();
    expect(message.headers).toBeUndefined();
  });
});

describe("resendEventToInboundEmailMessage — attachment normalization", () => {
  it("normalizes a single attachment's eagerly-known fields without any Resend API call", () => {
    const message = resendEventToInboundEmailMessage(event({ attachments: [attachment({ filename: "statement.pdf", content_type: "application/pdf", content_disposition: "attachment" })] }), "svix_1");

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({ filename: "statement.pdf", contentType: "application/pdf", contentDisposition: "attachment" });
    expect(fetchAttachmentMetadata).not.toHaveBeenCalled();
  });

  it("normalizes multiple attachments independently", () => {
    const message = resendEventToInboundEmailMessage(
      event({ attachments: [attachment({ id: "att_1", filename: "statement.pdf" }), attachment({ id: "att_2", filename: "logo.png", content_type: "image/png", content_disposition: "inline" })] }),
      "svix_1",
    );

    expect(message.attachments).toHaveLength(2);
    expect(message.attachments[0]).toMatchObject({ filename: "statement.pdf", contentDisposition: "attachment" });
    expect(message.attachments[1]).toMatchObject({ filename: "logo.png", contentDisposition: "inline" });
  });

  it("getMetadata() fetches metadata via the existing two-step Resend API, using the correct emailId/attachmentId", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue({ attachmentId: "att_1", filename: "statement.pdf", sizeBytes: 4096, contentType: "application/pdf", contentDisposition: "attachment", downloadUrl: "https://signed" });
    const message = resendEventToInboundEmailMessage(event({ email_id: "email_42", attachments: [attachment({ id: "att_99" })] }), "svix_1");

    const metadata = await message.attachments[0]!.getMetadata();

    expect(metadata).toEqual({ sizeBytes: 4096, filename: "statement.pdf" });
    expect(fetchAttachmentMetadata).toHaveBeenCalledWith(FAKE_RESEND, "email_42", "att_99");
  });

  it("getBytes() downloads via the memoized metadata's signed URL", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue({ attachmentId: "att_1", filename: "statement.pdf", sizeBytes: 4096, contentType: "application/pdf", contentDisposition: "attachment", downloadUrl: "https://signed-download-url" });
    vi.mocked(downloadAttachmentBytes).mockResolvedValue(new ArrayBuffer(8));
    const message = resendEventToInboundEmailMessage(event(), "svix_1");

    await message.attachments[0]!.getBytes();

    expect(downloadAttachmentBytes).toHaveBeenCalledWith("https://signed-download-url");
  });

  it("calling getMetadata() then getBytes() triggers exactly one Resend metadata fetch, not two", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue({ attachmentId: "att_1", filename: "statement.pdf", sizeBytes: 4096, contentType: "application/pdf", contentDisposition: "attachment", downloadUrl: "https://signed" });
    vi.mocked(downloadAttachmentBytes).mockResolvedValue(new ArrayBuffer(8));
    const message = resendEventToInboundEmailMessage(event(), "svix_1");

    await message.attachments[0]!.getMetadata();
    await message.attachments[0]!.getBytes();

    expect(fetchAttachmentMetadata).toHaveBeenCalledTimes(1);
  });

  it("an attachment whose metadata/bytes are never requested never triggers a Resend API call", () => {
    resendEventToInboundEmailMessage(event({ attachments: [attachment({ filename: "logo.png", content_disposition: "inline" })] }), "svix_1");

    expect(fetchAttachmentMetadata).not.toHaveBeenCalled();
    expect(downloadAttachmentBytes).not.toHaveBeenCalled();
  });

  it("falls back to the webhook payload's own filename when Resend's metadata omits one", async () => {
    vi.mocked(fetchAttachmentMetadata).mockResolvedValue({ attachmentId: "att_1", filename: null, sizeBytes: 100, contentType: "application/pdf", contentDisposition: "attachment", downloadUrl: "https://signed" });
    const message = resendEventToInboundEmailMessage(event({ attachments: [attachment({ filename: "original-name.pdf" })] }), "svix_1");

    const metadata = await message.attachments[0]!.getMetadata();

    expect(metadata.filename).toBe("original-name.pdf");
  });
});
