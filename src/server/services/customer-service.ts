/**
 * Service layer for Customer Management. Thin validation on top of
 * `customer-repository.ts`, matching this codebase's established
 * repository/service split.
 */

import * as repo from "@/server/repositories/customer-repository";
import { queueCommunication } from "@/server/services/communication-service";
import { getCompany } from "@/server/services/company-service";
import { recordPermissionAuditEntry } from "@/server/repositories/permission-repository";
import { parseCustomerImportCsv } from "@/server/import-centre/customer-supplier-import-parser";
import type { AddressType, Customer, CustomerAddress, CustomerContact, CustomerType, RiskRating } from "@/server/customer-management/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

const CUSTOMER_TYPES: CustomerType[] = ["Company", "Individual"];
const RISK_RATINGS: RiskRating[] = ["Low", "Medium", "High"];
const ADDRESS_TYPES: AddressType[] = ["Billing", "Delivery", "Postal", "Physical"];
const CODE_RE = /^[A-Za-z0-9._-]+$/;
// Finding #099 — South African VAT numbers are 10 digits; company
// registration numbers follow YYYY/NNNNNN/NN. Both checks are blank-
// tolerant (neither field is required) and only fire when a non-empty
// value is actually provided, matching this file's existing partial-
// update convention.
const VAT_NUMBER_RE = /^\d{10}$/;
const REGISTRATION_NUMBER_RE = /^\d{4}\/\d{6}\/\d{2}$/;

export function validateCustomerInput(input: { customerCode: string; name: string }) {
  if (!input.customerCode?.trim()) throw new ValidationError("Customer Code is required.");
  if (!CODE_RE.test(input.customerCode.trim())) {
    throw new ValidationError("Customer Code may only contain letters, numbers, dots, dashes, and underscores.");
  }
  if (!input.name?.trim()) throw new ValidationError("Customer Name is required.");
}

/** Phase 32A — was previously only enforced inside `updateCustomer`,
 * meaning `createCustomer` (and therefore the bulk CSV import, which
 * calls `createCustomer` row-by-row) silently accepted a malformed VAT
 * Number/Registration Number with no error. Extracted so `createCustomer`
 * and `updateCustomer` can never drift apart on this again — same
 * regexes, same messages, same blank-tolerant behaviour (neither field
 * is required; the check only fires on a genuinely non-empty value). */
export function validateVatAndRegistrationNumbers(vatNumber: string | undefined, registrationNumber: string | undefined) {
  if (vatNumber?.trim() && !VAT_NUMBER_RE.test(vatNumber.trim())) {
    throw new ValidationError(`VAT Number must be 10 digits. Value: "${vatNumber.trim()}".`);
  }
  if (registrationNumber?.trim() && !REGISTRATION_NUMBER_RE.test(registrationNumber.trim())) {
    throw new ValidationError(`Registration Number must be in the format YYYY/NNNNNN/NN. Value: "${registrationNumber.trim()}".`);
  }
}

export const listCustomers = repo.listCustomers;
export const getCustomer = repo.getCustomer;

export async function createCustomer(companyId: string, input: repo.NewCustomer, options: { skipCommunication?: boolean } = {}): Promise<Customer> {
  validateCustomerInput(input);
  if (input.creditLimit !== undefined && input.creditLimit < 0) throw new ValidationError("Credit Limit cannot be negative.");
  if (input.paymentTermsDays !== undefined && input.paymentTermsDays < 0) throw new ValidationError("Payment Terms cannot be negative.");
  validateVatAndRegistrationNumbers(input.vatNumber, input.registrationNumber);
  const customer = await repo.createCustomer(companyId, { ...input, customerCode: input.customerCode.trim(), name: input.name.trim() });

  // Finding #035 (RC-12) — a bulk CSV import creates many customers in
  // one pass; queuing one welcome email per row would flood the
  // communications queue, so bulk import opts out here.
  if (options.skipCommunication) return customer;

  try {
    const contacts = await repo.listCustomerContacts(customer.id);
    const contact = contacts.find((c) => c.isPrimary) ?? contacts[0];
    const company = await getCompany(companyId);
    await queueCommunication(companyId, {
      module: "Sales",
      businessObjectType: "Customer",
      businessObjectId: customer.id,
      channel: "Email",
      templateCode: "WelcomeEmail",
      recipients: [{ type: "Customer", id: customer.id, name: customer.name, address: contact?.email || null }],
      variables: { customerName: customer.name, customerCode: customer.customerCode, companyName: company?.name },
    });
  } catch {
    // Communication failures must never break the primary operation.
  }

  return customer;
}

export type BulkImportOutcome = { created: number; failed: number; errors: string[] };

/** Finding #035 (RC-12) — the only bulk-create path for Customers.
 * Reuses `createCustomer` row-by-row (same validation, same real
 * creation path — no parallel insert logic) rather than a bespoke bulk
 * insert, so every imported row is validated exactly as a manually
 * entered one would be. A row-level failure (e.g. a duplicate customer
 * code) doesn't abort the batch — it's collected and reported, matching
 * the same "N of M processed, see failures below" pattern
 * `batch-capture-tab.tsx`'s Cashbook batch save already established. */
export async function bulkImportCustomers(companyId: string, csvText: string): Promise<BulkImportOutcome> {
  const { rows, errors: parseErrors } = parseCustomerImportCsv(csvText);
  const errors = [...parseErrors];
  let created = 0;

  for (const row of rows) {
    try {
      await createCustomer(
        companyId,
        {
          customerCode: row.customerCode,
          name: row.name,
          customerGroup: row.customerGroup || undefined,
          vatNumber: row.vatNumber || undefined,
          registrationNumber: row.registrationNumber || undefined,
          creditLimit: row.creditLimit,
          paymentTermsDays: row.paymentTermsDays,
        },
        { skipCommunication: true },
      );
      created++;
    } catch (err) {
      errors.push(`Row ${row.rowNumber} (${row.name}): ${err instanceof Error ? err.message : "failed to create."}`);
    }
  }

  return { created, failed: errors.length, errors };
}

export type EditCustomerRequest = Partial<{
  name: string;
  customerType: CustomerType;
  customerGroup: string;
  industry: string;
  vatNumber: string;
  registrationNumber: string;
  creditLimit: number;
  paymentTermsDays: number;
  currencyCode: string | null;
  priceList: string;
  salesRep: string;
  riskRating: RiskRating;
  notes: string;
}>;

/** Pilot Review Round 1, Phase 3 — "sensitive fields should require
 * elevated permissions where appropriate." Credit Limit is the one
 * customer field with direct financial exposure (raises how much a
 * customer can owe before Sales stops accepting orders) — gated behind
 * `Sales:Approve` (already held by Sales Manager+, not base Sales:Edit
 * clerks) rather than a new permission key, reusing the existing grant
 * this codebase already seeds for every senior Sales role. */
export function editRequiresElevatedPermission(input: EditCustomerRequest): boolean {
  return input.creditLimit !== undefined;
}

export async function updateCustomer(companyId: string, customerId: number, input: EditCustomerRequest, performedBy = "System", reason = ""): Promise<Customer> {
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError("Customer Name cannot be empty.");
  if (input.customerType !== undefined && !CUSTOMER_TYPES.includes(input.customerType)) throw new ValidationError("Invalid Customer Type.");
  if (input.riskRating !== undefined && !RISK_RATINGS.includes(input.riskRating)) throw new ValidationError("Invalid Risk Rating.");
  if (input.creditLimit !== undefined && input.creditLimit < 0) throw new ValidationError("Credit Limit cannot be negative.");
  if (input.paymentTermsDays !== undefined && input.paymentTermsDays < 0) throw new ValidationError("Payment Terms cannot be negative.");
  validateVatAndRegistrationNumbers(input.vatNumber, input.registrationNumber);

  // Found live during RC1 Phase 7.6 certification: a nonexistent or
  // foreign-company id (a cross-tenant URL-manipulation attempt, or
  // any stale/typo'd id) previously reached `.single()` on zero rows,
  // throwing a raw, uncaught PostgREST error (500) instead of a clean
  // 404 — the write was always correctly blocked at the data layer
  // (RLS + this same company_id filter), only the error response was
  // wrong. Pre-checking existence, matching this codebase's established
  // NotFoundError pattern (document-service.ts, communication-service.ts),
  // fixes the response without changing the actual security boundary.
  const existing = await repo.getCustomer(companyId, customerId);
  if (!existing) throw new NotFoundError(`No customer with id ${customerId}.`);

  const updated = await repo.updateCustomer(companyId, customerId, {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.customerType !== undefined && { customer_type: input.customerType }),
    ...(input.customerGroup !== undefined && { customer_group: input.customerGroup }),
    ...(input.industry !== undefined && { industry: input.industry }),
    ...(input.vatNumber !== undefined && { vat_number: input.vatNumber }),
    ...(input.registrationNumber !== undefined && { registration_number: input.registrationNumber }),
    ...(input.creditLimit !== undefined && { credit_limit: input.creditLimit }),
    ...(input.paymentTermsDays !== undefined && { payment_terms_days: input.paymentTermsDays }),
    ...(input.currencyCode !== undefined && { currency_code: input.currencyCode }),
    ...(input.priceList !== undefined && { price_list: input.priceList }),
    ...(input.salesRep !== undefined && { sales_rep: input.salesRep }),
    ...(input.riskRating !== undefined && { risk_rating: input.riskRating }),
    ...(input.notes !== undefined && { notes: input.notes }),
  });

  // Every editable field, not a hand-picked subset — "maintain complete
  // audit history of changes" (Pilot Review Round 1, Phase 3) means
  // every field, including ones that don't feel individually sensitive.
  const changedFields: [string, unknown, unknown][] = [
    ["name", existing.name, updated.name],
    ["customerType", existing.customerType, updated.customerType],
    ["customerGroup", existing.customerGroup, updated.customerGroup],
    ["industry", existing.industry, updated.industry],
    ["vatNumber", existing.vatNumber, updated.vatNumber],
    ["registrationNumber", existing.registrationNumber, updated.registrationNumber],
    ["creditLimit", existing.creditLimit, updated.creditLimit],
    ["paymentTermsDays", existing.paymentTermsDays, updated.paymentTermsDays],
    ["currencyCode", existing.currencyCode, updated.currencyCode],
    ["priceList", existing.priceList, updated.priceList],
    ["riskRating", existing.riskRating, updated.riskRating],
    ["salesRep", existing.salesRep, updated.salesRep],
    ["notes", existing.notes, updated.notes],
  ];
  for (const [field, oldValue, newValue] of changedFields) {
    if (oldValue !== newValue) {
      await recordPermissionAuditEntry(companyId, "Customer", String(customerId), field, String(oldValue), String(newValue), reason || "Customer details updated.", performedBy);
    }
  }

  return updated;
}

export async function setCustomerActive(companyId: string, customerId: number, isActive: boolean): Promise<Customer> {
  const existing = await repo.getCustomer(companyId, customerId);
  if (!existing) throw new NotFoundError(`No customer with id ${customerId}.`);

  const customer = await repo.setCustomerActive(companyId, customerId, isActive);

  if (!isActive) {
    try {
      const contacts = await repo.listCustomerContacts(customer.id);
      const contact = contacts.find((c) => c.isPrimary) ?? contacts[0];
      const company = await getCompany(companyId);
      await queueCommunication(companyId, {
        module: "Sales",
        businessObjectType: "Customer",
        businessObjectId: customer.id,
        channel: "Email",
        templateCode: "AccountSuspensionNotice",
        recipients: [{ type: "Customer", id: customer.id, name: customer.name, address: contact?.email || null }],
        variables: { customerName: customer.name, companyName: company?.name },
      });
    } catch {
      // Communication failures must never break the primary operation.
    }
  }

  return customer;
}

/** Phase 25K — every Customer Contacts/Addresses function below used to
 * take only `customerId`, with no `companyId` check anywhere in the call
 * chain (the repository functions filter purely by `customer_id`/`id`,
 * never `company_id`). In a multi-company organisation, a user with a
 * permission grant in Company A only (but none in Company B) could
 * read, create, or delete Company B's customer contacts/addresses by
 * substituting a real Company-B `customerId` into a Company-A request —
 * `requirePermission(companyId, ...)` at the route layer checks the
 * URL's OWN companyId, which passes, and RLS's `user_can_access_company`
 * is organisation-wide, not company-specific, so it didn't catch this
 * either. This confirms the customer genuinely belongs to `companyId`
 * before any read/write, closing the gap at the one layer that actually
 * enforces it. */
async function requireCompanyCustomer(companyId: string, customerId: number): Promise<void> {
  const customer = await repo.getCustomer(companyId, customerId);
  if (!customer) throw new NotFoundError(`No customer with id ${customerId}.`);
}

export async function listCustomerContacts(companyId: string, customerId: number): Promise<CustomerContact[]> {
  await requireCompanyCustomer(companyId, customerId);
  return repo.listCustomerContacts(customerId);
}

export async function createCustomerContact(companyId: string, customerId: number, input: repo.NewCustomerContact): Promise<CustomerContact> {
  await requireCompanyCustomer(companyId, customerId);
  if (!input.name?.trim()) throw new ValidationError("Contact Name is required.");
  return repo.createCustomerContact(customerId, { ...input, name: input.name.trim() });
}

export async function deleteCustomerContact(companyId: string, customerId: number, contactId: number): Promise<void> {
  await requireCompanyCustomer(companyId, customerId);
  return repo.deleteCustomerContact(contactId);
}

export async function listCustomerAddresses(companyId: string, customerId: number): Promise<CustomerAddress[]> {
  await requireCompanyCustomer(companyId, customerId);
  return repo.listCustomerAddresses(customerId);
}

export async function createCustomerAddress(companyId: string, customerId: number, input: repo.NewCustomerAddress): Promise<CustomerAddress> {
  await requireCompanyCustomer(companyId, customerId);
  if (!ADDRESS_TYPES.includes(input.addressType)) throw new ValidationError("Invalid Address Type.");
  return repo.createCustomerAddress(customerId, input);
}

export async function deleteCustomerAddress(companyId: string, customerId: number, addressId: number): Promise<void> {
  await requireCompanyCustomer(companyId, customerId);
  return repo.deleteCustomerAddress(addressId);
}
