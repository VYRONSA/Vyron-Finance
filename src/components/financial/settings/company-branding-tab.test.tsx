import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { CompanyBrandingTab } from "./company-branding-tab";
import type { CompanyBrandingAssets } from "@/server/company-branding/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

const EMPTY: CompanyBrandingAssets = { hasLogo: false, logoUrl: null, logoFilename: null, logoMimeType: null, logoSizeBytes: null, updatedAt: null };
const WITH_LOGO: CompanyBrandingAssets = {
  hasLogo: true,
  logoUrl: "https://storage.example/signed-url",
  logoFilename: "acme-logo.png",
  logoMimeType: "image/png",
  logoSizeBytes: 2048,
  updatedAt: "2026-08-01T00:00:00.000Z",
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CompanyBrandingTab — empty state", () => {
  it("shows an Upload Logo affordance and no Remove button when there is no logo", () => {
    render(<CompanyBrandingTab companyId="co_1" branding={EMPTY} previewMode={false} />);
    expect(screen.getByRole("button", { name: /upload logo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });
});

describe("CompanyBrandingTab — populated state", () => {
  it("shows the current logo preview, filename, and a Replace/Remove affordance", () => {
    render(<CompanyBrandingTab companyId="co_1" branding={WITH_LOGO} previewMode={false} />);
    expect(screen.getByRole("img", { name: /logo/i })).toHaveAttribute("src", WITH_LOGO.logoUrl);
    expect(screen.getByText("acme-logo.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /replace logo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("calls the DELETE API and returns to the empty state when Remove is confirmed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompanyBrandingTab companyId="co_1" branding={WITH_LOGO} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/companies/co_1/branding", { method: "DELETE" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /upload logo/i })).toBeInTheDocument());
    expect(screen.getByText(/logo removed/i)).toBeInTheDocument();
  });

  it("shows the server-provided error message when Remove fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: "This company has no logo to remove." }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompanyBrandingTab companyId="co_1" branding={WITH_LOGO} previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This company has no logo to remove."));
  });
});

describe("CompanyBrandingTab — upload", () => {
  it("uploads the selected file as multipart/form-data to the branding endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ branding: WITH_LOGO }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<CompanyBrandingTab companyId="co_1" branding={EMPTY} previewMode={false} />);
    const file = new File(["fake-image-bytes"], "logo.png", { type: "image/png" });
    const input = screen.getByLabelText(/company logo/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/companies/co_1/branding");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    await waitFor(() => expect(screen.getByText(/logo saved/i)).toBeInTheDocument());
  });
});

describe("CompanyBrandingTab — Preview Mode", () => {
  it("disables Upload/Replace/Remove with an explanatory title", () => {
    render(<CompanyBrandingTab companyId="co_1" branding={WITH_LOGO} previewMode />);
    const replaceButton = screen.getByRole("button", { name: /replace logo/i });
    expect(replaceButton).toBeDisabled();
    expect(replaceButton).toHaveAttribute("title", expect.stringContaining("Supabase"));
    expect(screen.getByRole("button", { name: /remove/i })).toBeDisabled();
  });
});

describe("CompanyBrandingTab — accessibility", () => {
  it("has no obvious accessibility violations in the empty state", async () => {
    const { container } = render(<CompanyBrandingTab companyId="co_1" branding={EMPTY} previewMode={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no obvious accessibility violations with a logo present", async () => {
    const { container } = render(<CompanyBrandingTab companyId="co_1" branding={WITH_LOGO} previewMode={false} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
