import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useUnsavedChangesWarning } from "./use-unsaved-changes-warning";

describe("useUnsavedChangesWarning", () => {
  it("registers a beforeunload handler only while dirty", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { rerender, unmount } = renderHook(({ isDirty }) => useUnsavedChangesWarning(isDirty), {
      initialProps: { isDirty: false },
    });
    expect(addSpy).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));

    rerender({ isDirty: true });
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    rerender({ isDirty: false });
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    unmount();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("prevents default when the event fires while dirty", () => {
    // jsdom models a plain Event here, not a real BeforeUnloadEvent, so
    // `returnValue` doesn't hold a string the way it does in a real
    // browser — `preventDefault()` having been called is the portable,
    // meaningful signal that this hook did its job.
    renderHook(() => useUnsavedChangesWarning(true));

    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });
});
