import type { CustomerAddress } from "@/server/customer-management/types";

/** The address a customer document shows: the customer's default address,
 * then a Billing address, then whichever exists first — `null` (never
 * fabricated) when the customer has none on file. Shared by the browser
 * (`useCustomerAddress`) and the server-rendered PDF, so both pick the same one. */
export function chooseCustomerAddress(addresses: CustomerAddress[]): CustomerAddress | null {
  return addresses.find((a) => a.isDefault) ?? addresses.find((a) => a.addressType === "Billing") ?? addresses[0] ?? null;
}

export function formatCustomerAddress(address: CustomerAddress | null): string | null {
  if (!address) return null;
  const parts = [address.line1, address.line2, address.city, address.region, address.postalCode, address.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
