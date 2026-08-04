/**
 * Preview Mode seed data for the Import Centre. Field shapes match
 * `ImportBatch` exactly — the same type the real API returns.
 */

import type { ImportBatch } from "@/server/accounting/types";
import { MOCK_COMPANY } from "./financial-data";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_IMPORT_BATCHES: ImportBatch[] = [
  {
    id: 1,
    companyId: COMPANY_ID,
    batchId: "BATCH-20260729143200",
    importType: "bank_transactions",
    sourceFilename: "BankImport_Standard_July.csv",
    rowCount: 341,
    importedCount: 336,
    duplicateCount: 0,
    exceptionCount: 5,
    importedBy: "System",
    createdAt: "2026-07-29T14:32:00Z",
  },
  {
    id: 2,
    companyId: COMPANY_ID,
    batchId: "BATCH-20260722091500",
    importType: "bills",
    sourceFilename: "Bills_Supplier_Export_July.csv",
    rowCount: 128,
    importedCount: 121,
    duplicateCount: 3,
    exceptionCount: 4,
    importedBy: "System",
    createdAt: "2026-07-22T09:15:00Z",
  },
  {
    id: 3,
    companyId: COMPANY_ID,
    batchId: "BATCH-20260715163000",
    importType: "bank_transactions",
    sourceFilename: "BankImport_Standard_June.csv",
    rowCount: 298,
    importedCount: 298,
    duplicateCount: 0,
    exceptionCount: 0,
    importedBy: "System",
    createdAt: "2026-07-15T16:30:00Z",
  },
];
