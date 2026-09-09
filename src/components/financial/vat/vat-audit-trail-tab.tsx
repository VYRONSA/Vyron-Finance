import { EmptyState } from "@/components/ui/empty-state";
import { IconBookOpen } from "@/components/ui/icons";
import type { AutomationAuditLogEntry } from "@/server/automation/types";

/** Reuses the shared `automation_audit_log` (Module 7) — no separate VAT
 * audit table. Every VAT Return generation/recalculation/approval/
 * submission/amendment and every posted VAT Adjustment/applied VAT rule
 * is a real row here, answering who/what-rule/why/what-changed/
 * journals/documents/duration/reversible. */
export function VatAuditTrailTab({ auditLog }: { auditLog: AutomationAuditLogEntry[] }) {
  if (auditLog.length === 0) {
    return <EmptyState icon={<IconBookOpen className="h-5 w-5" />} title="No VAT audit activity yet." description="Every VAT Return, Adjustment, and rule application will be recorded here." />;
  }

  return (
    <ul className="flex flex-col gap-2 text-sm text-vf-ink-soft">
      {auditLog.map((e) => (
        <li key={e.id} className="border-t border-vf-paper-border pt-2 first:border-0 first:pt-0">
          <span className="font-medium text-vf-ink">{e.actionType}</span>
          {e.documentType && ` — ${e.documentType} #${e.documentId}`}
          {e.reason && ` — ${e.reason}`}
          {e.journalIds.length > 0 && ` · Journal(s) ${e.journalIds.join(", ")}`}
          {e.ruleId !== null && ` · Rule #${e.ruleId}`}
          <span className="ml-1 text-xs text-vf-ink-faint">
            · by {e.performedBy} · {new Date(e.createdAt).toLocaleString()} · {e.isReversible ? "reversible" : "not reversible"}
          </span>
        </li>
      ))}
    </ul>
  );
}
