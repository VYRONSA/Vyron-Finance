import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { CreateCompanyForm } from "./create-company-form";
import { MOCK_CURRENCIES } from "@/lib/mock/company-management-data";

const push = vi.fn();
const refresh = vi.fn();
const back = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, back }),
}));

/** Fills the required Company Name field and clicks "Continue" through
 * every step until the Review step (step 5) is showing. */
function goToReview() {
  fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "Acme Trading Ltd" } });
  for (let i = 0; i < 4; i++) {
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
  }
}

describe("CreateCompanyForm", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    back.mockClear();
    vi.restoreAllMocks();
  });

  it("shows the Preview Mode notice on the first step and keeps the wizard usable", () => {
    render(<CreateCompanyForm currencies={MOCK_CURRENCIES} previewMode />);
    expect(screen.getByText(/no supabase project is configured yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/company name/i)).toBeInTheDocument();
  });

  it("shows the 5-step progress bar starting on Company Details", () => {
    render(<CreateCompanyForm currencies={MOCK_CURRENCIES} previewMode={false} />);
    expect(screen.getByRole("heading", { name: /company details/i })).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 5/i)).toBeInTheDocument();
  });

  it("blocks continuing past step 1 with a blank company name", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<CreateCompanyForm currencies={MOCK_CURRENCIES} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    expect(screen.getByText(/company name is required/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /company details/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("walks through every step to the Review screen, showing what was entered", () => {
    render(<CreateCompanyForm currencies={MOCK_CURRENCIES} previewMode={false} />);
    goToReview();
    expect(screen.getByRole("heading", { name: /^review$/i })).toBeInTheDocument();
    expect(screen.getByText(/step 5 of 5/i)).toBeInTheDocument();
    expect(screen.getAllByText("Acme Trading Ltd").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^create company$/i })).toBeInTheDocument();
  });

  it("submits only the real, existing /api/companies fields — not the new UI-only preferences", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ company: { id: "co_99", name: "Acme Trading Ltd" } }) }),
    );

    render(<CreateCompanyForm currencies={MOCK_CURRENCIES} previewMode={false} />);
    goToReview();
    fireEvent.click(screen.getByRole("button", { name: /^create company$/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(
      "/api/companies",
      expect.objectContaining({
        method: "POST",
        // Phase 20D — tradingName/vatNumber now persist too
        // (companies.trading_name/vat_number); every OTHER wizard-only
        // preference (VAT registered/frequency, tax system, CoA
        // template, business profile, AI toggles) still isn't sent.
        body: JSON.stringify({
          name: "Acme Trading Ltd",
          industry: "Retail",
          registrationNumber: "",
          address: "",
          financialYearStartMonth: 3,
          baseCurrencyCode: "ZAR",
          tradingName: "",
          vatNumber: "",
        }),
      }),
    );
  });

  it("persists Trading Name and VAT Number entered on step 1 through to the /api/companies payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ company: { id: "co_99", name: "Acme Trading Ltd" } }) }),
    );

    render(<CreateCompanyForm currencies={MOCK_CURRENCIES} previewMode={false} />);
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "Acme Trading Ltd" } });
    fireEvent.change(screen.getByLabelText(/trading name/i), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText(/vat number/i), { target: { value: "4123456789" } });
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create company$/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(init!.body as string);
    expect(body.tradingName).toBe("Acme");
    expect(body.vatNumber).toBe("4123456789");
  });

  it("shows a premium success screen instead of redirecting immediately", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ company: { id: "co_99", name: "Acme Trading Ltd" } }) }),
    );

    render(<CreateCompanyForm currencies={MOCK_CURRENCIES} previewMode={false} />);
    goToReview();
    fireEvent.click(screen.getByRole("button", { name: /^create company$/i }));

    await waitFor(() => expect(screen.getByText(/has been created successfully/i)).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    // Next recommended steps, each linking into the real, existing routes
    // for the company that was just created.
    expect(screen.getByRole("link", { name: /enter dashboard/i })).toHaveAttribute("href", "/company/co_99/dashboard");
    expect(screen.getByRole("link", { name: /import opening balances/i })).toHaveAttribute("href", "/company/co_99/opening-balances");
    expect(screen.getByRole("link", { name: /connect bank/i })).toHaveAttribute("href", "/company/co_99/bank-accounts");
    expect(screen.getByRole("link", { name: /invite users/i })).toHaveAttribute("href", "/company/co_99/settings?tab=roles-permissions");
  });

  it("surfaces a server-side error on the Review step instead of navigating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Company name is required." }) }),
    );

    render(<CreateCompanyForm currencies={MOCK_CURRENCIES} previewMode={false} />);
    goToReview();
    fireEvent.click(screen.getByRole("button", { name: /^create company$/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/company name is required/i));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /^review$/i })).toBeInTheDocument();
  });

  it("has no obvious accessibility violations on the first step", async () => {
    const { container } = render(<CreateCompanyForm currencies={MOCK_CURRENCIES} previewMode={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
