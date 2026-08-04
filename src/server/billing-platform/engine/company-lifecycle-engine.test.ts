import { describe, expect, it } from "vitest";
import { deriveCompanyLifecycleState } from "./company-lifecycle-engine";

describe("deriveCompanyLifecycleState", () => {
  it("maps every subscription status onto its own PascalCase lifecycle state, 1:1", () => {
    expect(deriveCompanyLifecycleState("trial")).toBe("Trial");
    expect(deriveCompanyLifecycleState("active")).toBe("Active");
    expect(deriveCompanyLifecycleState("past_due")).toBe("PastDue");
    expect(deriveCompanyLifecycleState("grace_period")).toBe("GracePeriod");
    expect(deriveCompanyLifecycleState("suspended")).toBe("Suspended");
    expect(deriveCompanyLifecycleState("cancelled")).toBe("Cancelled");
    expect(deriveCompanyLifecycleState("expired")).toBe("Expired");
    expect(deriveCompanyLifecycleState("archived")).toBe("Archived");
  });
});
