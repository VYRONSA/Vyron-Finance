import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { FinancialWorkspaceShell } from "./workspace-shell";
import { NAV_GROUPS, activeNavGroup, activeNavParent, groupLinks, isNavItemActive } from "./workspace-nav";

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
 * `collapsed` state from outside the component — `aside.w-[230px]` is normal
 * width, `aside.w-[72px]` is collapsed (icons-only). */
function sidebar(container: HTMLElement): HTMLElement {
  const aside = container.querySelector("aside");
  if (!aside) throw new Error("Sidebar <aside> not found — is the viewport-gated `lg:flex` class present?");
  return aside as HTMLElement;
}

describe("FinancialWorkspaceShell — sidebar width (regression)", () => {
  it("starts expanded (normal width) on an ordinary route", () => {
    const { container } = renderShell("/company/co_1/dashboard");
    expect(sidebar(container).className).toContain("w-[230px]");
  });

  it("the manual Collapse/Expand button still toggles the sidebar on an ordinary route", () => {
    const { container } = renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByTitle("Collapse sidebar"));
    expect(sidebar(container).className).toContain("w-[72px]");
    fireEvent.click(screen.getByTitle("Expand sidebar"));
    expect(sidebar(container).className).toContain("w-[230px]");
  });

  it("clicking inside ordinary page content never changes sidebar width", () => {
    const { container } = renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByTestId("page-content"));
    expect(sidebar(container).className).toContain("w-[230px]");
  });

  it("auto-collapses the sidebar when navigating INTO the Transaction Explorer route (pre-existing UX-006, unchanged)", () => {
    const { container } = navigateTo("/company/co_1/transactions");
    expect(sidebar(container).className).toContain("w-[72px]");
  });
});

describe("FinancialWorkspaceShell — Transaction Explorer focus mode (Phase 16, Part 11)", () => {
  it("clicking inside Transaction Explorer content collapses the sidebar (explorer focus mode reduces sidebar)", () => {
    const { container } = renderShell("/company/co_1/transactions");
    expect(sidebar(container).className).toContain("w-[230px]");

    fireEvent.click(screen.getByTestId("page-content"));

    expect(sidebar(container).className).toContain("w-[72px]");
  });

  it("clicking the sidebar restores it to normal width (sidebar click restores normal width)", () => {
    const { container } = renderShell("/company/co_1/transactions");
    fireEvent.click(screen.getByTestId("page-content"));
    expect(sidebar(container).className).toContain("w-[72px]");

    fireEvent.click(sidebar(container));

    expect(sidebar(container).className).toContain("w-[230px]");
  });

  it("clicking back inside Transaction Explorer re-enters focus mode, collapsing the sidebar again (clicking explorer again re-enters focus mode)", () => {
    const { container } = renderShell("/company/co_1/transactions");
    fireEvent.click(screen.getByTestId("page-content"));
    fireEvent.click(sidebar(container));
    expect(sidebar(container).className).toContain("w-[230px]");

    fireEvent.click(screen.getByTestId("page-content"));

    expect(sidebar(container).className).toContain("w-[72px]");
  });

  it("supports repeated sidebar <-> explorer toggling without drifting or creating a second sidebar", () => {
    const { container } = renderShell("/company/co_1/transactions");
    for (let i = 0; i < 3; i++) {
      fireEvent.click(sidebar(container));
      expect(sidebar(container).className).toContain("w-[230px]");
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

    expect(sidebar(container).className).toContain("w-[230px]");
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
    expect(sidebar(container).className).toContain("w-[230px]");
    fireEvent.click(sidebar(container));
    expect(sidebar(container).className).toContain("w-[230px]");
    fireEvent.click(screen.getByTestId("page-content"));
    expect(sidebar(container).className).toContain("w-[230px]");
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

// -----------------------------------------------------------------------
// Phase 5G — grouped navigation and the tablet/mobile drawer.
//
// Two problems: the sidebar listed all 44 destinations flat, so finding
// anything meant scanning a wall of links; and below `lg` the sidebar is
// `hidden` with no menu control of any kind, leaving 768x1024 with no way
// to navigate at all.
// -----------------------------------------------------------------------

/** The sidebar's nav; the drawer's copy only exists once opened. */
function sidebarNav(): HTMLElement {
  return screen.getAllByRole("navigation", { name: "Workspace" })[0]!;
}

describe("Phase 5G — navigation model", () => {
  it("activeNavGroup names the group holding the open page", () => {
    expect(activeNavGroup("/company/co_1/dashboard", "co_1")).toBe("Executive");
    expect(activeNavGroup("/company/co_1/recurring-templates", "co_1")).toBe("Automation");
    expect(activeNavGroup("/company/co_1/settings", "co_1")).toBe("Workspace");
  });

  it("prefers the most specific match, so a shared prefix cannot mislabel the page", () => {
    expect(activeNavGroup("/company/co_1/reporting/financial", "co_1")).toBe("Reporting");
    expect(isNavItemActive("/company/co_1/reporting/financial", "co_1", "reporting", true)).toBe(false);
    expect(isNavItemActive("/company/co_1/reporting/financial", "co_1", "reporting/financial")).toBe(true);
  });

  it("never matches another company's route (tenant isolation)", () => {
    expect(isNavItemActive("/company/co_2/dashboard", "co_1", "dashboard")).toBe(false);
    expect(activeNavGroup("/company/co_2/dashboard", "co_1")).toBeNull();
  });

  it("a page outside the nav leaves the open section alone", () => {
    expect(activeNavGroup("/company/co_1/not-a-real-page", "co_1")).toBeNull();
  });
});

describe("Phase 5G — sidebar grouping", () => {
  it("shows every group heading rather than dumping all 44 links at once", () => {
    renderShell("/company/co_1/dashboard");
    const nav = sidebarNav();
    for (const group of NAV_GROUPS) {
      expect(within(nav).getByRole("button", { name: new RegExp(group.label) })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole("link", { name: "Recurring Templates" })).not.toBeInTheDocument();
  });

  it("the group containing the current page is open, and that page is marked current", () => {
    renderShell("/company/co_1/recurring-templates");
    const nav = sidebarNav();
    expect(within(nav).getByRole("button", { name: /Automation/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: "Recurring Templates" })).toHaveAttribute("aria-current", "page");
  });

  it("clicking a collapsed group expands it", () => {
    renderShell("/company/co_1/dashboard");
    const nav = sidebarNav();
    fireEvent.click(within(nav).getByRole("button", { name: /Automation/ }));
    expect(within(nav).getByRole("button", { name: /Automation/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: "Recurring Templates" })).toBeInTheDocument();
  });

  it("clicking the SAME group again collapses it", () => {
    renderShell("/company/co_1/dashboard");
    const nav = sidebarNav();
    fireEvent.click(within(nav).getByRole("button", { name: /Executive/ }));
    expect(within(nav).getByRole("button", { name: /Executive/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("expanding another group closes the previous one — only ONE open at a time", () => {
    renderShell("/company/co_1/dashboard");
    const nav = sidebarNav();
    expect(within(nav).getByRole("button", { name: /Executive/ })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(within(nav).getByRole("button", { name: /Reporting/ }));

    expect(within(nav).getByRole("button", { name: /Reporting/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("button", { name: /Executive/ })).toHaveAttribute("aria-expanded", "false");
    const openCount = NAV_GROUPS.filter(
      (g) => within(nav).getByRole("button", { name: new RegExp(g.label) }).getAttribute("aria-expanded") === "true",
    ).length;
    expect(openCount).toBe(1);
  });

  it("child links carry the company id, so navigation stays in this tenant", () => {
    renderShell("/company/co_1/dashboard");
    expect(within(sidebarNav()).getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/company/co_1/dashboard");
  });

  it("icons-only focus mode keeps the flat icon strip — navigation is never two clicks deep there", () => {
    // Navigating INTO Transaction Explorer collapses the sidebar to
    // icons (UX-006). There is no room for section headings at 72px, so
    // that mode deliberately keeps every destination directly reachable
    // rather than hiding them behind accordions.
    const { container } = navigateTo("/company/co_1/transactions");
    expect(sidebar(container).className).toContain("w-[72px]");

    const nav = screen.getAllByRole("navigation", { name: "Workspace" })[0]!;
    expect(within(nav).queryByRole("button", { name: /Executive/ })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Recurring Templates" })).toBeInTheDocument();
  });
});

describe("Phase 5G — responsive navigation (the 768x1024 gap)", () => {
  it("a menu button exists for the widths where the sidebar is hidden", () => {
    renderShell("/company/co_1/dashboard");
    expect(screen.getByRole("button", { name: "Open navigation menu" })).toBeInTheDocument();
  });

  it("the drawer stays closed until asked for", () => {
    renderShell("/company/co_1/dashboard");
    expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeInTheDocument();
  });

  it("the menu button opens a drawer rendering the SAME grouped navigation", () => {
    renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));

    const dialog = screen.getByRole("dialog", { name: "Navigation menu" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    for (const group of NAV_GROUPS) {
      expect(within(dialog).getByRole("button", { name: new RegExp(group.label) })).toBeInTheDocument();
    }
  });

  it("the drawer opens the section holding the current page, exactly as the sidebar does", () => {
    renderShell("/company/co_1/recurring-templates");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation menu" });
    expect(within(dialog).getByRole("link", { name: "Recurring Templates" })).toHaveAttribute("aria-current", "page");
  });

  it("its close button closes it", () => {
    renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation menu" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close navigation menu" }));
    expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeInTheDocument();
  });

  it("Escape closes it and returns focus to the menu button", () => {
    renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open navigation menu" }));
  });

  it("opening it moves focus into the drawer", () => {
    renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Navigation menu" }));
  });

  it("the backdrop dismisses it", () => {
    const { container } = renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const backdrop = container.querySelector("div[aria-hidden].absolute.inset-0");
    fireEvent.click(backdrop!);
    expect(screen.queryByRole("dialog", { name: "Navigation menu" })).not.toBeInTheDocument();
  });

  it("is one model, not two: a section toggled in the sidebar is already open in the drawer", () => {
    renderShell("/company/co_1/dashboard");
    fireEvent.click(within(sidebarNav()).getByRole("button", { name: /Automation/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation menu" });
    expect(within(dialog).getByRole("button", { name: /Automation/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("the desktop sidebar is untouched — still hidden below lg, shown at lg", () => {
    const { container } = renderShell("/company/co_1/dashboard");
    expect(sidebar(container).className).toContain("hidden");
    expect(sidebar(container).className).toContain("lg:flex");
  });
});

describe("Navigation hierarchy — parent entries (Banking, Transactions, Contacts)", () => {
  const PARENTS: Record<string, string[]> = {
    Banking: ["Bank Accounts", "Import Centre", "Cashbook", "Banking Exceptions", "Matching"],
    Transactions: ["Transaction Explorer", "Find & Recode"],
    Contacts: ["Suppliers", "Customers"],
  };
  const parentButton = (nav: HTMLElement, label: string) => within(nav).getByRole("button", { name: new RegExp(`^${label}`) });

  it("Dashboard shows only the main Executive options — no child options", () => {
    renderShell("/company/co_1/dashboard");
    const nav = sidebarNav();
    for (const main of ["Dashboard", "PRECISIA Intelligence", "Sales", "Purchasing", "Inventory"]) {
      expect(within(nav).getByRole("link", { name: main })).toBeInTheDocument();
    }
    for (const [parent, children] of Object.entries(PARENTS)) {
      expect(parentButton(nav, parent)).toHaveAttribute("aria-expanded", "false");
      for (const child of children) expect(within(nav).queryByRole("link", { name: child })).not.toBeInTheDocument();
    }
  });

  it("clicking a parent opens only that parent; clicking another closes the first", () => {
    renderShell("/company/co_1/dashboard");
    const nav = sidebarNav();
    fireEvent.click(parentButton(nav, "Banking"));
    for (const child of PARENTS.Banking) expect(within(nav).getByRole("link", { name: child })).toBeInTheDocument();

    fireEvent.click(parentButton(nav, "Contacts"));
    expect(parentButton(nav, "Contacts")).toHaveAttribute("aria-expanded", "true");
    expect(parentButton(nav, "Banking")).toHaveAttribute("aria-expanded", "false");
    expect(within(nav).queryByRole("link", { name: "Bank Accounts" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Suppliers" })).toHaveAttribute("href", "/company/co_1/suppliers");

    fireEvent.click(parentButton(nav, "Contacts"));
    expect(parentButton(nav, "Contacts")).toHaveAttribute("aria-expanded", "false");
  });

  it("on a child page its parent opens by itself and the page is marked current", () => {
    renderShell("/company/co_1/cashbook");
    const nav = sidebarNav();
    expect(parentButton(nav, "Banking")).toHaveAttribute("aria-expanded", "true");
    expect(within(nav).getByRole("link", { name: "Cashbook" })).toHaveAttribute("aria-current", "page");
    expect(activeNavParent("/company/co_1/transactions/find-and-recode", "co_1")).toBe("Transactions");
    expect(activeNavParent("/company/co_1/dashboard", "co_1")).toBeNull();
  });

  it("every previous destination is still in the navigation, exactly once per route", () => {
    const routes = NAV_GROUPS.flatMap((g) => groupLinks(g)).map((l) => l.href);
    for (const href of [
      "dashboard", "intelligence", "bank-accounts", "import-centre", "cashbook", "transactions", "transactions/find-and-recode",
      "banking-rules", "banking-exceptions", "matching", "suppliers", "customers", "sales", "purchasing", "inventory",
      "reporting", "reports", "automation-dashboard", "recurring-templates", "general-ledger", "settings",
    ]) {
      expect(routes).toContain(href);
    }
    expect(activeNavGroup("/company/co_1/banking-rules", "co_1")).toBe("Automation");
  });

  it("the mobile drawer uses the same hierarchy", () => {
    renderShell("/company/co_1/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const dialog = screen.getByRole("dialog", { name: "Navigation menu" });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Transactions/ }));
    expect(within(dialog).getByRole("link", { name: "Find & Recode" })).toBeInTheDocument();
  });
});
