import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUrlParam } from "./use-url-param";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => "/company/co_1/cashbook",
  useSearchParams: () => new URLSearchParams("tab=enquiry&other=1"),
}));

describe("useUrlParam", () => {
  it("reads the initial value from the URL on mount", () => {
    const { result } = renderHook(() => useUrlParam("tab", "capture"));
    expect(result.current[0]).toBe("enquiry");
  });

  it("falls back to the default when the param is absent", () => {
    const { result } = renderHook(() => useUrlParam("missing", "capture"));
    expect(result.current[0]).toBe("capture");
  });

  it("updates the displayed value immediately and replaces the URL, preserving other params", () => {
    replaceMock.mockClear();
    const { result } = renderHook(() => useUrlParam("tab", "capture"));

    act(() => result.current[1]("batches"));

    expect(result.current[0]).toBe("batches");
    expect(replaceMock).toHaveBeenCalledWith("/company/co_1/cashbook?tab=batches&other=1", { scroll: false });
  });

  it("drops the param from the URL when set back to the default", () => {
    replaceMock.mockClear();
    const { result } = renderHook(() => useUrlParam("tab", "capture"));

    act(() => result.current[1]("capture"));

    expect(replaceMock).toHaveBeenCalledWith("/company/co_1/cashbook?other=1", { scroll: false });
  });
});
