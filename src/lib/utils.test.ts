import { describe, expect, it } from "vitest";
import { getInitials } from "./utils";

describe("getInitials", () => {
  it("derives two initials from a dot-separated email local-part", () => {
    expect(getInitials("john.doe@company.com", "X")).toBe("JD");
  });

  it("handles underscore and hyphen separators the same way", () => {
    expect(getInitials("jane_smith@company.com", "X")).toBe("JS");
    expect(getInitials("mary-jones@company.com", "X")).toBe("MJ");
  });

  it("falls back to the first two letters when the local-part has only one part", () => {
    expect(getInitials("admin@company.com", "X")).toBe("AD");
  });

  it("falls back to the fallback string's initials when there's no email", () => {
    expect(getInitials(null, "Acme Trading")).toBe("AC");
    expect(getInitials(undefined, "Acme Trading")).toBe("AC");
  });
});
