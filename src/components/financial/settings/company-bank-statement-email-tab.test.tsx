import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { CompanyBankStatementEmailTab } from "./company-bank-statement-email-tab";

function identity(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, companyId: "co_1", stableIdentifier: "acme-ltd-a7k3", status: "active",
    createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z",
    lastReceivedAt: null, lastSuccessfulImportAt: null, lastFailureAt: null,
    emailAddress: "acme-ltd-a7k3.bank@imports.vyronfinance.co.za",
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe("CompanyBankStatementEmailTab — display", () => {
  it("shows the address once loaded, with a Copy action", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity() }) }));
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(screen.getByText("acme-ltd-a7k3.bank@imports.vyronfinance.co.za")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("copies the address to the clipboard when Copy is clicked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity() }) }));
    render(<CompanyBankStatementEmailTab companyId="co_1" />);
    await waitFor(() => expect(screen.getByText("acme-ltd-a7k3.bank@imports.vyronfinance.co.za")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("acme-ltd-a7k3.bank@imports.vyronfinance.co.za"));
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();
  });

  it("shows an honest message instead of a fabricated address when the domain isn't configured yet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity({ emailAddress: null }) }) }));
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(screen.getByText(/will appear here once/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("shows the server's error message when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "No company with id co_1." }) }));
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("No company with id co_1."));
  });

  it("never claims automatic processing is live — no Active/Connected status badge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity() }) }));
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(screen.getByText("acme-ltd-a7k3.bank@imports.vyronfinance.co.za")).toBeInTheDocument());
    expect(screen.queryByText(/^active$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^connected$/i)).not.toBeInTheDocument();
  });

  it("shows 'Waiting for first statement' — never a fake success — before any real email has arrived", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity({ lastReceivedAt: null }) }) }));
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(screen.getByText("Waiting for first statement")).toBeInTheDocument());
  });

  it("shows the real Last received timestamp once one is stored", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity({ lastReceivedAt: "2026-08-10T09:30:00.000Z" }) }) }));
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(screen.getByText("Last received:")).toBeInTheDocument());
    expect(screen.queryByText("Waiting for first statement")).not.toBeInTheDocument();
  });

  it("shows Last processed only when a real successful-import timestamp is stored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity({ lastReceivedAt: "2026-08-10T09:30:00.000Z", lastSuccessfulImportAt: "2026-08-10T09:31:00.000Z" }) }) }),
    );
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(screen.getByText("Last processed:")).toBeInTheDocument());
  });

  it("shows Last error only when a real failure timestamp is stored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity({ lastReceivedAt: "2026-08-10T09:30:00.000Z", lastFailureAt: "2026-08-10T09:31:00.000Z" }) }) }),
    );
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(screen.getByText("Last error:")).toBeInTheDocument());
  });

  it("omits Last processed/Last error entirely when neither has ever happened", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity({ lastReceivedAt: "2026-08-10T09:30:00.000Z" }) }) }));
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(screen.getByText("Last received:")).toBeInTheDocument());
    expect(screen.queryByText("Last processed:")).not.toBeInTheDocument();
    expect(screen.queryByText("Last error:")).not.toBeInTheDocument();
  });

  it("scopes the fetch to the exact companyId prop, never a different one", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity() }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CompanyBankStatementEmailTab companyId="co_1" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/bank-statement-email"));
  });

  it("has no obvious accessibility violations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bankStatementEmail: identity() }) }));
    const { container } = render(<CompanyBankStatementEmailTab companyId="co_1" />);
    await waitFor(() => expect(screen.getByText("acme-ltd-a7k3.bank@imports.vyronfinance.co.za")).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});
