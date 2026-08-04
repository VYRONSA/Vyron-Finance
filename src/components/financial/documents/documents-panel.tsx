"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconFileText, IconImport } from "@/components/ui/icons";
import { DOCUMENT_CATEGORIES, type DocumentEntityType, type DocumentRecord, type VirusScanStatus } from "@/server/documents/types";
import { MOCK_DOCUMENTS } from "@/lib/mock/documents-data";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SCAN_BADGE: Record<VirusScanStatus, { tone: "good" | "warn" | "danger" | "muted"; label: string }> = {
  clean: { tone: "good", label: "Scanned: Clean" },
  infected: { tone: "danger", label: "Scanned: Infected" },
  pending: { tone: "warn", label: "Scan Pending" },
  skipped: { tone: "muted", label: "Not Scanned" },
};

/**
 * The ONE shared document panel every entity's page embeds (Customer,
 * Supplier, Inventory, Asset, Journal, Bank Statement, Audit Evidence,
 * Financial Statement) — per RC1 Phase 4's "no module may upload
 * documents independently." Self-contained: fetches its own list against
 * `/api/companies/[companyId]/documents`, matching the NotificationBell's
 * established self-fetching client-component pattern.
 */
export function DocumentsPanel({
  companyId,
  entityType,
  entityId,
  previewMode,
}: {
  companyId: string;
  entityType: DocumentEntityType;
  entityId: number;
  previewMode: boolean;
}) {
  const [documents, setDocuments] = useState<DocumentRecord[]>(() =>
    previewMode ? MOCK_DOCUMENTS.filter((d) => d.entityType === entityType && d.entityId === entityId && d.isCurrent) : [],
  );
  const [loading, setLoading] = useState(!previewMode);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<string>("General");
  const [openVersionsFor, setOpenVersionsFor] = useState<number | null>(null);
  const [versions, setVersions] = useState<DocumentRecord[]>([]);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  /** Imperative refresh for post-action reloads (upload/delete) — called
   * from event handlers, never from the mount effect below (which fetches
   * directly to avoid a synchronous setState-in-effect). */
  function refresh() {
    if (previewMode) {
      setDocuments(MOCK_DOCUMENTS.filter((d) => d.entityType === entityType && d.entityId === entityId && d.isCurrent));
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/companies/${companyId}/documents?entityType=${entityType}&entityId=${entityId}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setDocuments(data.documents ?? []);
        else setError(data.error ?? "Couldn't load documents.");
      })
      .catch(() => setError("Couldn't reach the API. Check the dev server is running."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (previewMode) return;
    fetch(`/api/companies/${companyId}/documents?entityType=${entityType}&entityId=${entityId}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setDocuments(data.documents ?? []);
        else setError(data.error ?? "Couldn't load documents.");
      })
      .catch(() => setError("Couldn't reach the API. Check the dev server is running."))
      .finally(() => setLoading(false));
  }, [companyId, entityType, entityId, previewMode]);

  async function handleUpload(file: File, replacesDocumentId?: number) {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("entityType", entityType);
      formData.append("entityId", String(entityId));
      formData.append("category", category);
      formData.append("filename", file.name);
      formData.append("file", file);
      if (replacesDocumentId) formData.append("replacesDocumentId", String(replacesDocumentId));

      const res = await fetch(`/api/companies/${companyId}/documents`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status})`);
        return;
      }
      refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(documentId: number) {
    setError(null);
    const res = await fetch(`/api/companies/${companyId}/documents/${documentId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? `Delete failed (${res.status})`);
      return;
    }
    refresh();
  }

  async function handleDownload(documentId: number) {
    setError(null);
    const res = await fetch(`/api/companies/${companyId}/documents/${documentId}/download`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? `Couldn't generate a download link (${res.status})`);
      return;
    }
    window.open(data.url, "_blank", "noopener,noreferrer");
  }

  async function toggleVersions(documentId: number) {
    if (openVersionsFor === documentId) {
      setOpenVersionsFor(null);
      return;
    }
    setOpenVersionsFor(documentId);
    if (previewMode) {
      const doc = documents.find((d) => d.id === documentId);
      const groupId = doc?.documentGroupId ?? doc?.id;
      setVersions(MOCK_DOCUMENTS.filter((d) => (d.documentGroupId ?? d.id) === groupId));
      return;
    }
    const res = await fetch(`/api/companies/${companyId}/documents/${documentId}/versions`);
    const data = await res.json();
    if (res.ok) setVersions(data.versions ?? []);
  }

  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-vf-ink">
          <IconFileText className="h-4 w-4" /> Documents
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Document category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink"
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label className={`inline-flex ${previewMode ? "" : "cursor-pointer"}`} title={disabledTitle}>
            <span className="pointer-events-none">
              <Button variant="subtle" size="sm" disabled={previewMode || uploading} title={disabledTitle} type="button">
                <IconImport className="h-3.5 w-3.5" /> {uploading ? "Uploading…" : "Upload"}
              </Button>
            </span>
            <input
              type="file"
              className="sr-only"
              disabled={previewMode || uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUpload(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-vf-danger">{error}</p>}
      {previewMode && (
        <p className="mt-2 text-xs text-vf-ink-faint">Preview Mode — showing sample documents. Upload/delete are disabled until Supabase is configured.</p>
      )}

      <div className="mt-3 border-t border-vf-paper-border pt-3">
        {loading && <p className="text-sm text-vf-ink-faint">Loading…</p>}
        {!loading && documents.length === 0 && (
          <EmptyState
            icon={<IconFileText className="h-5 w-5" />}
            title="No documents yet"
            description="Upload a contract, invoice, or compliance file — it will appear here, versioned and permission-scoped."
          />
        )}
        {!loading && documents.length > 0 && (
          <ul className="flex flex-col gap-1.5 text-sm">
            {documents.map((doc) => {
              const scan = SCAN_BADGE[doc.virusScanStatus];
              return (
                <li key={doc.id} className="border-t border-vf-paper-border pt-1.5 first:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-vf-ink">{doc.filename}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-vf-ink-faint">
                        <Badge tone="info">{doc.category}</Badge>
                        <Badge tone={scan.tone}>{scan.label}</Badge>
                        v{doc.versionNumber} · {formatSize(doc.sizeBytes)} · {doc.uploadedBy} · {new Date(doc.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button variant="subtle" size="sm" onClick={() => handleDownload(doc.id)} disabled={previewMode} title={disabledTitle}>
                        Download
                      </Button>
                      <Button variant="subtle" size="sm" onClick={() => toggleVersions(doc.id)}>
                        {openVersionsFor === doc.id ? "Hide Versions" : "Versions"}
                      </Button>
                      <label className={previewMode ? "" : "cursor-pointer"} title={disabledTitle}>
                        <span className="pointer-events-none">
                          <Button variant="subtle" size="sm" disabled={previewMode || uploading} title={disabledTitle} type="button">
                            New Version
                          </Button>
                        </span>
                        <input
                          type="file"
                          className="sr-only"
                          disabled={previewMode || uploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleUpload(file, doc.id);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <Button variant="subtle" size="sm" onClick={() => handleDelete(doc.id)} disabled={previewMode} title={disabledTitle} className="hover:border-vf-danger hover:text-vf-danger">
                        Delete
                      </Button>
                    </div>
                  </div>
                  {openVersionsFor === doc.id && (
                    <ul className="mt-1.5 ml-4 flex flex-col gap-1 border-l border-vf-paper-border pl-3 text-xs text-vf-ink-faint">
                      {versions.map((v) => (
                        <li key={v.id}>
                          v{v.versionNumber} · {v.filename} · {v.uploadedBy} · {new Date(v.uploadedAt).toLocaleString()} {v.isCurrent && <Badge tone="good">Current</Badge>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
