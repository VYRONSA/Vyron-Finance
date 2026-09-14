/**
 * Inventory reporting — stock on hand, stock valuation reconciled to the
 * inventory GL accounts, and stock movements. Quantities on hand and
 * average costs are the stock items' CURRENT values (VYRON keeps no
 * historical snapshot of them), which the reports state plainly.
 */

import type { InventoryTransaction } from "@/server/inventory/types";
import { col, F, groupRow, numberFilter, periodLabel, row, section, subtotalRow, summaryCount, summaryMoney, totalRow, formatDate, type ReportDefinition } from "../kit";
import { check, inRange, round2, sum, type ReconciliationCheck, type ReportRow } from "../types";

const EFFECTIVE_STATUSES = new Set(["Approved", "Posted"]);

/** Same direction rules the inventory engine applies
 * (`inventory-transaction-service.ts::applyLinesAndGetAmount`). */
function direction(t: InventoryTransaction): "In" | "Out" | "Transfer" | "Count" {
  switch (t.transactionType) {
    case "Receipt":
    case "Return":
    case "OpeningBalance":
      return "In";
    case "Issue":
    case "WriteOff":
      return "Out";
    case "Adjustment":
      return t.direction === "Decrease" ? "Out" : "In";
    case "Transfer":
      return "Transfer";
    default:
      return "Count";
  }
}

function unitValue(item: { averageCost: number; costPrice: number }): number {
  return item.averageCost || item.costPrice || 0;
}

export const INVENTORY_REPORTS: ReportDefinition[] = [
  {
    id: "stock-on-hand",
    title: "Stock on Hand",
    description: "Every active stock item's current quantity, average cost, value and reorder position.",
    categories: ["inventory"],
    filters: [F.category],
    async build(ctx) {
      const items = (await ctx.source.stockItems()).filter((i) => i.status !== "Discontinued" && (!ctx.filters.category || i.category === ctx.filters.category));
      const rows = items
        .sort((a, b) => a.stockCode.localeCompare(b.stockCode, undefined, { numeric: true }))
        .map((i) => row({ code: i.stockCode, item: i.description, category: i.category, qty: i.quantityOnHand, uom: i.unitOfMeasure, cost: unitValue(i), value: round2(i.quantityOnHand * unitValue(i)), reorder: i.reorderLevel, flag: i.quantityOnHand <= i.reorderLevel && i.reorderLevel > 0 ? "Reorder" : "" }));
      rows.push(totalRow({ item: `${items.length} items`, value: sum(items, (i) => i.quantityOnHand * unitValue(i)) }));
      return {
        subtitle: `Current position · ${formatDate(ctx.today)}`,
        summary: [summaryCount("Items", items.length), summaryMoney("Stock Value", sum(items, (i) => i.quantityOnHand * unitValue(i))), summaryCount("At or below reorder level", items.filter((i) => i.reorderLevel > 0 && i.quantityOnHand <= i.reorderLevel).length)],
        sections: [section([col("code", "Code"), col("item", "Item"), col("category", "Category"), col("qty", "On Hand", "number"), col("uom", "Unit"), col("cost", "Average Cost", "money"), col("value", "Value", "money"), col("reorder", "Reorder Level", "number"), col("flag", "", "badge")], rows, undefined, "No stock items.")],
        checks: [],
        notices: ["Quantities and average costs are current values; VYRON does not store historical stock snapshots."],
      };
    },
  },
  {
    id: "stock-valuation",
    title: "Stock Valuation",
    description: "Stock value by category at current average cost, reconciled to the inventory accounts in the General Ledger.",
    categories: ["inventory", "financial"],
    filters: [],
    async build(ctx) {
      const [items, accounts, tb] = await Promise.all([ctx.source.stockItems(), ctx.source.accounts(), ctx.source.trialBalance(ctx.today)]);
      const categories = new Map<string, typeof items>();
      for (const i of items) categories.set(i.category || "Uncategorised", [...(categories.get(i.category || "Uncategorised") ?? []), i]);
      const rows: ReportRow[] = [];
      for (const [category, list] of [...categories.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        rows.push(groupRow({ item: category }));
        for (const i of list) rows.push(row({ item: `${i.stockCode} ${i.description}`, qty: i.quantityOnHand, cost: unitValue(i), value: round2(i.quantityOnHand * unitValue(i)) }, { level: 1 }));
        rows.push(subtotalRow({ item: `Total ${category}`, value: sum(list, (i) => i.quantityOnHand * unitValue(i)) }));
      }
      const total = sum(items, (i) => i.quantityOnHand * unitValue(i));
      rows.push(totalRow({ item: "Total stock value", value: total }));
      const inventoryAccounts = accounts.filter((a) => a.accountType === "Asset" && /inventor|stock/i.test(a.description));
      const gl = sum(tb.filter((r) => inventoryAccounts.some((a) => a.id === r.accountId)), (r) => r.totalDebit - r.totalCredit);
      const checks: ReconciliationCheck[] = inventoryAccounts.length ? [check("Stock valuation agrees with the inventory GL accounts", gl, total, "A difference means stock movements that have not been posted, or postings to the inventory accounts from outside the stock module.")] : [];
      return {
        subtitle: `Current position · ${formatDate(ctx.today)}`,
        summary: [summaryMoney("Stock Value", total), ...(inventoryAccounts.length ? [summaryMoney("Inventory per GL", gl)] : [])],
        sections: [section([col("item", "Item"), col("qty", "On Hand", "number"), col("cost", "Average Cost", "money"), col("value", "Value", "money")], rows, undefined, "No stock items.")],
        checks,
        notices: [inventoryAccounts.length ? `Inventory accounts (by name): ${inventoryAccounts.map((a) => `${a.accountCode} ${a.description}`).join(", ")}.` : "No inventory account exists in the Chart of Accounts to reconcile against."],
      };
    },
  },
  {
    id: "stock-movements",
    title: "Stock Movements",
    description: "Every approved or posted stock movement in the period — receipts, issues, returns, adjustments, transfers and write-offs.",
    categories: ["inventory"],
    filters: [...F.period, F.product],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const productId = numberFilter(ctx.filters.product);
      const [transactions, items] = await Promise.all([ctx.source.inventoryTransactions(), ctx.source.stockItems()]);
      const byId = new Map(items.map((i) => [i.id, i]));
      const lines = transactions
        .filter((t) => EFFECTIVE_STATUSES.has(t.status) && inRange(t.transactionDate, dateFrom, dateTo))
        .flatMap((t) => t.lines.filter((l) => productId === null || l.stockItemId === productId).map((l) => ({ t, l, dir: direction(t) })))
        .sort((a, b) => (a.t.transactionDate < b.t.transactionDate ? -1 : a.t.transactionDate > b.t.transactionDate ? 1 : a.t.id - b.t.id));
      const signed = (dir: string, qty: number) => (dir === "Out" ? -qty : dir === "In" ? qty : 0);
      const rows = lines.map(({ t, l, dir }) => {
        const item = byId.get(l.stockItemId);
        return row({ date: t.transactionDate, number: t.transactionNumber, type: t.transactionType, item: item ? `${item.stockCode} ${item.description}` : `Item #${l.stockItemId}`, direction: dir, qty: dir === "Out" ? -l.quantity : l.quantity, unitCost: l.unitCost || null, value: l.unitCost ? round2(signed(dir, l.quantity) * l.unitCost) : null, status: t.status });
      });
      rows.push(totalRow({ number: `${lines.length} lines`, qty: round2(sum(lines, ({ l, dir }) => signed(dir, l.quantity))) }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Movements", lines.length), summaryCount("Units in", round2(sum(lines.filter((x) => x.dir === "In"), (x) => x.l.quantity))), summaryCount("Units out", round2(sum(lines.filter((x) => x.dir === "Out"), (x) => x.l.quantity)))],
        sections: [section([col("date", "Date", "date"), col("number", "Number"), col("type", "Type", "badge"), col("item", "Item"), col("direction", "Direction", "badge"), col("qty", "Quantity", "number"), col("unitCost", "Unit Cost", "money"), col("value", "Value", "money"), col("status", "Status", "badge")], rows, undefined, "No stock movements in this period.")],
        checks: [],
        notices: ["Transfers move stock between warehouses and don't change the company's total quantity. Issues are costed from stock layers when approved, so the unit cost shown for them is the cost recorded on the line, where one was recorded."],
      };
    },
  },
];
