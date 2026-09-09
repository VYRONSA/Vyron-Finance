import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import {
  adjustStock,
  issueStock,
  listInventoryTransactions,
  receiveStock,
  recordOpeningBalance,
  returnStock,
  transferStock,
  ValidationError,
  writeOffStock,
} from "@/server/services/inventory-transaction-service";
import type { InventoryTransactionType } from "@/server/inventory/types";
import { requirePermission } from "@/server/services/permission-service";

const VALID_TYPES: InventoryTransactionType[] = ["Receipt", "Issue", "Transfer", "Adjustment", "StockTake", "Return", "WriteOff", "OpeningBalance"];

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  if (typeParam && !VALID_TYPES.includes(typeParam as InventoryTransactionType)) {
    return NextResponse.json({ error: `Invalid type '${typeParam}'.` }, { status: 400 });
  }

  const transactions = await listInventoryTransactions(companyId, (typeParam as InventoryTransactionType) || undefined);
  return NextResponse.json({ transactions });
}

/** `transactionType` in the body selects which real movement to create —
 * Receipt/Issue/Transfer/Return/WriteOff/OpeningBalance map directly;
 * Adjustment additionally requires `direction: "Increase" | "Decrease"`. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const body = await request.json();
  const { transactionType, direction, ...input } = body;

  const check = await requirePermission(companyId, "Inventory:Create");
  if (!check.ok) return check.response;

  try {
    switch (transactionType) {
      case "Receipt": {
        const transaction = await receiveStock(companyId, input);
        return NextResponse.json({ transaction }, { status: 201 });
      }
      case "Issue": {
        const transaction = await issueStock(companyId, input);
        return NextResponse.json({ transaction }, { status: 201 });
      }
      case "Transfer": {
        const transaction = await transferStock(companyId, input);
        return NextResponse.json({ transaction }, { status: 201 });
      }
      case "Return": {
        const transaction = await returnStock(companyId, input);
        return NextResponse.json({ transaction }, { status: 201 });
      }
      case "WriteOff": {
        const transaction = await writeOffStock(companyId, input);
        return NextResponse.json({ transaction }, { status: 201 });
      }
      case "OpeningBalance": {
        const transaction = await recordOpeningBalance(companyId, input);
        return NextResponse.json({ transaction }, { status: 201 });
      }
      case "Adjustment": {
        if (direction !== "Increase" && direction !== "Decrease") {
          return NextResponse.json({ error: "Adjustment requires a direction of 'Increase' or 'Decrease'." }, { status: 400 });
        }
        const transaction = await adjustStock(companyId, direction, input);
        return NextResponse.json({ transaction }, { status: 201 });
      }
      default:
        return NextResponse.json({ error: `Unknown transactionType '${transactionType}'.` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
