"use client";

import { useEffect, useState } from "react";
import type { CustomerContact } from "@/server/customer-management/types";

/** Phase 24B — mirrors `use-customer-address.ts` exactly, for the same
 * reason: a `Customer` record has no email field of its own (confirmed
 * by inspection — email lives on `CustomerContact`, a separate
 * one-to-many entity), so the "Send Email" confirm panel needs its own
 * small lookup via the existing
 * `GET /api/companies/{companyId}/customers/{customerId}/contacts`
 * route, never a second/duplicated contacts model. Prefers the primary
 * contact, then any contact with a real email; `null` — never a
 * fabricated address — when the customer genuinely has none on file. */
export function useCustomerPrimaryEmail(companyId: string, customerId: number | null): string | null {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (customerId === null) return;
    let cancelled = false;

    fetch(`/api/companies/${companyId}/customers/${customerId}/contacts`)
      .then((res) => (res.ok ? res.json() : { contacts: [] }))
      .then((body) => {
        if (cancelled) return;
        const contacts: CustomerContact[] = body.contacts ?? [];
        const chosen = contacts.find((c) => c.isPrimary && c.email) ?? contacts.find((c) => c.email) ?? null;
        setEmail(chosen?.email ?? null);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, customerId]);

  return email;
}
