import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { ModalPortal } from "./modal-portal";

describe("ModalPortal", () => {
  it("renders its children directly under <body> on the client, not inside the caller's DOM", () => {
    const { container } = render(
      <div data-testid="caller">
        <ModalPortal>
          <div data-testid="overlay">overlay</div>
        </ModalPortal>
      </div>,
    );
    const overlay = screen.getByTestId("overlay");
    expect(overlay.parentElement).toBe(document.body);
    expect(container.querySelector('[data-testid="overlay"]')).toBeNull();
  });

  it("renders inline during server rendering (the server-rendered PDF views depend on this)", () => {
    const html = renderToString(
      <div data-testid="caller">
        <ModalPortal>
          <span>printable document</span>
        </ModalPortal>
      </div>,
    );
    expect(html).toContain('<div data-testid="caller"><span>printable document</span></div>');
  });
});
