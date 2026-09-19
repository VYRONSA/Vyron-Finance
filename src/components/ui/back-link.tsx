"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconChevronLeft } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * Phase 5G — the one Back control.
 *
 * It is a REAL link to `fallbackHref` first and a history step second.
 * That ordering is the whole design:
 *
 *   - a bare `router.back()` does nothing useful when there is no
 *     history (opened in a new tab, pasted URL, first page of the
 *     session, arrived from an external link) — it either sits there or
 *     leaves the app entirely;
 *   - a real `href` means the control works without JavaScript, can be
 *     middle-clicked or opened in a new tab, is focusable and
 *     announced as a link, and always has a correct destination.
 *
 * So the element is an anchor pointing at the page you'd go "up" to,
 * and the click handler upgrades that to a genuine history step ONLY
 * when going back is provably better — i.e. the previous page was
 * inside this same company's workspace. `shouldUseHistoryBack` below is
 * the whole rule, exported so it can be tested directly.
 */

/** Is stepping back in history safe and appropriate?
 *
 * `referrer` is the previous document's URL (empty when there is no
 * history, when the page was opened directly, or when the referrer is
 * suppressed). `scopePrefix` is the path every acceptable previous page
 * must sit under — the company workspace, or `/platform`. Anything
 * else (another company, an external site, a fresh tab) falls back to
 * the explicit destination instead.
 */
export function shouldUseHistoryBack(referrer: string, origin: string, scopePrefix: string): boolean {
  if (!referrer) return false;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return false;
  }
  // A different site is never a sensible in-app "back".
  if (url.origin !== origin) return false;
  // A different company's page would silently cross the tenant
  // boundary, which is exactly what must not happen.
  return url.pathname === scopePrefix || url.pathname.startsWith(`${scopePrefix}/`);
}

export function BackLink({
  href,
  label = "Back",
  scopePrefix,
  className,
}: {
  /** Where "up" goes when history cannot be trusted. Always a real href. */
  href: string;
  /** Accessible, visible label — "Back to Suppliers" reads better than "Back". */
  label?: string;
  /** Path the previous page must be under for a history step to be used.
   * Defaults to the destination's own workspace root, derived from
   * `href` (`/company/{id}` or `/platform`). */
  scopePrefix?: string;
  className?: string;
}) {
  const router = useRouter();

  // `/company/abc/suppliers` -> `/company/abc`; `/platform/x` -> `/platform`.
  const derivedScope = (() => {
    const companyMatch = href.match(/^\/company\/[^/]+/);
    if (companyMatch) return companyMatch[0];
    if (href.startsWith("/platform")) return "/platform";
    return "/";
  })();
  const scope = scopePrefix ?? derivedScope;

  return (
    <Button
      href={href}
      variant="subtle"
      size="sm"
      className={cn("gap-1.5 self-start", className)}
      onClick={(e) => {
        // Let the browser handle new-tab / new-window / download intents.
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (typeof window === "undefined") return;
        if (!shouldUseHistoryBack(document.referrer, window.location.origin, scope)) return;
        // Going back is the better answer here: it restores the previous
        // page's own state — its open tab, filters, scroll and search —
        // which navigating to `href` would discard.
        e.preventDefault();
        router.back();
      }}
    >
      <IconChevronLeft className="h-3.5 w-3.5" aria-hidden />
      {label}
    </Button>
  );
}
