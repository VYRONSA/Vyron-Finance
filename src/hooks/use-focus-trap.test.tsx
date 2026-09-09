import { describe, expect, it } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { useRef } from "react";
import { useFocusTrap } from "./use-focus-trap";

function Dialog({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(active, ref);
  return (
    <div>
      <button type="button">Outside trigger</button>
      {active && (
        <div ref={ref} role="dialog" tabIndex={-1}>
          <button type="button">First</button>
          <button type="button">Middle</button>
          <button type="button">Last</button>
        </div>
      )}
    </div>
  );
}

describe("useFocusTrap", () => {
  it("moves initial focus into the dialog's first focusable element", () => {
    render(<Dialog active />);
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("falls back to focusing the container when nothing inside is focusable", () => {
    function EmptyDialog() {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(true, ref);
      return (
        <div ref={ref} role="dialog" tabIndex={-1}>
          <p>No interactive content</p>
        </div>
      );
    }
    render(<EmptyDialog />);
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("wraps Tab from the last focusable element back to the first", () => {
    render(<Dialog active />);
    screen.getByRole("button", { name: "Last" }).focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("wraps Shift+Tab from the first focusable element back to the last", () => {
    render(<Dialog active />);
    screen.getByRole("button", { name: "First" }).focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("restores focus to the previously focused element on close", () => {
    const { rerender } = render(<Dialog active={false} />);
    const trigger = screen.getByRole("button", { name: "Outside trigger" });
    trigger.focus();
    expect(trigger).toHaveFocus();

    rerender(<Dialog active />);
    expect(trigger).not.toHaveFocus();

    rerender(<Dialog active={false} />);
    expect(trigger).toHaveFocus();
  });

  it("does nothing when inactive", () => {
    render(<Dialog active={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
