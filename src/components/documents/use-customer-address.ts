"use client";

import { useEffect, useState } from "react";
import type { CustomerAddress } from "@/server/customer-management/types";

/** Phase 20C — one shared way for a document (Invoice, Customer
 * Statement) to show a customer's address "where available," reusing
 * the EXISTING `GET /api/companies/{companyId}/customers/{customerId}/addresses`
 * route rather than each document inventing its own lookup. Prefers the
 * customer's default address, then a Billing address, then whichever
 * address exists first; returns `null` (never fabricated) if the
 * customer has none on file. */
export function useCustomerAddress(companyId: string, customerId: number | null): CustomerAddress | null {
  const [address, setAddress] = useState<CustomerAddress | null>(null);

  useEffect(() => {
    if (customerId === null) return;
    let cancelled = false;

    fetch(`/api/companies/${companyId}/customers/${customerId}/addresses`)
      .then((res) => (res.ok ? res.json() : { addresses: [] }))
      .then((body) => {
        if (cancelled) return;
        const addresses: CustomerAddress[] = body.addresses ?? [];
        const chosen = addresses.find((a) => a.isDefault) ?? addresses.find((a) => a.addressType === "Billing") ?? addresses[0] ?? null;
        setAddress(chosen);
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, customerId]);

  return address;
}
