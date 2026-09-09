"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconBell } from "@/components/ui/icons";
import { MOCK_NOTIFICATIONS } from "@/lib/mock/automation-data";
import type { AppNotification } from "@/server/automation/types";

const SEVERITY_DOT: Record<AppNotification["severity"], string> = {
  info: "bg-vf-info",
  warning: "bg-vf-warning",
  critical: "bg-vf-red-500",
};

/** Finding #131 (RC-16/E12) — every notification row was inert (no
 * onClick at all). Maps each real `relatedType` this app actually
 * creates notifications with (grep-confirmed against every
 * `createNotification` call site) to where a user would actually go to
 * act on it; anything unrecognized stays inert rather than guessing a
 * link that might not exist. */
function notificationHref(companyId: string, n: AppNotification): string | null {
  switch (n.relatedType) {
    case "Communication":
      return `/company/${companyId}/communications`;
    case "RecurringTemplate":
      return `/company/${companyId}/recurring-templates`;
    case "BillingEvent":
    case "Subscription":
      return `/company/${companyId}/billing`;
    case "executive_alert":
      return `/company/${companyId}/dashboard`;
    default:
      return null;
  }
}

/** Real Notification Centre bell — replaces the previously hardcoded
 * "2" badge. Fetches on mount and whenever opened; Preview Mode shows
 * the same sample data every other module's Preview Mode uses. */
export function NotificationBell({ companyId, previewMode }: { companyId: string; previewMode?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(previewMode ? MOCK_NOTIFICATIONS : []);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  // Finding #172 (RC-16/E12) — the mount effect and the open-click
  // handler each had their own copy of the identical fetch. One shared
  // function now does the actual fetch+setNotifications instead of two
  // near-duplicate implementations; mount still fetches silently (no
  // visible loading state — the panel isn't open yet) for an accurate
  // unread badge, and opening still shows a loading state and refetches
  // for freshness — both real triggers, kept, only the duplicated fetch
  // body itself was the defect. `fetchNotifications` returns its own
  // promise rather than setting `loading` itself, so the mount effect
  // can call it without a synchronous setState in the effect body.
  function fetchNotifications() {
    return fetch(`/api/companies/${companyId}/notifications`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setNotifications(data.notifications ?? []);
      });
  }

  function load() {
    if (previewMode) return;
    setLoading(true);
    fetchNotifications().finally(() => setLoading(false));
  }

  useEffect(() => {
    if (previewMode) return;
    void fetchNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Finding #213 (RC-15) — Escape now closes the panel and returns
  // focus to the bell trigger, matching this app's other overlay
  // dismiss conventions. Not a full focus trap (unlike the modal
  // detail panels `useFocusTrap` covers): this is a non-modal anchored
  // popover, so Tab is left free to continue into the rest of the page.
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  async function markAllRead() {
    if (previewMode) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await fetch(`/api/companies/${companyId}/notifications`, { method: "PATCH" });
  }

  // Finding #131 (RC-16/E12) — clicking a row now marks it read (the
  // per-notification PATCH route already existed, just never called
  // from the UI) and navigates to where it can actually be acted on.
  function openNotification(n: AppNotification) {
    const href = notificationHref(companyId, n);
    if (!previewMode && !n.isRead) {
      setNotifications((prev) => prev.map((item) => (item.id === n.id ? { ...item, isRead: true } : item)));
      void fetch(`/api/companies/${companyId}/notifications/${n.id}`, { method: "PATCH" });
    }
    if (href) {
      setOpen(false);
      router.push(href);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) load();
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-vf-ink-soft hover:bg-vf-paper-alt"
      >
        <IconBell className="h-4.5 w-4.5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-vf-red-500 text-[0.55rem] font-bold text-vf-on-dark">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-20 mt-2 w-80 rounded-vf-md border border-vf-paper-border bg-vf-paper shadow-xl">
          <div className="flex items-center justify-between border-b border-vf-paper-border px-3 py-2">
            <p className="text-sm font-semibold text-vf-ink">Notifications</p>
            <button type="button" className="text-xs font-medium text-vf-red-600 hover:underline disabled:opacity-50" disabled={previewMode || unreadCount === 0} onClick={markAllRead}>
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && <p className="p-3 text-xs text-vf-ink-faint">Loading…</p>}
            {!loading && notifications.length === 0 && <p className="p-3 text-xs text-vf-ink-faint">No notifications.</p>}
            {!loading &&
              notifications.map((n) => {
                const clickable = notificationHref(companyId, n) !== null;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => openNotification(n)}
                    className={`flex w-full gap-2 border-b border-vf-paper-border px-3 py-2.5 text-left last:border-0 ${n.isRead ? "" : "bg-vf-red-500/5"} ${clickable ? "hover:bg-vf-paper-alt" : "cursor-default"}`}
                  >
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[n.severity]}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1 text-xs font-semibold text-vf-ink">
                        {n.severity === "critical" && <IconAlertTriangle className="h-3 w-3 text-vf-danger" />}
                        {n.title}
                      </p>
                      {n.message && <p className="mt-0.5 truncate text-xs text-vf-ink-faint">{n.message}</p>}
                      <p className="mt-0.5 text-[0.65rem] text-vf-ink-faint">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
