/**
 * Phase 26G — regression coverage for the Dashboard compaction. A fresh
 * audit (Phase 26G Part M) found the previous page rendered a giant
 * "Detailed Financials" block — a 54-tile Executive Summary strip,
 * Recovery Trend/Import Activity/Allocation Status/Cash Position/AI
 * Insights row, Age Analysis, two more rows of Top Suppliers/Customers/
 * Largest Journals/Sales/Bills/Products, a Recent Journal Entries table,
 * and Copilot Insights — that entirely duplicated what each module's own
 * page (Sales/Purchasing/Inventory/General Ledger/Copilot) already shows
 * in more detail, plus a "Quick Launch" nav grid fully redundant with the
 * sidebar. This proves that block is gone and the genuinely useful
 * sections (compact hero, trimmed KPIs, VYRON Intelligence/Needs
 * Attention, Business Setup Progress, one Recent Activity feed) remain —
 * using this codebase's own established pattern for testing an async
 * Server Component page directly (see `transactions/page.test.tsx`):
 * force `previewMode` via `isSupabaseConfigured`, so the real JSX renders
 * against static mock data with zero repository mocking needed.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/supabase/is-configured", () => ({ isSupabaseConfigured: vi.fn(() => false) }));

import DashboardPage from "./page";

async function renderPage() {
  const element = await DashboardPage({ params: Promise.resolve({ companyId: "company-a" }) });
  return render(element);
}

describe("Dashboard page — Phase 26G compaction", () => {
  it("renders without crashing in preview mode", async () => {
    await renderPage();
    expect(screen.getByText("Executive KPIs")).toBeInTheDocument();
  });

  it("no longer renders the 'Detailed Financials' heading or the 54-tile Executive Summary strip", async () => {
    await renderPage();
    expect(screen.queryByText("Detailed Financials")).not.toBeInTheDocument();
    expect(screen.queryByText("Net Profit (MTD)")).not.toBeInTheDocument();
    expect(screen.queryByText("Business Risk Score")).not.toBeInTheDocument();
  });

  it("no longer renders Recovery Trend / Import Activity / Allocation Status / Cash Position / AI Insights", async () => {
    await renderPage();
    expect(screen.queryByText("Recovery Trend")).not.toBeInTheDocument();
    expect(screen.queryByText("Import Activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Allocation Status")).not.toBeInTheDocument();
    expect(screen.queryByText("Cash Position")).not.toBeInTheDocument();
    expect(screen.queryByText("AI Insights")).not.toBeInTheDocument();
  });

  it("no longer renders Age Analysis", async () => {
    await renderPage();
    expect(screen.queryByText("Age Analysis")).not.toBeInTheDocument();
  });

  it("no longer renders the duplicate Top Suppliers/Customers/Largest Journals/Sales/Bills/Products cards", async () => {
    await renderPage();
    expect(screen.queryByText("Top Suppliers")).not.toBeInTheDocument();
    expect(screen.queryByText("Top Customers")).not.toBeInTheDocument();
    expect(screen.queryByText("Largest Journals")).not.toBeInTheDocument();
    expect(screen.queryByText("Largest Sales")).not.toBeInTheDocument();
    expect(screen.queryByText("Largest Bills")).not.toBeInTheDocument();
    expect(screen.queryByText("Top Moving Products")).not.toBeInTheDocument();
  });

  it("no longer renders Recent Journal Entries or Copilot Insights", async () => {
    await renderPage();
    expect(screen.queryByText("Recent Journal Entries")).not.toBeInTheDocument();
    expect(screen.queryByText("Copilot Insights")).not.toBeInTheDocument();
  });

  it("no longer renders the 'Quick Launch' nav grid — fully redundant with the sidebar", async () => {
    await renderPage();
    expect(screen.queryByText("Quick Launch")).not.toBeInTheDocument();
  });

  it("no longer renders a 'Recovery Alerts' card as a separate element (Needs Attention/VYRON Intelligence covers this)", async () => {
    await renderPage();
    expect(screen.queryByText("Recovery Alerts")).not.toBeInTheDocument();
  });

  it("still renders the compact company hero with its 5 action buttons", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "Import Bank Statement" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Invoice" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Supplier Bill" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Opening Balances" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AI Assistant" })).toBeInTheDocument();
  });

  it("Executive KPIs are trimmed to 5 genuinely distinct tiles — no 'Coming Soon' placeholders, no redundant Bank Accounts count", async () => {
    await renderPage();
    expect(screen.getByText("Cash Balance")).toBeInTheDocument();
    expect(screen.getByText("Outstanding Customers")).toBeInTheDocument();
    expect(screen.getByText("Outstanding Suppliers")).toBeInTheDocument();
    expect(screen.getByText("Profit This Month")).toBeInTheDocument();
    expect(screen.getByText("VAT Due")).toBeInTheDocument();
    expect(screen.queryByText("Coming Soon")).not.toBeInTheDocument();
    expect(screen.queryByText("Bank Accounts")).not.toBeInTheDocument();
  });

  it("still renders VYRON Intelligence (Needs Attention) and Business Setup Progress", async () => {
    await renderPage();
    expect(screen.getByText("VYRON Intelligence")).toBeInTheDocument();
    expect(screen.getByText("Business Setup Progress")).toBeInTheDocument();
  });

  it("still renders exactly one Recent Activity feed (previously duplicated twice)", async () => {
    await renderPage();
    expect(screen.getAllByText("Recent Activity")).toHaveLength(1);
  });
});
