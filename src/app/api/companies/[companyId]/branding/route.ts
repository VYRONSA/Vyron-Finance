import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { getCompanyBrandingAssets, uploadLogo, removeLogo, ValidationError, NotFoundError } from "@/server/services/company-branding-service";

/** Current branding assets for one company (signed logo URL, or the
 * empty state) — read access follows the same "session + RLS" pattern
 * as GET /api/companies/[companyId], no extra permission check. */
export async function GET(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const branding = await getCompanyBrandingAssets(companyId);
  return NextResponse.json({ branding });
}

/** Upload or replace the company logo — `multipart/form-data`, real
 * bytes land in the dedicated `company-branding` bucket before the DB
 * reference updates. `Settings:Edit`, the same permission that already
 * gates every other Company Settings write. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Settings:Edit");
  if (!check.ok) return check.response;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }
  const filename = String(formData.get("filename") ?? (file instanceof File ? file.name : "logo"));
  const performedBy = await getPerformedByLabel();

  try {
    const branding = await uploadLogo({
      companyId,
      filename,
      mimeType: file.type || "application/octet-stream",
      file,
      uploadedBy: performedBy,
    });
    return NextResponse.json({ branding }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** Remove the company logo — `Settings:Edit`, same as POST. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  const check = await requirePermission(companyId, "Settings:Edit");
  if (!check.ok) return check.response;

  try {
    await removeLogo(companyId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
