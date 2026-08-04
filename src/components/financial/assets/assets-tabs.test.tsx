import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { AssetsTabs } from "./assets-tabs";
import { MOCK_ASSET_CLASSES, MOCK_ASSET_FINDINGS, MOCK_ASSET_LIFECYCLE_EVENTS, MOCK_DEPRECIATION_RUNS, MOCK_FIXED_ASSETS } from "@/lib/mock/asset-data";
import { buildAssetDashboardSummary } from "@/server/services/asset-dashboard-summary-service";
import { computeNetBookValue } from "@/server/assets/depreciation-engine";
import type { AssetLifecycleEvent } from "@/server/assets/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderTabs(previewMode = true) {
  const assets = MOCK_FIXED_ASSETS.map((a) => ({ ...a, netBookValue: computeNetBookValue(a.cost, a.accumulatedDepreciation, a.accumulatedImpairment) }));
  const summary = buildAssetDashboardSummary(MOCK_FIXED_ASSETS, MOCK_ASSET_FINDINGS, MOCK_DEPRECIATION_RUNS[0].totalAmount);
  const lifecycleEventsByAsset = MOCK_ASSET_LIFECYCLE_EVENTS.reduce<Record<number, AssetLifecycleEvent[]>>((acc, e) => {
    acc[e.assetId] = [...(acc[e.assetId] ?? []), e];
    return acc;
  }, {});

  return render(
    <AssetsTabs
      companyId="co_1"
      summary={summary}
      assets={assets}
      assetClasses={MOCK_ASSET_CLASSES}
      lifecycleEventsByAsset={lifecycleEventsByAsset}
      depreciationRuns={MOCK_DEPRECIATION_RUNS}
      findings={MOCK_ASSET_FINDINGS}
      previewMode={previewMode}
    />,
  );
}

describe("AssetsTabs", () => {
  it("shows Dashboard as the default active tab with a real Asset Health Score", () => {
    renderTabs();
    expect(screen.getByText("Asset Health Score")).toBeInTheDocument();
  });

  it("switches to the Register tab and lists real assets, drilling through on click", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(screen.getByText("Delivery Vehicle — Toyota Hilux")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Delivery Vehicle — Toyota Hilux"));
    expect(screen.getAllByText("Net Book Value").length).toBeGreaterThan(1);
  });

  it("switches to the Depreciation tab and lists the mock run", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Depreciation" }));
    expect(screen.getByText("2026-07-01 to 2026-07-31")).toBeInTheDocument();
  });

  it("switches to the Findings tab and lists open Asset Findings", () => {
    renderTabs();
    fireEvent.click(screen.getByRole("button", { name: "Findings" }));
    expect(screen.getAllByText(/OverdueReplacement|IdleAsset|CapitalisationAnomaly|WarrantyExpiry|InsuranceExpiry/).length).toBeGreaterThan(0);
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = renderTabs();
    expect(await axe(container)).toHaveNoViolations();
  });
});
