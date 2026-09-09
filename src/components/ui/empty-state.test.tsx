import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the title, description, and action", () => {
    render(
      <EmptyState
        title="No bank statements have been imported yet."
        description="Import your first bank statement to begin the recovery process."
        action={<button>Import Bank Statement</button>}
      />,
    );

    expect(screen.getByText("No bank statements have been imported yet.")).toBeInTheDocument();
    expect(screen.getByText("Import your first bank statement to begin the recovery process.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Bank Statement" })).toBeInTheDocument();
  });

  it("renders without an action or icon", () => {
    render(<EmptyState title="Nothing here" description="Nothing to see." />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
