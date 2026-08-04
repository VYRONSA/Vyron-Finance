import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { CreateCompanyForm } from "./create-company-form";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, back: vi.fn() }),
}));

describe("CreateCompanyForm", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    vi.restoreAllMocks();
  });

  it("shows the Preview Mode notice but keeps the form usable", () => {
    render(<CreateCompanyForm previewMode />);
    expect(screen.getByText(/no supabase project is configured yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create company/i })).not.toBeDisabled();
  });

  it("rejects submission with a blank company name", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<CreateCompanyForm previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /create company/i }));
    expect(screen.getByText(/company name is required/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("submits and navigates to the new company's dashboard on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ company: { id: "co_99" } }) }),
    );

    render(<CreateCompanyForm previewMode={false} />);
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "Acme Trading Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/company/co_99/dashboard"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/companies",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a server-side error instead of navigating", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Company name is required." }) }),
    );

    render(<CreateCompanyForm previewMode={false} />);
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: "Acme Trading Ltd" } });
    fireEvent.click(screen.getByRole("button", { name: /create company/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/company name is required/i));
    expect(push).not.toHaveBeenCalled();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(<CreateCompanyForm previewMode={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
