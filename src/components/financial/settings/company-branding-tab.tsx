"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconBuilding, IconTrash } from "@/components/ui/icons";
import type { CompanyBrandingAssets } from "@/server/company-branding/types";

/** Phase 20B — Company Branding & Logo Storage Foundation. Upload /
 * Preview / Replace / Remove for a company's logo. Storage foundation
 * only — this tab does not attach the logo to any invoice, statement, or
 * report; there is no rendering layer for it to attach to yet. */
export function CompanyBrandingTab({
  companyId,
  branding: initialBranding,
  previewMode,
}: {
  companyId: string;
  branding: CompanyBrandingAssets;
  previewMode: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [branding, setBranding] = useState(initialBranding);
  const [loading, setLoading] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<"uploaded" | "removed" | null>(null);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setLoading("upload");
    setError(null);
    setSaved(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("filename", file.name);
      const res = await fetch(`/api/companies/${companyId}/branding`, { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setBranding(body.branding);
      setSaved("uploaded");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(null);
    }
  }

  async function handleRemove() {
    setLoading("remove");
    setError(null);
    setSaved(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/branding`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? `Request failed (${res.status})`);
        return;
      }
      setBranding({ hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: null });
      setSaved("removed");
      router.refresh();
    } catch {
      setError("Couldn't reach the API. Check the dev server is running.");
    } finally {
      setLoading(null);
    }
  }

  const disabled = loading !== null || previewMode;
  const previewTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-vf-ink">Company Logo</p>
        <p className="mt-0.5 max-w-[52ch] text-xs text-vf-ink-faint">
          PNG, JPEG, or WEBP, up to 5MB. Used as this company&apos;s logo across the workspace — not yet applied to
          invoices, statements, or reports.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-vf-paper-border bg-vf-paper-alt text-vf-ink-faint">
          {branding.hasLogo && branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Supabase Storage URL, not a static/remote asset next/image's loader is configured for.
            <img src={branding.logoUrl} alt={`${branding.logoFilename ?? "Company"} logo`} className="h-full w-full object-contain" />
          ) : (
            <IconBuilding className="h-7 w-7" />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button
              variant="subtle"
              size="sm"
              disabled={disabled}
              title={previewTitle}
              onClick={() => fileInputRef.current?.click()}
            >
              {loading === "upload" ? "Uploading…" : branding.hasLogo ? "Replace Logo" : "Upload Logo"}
            </Button>
            {branding.hasLogo && (
              <Button variant="danger" size="sm" disabled={disabled} title={previewTitle} onClick={handleRemove}>
                <IconTrash className="h-4 w-4" />
                {loading === "remove" ? "Removing…" : "Remove"}
              </Button>
            )}
          </div>
          {branding.hasLogo && branding.logoFilename && (
            <p className="text-xs text-vf-ink-faint">{branding.logoFilename}</p>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Company logo"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-vf-danger">
          {error}
        </p>
      )}
      {saved === "uploaded" && <p className="text-sm text-vf-success">Logo saved.</p>}
      {saved === "removed" && <p className="text-sm text-vf-success">Logo removed.</p>}
    </div>
  );
}
