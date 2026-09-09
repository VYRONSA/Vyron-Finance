import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose conditional class names, letting later Tailwind classes win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Finding #173 (RC-16/E12) — avatar initials used to be a raw
 * `.slice(0, 2)` of the email string (e.g. "john.doe@co.com" → "JO"),
 * not real initials. Derives up to 2 letters from the email's
 * local-part, split on the common separators a person's own name
 * commonly appears with in an address (john.doe / john_doe / john-doe
 * / john doe) — "john.doe@co.com" → "JD". Falls back to the first
 * letter alone when there's only one part, and to `fallback` when
 * there's no email at all (preview mode, or a not-yet-loaded session). */
export function getInitials(email: string | null | undefined, fallback: string): string {
  const localPart = email?.split("@")[0];
  if (!localPart) return fallback.slice(0, 2).toUpperCase();
  const parts = localPart.split(/[._\-\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return localPart.slice(0, 2).toUpperCase();
}
