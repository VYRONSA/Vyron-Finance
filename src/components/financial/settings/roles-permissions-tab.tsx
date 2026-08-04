"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { GLOBAL_PERMISSIONS, MODULE_ACTIONS, PERMISSION_MODULES, APPROVAL_CATEGORIES, type ApprovalCategory, type PermissionKey } from "@/server/permissions/types";
import type { PermissionRoleWithGrants, UserRoleAssignment } from "@/server/permissions/types";

const APPROVAL_CATEGORY_LABEL: Record<ApprovalCategory, string> = {
  Journal: "Journal Approval",
  SupplierPayment: "Supplier Payments",
  CustomerCreditNote: "Customer Credit Notes",
  PurchaseApproval: "Purchase Approvals",
  AssetDisposal: "Asset Disposals",
};

function RolePermissionEditor({ companyId, role, previewMode }: { companyId: string; role: PermissionRoleWithGrants; previewMode: boolean }) {
  const router = useRouter();
  const [keys, setKeys] = useState<Set<PermissionKey>>(new Set(role.permissionKeys));
  const [limits, setLimits] = useState<Record<ApprovalCategory, string>>(() => {
    const map = {} as Record<ApprovalCategory, string>;
    for (const cat of APPROVAL_CATEGORIES) {
      const existing = role.approvalLimits.find((l) => l.category === cat);
      map[cat] = existing ? (existing.maxAmount === null ? "unlimited" : String(existing.maxAmount)) : "";
    }
    return map;
  });
  const [saving, setSaving] = useState(false);
  const editable = !role.isSystemRole;
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : role.isSystemRole ? "System roles are fixed defaults — create a custom role to customize." : undefined;

  function toggle(key: PermissionKey) {
    if (!editable) return;
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function savePermissions() {
    setSaving(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionKeys: [...keys] }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function saveLimit(category: ApprovalCategory) {
    setSaving(true);
    try {
      const raw = limits[category].trim();
      const maxAmount = raw === "" ? null : raw.toLowerCase() === "unlimited" ? null : Number(raw);
      const res = await fetch(`/api/companies/${companyId}/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalLimit: { category, maxAmount } }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Module Permissions</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="p-1.5 text-left text-xs text-vf-ink-faint">Module</th>
                {MODULE_ACTIONS.map((a) => (
                  <th key={a} className="p-1.5 text-center text-xs text-vf-ink-faint">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_MODULES.map((m) => (
                <tr key={m} className="border-t border-vf-paper-border">
                  <td className="p-1.5 font-medium text-vf-ink">{m}</td>
                  {MODULE_ACTIONS.map((a) => {
                    const key: PermissionKey = `${m}:${a}`;
                    return (
                      <td key={a} className="p-1.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${m} ${a} for ${role.name}`}
                          checked={keys.has(key)}
                          disabled={!editable}
                          onChange={() => toggle(key)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Global Permissions</p>
        <div className="flex flex-wrap gap-3">
          {GLOBAL_PERMISSIONS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-sm text-vf-ink-soft">
              <input type="checkbox" checked={keys.has(p)} disabled={!editable} onChange={() => toggle(p)} />
              {p}
            </label>
          ))}
        </div>
      </div>

      {editable && (
        <Button variant="primary" size="sm" className="w-fit" disabled={previewMode || saving} title={disabledTitle} onClick={savePermissions}>
          Save Permissions
        </Button>
      )}

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Approval Limits</p>
        <div className="flex flex-col gap-2">
          {APPROVAL_CATEGORIES.map((cat) => (
            <div key={cat} className="flex flex-wrap items-end gap-2">
              <div className="w-44 text-sm text-vf-ink-soft">{APPROVAL_CATEGORY_LABEL[cat]}</div>
              <div className="w-40">
                <label htmlFor={`limit-${role.id}-${cat}`} className="sr-only">{APPROVAL_CATEGORY_LABEL[cat]} limit</label>
                <Input
                  id={`limit-${role.id}-${cat}`}
                  value={limits[cat]}
                  disabled={!editable}
                  placeholder="e.g. 50000 or unlimited"
                  onChange={(e) => setLimits((prev) => ({ ...prev, [cat]: e.target.value }))}
                />
              </div>
              {editable && (
                <Button variant="subtle" size="sm" disabled={previewMode || saving} title={disabledTitle} onClick={() => saveLimit(cat)}>
                  Save
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AssignmentsPanel({ companyId, roles, assignments, previewMode }: { companyId: string; roles: PermissionRoleWithGrants[]; assignments: UserRoleAssignment[]; previewMode: boolean }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState<number>(roles[0]?.id ?? 0);
  const [loading, setLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState<number>(roles[0]?.id ?? 0);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState<string | null>(null);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;
  const roleById = useMemo(() => new Map(roles.map((r) => [r.id, r])), [roles]);

  async function assign() {
    if (!userId.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/roles/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), roleId }),
      });
      if (res.ok) {
        setUserId("");
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function invite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteError(null);
    setInviteSent(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/users/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), roleId: inviteRoleId }),
      });
      if (res.ok) {
        setInviteSent(inviteEmail.trim());
        setInviteEmail("");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setInviteError(data.error ?? "Couldn't send this invite.");
      }
    } finally {
      setInviting(false);
    }
  }

  async function revoke(assignmentId: number) {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/roles/assignments/${assignmentId}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-vf-md border border-vf-paper-border p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Invite a New User</p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="invite-email" className="mb-1 block text-xs font-medium text-vf-ink-faint">Email address</label>
            <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="name@company.com" />
          </div>
          <div className="w-56">
            <label htmlFor="invite-role" className="mb-1 block text-xs font-medium text-vf-ink-faint">Role</label>
            <select id="invite-role" value={inviteRoleId} onChange={(e) => setInviteRoleId(Number(e.target.value))} className="w-full rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.scope === "platform" ? " (Platform)" : ""}</option>
              ))}
            </select>
          </div>
          <Button variant="primary" size="sm" disabled={previewMode || inviting || !inviteEmail.trim()} title={disabledTitle} onClick={invite}>
            {inviting ? "Sending…" : "Send Invite"}
          </Button>
        </div>
        {inviteError && <p role="alert" className="text-sm text-vf-danger">{inviteError}</p>}
        {inviteSent && <p className="text-sm text-[#1f6e4b]">Invite sent to {inviteSent}.</p>}
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-vf-md border border-vf-paper-border p-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="assign-user-id" className="mb-1 block text-xs font-medium text-vf-ink-faint">Or assign an existing user by ID (Supabase auth.users.id)</label>
          <Input id="assign-user-id" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
        </div>
        <div className="w-56">
          <label htmlFor="assign-role" className="mb-1 block text-xs font-medium text-vf-ink-faint">Role</label>
          <select id="assign-role" value={roleId} onChange={(e) => setRoleId(Number(e.target.value))} className="w-full rounded-vf-sm border border-vf-paper-border bg-vf-paper px-3 py-2 text-sm text-vf-ink">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}{r.scope === "platform" ? " (Platform)" : ""}</option>
            ))}
          </select>
        </div>
        <Button variant="primary" size="sm" disabled={previewMode || loading || !userId.trim()} title={disabledTitle} onClick={assign}>
          Assign Role
        </Button>
      </div>

      {assignments.length === 0 ? (
        <EmptyState title="No roles assigned yet." description="Assign a role above so a user can act in this company." />
      ) : (
        <div className="flex flex-col gap-2">
          {assignments.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-vf-md border border-vf-paper-border p-3">
              <div>
                <p className="font-mono text-xs text-vf-ink">{a.userId}</p>
                <p className="mt-0.5 text-sm text-vf-ink-soft">
                  <Badge tone="info">{roleById.get(a.roleId)?.name ?? `Role #${a.roleId}`}</Badge>
                  <span className="ml-2 text-xs text-vf-ink-faint">assigned by {a.assignedBy} on {a.assignedAt.slice(0, 10)}</span>
                </p>
              </div>
              <Button variant="subtle" size="sm" disabled={previewMode || loading} title={disabledTitle} onClick={() => revoke(a.id)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** RC1 Phase 1 — the ONE Permission Engine's own admin UI. Every save
 * here calls the same `permission-service.ts` functions every gated API
 * route already calls to CHECK a permission — this tab only ever
 * displays and edits the engine's real data, it never computes an
 * authorization decision itself. */
export function RolesPermissionsTab({ companyId, roles, assignments, previewMode }: { companyId: string; roles: PermissionRoleWithGrants[]; assignments: UserRoleAssignment[]; previewMode: boolean }) {
  const router = useRouter();
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(roles[0]?.id ?? null);
  const [view, setView] = useState<"roles" | "assignments">("roles");
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  const platformRoles = roles.filter((r) => r.scope === "platform");
  const systemRoles = roles.filter((r) => r.scope === "company" && r.isSystemRole);
  const customRoles = roles.filter((r) => r.scope === "company" && !r.isSystemRole);
  const selectedRole = roles.find((r) => r.id === selectedRoleId) ?? null;

  async function createRole() {
    if (!newRoleName.trim()) return;
    const res = await fetch(`/api/companies/${companyId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newRoleName.trim() }),
    });
    if (res.ok) {
      setNewRoleName("");
      setCreating(false);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-vf-ink-faint">
        One Permission Engine — 4 platform roles, 15 company roles, and any custom roles this company creates. Approval limits for Journals,
        Supplier Payments, Customer Credit Notes, Purchase Approvals, and Asset Disposals all route through the same engine, not a per-workflow check.
      </p>

      <div className="flex gap-2">
        <button type="button" onClick={() => setView("roles")} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${view === "roles" ? "border-vf-red-600 bg-vf-red-500/10 text-vf-red-600" : "border-vf-paper-border text-vf-ink-soft hover:border-vf-red-400"}`}>
          Roles
        </button>
        <button type="button" onClick={() => setView("assignments")} className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${view === "assignments" ? "border-vf-red-600 bg-vf-red-500/10 text-vf-red-600" : "border-vf-paper-border text-vf-ink-soft hover:border-vf-red-400"}`}>
          User Assignments ({assignments.length})
        </button>
      </div>

      {view === "assignments" ? (
        <AssignmentsPanel companyId={companyId} roles={roles} assignments={assignments} previewMode={previewMode} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
          <div className="flex flex-col gap-3">
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Company Roles</p>
              <div className="flex flex-col gap-1">
                {systemRoles.map((r) => (
                  <button key={r.id} type="button" onClick={() => setSelectedRoleId(r.id)} className={`rounded-vf-sm px-2.5 py-1.5 text-left text-sm ${selectedRoleId === r.id ? "bg-vf-red-500/10 text-vf-red-600" : "text-vf-ink-soft hover:bg-vf-paper-alt"}`}>
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
            {customRoles.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Custom Roles</p>
                <div className="flex flex-col gap-1">
                  {customRoles.map((r) => (
                    <button key={r.id} type="button" onClick={() => setSelectedRoleId(r.id)} className={`rounded-vf-sm px-2.5 py-1.5 text-left text-sm ${selectedRoleId === r.id ? "bg-vf-red-500/10 text-vf-red-600" : "text-vf-ink-soft hover:bg-vf-paper-alt"}`}>
                      {r.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-vf-ink-faint">Platform Roles</p>
              <div className="flex flex-col gap-1">
                {platformRoles.map((r) => (
                  <button key={r.id} type="button" onClick={() => setSelectedRoleId(r.id)} className={`rounded-vf-sm px-2.5 py-1.5 text-left text-sm ${selectedRoleId === r.id ? "bg-vf-red-500/10 text-vf-red-600" : "text-vf-ink-soft hover:bg-vf-paper-alt"}`}>
                    {r.name}
                  </button>
                ))}
              </div>
            </div>

            {creating ? (
              <div className="flex flex-col gap-2 rounded-vf-md border border-vf-paper-border p-2.5">
                <label htmlFor="new-role-name" className="sr-only">New role name</label>
                <Input id="new-role-name" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="e.g. Regional Controller" />
                <div className="flex gap-2">
                  <Button variant="primary" size="sm" disabled={previewMode || !newRoleName.trim()} title={disabledTitle} onClick={createRole}>Create</Button>
                  <Button variant="subtle" size="sm" onClick={() => setCreating(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button variant="subtle" size="sm" disabled={previewMode} title={disabledTitle} onClick={() => setCreating(true)}>
                + Custom Role
              </Button>
            )}
          </div>

          <div>
            {selectedRole ? (
              <>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-vf-ink">{selectedRole.name}</h3>
                  <Badge tone={selectedRole.isSystemRole ? "muted" : "info"}>{selectedRole.isSystemRole ? "System" : "Custom"}</Badge>
                  <Badge tone="muted">{selectedRole.scope === "platform" ? "Platform" : "Company"}</Badge>
                </div>
                <RolePermissionEditor companyId={companyId} role={selectedRole} previewMode={previewMode} />
              </>
            ) : (
              <EmptyState title="No role selected." description="Choose a role on the left." />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
