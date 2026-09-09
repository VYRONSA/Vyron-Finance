import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import { ConfirmActionRow, useConfirmTarget } from "./confirm-action";

describe("ConfirmActionRow", () => {
  it("renders the message, confirm, and cancel controls and wires their handlers", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmActionRow message="Delete this?" loading={false} onConfirm={onConfirm} onCancel={onCancel} />);

    expect(screen.getByText("Delete this?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons and shows the loading label while loading", () => {
    render(<ConfirmActionRow message="Deleting" loading confirmingLabel="Deleting…" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /deleting…/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled();
  });

  it("renders an itemized preview and an error only when supplied", () => {
    const { rerender } = render(
      <ConfirmActionRow
        layout="panel"
        message="Post 2 journals?"
        itemsPreview={<ul><li>JR000001</li></ul>}
        loading={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("JR000001")).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument();

    rerender(
      <ConfirmActionRow layout="panel" message="Post 2 journals?" error="Posting failed." loading={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Posting failed.")).toBeInTheDocument();
  });
});

describe("useConfirmTarget", () => {
  it("tracks at most one armed target at a time and clears on cancel", () => {
    const { result } = renderHook(() => useConfirmTarget<number>());

    expect(result.current.isConfirming(1)).toBe(false);
    act(() => result.current.request(1));
    expect(result.current.isConfirming(1)).toBe(true);
    expect(result.current.isConfirming(2)).toBe(false);

    act(() => result.current.request(2));
    expect(result.current.isConfirming(1)).toBe(false);
    expect(result.current.isConfirming(2)).toBe(true);

    act(() => result.current.cancel());
    expect(result.current.isConfirming(2)).toBe(false);
  });
});
