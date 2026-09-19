"use client";

import type { ReactNode } from "react";

/**
 * Phase 5I — one labelled group of fields inside a create panel.
 *
 * The customer and supplier create forms were each a single flat grid, so
 * tax details sat beside risk ratings with nothing to say which mattered
 * for an invoice. This groups them without changing the design system:
 * the same grid, the same `Field` children, the same spacing tokens —
 * just a heading and a rule above each group.
 */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h4 className="mb-2 border-b border-vf-paper-border pb-1.5 text-[0.65rem] font-semibold tracking-[0.12em] text-vf-ink-faint uppercase">
        {title}
      </h4>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

/** South African VAT numbers are 10 digits. Mirrors the server's own
 * `customer-service.ts` rule rather than inventing a second standard. */
const VAT_NUMBER_PATTERN = /^\d{10}$/;
/** Company registration numbers are YYYY/NNNNNN/NN. */
const REGISTRATION_NUMBER_PATTERN = /^\d{4}\/\d{6}\/\d{2}$/;
/** Deliberately permissive — enough to catch a typo, not to adjudicate
 * RFC 5322. The server checks this too. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CustomerFormErrors = {
  code?: string;
  name?: string;
  vatNumber?: string;
  registrationNumber?: string;
  contactEmail?: string;
};

/** Phase 5I — pure, exported, and mirroring the server's rules rather
 * than adding new ones. The server re-validates all of it; this exists so
 * the person is told which field is wrong before a round trip.
 *
 * Both tax fields are OPTIONAL — a customer who is not a VAT vendor
 * genuinely has no VAT number, and refusing to save one would be wrong.
 * They are only checked when something has actually been typed. */
export function validateCustomerForm(input: {
  code: string;
  name: string;
  vatNumber: string;
  registrationNumber: string;
  contactEmail: string;
}): CustomerFormErrors {
  const errors: CustomerFormErrors = {};

  if (!input.code.trim()) errors.code = "A customer code is required.";
  else if (!/^[A-Za-z0-9._-]+$/.test(input.code.trim())) {
    errors.code = "Use letters, numbers, dots, dashes or underscores only.";
  }
  if (!input.name.trim()) errors.name = "A customer name is required.";

  const vat = input.vatNumber.trim();
  if (vat && !VAT_NUMBER_PATTERN.test(vat)) errors.vatNumber = "A VAT number is 10 digits.";

  const reg = input.registrationNumber.trim();
  if (reg && !REGISTRATION_NUMBER_PATTERN.test(reg)) {
    errors.registrationNumber = "Use the format YYYY/NNNNNN/NN.";
  }

  const email = input.contactEmail.trim();
  if (email && !EMAIL_PATTERN.test(email)) errors.contactEmail = "Enter a valid email address.";

  return errors;
}

export type SupplierFormErrors = {
  name?: string;
  vatNumber?: string;
  registrationNumber?: string;
  contactEmail?: string;
};

/** Phase 5I — the supplier equivalent.
 *
 * Note the deliberate asymmetry with customers: the supplier NAME is
 * required and the code is not, because that is what the existing server
 * service enforces (`supplier-management-service.ts`) and what the
 * database allows (`ae_suppliers.supplier_code` has only a partial unique
 * index, on non-blank codes). Changing which of them is mandatory would
 * be a behaviour change, not a validation improvement.
 *
 * The VAT-number format check is NEW on the supplier side — the server
 * has never validated it there, unlike customers. It is client-side only
 * and advisory: it catches a typo at capture time without changing what
 * the server accepts. */
export function validateSupplierForm(input: {
  name: string;
  vatNumber: string;
  registrationNumber: string;
  contactEmail: string;
}): SupplierFormErrors {
  const errors: SupplierFormErrors = {};

  if (!input.name.trim()) errors.name = "A supplier name is required.";

  const vat = input.vatNumber.trim();
  if (vat && !VAT_NUMBER_PATTERN.test(vat)) errors.vatNumber = "A VAT number is 10 digits.";

  const reg = input.registrationNumber.trim();
  if (reg && !REGISTRATION_NUMBER_PATTERN.test(reg)) {
    errors.registrationNumber = "Use the format YYYY/NNNNNN/NN.";
  }

  const email = input.contactEmail.trim();
  if (email && !EMAIL_PATTERN.test(email)) errors.contactEmail = "Enter a valid email address.";

  return errors;
}
