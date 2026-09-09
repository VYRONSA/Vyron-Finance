import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconFileText } from "@/components/ui/icons";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { listMyDrafts, type MyDraftModule } from "@/server/services/my-drafts-service";

export const metadata: Metadata = {
  title: "My Drafts — VYRON FINANCE",
};

const MODULE_TONE: Record<MyDraftModule, "info" | "good" | "warn" | "muted"> = {
  "General Ledger": "info",
  Sales: "good",
  Purchasing: "warn",
  Cashbook: "muted",
};

/**
 * Master Implementation Tracker — Epic E11, Finding #223 (RC-9). Every
 * Draft-status document across GL, Sales, Purchasing, and Cashbook, in
 * one place, since today each is only visible by opening its own module
 * and filtering. Preview Mode shows an explanatory empty state rather
 * than a fabricated cross-module mock dataset — a deliberate, disclosed
 * scope limit for this lower-priority finding, not an oversight.
 */
export default async function MyDraftsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const previewMode = !isSupabaseConfigured();
  const drafts = previewMode ? [] : await listMyDrafts(companyId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-vf-ink">My Drafts</h1>
        <p className="mt-1 text-sm text-vf-ink-soft">
          Every Draft-status journal, quotation, sales order, purchase requisition, purchase order, and cashbook
          batch across the company — pick up where you left off.
        </p>
      </div>

      {previewMode && (
        <p className="text-xs text-vf-ink-faint">Preview Mode — this view is available once a production Supabase project is connected.</p>
      )}

      {drafts.length === 0 ? (
        <EmptyState
          icon={<IconFileText className="h-5 w-5" />}
          title="No drafts."
          description={previewMode ? "Available once a production Supabase project is connected." : "Nothing is currently sitting in Draft across GL, Sales, Purchasing, or Cashbook."}
        />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeadCell>Module</TableHeadCell>
              <TableHeadCell>Type</TableHeadCell>
              <TableHeadCell>Number</TableHeadCell>
              <TableHeadCell>Date</TableHeadCell>
              <TableHeadCell>Description</TableHeadCell>
              <TableHeadCell />
            </tr>
          </TableHead>
          <TableBody>
            {drafts.map((item) => (
              <TableRow key={`${item.documentType}-${item.id}`}>
                <TableCell>
                  <Badge tone={MODULE_TONE[item.module]}>{item.module}</Badge>
                </TableCell>
                <TableCell>{item.documentType}</TableCell>
                <TableCell className="font-mono text-xs font-medium text-vf-ink">{item.number}</TableCell>
                <TableCell>{item.date}</TableCell>
                <TableCell className="max-w-xs truncate">{item.description || "—"}</TableCell>
                <TableCell className="text-right">
                  <Link href={item.href} className="text-sm font-medium text-vf-red-600 hover:text-vf-red-700">
                    Open →
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
