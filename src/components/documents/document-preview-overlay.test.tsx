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
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const styleTag = document.body.querySelector("style");
    expect(styleTag?.textContent).toContain("@media print");
    expect(styleTag?.textContent).toContain("#document-preview-printable");
    expect(styleTag?.textContent).toContain("visibility: hidden");
  });

  it("prints on a white page: the dark application background is reset for print and PDF", () => {
    // Regression: the body's own dark background survives `body * { visibility: hidden }`,
    // so page.pdf({ printBackground: true }) produced near-black pages.
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const css = document.body.querySelector("style")?.textContent ?? "";
    expect(css).toMatch(/html,\s*body\s*\{\s*background:\s*#fff\s*!important/);
    expect(css).toMatch(/#document-preview-printable\s*\{[^}]*background:\s*#fff/);
  });

  it("pins the printed document to the top of the page, not one screen down", () => {
    // Regression: portaled after the full-height app shell, a relatively
    // positioned overlay/dialog pushed the printable root onto page 2 and
    // left page 1 of every PDF blank. In print both must be static so the
    // root's `position: absolute; top: 0` resolves against the page.
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("print:static");
    expect(dialog.parentElement?.className).toContain("print:static");
    expect(dialog.parentElement?.className).not.toContain("print:relative");
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
    render(
      <DocumentPreviewOverlay title="Test Document" onClose={vi.fn()}>
        <p>Document body</p>
      </DocumentPreviewOverlay>,
    );
    expect(await axe(document.body)).toHaveNoViolations();
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

describe("DocumentPreviewOverlay — layout stability (production defect: invoice modal jumping)", () => {
  // Root cause: the overlay is `position: fixed`, and it used to render
  // inside the Sales page's paper <Card>, whose hover style applies a CSS
  // translate. A transformed ancestor becomes the containing block for
  // fixed descendants, so hovering re-anchored the "full-screen" overlay
  // to the Card's box and it oscillated as the pointer moved. The fix is
  // structural: the overlay must never have a page element as a DOM
  // ancestor. These tests pin that invariant.
  function renderInsideTransformedCard() {
    return render(
      <div data-testid="hover-card" style={{ transform: "translateY(-2px)" }} className="hover:-translate-y-0.5">
        <DocumentPreviewOverlay title="Tax Invoice INV-0001" onClose={vi.fn()} downloadHref="/api/companies/c/sales/invoices/1/pdf">
          <p>Document body</p>
        </DocumentPreviewOverlay>
      </div>,
    );
  }

  it("mounts the overlay as a direct child of <body>, outside any page ancestor", () => {
    renderInsideTransformedCard();
    const dialog = screen.getByRole("dialog", { name: "Tax Invoice INV-0001" });
    const overlayRoot = dialog.parentElement;
    expect(overlayRoot?.parentElement).toBe(document.body);
    expect(dialog.closest('[data-testid="hover-card"]')).toBeNull();
  });

  it("no ancestor of the fixed overlay has a transform/filter that would capture it", () => {
    renderInsideTransformedCard();
    const overlayRoot = screen.getByRole("dialog").parentElement!;
    expect(overlayRoot.className).toContain("fixed");
    for (let el = overlayRoot.parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      expect(cs.transform === "" || cs.transform === "none").toBe(true);
      expect(cs.filter === "" || cs.filter === "none").toBe(true);
    }
  });

  it("contains scroll chaining and reserves the scrollbar gutter so the dialog never shifts sideways", () => {
    renderInsideTransformedCard();
    const overlayRoot = screen.getByRole("dialog").parentElement!;
    expect(overlayRoot.className).toContain("overscroll-contain");
    expect(overlayRoot.className).toContain("[scrollbar-gutter:stable]");
  });

  it("Print, Download PDF and Close keep working from the portaled overlay", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const onClose = vi.fn();
    render(
      <div style={{ transform: "translateY(-2px)" }}>
        <DocumentPreviewOverlay title="Tax Invoice INV-0001" onClose={onClose} downloadHref="/api/companies/c/sales/invoices/1/pdf" headerExtra={<button type="button">Send Email</button>}>
          <p>Document body</p>
        </DocumentPreviewOverlay>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /download pdf/i })).toHaveAttribute("href", "/api/companies/c/sales/invoices/1/pdf");
    expect(screen.getByRole("button", { name: "Send Email" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("removes the portaled overlay from <body> when it unmounts", () => {
    const { unmount } = renderInsideTransformedCard();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    unmount();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
});
