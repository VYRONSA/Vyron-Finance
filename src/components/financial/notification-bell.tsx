"use client";

import { useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconBell } from "@/components/ui/icons";
import { MOCK_NOTIFICATIONS } from "@/lib/mock/automation-data";
import type { AppNotification } from "@/server/automation/types";

const SEVERITY_DOT: Record<AppNotification["severity"], string> = {
  info: "bg-vf-info",
  warning: "bg-vf-warning",
  critical: "bg-vf-red-500",
};

/** Real Notification Centre bell — replaces the previously hardcoded
 * "2" badge. Fetches on mount and whenever opened; Preview Mode shows
 * the same sample data every other module's Preview Mode uses. */
export function NotificationBell({ companyId, previewMode }: { companyId: string; previewMode?: boolean }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>(previewMode ? MOCK_NOTIFICATIONS : []);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  function load() {
    if (previewMode) return;
    setLoading(true);
    fetch(`/api/companies/${companyId}/notifications`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setNotifications(data.notifications ?? []);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (previewMode) return;
    fetch(`/api/companies/${companyId}/notifications`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok) setNotifications(data.notifications ?? []);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function markAllRead() {
    if (previewMode) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    await fetch(`/api/companies/${companyId}/notifications`, { method: "PATCH" });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
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
              notifications.map((n) => (
                <div key={n.id} className={`flex gap-2 border-b border-vf-paper-border px-3 py-2.5 last:border-0 ${n.isRead ? "" : "bg-vf-red-500/5"}`}>
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[n.severity]}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-xs font-semibold text-vf-ink">
                      {n.severity === "critical" && <IconAlertTriangle className="h-3 w-3 text-vf-danger" />}
                      {n.title}
                    </p>
                    {n.message && <p className="mt-0.5 truncate text-xs text-vf-ink-faint">{n.message}</p>}
                    <p className="mt-0.5 text-[0.65rem] text-vf-ink-faint">{new Date(n.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
