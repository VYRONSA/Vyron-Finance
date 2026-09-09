"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { IconBell } from "@/components/ui/icons";
import type { CommunicationChannel, CommunicationRecipient } from "@/server/communications/types";
import type { DocumentEntityType, DocumentRecord } from "@/server/documents/types";

/**
 * The ONE reusable trigger every business object's "Send" action uses —
 * a Customer's Welcome Email, a Sales Invoice's "Email Invoice", an
 * Auditor Finding's ad-hoc query, all go through the same component
 * calling the same `POST /communications` endpoint. Never a per-module
 * send form. `templateCode` renders server-side via the Template Engine;
 * omitting it opens a free-text ad-hoc send (e.g. Auditor Workspace,
 * which has no fixed template for "Audit Query").
 */
export function SendCommunicationButton({
  companyId,
  module,
  businessObjectType,
  businessObjectId,
  channel = "Email",
  templateCode,
  recipients,
  variables = {},
  attachableEntityType,
  attachableEntityId,
  copilotDraftUrl,
  previewMode,
  buttonLabel = "Send",
}: {
  companyId: string;
  module: string;
  businessObjectType: string;
  businessObjectId: number;
  channel?: CommunicationChannel;
  templateCode?: string;
  recipients: CommunicationRecipient[];
  variables?: Record<string, unknown>;
  attachableEntityType?: DocumentEntityType;
  attachableEntityId?: number;
  /** When set, shows a "Draft with Copilot" action that POSTs here and
   * fills the message/body with the response's `draft` string — a real,
   * computed suggestion (see `communication-draft-engine.ts`), never
   * sent by Copilot itself. */
  copilotDraftUrl?: string;
  previewMode: boolean;
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [adHocSubject, setAdHocSubject] = useState("");
  const [adHocBody, setAdHocBody] = useState("");
  const [availableDocuments, setAvailableDocuments] = useState<DocumentRecord[]>([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<number[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function draftWithCopilot() {
    if (!copilotDraftUrl) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch(copilotDraftUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: templateCode === "WelcomeEmail" ? "welcome" : "reminder" }) });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Couldn't draft (${res.status})`);
        return;
      }
      if (templateCode) setMessage(data.draft);
      else setAdHocBody(data.draft);
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setDrafting(false);
    }
  }

  useEffect(() => {
    if (!open || previewMode || !attachableEntityType || !attachableEntityId) return;
    fetch(`/api/companies/${companyId}/documents?entityType=${attachableEntityType}&entityId=${attachableEntityId}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setAvailableDocuments(data.documents ?? []);
      });
  }, [open, previewMode, companyId, attachableEntityType, attachableEntityId]);

  async function send() {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/communications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          module,
          businessObjectType,
          businessObjectId,
          channel,
          recipients,
          templateCode,
          subject: templateCode ? undefined : adHocSubject,
          body: templateCode ? undefined : adHocBody,
          variables: templateCode ? { ...variables, message: message || undefined } : undefined,
          documentIds: selectedDocumentIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setNotice(`Queued — status: ${data.communication.status}`);
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setOpen(true)}>
        <IconBell className="h-3.5 w-3.5" /> {buttonLabel}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-vf-md border border-vf-paper-border p-3">
      <p className="text-xs text-vf-ink-faint">To: {recipients.map((r) => r.name).join(", ") || "—"}{recipients[0]?.address ? ` (${recipients[0].address})` : ""}</p>

      {templateCode ? (
        <Field label="Additional message (optional)" htmlFor="send-comm-message">
          <Input id="send-comm-message" value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
      ) : (
        <>
          <Field label="Subject" htmlFor="send-comm-subject">
            <Input id="send-comm-subject" value={adHocSubject} onChange={(e) => setAdHocSubject(e.target.value)} />
          </Field>
          <Field label="Message" htmlFor="send-comm-body">
            <textarea
              id="send-comm-body"
              value={adHocBody}
              onChange={(e) => setAdHocBody(e.target.value)}
              rows={4}
              className="w-full rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
            />
          </Field>
        </>
      )}

      {copilotDraftUrl && (
        <div>
          <Button variant="subtle" size="sm" disabled={previewMode || drafting} title={disabledTitle} onClick={draftWithCopilot}>
            {drafting ? "Drafting…" : "Draft with Copilot"}
          </Button>
          <p className="mt-1 text-[0.7rem] text-vf-ink-faint">A computed suggestion, not AI-generated — review before sending.</p>
        </div>
      )}

      {attachableEntityType && attachableEntityId && (
        <div>
          <p className="text-xs font-medium text-vf-ink">Attach documents</p>
          {availableDocuments.length === 0 ? (
            <p className="text-xs text-vf-ink-faint">No documents on file for this record.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-1">
              {availableDocuments.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-xs text-vf-ink-soft">
                  <input
                    type="checkbox"
                    id={`attach-${d.id}`}
                    checked={selectedDocumentIds.includes(d.id)}
                    onChange={(e) => setSelectedDocumentIds((prev) => (e.target.checked ? [...prev, d.id] : prev.filter((id) => id !== d.id)))}
                  />
                  <label htmlFor={`attach-${d.id}`}>{d.filename}</label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={previewMode || loading || (!templateCode && !adHocBody.trim())} title={disabledTitle} onClick={send}>
          {loading ? "Sending…" : "Confirm Send"}
        </Button>
        <Button variant="subtle" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
      {notice && <p className="text-sm text-vf-success">{notice}</p>}
      {error && <p className="text-sm text-vf-danger">{error}</p>}
    </div>
  );
}
