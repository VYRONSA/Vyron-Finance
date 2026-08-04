/**
 * Service layer for the Chart of Accounts. `buildAccountTree` and the CSV
 * parsing/building functions are pure and unit-tested independently of
 * Supabase, matching this codebase's established rigor (e.g.
 * `journal-service.ts::buildJournalLinesForTransaction`,
 * `transaction-export.ts::transactionsToExportRows`).
 */

import * as repo from "@/server/repositories/chart-of-accounts-repository";
import { cleanText, isBlankRow, normalizeHeader, parseCsvText } from "@/server/import-centre/csv-utils";
import type { AccountType, ChartOfAccount, ChartOfAccountNode, NormalBalance } from "@/server/general-ledger/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const ACCOUNT_TYPES: AccountType[] = [
  "Asset",
  "Liability",
  "Equity",
  "Income",
  "Cost of Sales",
  "Expense",
  "Other Income",
  "Other Expense",
];

export const NORMAL_BALANCES: NormalBalance[] = ["Debit", "Credit"];

const ACCOUNT_CODE_RE = /^[A-Za-z0-9._-]+$/;

export function validateChartOfAccountInput(input: {
  accountCode: string;
  description: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
}) {
  if (!input.accountCode?.trim()) throw new ValidationError("Account Code is required.");
  if (!ACCOUNT_CODE_RE.test(input.accountCode.trim())) {
    throw new ValidationError("Account Code may only contain letters, numbers, dots, dashes, and underscores.");
  }
  if (!input.description?.trim()) throw new ValidationError("Description is required.");
  if (!ACCOUNT_TYPES.includes(input.accountType)) {
    throw new ValidationError(`Account Type must be one of: ${ACCOUNT_TYPES.join(", ")}.`);
  }
  if (!NORMAL_BALANCES.includes(input.normalBalance)) {
    throw new ValidationError("Normal Balance must be Debit or Credit.");
  }
}

/** True if setting `accountId`'s parent to `candidateParentId` would form a
 * cycle — i.e. `accountId` already appears somewhere in `candidateParentId`'s
 * own ancestor chain. Guards both `buildAccountTree` (silently demotes a
 * cyclic/orphaned link to a root) and `updateChartOfAccount` (rejects it). */
export function wouldCreateCycle(accounts: ChartOfAccount[], accountId: number, candidateParentId: number): boolean {
  if (accountId === candidateParentId) return true;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const visited = new Set<number>();
  let current: number | null = candidateParentId;
  while (current !== null && !visited.has(current)) {
    if (current === accountId) return true;
    visited.add(current);
    current = byId.get(current)?.parentAccountId ?? null;
  }
  return false;
}

/** Assembles a flat account list into a tree via `parentAccountId`. Orphaned
 * parents (pointing at a non-existent, or — defensively — a cyclic, id) fall
 * back to the root level rather than being dropped, so a bad row never
 * hides an account from the tree view. Children are sorted by account code
 * at every level, independent of input order. */
export function buildAccountTree(accounts: ChartOfAccount[]): ChartOfAccountNode[] {
  const byId = new Map<number, ChartOfAccountNode>();
  for (const account of accounts) byId.set(account.id, { ...account, children: [] });

  const roots: ChartOfAccountNode[] = [];
  for (const account of accounts) {
    const node = byId.get(account.id)!;
    const parentId = account.parentAccountId;
    const parent = parentId !== null ? byId.get(parentId) : undefined;
    if (parent && !wouldCreateCycle(accounts, account.id, parentId!)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRecursive = (nodes: ChartOfAccountNode[]) => {
    nodes.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    for (const node of nodes) sortRecursive(node.children);
  };
  sortRecursive(roots);

  return roots;
}

export const listChartOfAccounts = repo.listChartOfAccounts;
export const getChartOfAccount = repo.getChartOfAccount;

export async function createChartOfAccount(companyId: string, input: repo.NewChartOfAccount): Promise<ChartOfAccount> {
  validateChartOfAccountInput(input);
  return repo.createChartOfAccount(companyId, { ...input, accountCode: input.accountCode.trim(), description: input.description.trim() });
}

export type EditChartOfAccountRequest = Partial<{
  description: string;
  accountType: AccountType;
  category: string;
  normalBalance: NormalBalance;
  parentAccountId: number | null;
  reportingGroup: string;
  financialStatementGroup: string;
  taxTreatment: string;
  branchId: number | null;
  departmentId: number | null;
  costCentreId: number | null;
  projectId: number | null;
  isControlAccount: boolean;
  notes: string;
}>;

export async function updateChartOfAccount(companyId: string, accountId: number, input: EditChartOfAccountRequest): Promise<ChartOfAccount> {
  if (input.description !== undefined && !input.description.trim()) throw new ValidationError("Description cannot be empty.");
  if (input.accountType !== undefined && !ACCOUNT_TYPES.includes(input.accountType)) {
    throw new ValidationError(`Account Type must be one of: ${ACCOUNT_TYPES.join(", ")}.`);
  }
  if (input.normalBalance !== undefined && !NORMAL_BALANCES.includes(input.normalBalance)) {
    throw new ValidationError("Normal Balance must be Debit or Credit.");
  }
  if (input.parentAccountId !== undefined && input.parentAccountId !== null) {
    const accounts = await repo.listChartOfAccounts(companyId);
    if (!accounts.some((a) => a.id === input.parentAccountId)) throw new ValidationError("Parent account not found.");
    if (wouldCreateCycle(accounts, accountId, input.parentAccountId)) {
      throw new ValidationError("That would create a circular parent chain.");
    }
  }

  return repo.updateChartOfAccount(companyId, accountId, {
    ...(input.description !== undefined && { description: input.description.trim() }),
    ...(input.accountType !== undefined && { account_type: input.accountType }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.normalBalance !== undefined && { normal_balance: input.normalBalance }),
    ...(input.parentAccountId !== undefined && { parent_account_id: input.parentAccountId }),
    ...(input.reportingGroup !== undefined && { reporting_group: input.reportingGroup }),
    ...(input.financialStatementGroup !== undefined && { financial_statement_group: input.financialStatementGroup }),
    ...(input.taxTreatment !== undefined && { tax_treatment: input.taxTreatment }),
    ...(input.branchId !== undefined && { branch_id: input.branchId }),
    ...(input.departmentId !== undefined && { department_id: input.departmentId }),
    ...(input.costCentreId !== undefined && { cost_centre_id: input.costCentreId }),
    ...(input.projectId !== undefined && { project_id: input.projectId }),
    ...(input.isControlAccount !== undefined && { is_control_account: input.isControlAccount }),
    ...(input.notes !== undefined && { notes: input.notes }),
  });
}

export async function setChartOfAccountActive(companyId: string, accountId: number, isActive: boolean): Promise<ChartOfAccount> {
  return repo.setChartOfAccountActive(companyId, accountId, isActive);
}

export async function duplicateChartOfAccount(companyId: string, accountId: number, newAccountCode: string): Promise<ChartOfAccount> {
  const source = await repo.getChartOfAccount(companyId, accountId);
  if (!source) throw new NotFoundError(`No account with id ${accountId}.`);
  validateChartOfAccountInput({
    accountCode: newAccountCode,
    description: source.description,
    accountType: source.accountType,
    normalBalance: source.normalBalance,
  });
  return repo.createChartOfAccount(companyId, {
    accountCode: newAccountCode.trim(),
    description: source.description,
    accountType: source.accountType,
    category: source.category,
    normalBalance: source.normalBalance,
    parentAccountId: source.parentAccountId,
    reportingGroup: source.reportingGroup,
    financialStatementGroup: source.financialStatementGroup,
    taxTreatment: source.taxTreatment,
    isControlAccount: source.isControlAccount,
    notes: source.notes,
  });
}

// ---------------------------------------------------------------------
// CSV export / import — same hand-rolled approach as Import Centre
// (`import-centre/csv-utils.ts`), no new dependency.
// ---------------------------------------------------------------------

const CSV_HEADERS = [
  "Account Code",
  "Description",
  "Account Type",
  "Category",
  "Normal Balance",
  "Parent Account",
  "Reporting Group",
  "Financial Statement Group",
  "Tax Treatment",
  "Control Account",
  "Active",
  "Notes",
];

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildChartOfAccountsCsv(accounts: ChartOfAccount[]): string {
  const codeById = new Map(accounts.map((a) => [a.id, a.accountCode]));
  const lines = [CSV_HEADERS.map(csvField).join(",")];

  for (const a of accounts) {
    lines.push(
      [
        a.accountCode,
        a.description,
        a.accountType,
        a.category,
        a.normalBalance,
        a.parentAccountId !== null ? (codeById.get(a.parentAccountId) ?? "") : "",
        a.reportingGroup,
        a.financialStatementGroup,
        a.taxTreatment,
        a.isControlAccount ? "Yes" : "No",
        a.isActive ? "Yes" : "No",
        a.notes,
      ]
        .map(csvField)
        .join(","),
    );
  }

  return lines.join("\r\n");
}

export type ChartOfAccountImportRow = {
  accountCode: string;
  description: string;
  accountType: AccountType;
  category: string;
  normalBalance: NormalBalance;
  parentAccountCode: string;
  reportingGroup: string;
  financialStatementGroup: string;
  taxTreatment: string;
  isControlAccount: boolean;
  notes: string;
};

/** Pure CSV parsing — validates each row independently and collects every
 * error rather than throwing on the first, so a caller can show the full
 * list of problems at once. */
export function parseChartOfAccountsCsv(csvText: string): { rows: ChartOfAccountImportRow[]; errors: string[] } {
  const table = parseCsvText(csvText).filter((row) => !isBlankRow(row));
  if (table.length === 0) return { rows: [], errors: ["The file is empty."] };

  const [headerRow, ...dataRows] = table;
  const headerIndex = new Map<string, number>();
  headerRow.forEach((h, i) => headerIndex.set(normalizeHeader(h), i));
  const col = (key: string) => headerIndex.get(key);
  const cell = (raw: string[], key: string) => {
    const idx = col(key);
    return idx !== undefined ? cleanText(raw[idx]) : "";
  };

  const idxCode = col("accountcode");
  const idxDescription = col("description");
  const idxType = col("accounttype");
  const idxBalance = col("normalbalance");
  if (idxCode === undefined || idxDescription === undefined || idxType === undefined || idxBalance === undefined) {
    return { rows: [], errors: ["Missing required columns: Account Code, Description, Account Type, Normal Balance."] };
  }

  const rows: ChartOfAccountImportRow[] = [];
  const errors: string[] = [];

  dataRows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const accountCode = cleanText(raw[idxCode]);
    const description = cleanText(raw[idxDescription]);
    const accountTypeRaw = cleanText(raw[idxType]);
    const normalBalanceRaw = cleanText(raw[idxBalance]);
    const accountType = ACCOUNT_TYPES.find((t) => t.toLowerCase() === accountTypeRaw.toLowerCase());
    const normalBalance = NORMAL_BALANCES.find((b) => b.toLowerCase() === normalBalanceRaw.toLowerCase());

    if (!accountCode) return void errors.push(`Row ${rowNumber}: Account Code is required.`);
    if (!description) return void errors.push(`Row ${rowNumber}: Description is required.`);
    if (!accountType) return void errors.push(`Row ${rowNumber}: Account Type "${accountTypeRaw}" is not valid.`);
    if (!normalBalance) return void errors.push(`Row ${rowNumber}: Normal Balance must be Debit or Credit.`);

    rows.push({
      accountCode,
      description,
      accountType,
      category: cell(raw, "category"),
      normalBalance,
      parentAccountCode: cell(raw, "parentaccount"),
      reportingGroup: cell(raw, "reportinggroup"),
      financialStatementGroup: cell(raw, "financialstatementgroup"),
      taxTreatment: cell(raw, "taxtreatment"),
      isControlAccount: /^(y|yes|true|1)$/i.test(cell(raw, "controlaccount")),
      notes: cell(raw, "notes"),
    });
  });

  return { rows, errors };
}

/** Orchestrates a CSV import: creates every valid row (flat, no parent
 * yet), then links parents by account code in a second pass so import
 * order never matters. Sequential, not batched — matches this being a
 * settings-scale bulk operation, not a 100,000-row ingestion path. */
export async function importChartOfAccountsCsv(companyId: string, csvText: string): Promise<{ created: ChartOfAccount[]; errors: string[] }> {
  const { rows, errors } = parseChartOfAccountsCsv(csvText);
  if (rows.length === 0) return { created: [], errors };

  const existing = await repo.listChartOfAccounts(companyId);
  const codeToId = new Map(existing.map((a) => [a.accountCode, a.id]));

  const created: ChartOfAccount[] = [];
  for (const row of rows) {
    try {
      const account = await repo.createChartOfAccount(companyId, {
        accountCode: row.accountCode,
        description: row.description,
        accountType: row.accountType,
        category: row.category,
        normalBalance: row.normalBalance,
        reportingGroup: row.reportingGroup,
        financialStatementGroup: row.financialStatementGroup,
        taxTreatment: row.taxTreatment,
        isControlAccount: row.isControlAccount,
        notes: row.notes,
      });
      codeToId.set(account.accountCode, account.id);
      created.push(account);
    } catch (err) {
      errors.push(`Account Code "${row.accountCode}": ${err instanceof Error ? err.message : "failed to import."}`);
    }
  }

  for (const row of rows) {
    if (!row.parentAccountCode) continue;
    const childId = codeToId.get(row.accountCode);
    const parentId = codeToId.get(row.parentAccountCode);
    if (!childId || !parentId || childId === parentId) continue;
    await repo.updateChartOfAccount(companyId, childId, { parent_account_id: parentId });
    const idx = created.findIndex((a) => a.id === childId);
    if (idx !== -1) created[idx] = { ...created[idx], parentAccountId: parentId };
  }

  return { created, errors };
}
