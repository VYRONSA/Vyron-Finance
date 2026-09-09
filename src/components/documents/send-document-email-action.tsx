"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmActionRow } from "@/components/ui/confirm-action";

/**
 * Phase 24B — the "Send Email" action inside a Document Preview
 * (Invoice or Customer Statement). Deliberately its own small component
 * rather than reusing `SendCommunicationButton` (the existing generic
 * Communications trigger already used elsewhere in this app) — that
 * component's inline-expand form is built for picking a template/typing
 * a message/manually choosing attachments from a document list, none of
 * which apply here: this action always sends the SAME freshly-generated
 * PDF automatically, and this ticket specifically wants a plain
 * Recipient/Document/Attachment/Company confirmation before an external
 * send, not a compose form. Both ultimately queue through the exact same
 * `queueCommunication`/`EmailSender`/`CommunicationRecord` infrastructure
 * — this is a second, purpose-built ENTRY POINT into that same system,
 * not a parallel one.
 */
export function SendDocumentEmailAction({
  sendUrl,
  recipientEmail,
  documentLabel,
  attachmentFilename,
  companyName,
  previewMode,
}: {
  sendUrl: string;
  recipientEmail: string | null;
  documentLabel: string;
  attachmentFilename: string;
  companyName: string;
  previewMode: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disabledTitle = previewMode
    ? "Available once a production Supabase project is connected"
    : !recipientEmail
      ? "This customer has no email address on file — add one under Customer Contacts."
      : undefined;

  async function send() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(sendUrl, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      // Matches this app's EXISTING Communications send convention
      // exactly (`SendCommunicationButton`'s own success message) — an
      // honest "Queued", never "sent", since the Email channel always
      // queues for the scheduler to actually attempt delivery, never
      // sends synchronously within this request.
      setNotice(`Queued — status: ${body.communication.status}`);
      setConfirming(false);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setSending(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="subtle" size="sm" disabled={Boolean(disabledTitle)} title={disabledTitle} onClick={() => setConfirming(true)}>
          Send Email
        </Button>
        {notice && <span className="text-sm text-[#1f6e4b]">{notice}</span>}
      </div>
    );
  }

  return (
    <ConfirmActionRow
      layout="panel"
      tone="primary"
      loading={sending}
      error={error}
      confirmLabel="Send"
      confirmingLabel="Sending…"
      onConfirm={send}
      onCancel={() => {
        setConfirming(false);
        setError(null);
      }}
      message="Send this document by email?"
      itemsPreview={
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-vf-ink-soft">
          <dt className="font-medium text-vf-ink-faint">Recipient</dt>
          <dd>{recipientEmail ?? "No email on file"}</dd>
          <dt className="font-medium text-vf-ink-faint">Document</dt>
          <dd>{documentLabel}</dd>
          <dt className="font-medium text-vf-ink-faint">Attachment</dt>
          <dd>{attachmentFilename}</dd>
          <dt className="font-medium text-vf-ink-faint">From</dt>
          <dd>{companyName}</dd>
        </dl>
      }
    />
  );
}
