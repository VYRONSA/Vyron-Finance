"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { IconBell } from "@/components/ui/icons";
import type { CommunicationRecord, CommunicationStatus } from "@/server/communications/types";
import type { DocumentRecord } from "@/server/documents/types";

const STATUS_TONE: Record<CommunicationStatus, "muted" | "info" | "good" | "danger" | "warn"> = {
  Draft: "muted", PendingApproval: "warn", Rejected: "danger", Queued: "info",
  Sending: "info", Sent: "good", Failed: "danger", Cancelled: "muted", Expired: "muted",
};

/**
 * "What was sent, when, to whom, which template, delivery status,
 * attachments" — the RC1 Phase 5.1 requirement, sourced ENTIRELY from
 * the shared `communications` record. Reusable on any business object's
 * detail page, matching the `<DocumentsPanel>` self-fetching pattern.
 */
export function CommunicationHistoryPanel({
  companyId,
  businessObjectType,
  businessObjectId,
  previewMode,
  mockCommunications = [],
}: {
  companyId: string;
  businessObjectType: string;
  businessObjectId: number;
  previewMode: boolean;
  mockCommunications?: CommunicationRecord[];
}) {
  const [communications, setCommunications] = useState<CommunicationRecord[]>(
    previewMode ? mockCommunications.filter((c) => c.businessObjectType === businessObjectType && c.businessObjectId === businessObjectId) : [],
  );
  const [loading, setLoading] = useState(!previewMode);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [attachmentsByComm, setAttachmentsByComm] = useState<Record<number, DocumentRecord[]>>({});

  useEffect(() => {
    if (previewMode) return;
    fetch(`/api/companies/${companyId}/communications?businessObjectType=${businessObjectType}&businessObjectId=${businessObjectId}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setCommunications(data.communications ?? []);
      })
      .finally(() => setLoading(false));
  }, [companyId, businessObjectType, businessObjectId, previewMode]);

  function toggleAttachments(communicationId: number) {
    if (expandedId === communicationId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(communicationId);
    if (previewMode || attachmentsByComm[communicationId]) return;
    fetch(`/api/companies/${companyId}/communications/${communicationId}/attachments`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setAttachmentsByComm((prev) => ({ ...prev, [communicationId]: data.attachments ?? [] }));
      });
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-vf-ink">
        <IconBell className="h-4 w-4" /> Communication History
      </p>
      <div className="mt-3 border-t border-vf-paper-border pt-3">
        {loading && <p className="text-sm text-vf-ink-faint">Loading…</p>}
        {!loading && communications.length === 0 && (
          <EmptyState icon={<IconBell className="h-5 w-5" />} title="No communications yet" description="Emails, reminders, and statements sent about this record will appear here." />
        )}
        {!loading && communications.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {communications.map((c) => (
              <li key={c.id} className="border-t border-vf-paper-border pt-1.5 first:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-vf-ink">{c.subject ?? c.body.slice(0, 60)}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-vf-ink-faint">
                      <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                      {c.channel} · To: {c.recipients.map((r) => r.name).join(", ") || "—"} · {new Date(c.sentAt ?? c.scheduledFor).toLocaleString()}
                    </p>
                    {c.status === "Failed" && c.failureReason && <p className="mt-0.5 text-xs text-vf-danger">{c.failureReason}</p>}
                  </div>
                  <button type="button" className="text-xs font-medium text-vf-red-600 hover:underline" onClick={() => toggleAttachments(c.id)}>
                    {expandedId === c.id ? "Hide Attachments" : "Attachments"}
                  </button>
                </div>
                {expandedId === c.id && (
                  <ul className="mt-1.5 ml-4 flex flex-col gap-1 border-l border-vf-paper-border pl-3 text-xs text-vf-ink-faint">
                    {(attachmentsByComm[c.id] ?? []).length === 0 ? <li>No attachments.</li> : (attachmentsByComm[c.id] ?? []).map((d) => <li key={d.id}>{d.filename}</li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
