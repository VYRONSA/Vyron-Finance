/**
 * Phase 5I — the Table scroll container must contain its own overflow.
 *
 * A wide table made the PAGE scroll sideways rather than the table
 * (measured: Sales 171px of horizontal document scroll at 1440 and 949px
 * at 390; Customers 676px at 390). Two causes, both fixed on this one
 * component so no page has to remember:
 *
 *   `min-w-0`  — a flex item's automatic minimum size is its content
 *                width, so inside a flex parent the scroll container grew
 *                to the table's width instead of shrinking.
 *
 *   `relative` — the real culprit. Tailwind's `sr-only` is
 *                `position: absolute`, and an absolutely positioned
 *                element is only clipped by an ancestor that is its
 *                containing block. With no positioned ancestor, an
 *                `sr-only` label in a far-right column had the DOCUMENT
 *                as its containing block and extended the page's
 *                scrollable width — straight through `overflow-x-auto`.
 *
 * jsdom does no layout, so this asserts the CSS contract that produces
 * the behaviour; the measured proof is the browser verification.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Table, TableBody, TableCell, TableHead, TableHeadCell, TableRow } from "./table";

function renderTable() {
  return render(
    <Table>
      <TableHead>
        <tr>
          <TableHeadCell>Document</TableHeadCell>
          <TableHeadCell className="text-right">
            <span className="sr-only">Actions</span>
          </TableHeadCell>
        </tr>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell>INV000001</TableCell>
          <TableCell>—</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("Table scroll container", () => {
  it("scrolls horizontally itself", () => {
    const { container } = renderTable();
    expect(container.firstElementChild?.className).toContain("overflow-x-auto");
  });

  it("can shrink inside a flex parent instead of growing to its content", () => {
    const { container } = renderTable();
    expect(container.firstElementChild?.className).toContain("min-w-0");
  });

  it("is positioned, so an absolutely positioned sr-only label cannot escape to the document", () => {
    const { container } = renderTable();
    expect(container.firstElementChild?.className).toContain("relative");
  });

  it("still lets the table itself size to its content", () => {
    const { container } = renderTable();
    expect(container.querySelector("table")?.className).toContain("min-w-max");
  });

  it("keeps an sr-only header label inside the scroll container", () => {
    const { container } = renderTable();
    const srOnly = container.querySelector(".sr-only");
    expect(srOnly).not.toBeNull();
    expect(container.firstElementChild?.contains(srOnly!)).toBe(true);
  });
});
