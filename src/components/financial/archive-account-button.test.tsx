import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ArchiveAccountButton } from "./archive-account-button";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), back: vi.fn() }),
}));

describe("ArchiveAccountButton", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.restoreAllMocks();
  });

  it("renders disabled with an explanatory title in Preview Mode", () => {
    render(<ArchiveAccountButton companyId="co_1" accountId={1} previewMode />);
    const button = screen.getByRole("button", { name: /archive account/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("Supabase"));
  });

  it("asks for confirmation before archiving when not in Preview Mode", () => {
    render(<ArchiveAccountButton companyId="co_1" accountId={1} previewMode={false} />);
    const button = screen.getByRole("button", { name: /archive account/i });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    expect(screen.getByText(/archive this account\?/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("cancels back to the initial state without calling the API", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    render(<ArchiveAccountButton companyId="co_1" accountId={1} previewMode={false} />);

    fireEvent.click(screen.getByRole("button", { name: /archive account/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByRole("button", { name: /archive account/i })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls the archive API and refreshes on confirm", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: { id: 1, status: "Archived" } }) }),
    );

    render(<ArchiveAccountButton companyId="co_1" accountId={1} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /archive account/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/companies/co_1/bank-accounts/1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});
