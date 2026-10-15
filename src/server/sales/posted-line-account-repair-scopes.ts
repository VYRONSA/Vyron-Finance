/**
 * Named, pinned scopes for the bulk Posted-invoice line-account repair
 * (`posted-line-account-repair-service.ts`). A scope is the EXACT list of
 * documents a migration correction is about — taken from the migration's
 * own mapping, never inferred from customer, date or amount — so a bulk
 * run cannot reach an unrelated invoice that merely looks similar.
 *
 * Every entry pins the invoice number, its database id and its journal,
 * and the figures it had when the scope was verified. The preflight
 * refuses the scope if any of them differs in the company's data now.
 */

export type PostedLineAccountRepairScopeEntry = {
  invoiceNumber: string;
  invoiceId: number;
  journalId: number;
  journalNumber: string;
  total: number;
  vatAmount: number;
  /** Lines on the invoice; every one had no account when pinned. */
  lines: number;
};

export type PostedLineAccountRepairScope = {
  id: string;
  label: string;
  companyId: string;
  description: string;
  expected: { invoices: number; lines: number; total: number; vatAmount: number; journals: number };
  entries: PostedLineAccountRepairScopeEntry[];
};

/** Handcrafted Food Products migration, Batch 1B: the 43 invoices of
 * `precisia-migration-v3/batch-1B-customer-invoices-name-matched/sales-invoices.csv`,
 * imported without line accounts and then approved and posted in the app
 * on 2026-10-15 (journals JR001348–JR001390). Ids and journals from the
 * read-only production snapshot of 2026-10-15 09:56 UTC; the 43 numbers
 * equal the v3 file's. `journals` is the company's journal count then. */
const HANDCRAFTED_BATCH_1B: PostedLineAccountRepairScope = {
  id: "handcrafted-batch-1b",
  label: "Handcrafted Food Products — Batch 1B",
  companyId: "45b3d2a0-3973-4587-a043-0e05d8d9bff3",
  description: "43 posted invoices imported without a revenue account (journals JR001348–JR001390).",
  expected: { invoices: 43, lines: 132, total: 101911.04, vatAmount: 13292.78, journals: 1390 },
  entries: [
    { invoiceNumber: "SI-53992644", invoiceId: 494, journalId: 1498, journalNumber: "JR001348", total: 755.55, vatAmount: 98.55, lines: 1 },
    { invoiceNumber: "SI-48587938", invoiceId: 493, journalId: 1499, journalNumber: "JR001349", total: 412.62, vatAmount: 53.82, lines: 2 },
    { invoiceNumber: "SI-48467292", invoiceId: 492, journalId: 1500, journalNumber: "JR001350", total: 149.5, vatAmount: 19.5, lines: 1 },
    { invoiceNumber: "SI-80371771", invoiceId: 491, journalId: 1501, journalNumber: "JR001351", total: 9052.8, vatAmount: 1180.8, lines: 4 },
    { invoiceNumber: "SI-59085418", invoiceId: 490, journalId: 1502, journalNumber: "JR001352", total: 37.71, vatAmount: 4.91, lines: 4 },
    { invoiceNumber: "SI-26034579", invoiceId: 489, journalId: 1503, journalNumber: "JR001353", total: 425.04, vatAmount: 55.44, lines: 1 },
    { invoiceNumber: "SI-25946936", invoiceId: 488, journalId: 1504, journalNumber: "JR001354", total: 3488.64, vatAmount: 455.04, lines: 6 },
    { invoiceNumber: "SI-76057888", invoiceId: 487, journalId: 1505, journalNumber: "JR001355", total: 3581.1, vatAmount: 467.1, lines: 6 },
    { invoiceNumber: "SI-35331184", invoiceId: 484, journalId: 1506, journalNumber: "JR001356", total: 224.25, vatAmount: 29.25, lines: 1 },
    { invoiceNumber: "SI-69723716", invoiceId: 485, journalId: 1507, journalNumber: "JR001357", total: 6183.78, vatAmount: 806.58, lines: 4 },
    { invoiceNumber: "SI-48925588", invoiceId: 486, journalId: 1508, journalNumber: "JR001358", total: 755.55, vatAmount: 98.55, lines: 1 },
    { invoiceNumber: "SI-39872979", invoiceId: 483, journalId: 1509, journalNumber: "JR001359", total: 1474.88, vatAmount: 192.38, lines: 2 },
    { invoiceNumber: "SI-29664409", invoiceId: 482, journalId: 1510, journalNumber: "JR001360", total: 4589.88, vatAmount: 598.68, lines: 7 },
    { invoiceNumber: "SI-05273875", invoiceId: 481, journalId: 1511, journalNumber: "JR001361", total: 224.85, vatAmount: 29.33, lines: 3 },
    { invoiceNumber: "SI-69316032", invoiceId: 479, journalId: 1513, journalNumber: "JR001362", total: 1286.16, vatAmount: 167.76, lines: 2 },
    { invoiceNumber: "SI-69571077", invoiceId: 480, journalId: 1514, journalNumber: "JR001363", total: 1697.4, vatAmount: 221.4, lines: 1 },
    { invoiceNumber: "SI-69051081", invoiceId: 478, journalId: 1515, journalNumber: "JR001364", total: 755.55, vatAmount: 98.55, lines: 1 },
    { invoiceNumber: "SI-70827806", invoiceId: 477, journalId: 1516, journalNumber: "JR001365", total: 179.4, vatAmount: 23.4, lines: 1 },
    { invoiceNumber: "SI-78521847", invoiceId: 475, journalId: 1517, journalNumber: "JR001366", total: 515.78, vatAmount: 67.28, lines: 2 },
    { invoiceNumber: "SI-07357954", invoiceId: 473, journalId: 1518, journalNumber: "JR001367", total: 755.55, vatAmount: 98.55, lines: 1 },
    { invoiceNumber: "SI-06402862", invoiceId: 471, journalId: 1519, journalNumber: "JR001368", total: 1101.24, vatAmount: 143.64, lines: 4 },
    { invoiceNumber: "SI-07429053", invoiceId: 474, journalId: 1520, journalNumber: "JR001369", total: 550.62, vatAmount: 71.82, lines: 1 },
    { invoiceNumber: "SI-07184772", invoiceId: 472, journalId: 1521, journalNumber: "JR001370", total: 347.42, vatAmount: 45.32, lines: 1 },
    { invoiceNumber: "SI-69420358", invoiceId: 470, journalId: 1522, journalNumber: "JR001371", total: 28753.68, vatAmount: 3750.48, lines: 8 },
    { invoiceNumber: "SI-68060292", invoiceId: 469, journalId: 1524, journalNumber: "JR001372", total: 2663.4, vatAmount: 347.4, lines: 5 },
    { invoiceNumber: "SI-51653842", invoiceId: 476, journalId: 1525, journalNumber: "JR001373", total: 2432.6, vatAmount: 317.3, lines: 4 },
    { invoiceNumber: "SI-06209001", invoiceId: 466, journalId: 1526, journalNumber: "JR001374", total: 255.99, vatAmount: 33.39, lines: 1 },
    { invoiceNumber: "SI-67360196", invoiceId: 468, journalId: 1527, journalNumber: "JR001375", total: 4039.26, vatAmount: 526.86, lines: 6 },
    { invoiceNumber: "SI-37257134", invoiceId: 467, journalId: 1528, journalNumber: "JR001376", total: 425.04, vatAmount: 55.44, lines: 1 },
    { invoiceNumber: "SI-87626024", invoiceId: 465, journalId: 1529, journalNumber: "JR001377", total: 3442.76, vatAmount: 449.06, lines: 6 },
    { invoiceNumber: "SI-45341842", invoiceId: 464, journalId: 1530, journalNumber: "JR001378", total: 755.55, vatAmount: 98.55, lines: 1 },
    { invoiceNumber: "SI-55928858", invoiceId: 463, journalId: 1531, journalNumber: "JR001379", total: 963.59, vatAmount: 125.69, lines: 4 },
    { invoiceNumber: "SI-42281843", invoiceId: 462, journalId: 1532, journalNumber: "JR001380", total: 1097.1, vatAmount: 143.1, lines: 1 },
    { invoiceNumber: "SI-13559091", invoiceId: 461, journalId: 1533, journalNumber: "JR001381", total: 4589.88, vatAmount: 598.68, lines: 6 },
    { invoiceNumber: "SI-41761603", invoiceId: 460, journalId: 1534, journalNumber: "JR001382", total: 3572.83, vatAmount: 466.03, lines: 5 },
    { invoiceNumber: "SI-59275142", invoiceId: 458, journalId: 1536, journalNumber: "JR001383", total: 469.2, vatAmount: 61.2, lines: 2 },
    { invoiceNumber: "SI-97772233", invoiceId: 459, journalId: 1538, journalNumber: "JR001384", total: 1651.86, vatAmount: 215.46, lines: 3 },
    { invoiceNumber: "SI-37769655", invoiceId: 455, journalId: 1539, journalNumber: "JR001385", total: 755.55, vatAmount: 98.55, lines: 1 },
    { invoiceNumber: "SI-38006057", invoiceId: 456, journalId: 1540, journalNumber: "JR001386", total: 3488.64, vatAmount: 455.04, lines: 6 },
    { invoiceNumber: "SI-38651994", invoiceId: 457, journalId: 1541, journalNumber: "JR001387", total: 2307.02, vatAmount: 300.92, lines: 4 },
    { invoiceNumber: "SI-32558763", invoiceId: 454, journalId: 1542, journalNumber: "JR001388", total: 234.6, vatAmount: 30.6, lines: 1 },
    { invoiceNumber: "SI-01667102", invoiceId: 452, journalId: 1543, journalNumber: "JR001389", total: 1211.3, vatAmount: 158, lines: 3 },
    { invoiceNumber: "SI-31048832", invoiceId: 453, journalId: 1544, journalNumber: "JR001390", total: 255.92, vatAmount: 33.38, lines: 7 },
  ],
};

export const POSTED_LINE_ACCOUNT_REPAIR_SCOPES: readonly PostedLineAccountRepairScope[] = [HANDCRAFTED_BATCH_1B];

/** The scopes that belong to this company — a scope is never offered,
 * or accepted, for any other. */
export function repairScopesForCompany(companyId: string): PostedLineAccountRepairScope[] {
  return POSTED_LINE_ACCOUNT_REPAIR_SCOPES.filter((s) => s.companyId === companyId);
}

export function findRepairScope(companyId: string, scopeId: string): PostedLineAccountRepairScope | null {
  return repairScopesForCompany(companyId).find((s) => s.id === scopeId) ?? null;
}
