/**
 * SD-2 — which Supplier Documents controls to offer the signed-in user.
 *
 * Display only. Every action is enforced again by its API route
 * (`requirePermission` / `requireApproval`) and by the database (0111/0112);
 * a control that is hidden here could not have succeeded anyway, and one
 * that is shown can still be refused (for example by an approval limit).
 */
import { hasPermission } from "@/server/services/permission-service";
import type { CapturePermissions } from "@/lib/supplier-documents/capture-stages";

export const NO_CAPTURE_PERMISSIONS: CapturePermissions = { view: false, upload: false, edit: false, reject: false, approve: false };

export async function loadCapturePermissions(companyId: string): Promise<CapturePermissions> {
  const [view, create, edit, reject, approve] = await Promise.all([
    hasPermission(companyId, "Purchasing:View"),
    hasPermission(companyId, "Purchasing:Create"),
    hasPermission(companyId, "Purchasing:Edit"),
    hasPermission(companyId, "Purchasing:Reject"),
    hasPermission(companyId, "Purchasing:Approve"),
  ]);
  return { view, upload: view && create, edit: view && edit, reject: view && reject, approve: view && create && approve };
}
