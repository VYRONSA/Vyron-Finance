import type { Metadata } from "next";
import { BulkUnallocate } from "@/components/financial/bank-unallocation/bulk-unallocate";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listBankAccounts } from "@/server/repositories/bank-account-repository";
import { hasPermission } from "@/server/services/permission-service";
import { MOCK_BANK_ACCOUNT_SUMMARIES } from "@/lib/mock/bank-accounts-data";

export const metadata: Metadata = {
  title: "Bulk Unallocate Transactions — PRECISIA",
};

export default async function BulkUnallocatePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();

  const bankAccounts = previewMode
    ? MOCK_BANK_ACCOUNT_SUMMARIES.map((s) => ({ id: s.account.id, accountName: s.account.accountName }))
    : (await listBankAccounts(companyId)).map((a) => ({ id: a.id, accountName: a.accountName }));
  const canEdit = previewMode ? false : await hasPermission(companyId, "Banking:Edit");
  const canReverse = previewMode ? false : await hasPermission(companyId, "GeneralLedger:Reverse");

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-4 overflow-y-auto">
      <div>
        <h1 className="text-xl font-medium text-vf-ink">Bulk Unallocate Transactions</h1>
        <p className="text-sm text-vf-ink-faint">
          Choose a date range, review exactly which bank transactions would be unallocated — or, for posted transactions, unposted and unallocated —
          and why any are excluded, then confirm. Each transaction keeps its current GL account, customer or supplier beside it for the next review.
        </p>
      </div>

      {previewMode && (
        <p className="text-xs text-vf-ink-faint">Preview Mode — Bulk Unallocate is disabled until Supabase is configured.</p>
      )}

      <BulkUnallocate companyId={companyId} bankAccounts={bankAccounts} canEdit={canEdit} canReverse={canReverse} previewMode={previewMode} />
    </div>
  );
}
