import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCustomerAddress } from "./use-customer-address";
import type { CustomerAddress } from "@/server/customer-management/types";

function address(overrides: Partial<CustomerAddress> = {}): CustomerAddress {
  return { id: 1, customerId: 10, addressType: "Postal", line1: "1 Main St", line2: "", city: "Cape Town", region: "", postalCode: "8001", country: "South Africa", isDefault: false, createdAt: "2025-01-01T00:00:00Z", ...overrides };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useCustomerAddress", () => {
  it("returns null and fetches nothing when customerId is null", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useCustomerAddress("co_1", null));
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches addresses scoped to the given company and customer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ addresses: [address()] }) });
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useCustomerAddress("co_1", 10));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/customers/10/addresses"));
  });

  it("prefers the default address over any other", async () => {
    const addresses = [address({ id: 1, line1: "Not Default" }), address({ id: 2, line1: "Default Address", isDefault: true })];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ addresses }) }));
    const { result } = renderHook(() => useCustomerAddress("co_1", 10));
    await waitFor(() => expect(result.current?.line1).toBe("Default Address"));
  });

  it("falls back to a Billing address when there is no default", async () => {
    const addresses = [address({ id: 1, addressType: "Postal", line1: "Postal Address" }), address({ id: 2, addressType: "Billing", line1: "Billing Address" })];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ addresses }) }));
    const { result } = renderHook(() => useCustomerAddress("co_1", 10));
    await waitFor(() => expect(result.current?.line1).toBe("Billing Address"));
  });

  it("returns null (never fabricated) when the customer has no addresses on file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ addresses: [] }) }));
    const { result } = renderHook(() => useCustomerAddress("co_1", 10));
    await waitFor(() => expect(result.current).toBeNull());
  });
});
