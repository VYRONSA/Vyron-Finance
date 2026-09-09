/**
 * Phase 26G, Part L — "+ Add General Ledger Account." Posts to the
 * existing `POST /api/companies/[companyId]/general-ledger/chart-of-accounts`
 * route (unchanged) — this only tests the modal's own form behavior
 * (validation-disabled state, success/error handling) since the route
 * itself already has its own test coverage.
 *
 * Phase 44 — this used to also call `router.refresh()` on success, which
 * forced a full Transaction Explorer page reload just to make a new
 * account visible — confirmed as the cause of a reported browser hang.
 * That call is gone; `onCreated` is now the only thing the parent needs
 * to append the new account to its own local state.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AddGlAccountModal } from "./add-gl-account-modal";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AddGlAccountModal", () => {
  it("pre-fills the account code from whatever the user already typed in the combobox", () => {
    render(<AddGlAccountModal companyId="co_1" initialAccountCode="6950" onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByLabelText("Account Code")).toHaveValue("6950");
  });

  it("disables Create until both account code and description are filled in", () => {
    render(<AddGlAccountModal companyId="co_1" initialAccountCode="" onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole("button", { name: "Create Account" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Account Code"), { target: { value: "6950" } });
    expect(screen.getByRole("button", { name: "Create Account" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Marketing Materials" } });
    expect(screen.getByRole("button", { name: "Create Account" })).not.toBeDisabled();
  });

  it("posts the form to the existing chart-of-accounts route, calls onCreated with the real account, and closes — no page-level refresh", async () => {
    const createdAccount = { id: 99, companyId: "co_1", accountCode: "6950", description: "Marketing Materials", accountType: "Expense", normalBalance: "Debit" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: createdAccount }) }));
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(<AddGlAccountModal companyId="co_1" initialAccountCode="6950" onClose={onClose} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Marketing Materials" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdAccount));
    expect(fetch).toHaveBeenCalledWith(
      "/api/companies/co_1/general-ledger/chart-of-accounts",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ accountCode: "6950", description: "Marketing Materials", accountType: "Expense", normalBalance: "Debit" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the server's error (e.g. duplicate account code) and does not close or call onCreated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'Account code "1000" already exists.' }) }));
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(<AddGlAccountModal companyId="co_1" initialAccountCode="1000" onClose={onClose} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Bank" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => expect(screen.getByText('Account code "1000" already exists.')).toBeInTheDocument());
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never creates a journal, never touches VAT, never allocates the transaction — the request body carries only master-data fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: {} }) }));
    render(<AddGlAccountModal companyId="co_1" initialAccountCode="6950" onClose={() => {}} onCreated={() => {}} />);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Marketing Materials" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/companies/co_1/general-ledger/chart-of-accounts");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(Object.keys(body).sort()).toEqual(["accountCode", "accountType", "description", "normalBalance"]);
  });

  it("Cancel closes without ever calling fetch", () => {
    vi.stubGlobal("fetch", vi.fn());
    const onClose = vi.fn();
    render(<AddGlAccountModal companyId="co_1" initialAccountCode="6950" onClose={onClose} onCreated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
