import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { updateRolePermissions, updateRoleApprovalLimit, deleteCustomRole, ValidationError, NotFoundError } from "@/server/services/permission-service";
import { isValidPermissionKey, APPROVAL_CATEGORIES, type ApprovalCategory, type PermissionKey } from "@/server/permissions/types";

/** A custom role's permission grants and/or one approval-limit category
 * — both gated by ManageUsers, both routed through the ONE Permission
 * Engine's own update functions (never a bespoke per-field mutation). */
export async function PATCH(request: Request, { params }: { params: Promise<{ companyId: string; roleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, roleId } = await params;
  const check = await requirePermission(companyId, "ManageUsers");
  if (!check.ok) return check.response;

  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  try {
    if (Array.isArray(body.permissionKeys)) {
      const keys = body.permissionKeys.filter((k: unknown): k is PermissionKey => typeof k === "string" && isValidPermissionKey(k));
      await updateRolePermissions(companyId, Number(roleId), keys, performedBy);
    }
    if (body.approvalLimit && APPROVAL_CATEGORIES.includes(body.approvalLimit.category)) {
      const category = body.approvalLimit.category as ApprovalCategory;
      const maxAmount = body.approvalLimit.maxAmount === null ? null : Number(body.approvalLimit.maxAmount);
      await updateRoleApprovalLimit(companyId, Number(roleId), category, maxAmount, performedBy);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ companyId: string; roleId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, roleId } = await params;
  const check = await requirePermission(companyId, "ManageUsers");
  if (!check.ok) return check.response;

  const performedBy = await getPerformedByLabel();
  try {
    await deleteCustomRole(companyId, Number(roleId), performedBy);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
