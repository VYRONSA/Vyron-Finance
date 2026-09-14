/**
 * VAT & Tax reporting — built only from real VAT records: posted Sales
 * Invoices/Credit Notes, posted Supplier Bills/Credit Notes, VAT split
 * out of directly GL-allocated bank transactions at posting time,
 * approved VAT adjustments, VAT returns, and the VAT accounts in the
 * General Ledger. Nothing is estimated; a document with no VAT code is
 * reported as such, never assigned one.
 *
 * VAT sources are reconciled to the GL direction by direction:
 *   Output VAT per GL = VAT Output (credit − debit) + VAT Control credits
 *   Input VAT per GL  = VAT Input (debit − credit) + VAT Control debits
 * excluding VAT-return settlement and VAT-payment journals, which move
 * balances between accounts rather than create VAT.
 */

import { buildVatDocuments } from "@/server/services/vat-transaction-service";
import { buildVat201Summary } from "@/server/vat/vat-201-engine";
import type { GlTransactionWithContext } from "@/server/general-ledger/types";
import type { BankTransactionRecord } from "@/server/accounting/types";
import { isPostedBill } from "../party-ledger";
import type { VatAccountRef } from "../source";
import {
  col,
  dayBefore,
  drill,
  F,
  groupRow,
  periodLabel,
  row,
  section,
  subtotalRow,
  summaryCount,
  summaryMoney,
  totalRow,
  type ReportContext,
  type ReportDefinition,
} from "../kit";
import { check, inRange, round2, sum, type DocumentType, type DrillTarget, type ReportRow } from "../types";
import { naturalBalance, sourceLabel } from "./shared";

type Direction = "Output" | "Input";

export type VatItem = {
  direction: Direction;
  date: string;
  source: string;
  reference: string;
  party: string;
  vatCode: string;
  net: number;
  vat: number;
  gross: number;
  glAccount: string | null;
  drill: DrillTarget;
  docType: DocumentType | null;
  docId: number | null;
  bank: BankTransactionRecord | null;
};

const SETTLEMENT_SOURCES = new Set(["vat_return", "vat_payment"]);

/** Is VAT split out of this bank transaction when it posts? Mirrors
 * `journal-service.ts::buildJournalLinesForTransaction`: only a direct
 * GL allocation (not a customer/supplier settlement) whose VAT is below
 * the gross amount. */
export function bankVatAmount(t: BankTransactionRecord): number {
  if (t.isSplit || t.allocationType === "S" || t.allocationType === "C") return 0;
  const gross = t.debit > 0 ? t.debit : t.credit;
  const vat = Math.abs(t.vat ?? 0);
  return vat > 0 && vat < gross ? round2(vat) : 0;
}

/** Every VAT-bearing item in the period, from documents and posted bank
 * transactions. */
export async function loadVatItems(ctx: ReportContext, from: string, to: string): Promise<VatItem[]> {
  const [invoices, bills, customers, suppliers, treatments, bank] = await Promise.all([
    ctx.source.salesInvoices(),
    ctx.source.bills(),
    ctx.source.customers(),
    ctx.source.suppliers(),
    ctx.source.vatTreatments(),
    ctx.source.bankTransactions({ from, to }),
  ]);
  const postedInvoices = invoices.filter((i) => i.status === "Posted" && inRange(i.invoiceDate, from, to));
  const postedBills = bills.filter((b) => isPostedBill(b) && inRange(b.invoiceDate, from, to));
  const documents = buildVatDocuments(postedInvoices, postedBills, customers, suppliers, treatments);
  const invoiceById = new Map(postedInvoices.map((i) => [i.id, i]));
  const billById = new Map(postedBills.map((b) => [b.id, b]));
  const items: VatItem[] = documents.map((d) => {
    const isCustomer = d.documentType.startsWith("Customer");
    const sign = d.documentType.endsWith("Credit Note") ? -1 : 1;
    const docType: DocumentType = isCustomer ? "sales-invoice" : "purchase-bill";
    return {
      direction: isCustomer ? "Output" : "Input",
      date: d.date,
      source: d.documentType,
      reference: isCustomer ? invoiceById.get(d.id)?.invoiceNumber ?? `#${d.id}` : billById.get(d.id)?.invoiceNumber ?? `#${d.id}`,
      party: d.partyName,
      vatCode: d.vatTreatmentCode,
      net: round2(sign * (d.grossAmount - d.vatAmount)),
      vat: round2(sign * d.vatAmount),
      gross: round2(sign * d.grossAmount),
      glAccount: isCustomer ? null : billById.get(d.id)?.glAccount ?? null,
      drill: drill.document(docType, d.id),
      docType,
      docId: d.id,
      bank: null,
    };
  });
  for (const t of bank.items) {
    if (!t.postedFlag || !t.transactionDate) continue;
    const vat = bankVatAmount(t);
    if (vat === 0) continue;
    const gross = t.debit > 0 ? t.debit : t.credit;
    items.push({
      direction: t.debit > 0 ? "Input" : "Output",
      date: t.transactionDate,
      source: t.debit > 0 ? "Bank Payment" : "Bank Receipt",
      reference: t.reference || t.description,
      party: t.beneficiary || t.description,
      vatCode: t.suggestedVatCode ?? "",
      net: round2(gross - vat),
      vat,
      gross,
      glAccount: t.suggestedGlAccount,
      drill: drill.bank(t.id),
      docType: null,
      docId: null,
      bank: t,
    });
  }
  return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Approved VAT adjustments in the period, signed per direction. */
async function loadAdjustments(ctx: ReportContext, from: string, to: string) {
  const adjustments = (await ctx.source.vatAdjustments()).filter((a) => a.status === "Approved" && inRange(a.adjustmentDate, from, to));
  return adjustments.map((a) => ({ ...a, directionOf: (a.targetAccount === "VATOutput" ? "Output" : "Input") as Direction, signed: round2(a.direction === "Increase" ? a.amount : -a.amount) }));
}

type VatGl = { account: VatAccountRef; lines: GlTransactionWithContext[]; truncated: boolean };

async function loadVatGl(ctx: ReportContext, from: string, to: string): Promise<VatGl[]> {
  const accounts = (await ctx.source.controlAccounts()).vat;
  return Promise.all(
    accounts.map(async (account) => {
      const gl = await ctx.source.glTransactions({ from, to, accountId: account.accountId });
      return { account, lines: gl.items, truncated: gl.truncated };
    }),
  );
}

/** Output and input VAT per the GL, excluding settlement journals. */
function glVatByDirection(gl: VatGl[]): { output: number; input: number } {
  let output = 0;
  let input = 0;
  for (const { account, lines } of gl) {
    for (const t of lines) {
      if (SETTLEMENT_SOURCES.has(t.sourceType)) continue;
      if (account.role === "Output") output += t.credit - t.debit;
      else if (account.role === "Input") input += t.debit - t.credit;
      else {
        output += t.credit;
        input += t.debit;
      }
    }
  }
  return { output: round2(output), input: round2(input) };
}

function vatTotals(items: VatItem[], adjustments: Awaited<ReturnType<typeof loadAdjustments>>, direction: Direction) {
  const own = items.filter((i) => i.direction === direction);
  return {
    documents: sum(own.filter((i) => !i.bank), (i) => i.vat),
    bank: sum(own.filter((i) => i.bank), (i) => i.vat),
    adjustments: sum(adjustments.filter((a) => a.directionOf === direction), (a) => a.signed),
  };
}

const DETAIL_COLUMNS = [
  col("date", "Date", "date"),
  col("direction", "Direction", "badge"),
  col("source", "Source"),
  col("reference", "Reference"),
  col("party", "Party"),
  col("vatCode", "VAT Code"),
  col("net", "Net", "money"),
  col("vat", "VAT", "money"),
  col("gross", "Gross", "money"),
];

function detailReport(id: string, title: string, description: string, direction: Direction | null): ReportDefinition {
  return {
    id,
    title,
    description,
    categories: ["vat"],
    filters: [...F.period, F.vatCode],
    async build(ctx) {
      const { dateFrom, dateTo, vatCode } = ctx.filters;
      const items = (await loadVatItems(ctx, dateFrom, dateTo)).filter((i) => (direction === null || i.direction === direction) && (!vatCode || i.vatCode === vatCode));
      const rows: ReportRow[] = items.map((i) => row({ date: i.date, direction: i.direction, source: i.source, reference: i.reference, party: i.party, vatCode: i.vatCode || "No VAT code", net: i.net, vat: i.vat, gross: i.gross }, { drill: i.drill }));
      for (const d of direction ? [direction] : (["Output", "Input"] as Direction[])) {
        const own = items.filter((i) => i.direction === d);
        rows.push(subtotalRow({ source: `Total ${d} VAT`, net: sum(own, (i) => i.net), vat: sum(own, (i) => i.vat), gross: sum(own, (i) => i.gross) }));
      }
      const output = sum(items.filter((i) => i.direction === "Output"), (i) => i.vat);
      const input = sum(items.filter((i) => i.direction === "Input"), (i) => i.vat);
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [
          ...(direction !== "Input" ? [summaryMoney("Output VAT", output)] : []),
          ...(direction !== "Output" ? [summaryMoney("Input VAT", input)] : []),
          ...(direction === null ? [summaryMoney("Net VAT", round2(output - input))] : []),
          summaryCount("Items", items.length),
        ],
        sections: [section(DETAIL_COLUMNS, rows, undefined, "No VAT-bearing transactions in this period.")],
        checks: [check("Net + VAT = Gross", sum(items, (i) => i.gross), round2(sum(items, (i) => i.net) + sum(items, (i) => i.vat)))],
        notices: ["Documents are posted Sales and Purchasing documents; bank rows are posted bank transactions whose VAT was split out at posting (direct GL allocations only). Credit notes are negative."],
      };
    },
  };
}

export const VAT_REPORTS: ReportDefinition[] = [
  {
    id: "vat-summary",
    title: "VAT Summary",
    description: "Output and input VAT for the period by VAT category and source, the net VAT position, and the same figures per the General Ledger.",
    categories: ["vat", "management"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [items, adjustments, gl, invoices, bills, customers, suppliers, treatments] = await Promise.all([
        loadVatItems(ctx, dateFrom, dateTo),
        loadAdjustments(ctx, dateFrom, dateTo),
        loadVatGl(ctx, dateFrom, dateTo),
        ctx.source.salesInvoices(),
        ctx.source.bills(),
        ctx.source.customers(),
        ctx.source.suppliers(),
        ctx.source.vatTreatments(),
      ]);
      const docs = buildVatDocuments(invoices.filter((i) => i.status === "Posted"), bills.filter(isPostedBill), customers, suppliers, treatments);
      const vat201 = buildVat201Summary(docs, dateFrom, dateTo);
      const out = vatTotals(items, adjustments, "Output");
      const inp = vatTotals(items, adjustments, "Input");
      const rows: ReportRow[] = [];
      const block = (label: string, categories: typeof vat201.outputs, bankVat: number, adjustmentVat: number, direction: Direction) => {
        rows.push(groupRow({ label }));
        for (const c of categories) rows.push(row({ label: c.category, count: c.documentCount, net: c.netValue, vat: c.vatValue }, { level: 1, drill: drill.report(direction === "Output" ? "output-vat" : "input-vat", { dateFrom, dateTo }) }));
        const bankItems = items.filter((i) => i.bank && i.direction === direction);
        if (bankItems.length) rows.push(row({ label: `Bank ${direction === "Output" ? "receipts" : "payments"} with VAT`, count: bankItems.length, net: sum(bankItems, (i) => i.net), vat: bankVat }, { level: 1, drill: drill.report(direction === "Output" ? "output-vat" : "input-vat", { dateFrom, dateTo }) }));
        if (adjustmentVat !== 0) rows.push(row({ label: "VAT adjustments", vat: adjustmentVat }, { level: 1, drill: drill.report("vat-audit", { dateFrom, dateTo }) }));
        rows.push(subtotalRow({ label: `Total ${direction} VAT`, vat: round2((direction === "Output" ? out.documents : inp.documents) + bankVat + adjustmentVat) }));
      };
      block("Output VAT — Sales", vat201.outputs, out.bank, out.adjustments, "Output");
      block("Input VAT — Purchases", vat201.inputs, inp.bank, inp.adjustments, "Input");
      const totalOut = round2(out.documents + out.bank + out.adjustments);
      const totalIn = round2(inp.documents + inp.bank + inp.adjustments);
      rows.push(totalRow({ label: totalOut - totalIn >= 0 ? "Net VAT payable" : "Net VAT refundable", vat: round2(totalOut - totalIn) }));

      const glRows: ReportRow[] = gl.map(({ account, lines }) => {
        const own = lines.filter((t) => !SETTLEMENT_SOURCES.has(t.sourceType));
        return row({ account: `${account.accountCode} ${account.description}`, role: account.role, debits: sum(own, (t) => t.debit), credits: sum(own, (t) => t.credit) }, { drill: drill.report("vat-control-account", { dateFrom, dateTo }) });
      });
      const glVat = glVatByDirection(gl);
      glRows.push(totalRow({ account: "VAT per General Ledger", role: `Output ${glVat.output.toFixed(2)} · Input ${glVat.input.toFixed(2)}`, debits: null, credits: null }));

      const truncated = gl.some((g) => g.truncated);
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Output VAT", totalOut), summaryMoney("Input VAT", totalIn), summaryMoney("Net VAT", round2(totalOut - totalIn))],
        sections: [
          section([col("label", ""), col("count", "Documents", "number"), col("net", "Net", "money"), col("vat", "VAT", "money")], rows, "By Source"),
          section([col("account", "VAT Account"), col("role", "Role"), col("debits", "Debits", "money"), col("credits", "Credits", "money")], glRows, "Per General Ledger (excluding VAT settlement and payment journals)", "No VAT accounts exist in the Chart of Accounts."),
        ],
        checks: gl.length
          ? [
              check("Output VAT from sources equals Output VAT per the GL", glVat.output, totalOut, "A difference usually means a document was posted to the ledger in a different period from its document date, or VAT was posted by a manual journal."),
              check("Input VAT from sources equals Input VAT per the GL", glVat.input, totalIn, "A difference usually means a document was posted in a different period from its date, or input VAT was posted by a manual journal."),
            ]
          : [],
        notices: [...(truncated ? ["The GL exceeded the report read limit; the GL comparison is incomplete."] : []), "VAT categories use each document's VAT treatment (the same classification as the VAT201 return)."],
      };
    },
  },
  detailReport("vat-detail", "VAT Detail", "Every VAT-bearing document and bank transaction in the period with net, VAT and gross.", null),
  detailReport("output-vat", "Output VAT", "VAT charged on sales — posted invoices, credit notes and bank receipts with VAT.", "Output"),
  detailReport("input-vat", "Input VAT", "VAT claimed on purchases — posted bills, supplier credit notes and bank payments with VAT.", "Input"),
  {
    id: "vat-transaction-detail",
    title: "VAT Transaction Detail",
    description: "Every posting to the VAT accounts in the General Ledger, drillable to its journal and source.",
    categories: ["vat", "audit"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const gl = await loadVatGl(ctx, dateFrom, dateTo);
      const lines = gl.flatMap(({ account, lines }) => lines.map((t) => ({ account, t }))).sort((a, b) => (a.t.postingDate < b.t.postingDate ? -1 : a.t.postingDate > b.t.postingDate ? 1 : a.t.id - b.t.id));
      const rows = lines.map(({ account, t }) =>
        row({ date: t.postingDate, account: `${account.accountCode} ${account.role}`, journal: t.journalNumber, source: sourceLabel(t.sourceType), reference: t.reference, description: t.description, debit: t.debit || null, credit: t.credit || null }, { drill: drill.journal(t.journalId) }),
      );
      rows.push(totalRow({ description: `${lines.length} postings`, debit: sum(lines, (l) => l.t.debit), credit: sum(lines, (l) => l.t.credit) }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Postings", lines.length), summaryMoney("Debits", sum(lines, (l) => l.t.debit)), summaryMoney("Credits", sum(lines, (l) => l.t.credit))],
        sections: [section([col("date", "Date", "date"), col("account", "VAT Account"), col("journal", "Journal"), col("source", "Source", "badge"), col("reference", "Reference"), col("description", "Description"), col("debit", "Debit", "money"), col("credit", "Credit", "money")], rows, undefined, "No postings to the VAT accounts in this period.")],
        checks: [],
        notices: [`VAT accounts: ${gl.map((g) => `${g.account.accountCode} (${g.account.role})`).join(", ") || "none in the Chart of Accounts"}.`],
      };
    },
  },
  {
    id: "vat-by-account",
    title: "VAT by Account",
    description: "VAT analysed by the GL account of the underlying income or expense.",
    categories: ["vat"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [items, billLines, invoices, accounts] = await Promise.all([loadVatItems(ctx, dateFrom, dateTo), ctx.source.billLines(), ctx.source.salesInvoices(), ctx.source.accounts()]);
      const accountName = new Map(accounts.map((a) => [a.accountCode, a.description]));
      const linesByBill = new Map<number, typeof billLines>();
      for (const l of billLines) linesByBill.set(l.billId, [...(linesByBill.get(l.billId) ?? []), l]);
      const invoiceById = new Map(invoices.map((i) => [i.id, i]));
      const buckets = new Map<string, { direction: Direction; code: string; net: number; vat: number }>();
      const add = (direction: Direction, code: string, net: number, vat: number) => {
        const key = `${direction}|${code}`;
        const b = buckets.get(key) ?? { direction, code, net: 0, vat: 0 };
        b.net = round2(b.net + net);
        b.vat = round2(b.vat + vat);
        buckets.set(key, b);
      };
      for (const item of items) {
        const sign = item.vat < 0 || item.gross < 0 ? -1 : 1;
        if (item.docType === "purchase-bill" && item.docId !== null && linesByBill.has(item.docId)) {
          for (const l of linesByBill.get(item.docId)!) add("Input", l.glAccount || "Unassigned", sign * l.netAmount, sign * l.vatAmount);
        } else if (item.docType === "sales-invoice" && item.docId !== null) {
          const inv = invoiceById.get(item.docId);
          const lines = inv?.lines ?? [];
          const base = lines.reduce((s, l) => s + (l.netAmount || l.lineTotal), 0);
          if (!inv || lines.length === 0 || base === 0) add("Output", "Sales (default revenue account)", item.net, item.vat);
          else for (const l of lines) {
            const share = (l.netAmount || l.lineTotal) / base;
            add("Output", l.glAccount || "Sales (default revenue account)", round2(item.net * share), round2(item.vat * share));
          }
        } else {
          add(item.direction, item.glAccount || "Unassigned", item.net, item.vat);
        }
      }
      const rows: ReportRow[] = [];
      for (const direction of ["Output", "Input"] as Direction[]) {
        const own = [...buckets.values()].filter((b) => b.direction === direction).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
        if (!own.length) continue;
        rows.push(groupRow({ account: `${direction} VAT` }));
        for (const b of own) rows.push(row({ account: accountName.has(b.code) ? `${b.code} ${accountName.get(b.code)}` : b.code, net: b.net, vat: b.vat }, { level: 1 }));
        rows.push(subtotalRow({ account: `Total ${direction} VAT`, net: sum(own, (b) => b.net), vat: sum(own, (b) => b.vat) }));
      }
      const attributed = sum([...buckets.values()], (b) => (b.direction === "Output" ? b.vat : -b.vat));
      const expected = sum(items, (i) => (i.direction === "Output" ? i.vat : -i.vat));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Output VAT", sum(items.filter((i) => i.direction === "Output"), (i) => i.vat)), summaryMoney("Input VAT", sum(items.filter((i) => i.direction === "Input"), (i) => i.vat))],
        sections: [section([col("account", "GL Account"), col("net", "Net", "money"), col("vat", "VAT", "money")], rows, undefined, "No VAT-bearing transactions in this period.")],
        checks: [check("VAT by account adds up to total VAT", expected, attributed)],
        notices: ["Bills use their line GL accounts where captured, otherwise the bill's header account. Invoice VAT is spread across invoice lines in proportion to their net amounts; lines with no GL account post to the sales posting rule's default revenue account."],
      };
    },
  },
  {
    id: "vat-reconciliation",
    title: "VAT Reconciliation",
    description: "VAT from source documents and bank transactions reconciled to the VAT accounts, and each VAT return compared with its period's figures.",
    categories: ["vat", "audit"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [items, adjustments, gl, returns] = await Promise.all([loadVatItems(ctx, dateFrom, dateTo), loadAdjustments(ctx, dateFrom, dateTo), loadVatGl(ctx, dateFrom, dateTo), ctx.source.vatReturns()]);
      const out = vatTotals(items, adjustments, "Output");
      const inp = vatTotals(items, adjustments, "Input");
      const glVat = glVatByDirection(gl);
      const recon = (direction: Direction, t: typeof out, glValue: number): ReportRow[] => {
        const total = round2(t.documents + t.bank + t.adjustments);
        return [
          groupRow({ label: `${direction} VAT` }),
          row({ label: "Posted documents", amount: t.documents }, { level: 1, drill: drill.report(direction === "Output" ? "output-vat" : "input-vat", { dateFrom, dateTo }) }),
          row({ label: "Posted bank transactions (VAT split at posting)", amount: t.bank }, { level: 1 }),
          row({ label: "Approved VAT adjustments", amount: t.adjustments }, { level: 1 }),
          subtotalRow({ label: `${direction} VAT from sources`, amount: total }),
          row({ label: `${direction} VAT per the General Ledger`, amount: glValue }, { level: 1, drill: drill.report("vat-transaction-detail", { dateFrom, dateTo }) }),
          subtotalRow({ label: "Difference", amount: round2(total - glValue) }),
        ];
      };
      const rows = [...recon("Output", out, glVat.output), ...recon("Input", inp, glVat.input)];

      const overlapping = returns.filter((r) => r.periodEnd >= dateFrom && r.periodStart <= dateTo);
      const returnRows: ReportRow[] = [];
      for (const r of overlapping) {
        const rItems = await loadVatItems(ctx, r.periodStart, r.periodEnd);
        const rAdj = await loadAdjustments(ctx, r.periodStart, r.periodEnd);
        const o = vatTotals(rItems, rAdj, "Output");
        const i = vatTotals(rItems, rAdj, "Input");
        const recalcNet = round2(o.documents + o.bank + o.adjustments - (i.documents + i.bank + i.adjustments));
        returnRows.push(row({ period: `${r.periodStart} – ${r.periodEnd}`, status: r.status, returnOutput: r.totalOutputVat, returnInput: r.totalInputVat, returnNet: r.netPayable, current: recalcNet, difference: round2(recalcNet - r.netPayable) }, { drill: drill.report("vat-summary", { dateFrom: r.periodStart, dateTo: r.periodEnd }) }));
      }
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryMoney("Output difference", round2(out.documents + out.bank + out.adjustments - glVat.output)), summaryMoney("Input difference", round2(inp.documents + inp.bank + inp.adjustments - glVat.input)), summaryCount("VAT returns in period", overlapping.length)],
        sections: [
          section([col("label", ""), col("amount", "Amount", "money")], rows, "Sources vs General Ledger"),
          section([col("period", "Return Period"), col("status", "Status", "badge"), col("returnOutput", "Return Output", "money"), col("returnInput", "Return Input", "money"), col("returnNet", "Return Net", "money"), col("current", "Net from Current Records", "money"), col("difference", "Difference", "money")], returnRows, "VAT Returns", "No VAT returns overlap this period."),
        ],
        checks: gl.length ? [check("Output VAT reconciles to the GL", glVat.output, round2(out.documents + out.bank + out.adjustments)), check("Input VAT reconciles to the GL", glVat.input, round2(inp.documents + inp.bank + inp.adjustments))] : [],
        notices: ["A return is a snapshot taken when it was generated; a difference against current records means documents in that period changed afterwards."],
      };
    },
  },
  {
    id: "vat-control-account",
    title: "VAT Control Account",
    description: "Opening balance, every posting and closing balance of each VAT account, including settlements and VAT payments.",
    categories: ["vat", "general-ledger"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [gl, start, end, accounts] = await Promise.all([loadVatGl(ctx, dateFrom, dateTo), ctx.source.trialBalance(dayBefore(dateFrom)), ctx.source.trialBalance(dateTo), ctx.source.accounts()]);
      const rows: ReportRow[] = [];
      const checks = [];
      for (const { account, lines } of gl) {
        const coa = accounts.find((a) => a.id === account.accountId);
        const normal = coa?.normalBalance ?? "Credit";
        const s = start.find((r) => r.accountId === account.accountId);
        const e = end.find((r) => r.accountId === account.accountId);
        let balance = naturalBalance(normal, s?.totalDebit ?? 0, s?.totalCredit ?? 0);
        rows.push(groupRow({ date: account.accountCode, journal: `${account.description} (${account.role})` }));
        rows.push(row({ description: "Opening balance", balance }, { level: 1 }));
        for (const t of lines) {
          balance = round2(balance + (normal === "Debit" ? t.debit - t.credit : t.credit - t.debit));
          rows.push(row({ date: t.postingDate, journal: t.journalNumber, source: sourceLabel(t.sourceType), description: t.description, debit: t.debit || null, credit: t.credit || null, balance }, { level: 1, drill: drill.journal(t.journalId) }));
        }
        rows.push(subtotalRow({ description: `Closing balance — ${account.accountCode}`, balance }));
        checks.push(check(`${account.accountCode} closing balance agrees with the Trial Balance`, naturalBalance(normal, e?.totalDebit ?? 0, e?.totalCredit ?? 0), balance));
      }
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: gl.map((g) => summaryCount(`${g.account.accountCode} postings`, g.lines.length)),
        sections: [section([col("date", "Date", "date"), col("journal", "Journal"), col("source", "Source", "badge"), col("description", "Description"), col("debit", "Debit", "money"), col("credit", "Credit", "money"), col("balance", "Balance", "money")], rows, undefined, "No VAT accounts exist in the Chart of Accounts.")],
        checks,
        notices: ["Balances are shown on each account's normal side."],
      };
    },
  },
  {
    id: "vat-period-summary",
    title: "VAT Period Summary",
    description: "Every VAT return with its output, input, net and status, compared with the General Ledger for the same period.",
    categories: ["vat"],
    filters: [],
    async build(ctx) {
      const returns = [...(await ctx.source.vatReturns())].sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
      const rows: ReportRow[] = [];
      for (const r of returns) {
        const glVat = glVatByDirection(await loadVatGl(ctx, r.periodStart, r.periodEnd));
        rows.push(
          row(
            { period: `${r.periodStart} – ${r.periodEnd}`, status: r.status, output: r.totalOutputVat, input: r.totalInputVat, broughtForward: r.broughtForward, net: r.netPayable, glNet: round2(glVat.output - glVat.input), submitted: r.submittedAt ? r.submittedAt.slice(0, 10) : "", reference: r.sarsReference ?? "" },
            { drill: drill.report("vat-summary", { dateFrom: r.periodStart, dateTo: r.periodEnd }) },
          ),
        );
      }
      return {
        subtitle: `${returns.length} VAT returns`,
        summary: [summaryCount("Returns", returns.length), summaryCount("Submitted", returns.filter((r) => r.status === "Submitted").length)],
        sections: [section([col("period", "Period"), col("status", "Status", "badge"), col("output", "Output VAT", "money"), col("input", "Input VAT", "money"), col("broughtForward", "Brought Forward", "money"), col("net", "Net Payable", "money"), col("glNet", "Net per GL", "money"), col("submitted", "Submitted", "date"), col("reference", "SARS Reference")], rows, undefined, "No VAT returns have been generated.")],
        checks: [],
        notices: ["'Net per GL' is output less input VAT posted to the VAT accounts in the return's period, excluding settlement and payment journals."],
      };
    },
  },
  {
    id: "vat-audit",
    title: "VAT Audit Report",
    description: "VAT exceptions for review: missing VAT codes, VAT that doesn't match the treatment's rate, input VAT without a supplier VAT number, and every VAT adjustment.",
    categories: ["vat", "audit"],
    filters: [...F.period],
    async build(ctx) {
      const { dateFrom, dateTo } = ctx.filters;
      const [items, treatments, suppliers, bills, adjustments] = await Promise.all([loadVatItems(ctx, dateFrom, dateTo), ctx.source.vatTreatments(), ctx.source.suppliers(), ctx.source.bills(), ctx.source.vatAdjustments()]);
      const rateByCode = new Map(treatments.map((t) => [t.code, t.rate]));
      const supplierVat = new Map(suppliers.map((s) => [s.id, s.vatNumber]));
      const billById = new Map(bills.map((b) => [b.id, b]));
      const exceptions: ReportRow[] = [];
      for (const i of items) {
        const base = { date: i.date, source: i.source, reference: i.reference, party: i.party, vatCode: i.vatCode, net: i.net, vat: i.vat };
        if (!i.vatCode) exceptions.push(row({ ...base, issue: "No VAT code" }, { drill: i.drill }));
        const rate = rateByCode.get(i.vatCode);
        if (rate !== undefined && Math.abs(round2((i.net * rate) / 100) - i.vat) > 0.05) exceptions.push(row({ ...base, issue: `VAT differs from ${rate}% of net (expected ${round2((i.net * rate) / 100).toFixed(2)})` }, { drill: i.drill }));
        if (i.direction === "Input" && i.docType === "purchase-bill" && i.docId !== null && i.vat !== 0) {
          const supplierId = billById.get(i.docId)?.supplierId ?? null;
          if (supplierId === null || !supplierVat.get(supplierId)) exceptions.push(row({ ...base, issue: "Input VAT claimed without a supplier VAT number" }, { drill: i.drill }));
        }
      }
      const adjustmentRows = adjustments
        .filter((a) => inRange(a.adjustmentDate, dateFrom, dateTo))
        .map((a) => row({ date: a.adjustmentDate, target: a.targetAccount === "VATOutput" ? "Output" : "Input", direction: a.direction, amount: a.amount, reason: a.reason, status: a.status, by: a.createdBy, approvedBy: a.approvedBy ?? "" }));
      return {
        subtitle: periodLabel(dateFrom, dateTo),
        summary: [summaryCount("Exceptions", exceptions.length), summaryCount("VAT adjustments", adjustmentRows.length)],
        sections: [
          section([col("date", "Date", "date"), col("source", "Source"), col("reference", "Reference"), col("party", "Party"), col("vatCode", "VAT Code"), col("net", "Net", "money"), col("vat", "VAT", "money"), col("issue", "Issue")], exceptions, "Exceptions", "No VAT exceptions in this period."),
          section([col("date", "Date", "date"), col("target", "Account"), col("direction", "Direction", "badge"), col("amount", "Amount", "money"), col("reason", "Reason"), col("status", "Status", "badge"), col("by", "Captured By"), col("approvedBy", "Approved By")], adjustmentRows, "VAT Adjustments", "No VAT adjustments in this period."),
        ],
        checks: [],
        notices: ["Rate checks compare each item's VAT with its VAT treatment's rate, within 5 cents for rounding."],
      };
    },
  },
];
