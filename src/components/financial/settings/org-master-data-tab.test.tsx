import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { OrgMasterDataTab } from "./org-master-data-tab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

describe("OrgMasterDataTab", () => {
  it("shows an empty state when there are no items yet", () => {
    render(
      <OrgMasterDataTab apiPath="/api/companies/co_1/departments" resourceLabel="Department" resourceLabelPlural="Departments" items={[]} previewMode={false} />,
    );
    expect(screen.getByText(/no departments yet/i)).toBeInTheDocument();
  });

  it("lists existing items with Active/Inactive status", () => {
    render(
      <OrgMasterDataTab
        apiPath="/api/companies/co_1/departments"
        resourceLabel="Department"
        resourceLabelPlural="Departments"
        items={[{ id: 1, name: "Finance", code: "FIN", isActive: true }]}
        previewMode={false}
      />,
    );
    expect(screen.getByText("Finance")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("only shows an Address column when hasAddress is set (Branches, not Departments)", () => {
    const items = [{ id: 1, name: "Head Office", code: "HO", address: "1 Main St", isActive: true }];
    const { rerender } = render(
      <OrgMasterDataTab apiPath="/api/companies/co_1/branches" resourceLabel="Branch" resourceLabelPlural="Branches" items={items} hasAddress previewMode={false} />,
    );
    expect(screen.getByText("1 Main St")).toBeInTheDocument();

    rerender(
      <OrgMasterDataTab apiPath="/api/companies/co_1/departments" resourceLabel="Department" resourceLabelPlural="Departments" items={items} previewMode={false} />,
    );
    expect(screen.queryByText("1 Main St")).not.toBeInTheDocument();
  });

  it("disables Add and Deactivate in Preview Mode with an explanatory title", () => {
    render(
      <OrgMasterDataTab
        apiPath="/api/companies/co_1/departments"
        resourceLabel="Department"
        resourceLabelPlural="Departments"
        items={[{ id: 1, name: "Finance", code: "FIN", isActive: true }]}
        previewMode
      />,
    );
    const addButton = screen.getByRole("button", { name: /add department/i });
    expect(addButton).toBeDisabled();
    const deactivateButton = screen.getByRole("button", { name: /deactivate/i });
    expect(deactivateButton).toBeDisabled();
    expect(deactivateButton).toHaveAttribute("title", expect.stringContaining("Supabase"));
  });

  it("disables Add when the name field is blank", () => {
    render(
      <OrgMasterDataTab apiPath="/api/companies/co_1/departments" resourceLabel="Department" resourceLabelPlural="Departments" items={[]} previewMode={false} />,
    );
    expect(screen.getByRole("button", { name: /add department/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/department name/i), { target: { value: "Marketing" } });
    expect(screen.getByRole("button", { name: /add department/i })).not.toBeDisabled();
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(
      <OrgMasterDataTab
        apiPath="/api/companies/co_1/departments"
        resourceLabel="Department"
        resourceLabelPlural="Departments"
        items={[{ id: 1, name: "Finance", code: "FIN", isActive: true }]}
        previewMode={false}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
