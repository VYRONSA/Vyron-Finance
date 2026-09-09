import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FinancialWorkspaceShell } from "./workspace-shell";

const mockUsePathname = vi.fn(() => "/company/co_1/dashboard");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
}));

function shellTree() {
  return (
    <FinancialWorkspaceShell companyId="co_1" companyName="Acme Ltd" previewMode>
      <div data-testid="page-content">
        <button type="button">A transaction row</button>
      </div>
    </FinancialWorkspaceShell>
  );
}

function renderShell(pathname: string) {
  mockUsePathname.mockReturnValue(pathname);
  return render(shellTree());
}

/** Simulates an in-app client-side navigation (rather than a fresh
 * mount already on the destination route) — the entry-collapse effect
 * (UX-006) only fires on a genuine transition, exactly as it does for a
 * real user clicking a nav link, not on first paint. */
function navigateTo(pathname: string) {
  mockUsePathname.mockReturnValue("/company/co_1/dashboard");
  const utils = render(shellTree());
  mockUsePathname.mockReturnValue(pathname);
  utils.rerender(shellTree());
  return utils;
}

/** The sidebar's width class is the only observable signal of
 * `collapsed` state from outside the component — `aside.w-64` is normal
 * width, `aside.w-[72px]` is collapsed (icons-only). */
function sidebar(container: HTMLElement): HTMLElement {
  const aside = container.querySelector("aside");
  if (!aside) throw new Error("Sidebar <aside> not found — is the viewport-gated `lg:flex` class present?");
  return aside as HTMLElement;
}

describe("FinancialWorkspaceShell — sidebar width (regression)", () => {
  it("starts expanded (normal width) on an ordinary route", () => {
    const { container } = renderShell("/company/co_1/dashboard");
    expect(sidebar(container).className).toContain("w-64");
  });

  it("the manual Collapse/Expand button still toggles the sidebar on an ordinary route", () => {
    const { container } = renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    expect(sidebar(container).className).toContain("w-[72px]");
    fireEvent.click(screen.getByTitle("Expand sidebar"));
    expect(sidebar(container).className).toContain("w-64");
  });

  it("clicking inside ordinary page content never changes sidebar width", () => {
    const { container } = renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByTestId("page-content"));
    expect(sidebar(container).className).toContain("w-64");
  });

  it("auto-collapses the sidebar when navigating INTO the Transaction Explorer route (pre-existing UX-006, unchanged)", () => {
    const { container } = navigateTo("/company/co_1/transactions");
    expect(sidebar(container).className).toContain("w-[72px]");
  });
});

describe("FinancialWorkspaceShell — Transaction Explorer focus mode (Phase 16, Part 11)", () => {
  it("clicking inside Transaction Explorer content collapses the sidebar (explorer focus mode reduces sidebar)", () => {
    const { container } = renderShell("/company/co_1/transactions");
    expect(sidebar(container).className).toContain("w-64");

    fireEvent.click(screen.getByTestId("page-content"));

    expect(sidebar(container).className).toContain("w-[72px]");
  });

  it("clicking the sidebar restores it to normal width (sidebar click restores normal width)", () => {
    const { container } = renderShell("/company/co_1/transactions");
    fireEvent.click(screen.getByTestId("page-content"));
    expect(sidebar(container).className).toContain("w-[72px]");

    fireEvent.click(sidebar(container));

    expect(sidebar(container).className).toContain("w-64");
  });

  it("clicking back inside Transaction Explorer re-enters focus mode, collapsing the sidebar again (clicking explorer again re-enters focus mode)", () => {
    const { container } = renderShell("/company/co_1/transactions");
    fireEvent.click(screen.getByTestId("page-content"));
    fireEvent.click(sidebar(container));
    expect(sidebar(container).className).toContain("w-64");

    fireEvent.click(screen.getByTestId("page-content"));

    expect(sidebar(container).className).toContain("w-[72px]");
  });

  it("supports repeated sidebar <-> explorer toggling without drifting or creating a second sidebar", () => {
    const { container } = renderShell("/company/co_1/transactions");
    for (let i = 0; i < 3; i++) {
      fireEvent.click(sidebar(container));
      expect(sidebar(container).className).toContain("w-64");
      fireEvent.click(screen.getByTestId("page-content"));
      expect(sidebar(container).className).toContain("w-[72px]");
    }
    expect(container.querySelectorAll("aside").length).toBe(1);
  });

  it("does not fight the manual Collapse/Expand button while in focus mode — clicking it still expands (existing sidebar collapse still works)", () => {
    const { container } = renderShell("/company/co_1/transactions");
    fireEvent.click(screen.getByTestId("page-content"));
    expect(sidebar(container).className).toContain("w-[72px]");

    fireEvent.click(screen.getByTitle("Expand sidebar"));

    expect(sidebar(container).className).toContain("w-64");
  });

  it("clicking an interactive control inside Transaction Explorer content still fires its own handler (transaction explorer selection unaffected)", () => {
    const onRowClick = vi.fn();
    mockUsePathname.mockReturnValue("/company/co_1/transactions");
    render(
      <FinancialWorkspaceShell companyId="co_1" companyName="Acme Ltd" previewMode>
        <button type="button" onClick={onRowClick}>
          A transaction row
        </button>
      </FinancialWorkspaceShell>,
    );
    fireEvent.click(screen.getByRole("button", { name: "A transaction row" }));
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it("leaves sidebar behaviour on every other route completely unaffected by the focus-mode handlers", () => {
    const { container } = renderShell("/company/co_1/bank-accounts");
    expect(sidebar(container).className).toContain("w-64");
    fireEvent.click(sidebar(container));
    expect(sidebar(container).className).toContain("w-64");
    fireEvent.click(screen.getByTestId("page-content"));
    expect(sidebar(container).className).toContain("w-64");
  });
});

describe("FinancialWorkspaceShell — responsive/mobile (regression)", () => {
  it("keeps the sidebar hidden below the lg breakpoint regardless of focus mode (mobile/tablet)", () => {
    const { container } = renderShell("/company/co_1/transactions");
    expect(sidebar(container).className).toContain("hidden");
    expect(sidebar(container).className).toContain("lg:flex");
  });

  it("keyboard navigation to the manual toggle button still works (keyboard navigation)", () => {
    renderShell("/company/co_1/dashboard");
    const button = screen.getByTitle("Collapse sidebar");
    button.focus();
    expect(button).toHaveFocus();
  });
});
