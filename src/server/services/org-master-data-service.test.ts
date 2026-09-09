import { describe, expect, it } from "vitest";
import { createBranch, createCostCentre, createDepartment, ValidationError } from "./org-master-data-service";

describe("org master data validation", () => {
  it("rejects a blank branch name", () => {
    return expect(createBranch("co_1", { name: "" })).rejects.toThrow(ValidationError);
  });

  it("rejects a blank department name", () => {
    return expect(createDepartment("co_1", { name: "   " })).rejects.toThrow(ValidationError);
  });

  it("rejects a blank cost centre name", () => {
    return expect(createCostCentre("co_1", { name: "" })).rejects.toThrow(ValidationError);
  });
});
