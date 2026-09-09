/**
 * The ONE template engine every communication renders through — modules
 * never embed HTML/email text directly, they supply a template `code`
 * and `variables`. Pure, no I/O, exhaustively unit-tested.
 */

import type { CommunicationTemplate } from "./types";

const CONDITIONAL_PATTERN = /\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g;

function isTruthy(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return value !== 0;
  return Boolean(value);
}

/** Every `{{name}}` referenced in a template string, conditional section
 * names included — the "what variables does this template need" query
 * the admin UI's variable picker and validation both use. */
export function extractVariableNames(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(CONDITIONAL_PATTERN)) names.add(match[1]);
  for (const match of template.matchAll(VARIABLE_PATTERN)) names.add(match[1]);
  return [...names];
}

/** `{{#if name}}...{{/if}}` conditional sections, then `{{name}}`
 * substitution. A variable with no value in `variables` renders as an
 * empty string (never a raw `{{placeholder}}` leaking into a real
 * message) — callers that need to know what was missing should call
 * `extractVariableNames` first and diff against their own `variables`. */
export function renderText(template: string, variables: Record<string, unknown>): string {
  const withConditionals = template.replace(CONDITIONAL_PATTERN, (_match, name: string, body: string) => (isTruthy(variables[name]) ? body : ""));
  return withConditionals.replace(VARIABLE_PATTERN, (_match, name: string) => {
    const value = variables[name];
    return value === null || value === undefined ? "" : String(value);
  });
}

export type RenderedCommunication = { subject: string | null; body: string };

export function renderTemplate(template: Pick<CommunicationTemplate, "subjectTemplate" | "bodyTemplate">, variables: Record<string, unknown>): RenderedCommunication {
  return {
    subject: template.subjectTemplate ? renderText(template.subjectTemplate, variables) : null,
    body: renderText(template.bodyTemplate, variables),
  };
}

/** Variable names the template references that have no value (or an
 * empty string) supplied — a warning signal for "Preview"/"Test Send",
 * not a hard failure (an empty section is still a valid, if sparse,
 * message). */
export function findMissingVariables(template: Pick<CommunicationTemplate, "subjectTemplate" | "bodyTemplate">, variables: Record<string, unknown>): string[] {
  const referenced = new Set<string>([...extractVariableNames(template.bodyTemplate), ...(template.subjectTemplate ? extractVariableNames(template.subjectTemplate) : [])]);
  return [...referenced].filter((name) => !isTruthy(variables[name]));
}
