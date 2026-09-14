/**
 * Which GL accounts carry VAT — taken from the posting engines' OWN
 * constants, not re-typed here, so the VAT reports read exactly the
 * accounts VYRON actually posts tax to:
 *   - VAT Input (`vat-return-service.ts`) — supplier bills, input adjustments
 *   - VAT Output (`vat-return-service.ts`) — sales invoices, output adjustments
 *   - VAT Control (`journal-service.ts`) — VAT split out of a directly
 *     GL-allocated bank transaction at posting time
 * An account is only included if it exists in the company's chart.
 */

import { VAT_INPUT_CODE, VAT_OUTPUT_CODE } from "@/server/services/vat-return-service";
import { VAT_CONTROL_ACCOUNT_CODE } from "@/server/services/journal-service";
import type { ChartOfAccount } from "@/server/general-ledger/types";
import type { VatAccountRef, VatAccountRole } from "./source";

const VAT_ACCOUNT_CODES: { code: string; role: VatAccountRole }[] = [
  { code: VAT_INPUT_CODE, role: "Input" },
  { code: VAT_OUTPUT_CODE, role: "Output" },
  { code: VAT_CONTROL_ACCOUNT_CODE, role: "Control" },
];

export function resolveVatAccounts(accounts: ChartOfAccount[]): VatAccountRef[] {
  const refs: VatAccountRef[] = [];
  for (const { code, role } of VAT_ACCOUNT_CODES) {
    const account = accounts.find((a) => a.accountCode === code);
    if (account) refs.push({ accountId: account.id, accountCode: account.accountCode, description: account.description, role });
  }
  return refs;
}
