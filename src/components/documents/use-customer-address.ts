"use client";

import { useEffect, useState } from "react";
import type { CustomerAddress } from "@/server/customer-management/types";
import { chooseCustomerAddress } from "./print/customer-address";

/** Phase 20C — one shared way for a document (Invoice, Customer
 * Statement) to show a customer's address "where available," reusing
 * the EXISTING `GET /api/companies/{companyId}/customers/{customerId}/addresses`
 * route rather than each document inventing its own lookup. Which address
 * is shown is `chooseCustomerAddress` — the same rule the server-rendered
 * PDF uses; `null` (never fabricated) if the customer has none on file. */
export function useCustomerAddress(companyId: string, customerId: number | null): CustomerAddress | null {
  const [address, setAddress] = useState<CustomerAddress | null>(null);

  useEffect(() => {
    if (customerId === null) return;
    let cancelled = false;

    fetch(`/api/companies/${companyId}/customers/${customerId}/addresses`)
      .then((res) => (res.ok ? res.json() : { addresses: [] }))
      .then((body) => {
        if (cancelled) return;
        setAddress(chooseCustomerAddress(body.addresses ?? []));
      });

    return () => {
      cancelled = true;
    };
  }, [companyId, customerId]);

  return address;
}
