import { describe, expect, it, vi, beforeEach } from "vitest";
import { fetchAttachmentMetadata, downloadAttachmentBytes, AttachmentFetchError } from "./attachment-fetcher";
import type { Resend } from "resend";

function fakeResend(getImpl: (...args: unknown[]) => unknown): Resend {
  return { emails: { receiving: { attachments: { get: getImpl } } } } as unknown as Resend;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("fetchAttachmentMetadata", () => {
  it("returns mapped metadata on success", async () => {
    const resend = fakeResend(async () => ({
      data: {
        id: "att_1",
        filename: "statement.pdf",
        size: 2048,
        content_type: "application/pdf",
        content_disposition: "attachment",
        download_url: "https://inbound-cdn.resend.com/signed-url",
        expires_at: "2026-08-01T00:10:00.000Z",
      },
      error: null,
    }));

    const result = await fetchAttachmentMetadata(resend, "email_1", "att_1");

    expect(result).toEqual({
      attachmentId: "att_1",
      filename: "statement.pdf",
      sizeBytes: 2048,
      contentType: "application/pdf",
      contentDisposition: "attachment",
      downloadUrl: "https://inbound-cdn.resend.com/signed-url",
    });
  });

  it("calls the SDK with the exact emailId and attachment id", async () => {
    const getSpy = vi.fn(async () => ({ data: { id: "att_1", size: 1, content_type: "text/csv", content_disposition: "attachment" as const, download_url: "https://x", expires_at: "" }, error: null }));
    const resend = fakeResend(getSpy);

    await fetchAttachmentMetadata(resend, "email_42", "att_99");

    expect(getSpy).toHaveBeenCalledWith({ emailId: "email_42", id: "att_99" });
  });

  it("throws AttachmentFetchError when Resend returns an error (attachment download failure is retryable)", async () => {
    const resend = fakeResend(async () => ({ data: null, error: { message: "not found" } }));
    await expect(fetchAttachmentMetadata(resend, "email_1", "att_1")).rejects.toBeInstanceOf(AttachmentFetchError);
  });

  it("throws AttachmentFetchError when no data is returned at all", async () => {
    const resend = fakeResend(async () => ({ data: null, error: null }));
    await expect(fetchAttachmentMetadata(resend, "email_1", "att_1")).rejects.toBeInstanceOf(AttachmentFetchError);
  });
});

describe("downloadAttachmentBytes", () => {
  it("downloads and returns the bytes on success", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes }));

    const result = await downloadAttachmentBytes("https://inbound-cdn.resend.com/signed-url");

    expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("throws AttachmentFetchError on a non-ok response (attachment download failure is retryable)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(downloadAttachmentBytes("https://inbound-cdn.resend.com/expired")).rejects.toBeInstanceOf(AttachmentFetchError);
  });

  it("never logs the signed download URL", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));

    await downloadAttachmentBytes("https://inbound-cdn.resend.com/super-secret-signed-url");

    const allLoggedText = [...consoleSpy.mock.calls, ...consoleErrorSpy.mock.calls].flat().join(" ");
    expect(allLoggedText).not.toContain("super-secret-signed-url");
  });
});
