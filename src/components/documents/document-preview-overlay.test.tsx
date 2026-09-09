import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { DocumentPreviewOverlay } from "./document-preview-overlay";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("DocumentPreviewOverlay — print architecture (Phase 20C)", () => {
  it("renders the document content inside the dedicated print-root id, and keeps chrome out of it", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const printRoot = document.getElementById("document-preview-printable");
    expect(printRoot).not.toBeNull();
    expect(printRoot).toHaveTextContent("Document body");
    // The header bar (title, Print, Close) is NOT inside the printable root.
    expect(printRoot).not.toHaveTextContent("Print");
    expect(printRoot).not.toHaveTextContent("Close");
  });

  it("marks the header chrome as no-print / print:hidden so application chrome never prints", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const closeButton = screen.getByRole("button", { name: "Close" });
    // Walk up to the header bar and confirm it carries the no-print marker.
    const header = closeButton.closest(".no-print");
    expect(header).not.toBeNull();
  });

  it("injects a @media print rule that hides everything except the printable root", () => {
    const { container } = render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const styleTag = container.querySelector("style");
    expect(styleTag?.textContent).toContain("@media print");
    expect(styleTag?.textContent).toContain("#document-preview-printable");
    expect(styleTag?.textContent).toContain("visibility: hidden");
  });

  it("calls window.print() when Print is clicked", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Close is clicked, when the backdrop is clicked, or on Escape", () => {
    const onClose = vi.fn();
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={onClose}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /close test document/i }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("exposes proper dialog semantics", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const dialog = screen.getByRole("dialog", { name: "Test Document" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("has no obvious accessibility violations", async () => {
    const { container } = render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("DocumentPreviewOverlay — Download PDF (Phase 24A)", () => {
  it("does not render a Download PDF action when no downloadHref is supplied (existing behavior unchanged)", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    expect(screen.queryByRole("link", { name: /download pdf/i })).not.toBeInTheDocument();
  });

  it("renders a Download PDF link pointing at the supplied href when provided", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()} downloadHref="/api/companies/company-a/sales/invoices/501/pdf">
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const link = screen.getByRole("link", { name: /download pdf/i });
    expect(link).toHaveAttribute("href", "/api/companies/company-a/sales/invoices/501/pdf");
  });

  it("Print remains available alongside Download PDF (both, not either/or)", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()} downloadHref="/api/companies/company-a/sales/invoices/501/pdf">
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download pdf/i })).toBeInTheDocument();
  });

  it("the Download PDF link is outside the printable root (never shown twice on the printed page)", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()} downloadHref="/api/companies/company-a/sales/invoices/501/pdf">
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const printRoot = document.getElementById("document-preview-printable");
    expect(printRoot).not.toHaveTextContent("Download PDF");
  });
});

describe("DocumentPreviewOverlay — headerExtra slot (Phase 24B)", () => {
  it("renders nothing extra when headerExtra is not supplied (existing behavior unchanged)", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    expect(screen.queryByText("Extra action")).not.toBeInTheDocument();
  });

  it("renders the supplied headerExtra content", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()} headerExtra={<span>Extra action</span>}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    expect(screen.getByText("Extra action")).toBeInTheDocument();
  });

  it("keeps headerExtra out of the printable root", () => {
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()} headerExtra={<span>Extra action</span>}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const printRoot = document.getElementById("document-preview-printable");
    expect(printRoot).not.toHaveTextContent("Extra action");
  });
});
