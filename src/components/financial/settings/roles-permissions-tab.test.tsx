import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { RolesPermissionsTab } from "./roles-permissions-tab";
import { MOCK_PERMISSION_ROLES, MOCK_ROLE_ASSIGNMENTS } from "@/lib/mock/permissions-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

function renderTab(previewMode = true) {
  return render(<RolesPermissionsTab companyId="co_1" roles={MOCK_PERMISSION_ROLES} assignments={MOCK_ROLE_ASSIGNMENTS} previewMode={previewMode} />);
}

describe("RolesPermissionsTab", () => {
  it("shows the Roles view by default with the first company role selected", () => {
    renderTab();
    expect(screen.getByText("Company Owner")).toBeInTheDocument();
    expect(screen.getAllByText("Financial Director").length).toBeGreaterThan(0);
  });

  it("lists every seeded system role across platform and company scope", () => {
    renderTab();
    expect(screen.getAllByText("Read Only").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Platform Super Administrator").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bookkeeper").length).toBeGreaterThan(0);
  });

  it("selecting a role shows its module permission grid and approval limits", () => {
    renderTab();
    fireEvent.click(screen.getAllByText("Financial Manager")[0]);
    expect(screen.getByText("Module Permissions")).toBeInTheDocument();
    expect(screen.getByText("Journal Approval")).toBeInTheDocument();
  });

  it("disables permission checkboxes for a system role (fixed defaults)", () => {
    renderTab();
    fireEvent.click(screen.getAllByText("Bookkeeper")[0]);
    const checkbox = screen.getAllByRole("checkbox")[0] as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
  });

  it("switches to the User Assignments view and lists real assignments", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /User Assignments/ }));
    expect(screen.getByText(MOCK_ROLE_ASSIGNMENTS[0].userId)).toBeInTheDocument();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTab();
    expect(await axe(container)).toHaveNoViolations();
  });
});
