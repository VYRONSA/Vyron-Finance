import { describe, expect, it } from "vitest";
import { NoOpEmailSender, defaultEmailSender, type EmailSender } from "./email-sender";

describe("NoOpEmailSender", () => {
  it("always honestly reports delivered: false, with a real reason, never a fabricated success", async () => {
    const sender: EmailSender = new NoOpEmailSender();
    const result = await sender.send("customer@example.com", "Subject", "Body");
    expect(result).toEqual({ delivered: false, failureReason: "No email provider is configured for this deployment." });
  });

  it("still honestly fails even when attachments are supplied (Phase 24B's new optional param)", async () => {
    const sender: EmailSender = new NoOpEmailSender();
    const result = await sender.send("customer@example.com", "Subject", "Body", {
      attachments: [{ filename: "invoice.pdf", contentType: "application/pdf", content: Buffer.from("%PDF") }],
    });
    expect(result.delivered).toBe(false);
  });

  it("defaultEmailSender is the NoOp instance", async () => {
    const result = await defaultEmailSender.send("a@b.com", "s", "b");
    expect(result.delivered).toBe(false);
  });
});
