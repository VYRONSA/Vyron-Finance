import { EmptyState } from "@/components/ui/empty-state";
import { IconBuilding } from "@/components/ui/icons";
import type { BillingAccount } from "@/server/billing-platform/types";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">{label}</div>
      <div className="mt-1 text-sm text-vf-ink">{value || <span className="text-vf-ink-faint">Not set</span>}</div>
    </div>
  );
}

/** Read-only for now — editing (a `PATCH` on `billing_accounts`) is a
 * real, disclosed next step, not built in this pass since no route
 * exists yet to validate/authorize the write. Showing the real,
 * currently-on-file values honestly is still strictly better than a
 * placeholder form with nowhere to send its data. */
export function BillingContactTab({ billingAccount }: { billingAccount: BillingAccount | null }) {
  if (!billingAccount) {
    return <EmptyState icon={<IconBuilding className="h-5 w-5" />} title="No billing account yet" description="A billing account is created automatically the first time a company starts a trial." />;
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
      <Field label="Billing email" value={billingAccount.billingEmail} />
      <Field label="Billing contact" value={billingAccount.billingContactName} />
      <Field label="Tax number" value={billingAccount.taxNumber} />
      <Field label="Billing address" value={billingAccount.billingAddress} />
      <Field label="Default currency" value={billingAccount.defaultCurrencyCode} />
    </div>
  );
}
