import { describe, expect, it } from "vitest";
import { extractVariableNames, findMissingVariables, renderTemplate, renderText } from "./template-engine";

describe("renderText", () => {
  it("substitutes a simple variable", () => {
    expect(renderText("Hello {{name}}", { name: "Nomsa" })).toBe("Hello Nomsa");
  });

  it("substitutes multiple occurrences of the same variable", () => {
    expect(renderText("{{name}} and {{name}} again", { name: "X" })).toBe("X and X again");
  });

  it("renders a missing variable as an empty string, never a raw placeholder", () => {
    expect(renderText("Hello {{name}}", {})).toBe("Hello ");
  });

  it("renders a conditional section when the variable is truthy", () => {
    expect(renderText("Dear customer,{{#if message}} {{message}}{{/if}}", { message: "Please pay." })).toBe("Dear customer, Please pay.");
  });

  it("omits a conditional section when the variable is falsy or missing", () => {
    expect(renderText("Dear customer,{{#if message}} {{message}}{{/if}}", {})).toBe("Dear customer,");
    expect(renderText("Dear customer,{{#if message}} {{message}}{{/if}}", { message: "" })).toBe("Dear customer,");
    expect(renderText("Dear customer,{{#if message}} {{message}}{{/if}}", { message: 0 })).toBe("Dear customer,");
  });

  it("handles numeric variable values", () => {
    expect(renderText("Balance: {{amount}}", { amount: 1250.5 })).toBe("Balance: 1250.5");
  });
});

describe("extractVariableNames", () => {
  it("finds plain variables and conditional variable names, deduped", () => {
    expect(extractVariableNames("{{name}}{{#if name}}{{amount}}{{/if}}").sort()).toEqual(["amount", "name"]);
  });

  it("returns an empty array for a template with no variables", () => {
    expect(extractVariableNames("Just plain text.")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("renders both subject and body", () => {
    const result = renderTemplate({ subjectTemplate: "Reminder for {{name}}", bodyTemplate: "Dear {{name}}, please pay." }, { name: "Meridian" });
    expect(result).toEqual({ subject: "Reminder for Meridian", body: "Dear Meridian, please pay." });
  });

  it("returns a null subject when the template has none", () => {
    const result = renderTemplate({ subjectTemplate: null, bodyTemplate: "Dear {{name}}" }, { name: "X" });
    expect(result.subject).toBeNull();
  });
});

describe("findMissingVariables", () => {
  it("reports variables referenced in the template with no truthy value supplied", () => {
    const template = { subjectTemplate: "Hi {{name}}", bodyTemplate: "Balance: {{amount}}{{#if note}} {{note}}{{/if}}" };
    expect(findMissingVariables(template, { name: "X" }).sort()).toEqual(["amount", "note"]);
  });

  it("reports nothing when every referenced variable has a truthy value", () => {
    const template = { subjectTemplate: "Hi {{name}}", bodyTemplate: "{{name}}" };
    expect(findMissingVariables(template, { name: "X" })).toEqual([]);
  });
});
