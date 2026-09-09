"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { IntegrationConnection } from "@/server/inventory/types";

const SYSTEM_LABEL: Record<IntegrationConnection["systemName"], string> = { VYRON_COST: "VYRON COST", VYRON_CORE: "VYRON CORE" };
const STATUS_TONE: Record<IntegrationConnection["status"], "muted" | "good" | "danger"> = { "Not Connected": "muted", Connected: "good", Error: "danger" };

export function IntegrationCentreTab({ connections }: { connections: IntegrationConnection[] }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-vf-ink-soft">
        The integration layer for VYRON FINANCE&apos;s peer platform applications — VYRON FINANCE never builds
        manufacturing or workforce management itself. Finished Goods, Production Costs, BOM Costs, and Manufacturing
        Journals will flow in from VYRON COST; Approved Timesheets, Labour Cost Allocation, and Payroll Journals will
        flow in from VYRON CORE — both once a real connection exists.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {connections.map((connection) => (
          <Card key={connection.id}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium text-vf-ink">{SYSTEM_LABEL[connection.systemName]}</p>
                <p className="mt-1 text-xs text-vf-ink-faint">
                  {connection.lastSyncedAt ? `Last synced ${new Date(connection.lastSyncedAt).toLocaleString()}` : "Never synced"}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge tone={STATUS_TONE[connection.status]}>{connection.status}</Badge>
                <Button
                  variant="subtle"
                  size="sm"
                  disabled
                  title={`No real ${SYSTEM_LABEL[connection.systemName]} connection exists yet — this is an honest 'Not Connected' status, not a placeholder that pretends to work.`}
                >
                  Connect
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
