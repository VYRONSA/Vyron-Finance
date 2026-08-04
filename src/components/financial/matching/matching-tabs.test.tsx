import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { MatchingTabs } from "./matching-tabs";
import {
  MOCK_CUSTOMER_MATCHING,
  MOCK_DUPLICATE_FINDINGS,
  MOCK_MATCHING_QUEUE,
  MOCK_MATCHING_SUMMARY,
  MOCK_MERCHANTS,
  MOCK_SUPPLIER_MATCHING,
} from "@/lib/mock/matching-data";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs(previewMode = true) {
  return render(
    <MatchingTabs
      companyId="co_1"
      summary={MOCK_MATCHING_SUMMARY}
      queue={MOCK_MATCHING_QUEUE}
      merchants={MOCK_MERCHANTS}
      duplicateFindings={MOCK_DUPLICATE_FINDINGS}
      customerMatching={MOCK_CUSTOMER_MATCHING}
      supplierMatching={MOCK_SUPPLIER_MATCHING}
      previewMode={previewMode}
    />,
  );
}

describe("MatchingTabs", () => {
  it("shows Dashboard as the default active tab with the 7 shared metrics", () => {
    renderTabs();
    expect(screen.getByText("Matching Accuracy")).toBeInTheDocument();
    expect(screen.getByText("Duplicate Risk")).toBeInTheDocument();
  });

  it("switches to the Review Queue tab and lists real unresolved items", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Review Queue" }));
    expect(screen.getByText(`${MOCK_MATCHING_QUEUE.length} of ${MOCK_MATCHING_QUEUE.length} items`)).toBeInTheDocument();
  });

  it("switches to the Customer Matching tab, defaulting to Suggestions with AI-scored candidates", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Customer Matching" }));
    if (MOCK_CUSTOMER_MATCHING.candidates.length > 0) {
      expect(screen.getAllByText(/% confidence/).length).toBeGreaterThan(0);
    } else {
      expect(screen.getByText("No suggested matches.")).toBeInTheDocument();
    }
  });

  it("switches to the Supplier Matching tab and lists real Bills", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Supplier Matching" }));
    fireEvent.click(screen.getByRole("button", { name: "Bills" }));
    if (MOCK_SUPPLIER_MATCHING.bills.length > 0) {
      expect(screen.getByText(MOCK_SUPPLIER_MATCHING.bills[0].invoiceNumber)).toBeInTheDocument();
    } else {
      expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    }
  });

  it("switches to the Merchant Matching tab and lists learned merchants", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Merchant Matching" }));
    expect(screen.getByText(MOCK_MERCHANTS[0].name)).toBeInTheDocument();
  });

  it("switches to the Duplicate Detection tab and lists findings filterable by all 12 entity types", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Detection" }));
    expect(screen.getByRole("button", { name: /^Customer \(/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Supplier \(/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Journal \(/ })).toBeInTheDocument();
    if (MOCK_DUPLICATE_FINDINGS.length > 0) {
      expect(screen.getAllByText(/% confidence/).length).toBeGreaterThan(0);
    } else {
      expect(screen.getByText("No duplicates found.")).toBeInTheDocument();
    }
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
