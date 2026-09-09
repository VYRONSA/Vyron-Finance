/**
 * Master Implementation Tracker — Epic E13, Finding #178. The password
 * policy used to be a bare 8-character-minimum check, duplicated three
 * times (server-side in bootstrap-service.ts, client-side in
 * set-password-form.tsx and bootstrap-admin-form.tsx). One shared rule,
 * usable on both sides, closes the duplication and strengthens the
 * policy modestly — a letter and a number, not a full strength-meter
 * UI, which would be disproportionate for this finding.
 */
export const MIN_PASSWORD_LENGTH = 8;

export function passwordPolicyError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[a-zA-Z]/.test(password)) return "Password must include at least one letter.";
  if (!/[0-9]/.test(password)) return "Password must include at least one number.";
  return null;
}
