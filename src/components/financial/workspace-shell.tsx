"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, getInitials } from "@/lib/utils";
import { PrecisiaWordmark, VyronsoftAttribution } from "@/components/ui/precisia-wordmark";
import { NAV_GROUPS, activeNavGroup, isNavItemActive } from "./workspace-nav";
import { WorkspaceNavSections } from "./workspace-nav-sections";
import { NotificationBell } from "@/components/financial/notification-bell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SessionExpiryGuard } from "@/components/auth/session-expiry-guard";
import { IconChevronDown, IconChevronLeft, IconHelpCircle, IconMenu, IconSearch, IconX } from "@/components/ui/icons";

// Phase 5G — NAV_GROUPS, ModuleLink, isNavItemActive and activeNavGroup
// now live in `workspace-nav.ts` so the desktop sidebar and the
// tablet/mobile drawer render from one model. Nothing about the list
// itself changed in the move.

/** "jane.smith@…" → "Jane Smith" — the account name shown beside
 * the avatar, as in the PRECISIA "Software Page" reference. Derived from
 * the signed-in user's own email; nothing is invented. */
function displayNameFromEmail(email: string | undefined): string | null {
  const local = email?.split("@")[0];
  if (!local) return null;
  return local
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function FinancialWorkspaceShell({
  children,
  companyId,
  companyName,
  companies,
  userEmail,
  previewMode,
}: {
  children: ReactNode;
  companyId: string;
  companyName: string;
  companies?: { id: string; name: string }[];
  userEmail?: string;
  previewMode?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  // Phase 5G — grouped navigation. The open section is DERIVED, not
  // synced in an effect: the route decides it, and a user's click
  // overrides it until the route moves to a different section.
  //
  // `override.base` records which section was active when the user last
  // clicked. Once the route moves elsewhere that no longer matches, so
  // the override is ignored and the new section opens on its own. This
  // gets "the active route opens its parent" and "clicking toggles"
  // without a setState-in-effect (which the React Compiler correctly
  // flags, and which would render twice on every navigation).
  const activeGroup = activeNavGroup(pathname, companyId);
  const [override, setOverride] = useState<{ base: string | null; value: string | null } | null>(null);
  const openGroup = override && override.base === activeGroup ? override.value : activeGroup;
  // One value, so only one section can ever be open; `null` = all closed.
  const toggleGroup = (label: string) => setOverride({ base: activeGroup, value: openGroup === label ? null : label });

  // Phase 5G — the tablet/mobile drawer. Below `lg` the sidebar is
  // hidden; until this existed there was no way to reach navigation at
  // 768x1024 at all. Same nav model, same groups, same permissions —
  // one navigation system rendered in two places.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Following a link closes the drawer — handled by the `onNavigate`
  // callback passed to the nav below, at the click, rather than by an
  // effect watching `pathname` (which would be a setState-in-effect and
  // an extra render on every navigation).

  // Escape closes it, and focus returns to the button that opened it so
  // keyboard users are not dropped at the top of the document.
  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileNavOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  // Opening the drawer moves focus into it, so the next Tab is a nav
  // item rather than something behind the overlay.
  useEffect(() => {
    if (mobileNavOpen) mobileNavRef.current?.focus();
  }, [mobileNavOpen]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) setSwitcherOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);
  const isActive = (href?: string, exact = false) => isNavItemActive(pathname, companyId, href, exact);
  const initials = getInitials(userEmail, companyName);
  const displayName = displayNameFromEmail(userEmail);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);
  // The dashboard is the one company screen the PRECISIA "Software Page"
  // reference defines — it renders on the dark PRECISIA canvas. Every
  // other module page keeps the light operational canvas its white
  // "paper" cards and ink text were designed for.
  const isDashboardRoute = pathname === `/company/${companyId}/dashboard` || pathname === `/company/${companyId}`;

  // UI-005 — "the sidebar must never visually move... full-height blue
  // application frame." A `sticky` sidebar (last round's fix) still
  // *unsticks* once a long page has scrolled far enough that the
  // sidebar would overrun the bottom of its own containing row — the
  // exact "blue shell ends, page continues beneath it" symptom
  // reported. Sticky was the wrong tool: it makes an element stay put
  // *within document scroll*, not stay put *instead of* document
  // scroll. Real native-app sidebars (Slack, Linear, Notion) don't
  // scroll the document at all — the whole shell is pinned to the
  // viewport and only specific *panes inside it* scroll. `<main>`'s own
  // scroll position doesn't reset on route change the way the browser
  // naturally resets document scroll, so this effect does that
  // explicitly on every navigation.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [pathname]);

  // UX-006 — "Full Screen Processing Mode... collapse sidebar to
  // icons-only... when entering Transaction Workspace." Only fires on
  // the transition INTO the route (guarded by the ref, which tracks the
  // previous render's value) — collapsing again on every re-render
  // inside the route would fight an accountant who manually re-expands
  // the sidebar while processing a statement.
  const isProcessingRoute = pathname.startsWith(`/company/${companyId}/transactions`);
  const wasProcessingRouteRef = useRef(isProcessingRoute);
  useEffect(() => {
    if (isProcessingRoute && !wasProcessingRouteRef.current) setCollapsed(true);
    wasProcessingRouteRef.current = isProcessingRoute;
  }, [isProcessingRoute]);

  // Phase 16, Part 11 — "focus mode" toggle for Transaction Explorer:
  // clicking anywhere in the sidebar restores it to normal width (giving
  // the nav its own space back); clicking anywhere back inside the
  // workspace content re-collapses it (giving Transaction Explorer the
  // working area back). Reuses the SAME `collapsed` state the manual
  // Collapse/Expand button and the entry-collapse effect above already
  // share — no second sidebar, no new shared-state module, no per-page
  // width. Both handlers are no-ops off the transactions route, so no
  // other page's sidebar behaviour changes. Neither calls
  // preventDefault/stopPropagation, so nav links, the manual toggle
  // button, and every interaction inside Transaction Explorer itself
  // (row selection, detail panel, attention queue, filters, import
  // workflow) keep working exactly as before — this only ever flips one
  // boolean on click-bubble.
  function expandSidebarIfProcessing() {
    if (isProcessingRoute && collapsed) setCollapsed(false);
  }
  function refocusExplorerIfProcessing() {
    if (isProcessingRoute && !collapsed) setCollapsed(true);
  }

  return (
    // `h-screen overflow-hidden` — the outermost frame is locked to
    // exactly the viewport size and never scrolls itself; every
    // scrollable region below is a deliberate, bounded exception
    // (`<nav>`, `<main>`), not the document. This is what actually
    // guarantees UI-003's "workspace must never scroll horizontally"
    // and UI-005's "sidebar must never visually move" at the same
    // time — both are the same underlying fix, a real fixed frame
    // instead of relying on sticky/overflow tricks layered on top of
    // ordinary document scroll.
    <div className="flex h-screen flex-col overflow-hidden bg-[#050c18]">
      {!previewMode && <SessionExpiryGuard />}
      {previewMode && (
        <div className="shrink-0 border-b border-vf-red-500/25 bg-vf-red-500/10 px-4 py-2 text-center text-xs font-medium text-vf-red-300">
          Preview Mode — no Supabase project is configured yet, so this workspace is showing mock
          data with authentication disabled. See ARCHITECTURE.md.
        </div>
      )}

      {/* Phase 5G — the tablet/mobile navigation drawer. It renders the
          SAME `WorkspaceNavSections` the sidebar does, from the same
          model and the same open-section state, so the two can never
          drift. `lg:hidden` keeps it out of the way entirely once the
          real sidebar is back. */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-vf-ink/40"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden
          />
          <div
            id="workspace-mobile-nav"
            ref={mobileNavRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-[#0f2238] bg-gradient-to-b from-[#020a16] via-[#010711] to-[#01060f] px-3 py-5 shadow-vf-paper-xl outline-none"
          >
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-vf-on-dark">{companyName}</span>
              <button
                type="button"
                onClick={() => {
                  setMobileNavOpen(false);
                  menuButtonRef.current?.focus();
                }}
                aria-label="Close navigation menu"
                className="flex h-8 w-8 items-center justify-center rounded-vf-sm text-vf-on-dark-soft transition-colors duration-150 ease-vf-out hover:bg-white/10 hover:text-vf-on-dark"
              >
                <IconX className="h-4.5 w-4.5" />
              </button>
            </div>
            <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto">
              <WorkspaceNavSections
                companyId={companyId}
                pathname={pathname}
                openGroup={openGroup}
                onToggleGroup={toggleGroup}
                onNavigate={() => setMobileNavOpen(false)}
                idPrefix="mobile-nav"
              />
            </nav>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          onClick={expandSidebarIfProcessing}
          className={cn(
            "hidden h-full shrink-0 flex-col border-r border-[#0f2238] bg-gradient-to-b from-[#020a16] via-[#010711] to-[#01060f] px-3 py-6 transition-[width] duration-300 ease-vf-out lg:flex",
            collapsed ? "w-[72px]" : "w-[230px]",
          )}
        >
          {/* PRECISIA wordmark, as in the "Software Page" reference. In
              icons-only mode there is room for the "PA" monogram only. */}
          <Link href="/platform" className="mb-5 flex px-4" title="PRECISIA — back to Platform Workspace" aria-label="PRECISIA — back to Platform Workspace">
            {collapsed ? (
              <span className="font-[family-name:var(--font-brand)] text-2xl text-white">
                P<span className="text-[#1d8dff]">A</span>
              </span>
            ) : (
              <PrecisiaWordmark size="md" subtitleTone="blue" />
            )}
          </Link>

          {/* Phase 5G — grouped when the sidebar is at full width. In
              icons-only mode (Transaction Explorer's focus mode) there is
              no room for section headings, so that mode keeps the flat
              icon list it always had — collapsing an icon strip into
              accordions would hide navigation behind two clicks for no
              gain. */}
          <nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto pt-1">
            {collapsed ? (
              NAV_GROUPS.flatMap((group) => group.items).map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href, item.exact);
                const itemClass = cn(
                  "flex items-center justify-center gap-2.5 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-vf-out",
                  active ? "pc-nav-active" : "text-[#c9d4e3] hover:bg-white/5 hover:text-white",
                );
                return item.href ? (
                  <Link key={item.label} href={`/company/${companyId}/${item.href}`} className={itemClass} title={item.label} aria-current={active ? "page" : undefined}>
                    <Icon className="h-4 w-4 shrink-0" />
                  </Link>
                ) : (
                  <span
                    key={item.label}
                    className="flex cursor-not-allowed items-center justify-center gap-2.5 rounded-[10px] px-3 py-2.5 text-sm font-medium text-white/30"
                    aria-disabled
                    title={`${item.label} — not available yet`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                  </span>
                );
              })
            ) : (
              <WorkspaceNavSections
                companyId={companyId}
                pathname={pathname}
                openGroup={openGroup}
                onToggleGroup={toggleGroup}
                idPrefix="sidebar-nav"
              />
            )}
          </nav>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "mt-4 flex items-center gap-2 rounded-[10px] px-3 py-2 text-xs font-medium text-[#7f8da6] transition-colors duration-150 ease-vf-out hover:bg-white/5 hover:text-white",
              collapsed && "justify-center",
            )}
          >
            <IconChevronLeft className={cn("h-3.5 w-3.5 transition-transform duration-300 ease-vf-out", collapsed && "rotate-180")} />
            {!collapsed && "Collapse"}
          </button>
        </aside>

        {/* `min-w-0` on both flex items below is the actual fix for
            VR-022 (Transaction Explorer's table pushing the whole page
            wider instead of scrolling internally) — a classic flexbox
            gotcha: a flex item's default `min-width` is `auto`, which
            lets it grow to fit its widest descendant (here, any page's
            wide data table) rather than respecting the row's available
            width, so the overflow propagates all the way up to the
            document instead of being caught by any `overflow-x-auto`
            container further down. Fixed once, here, in the one shell
            every page in this workspace renders inside — not per-page —
            so this can't recur on a page that happens to render a wide
            table later. `min-h-0` is the same fix on the height axis —
            needed now that `<main>` below has its own bounded scroll
            (UI-005) instead of the document scrolling. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="z-10 flex h-[70px] shrink-0 items-center justify-between gap-4 border-b border-[#16304d] bg-[#0b1a2a] px-4 font-sans sm:px-6">
            {/* Phase 5G — below `lg` the sidebar is hidden, so this is
                the only way into navigation at tablet and phone widths.
                Hidden at `lg` and up, where the real sidebar is back. */}
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMobileNavOpen((v) => !v)}
              aria-expanded={mobileNavOpen}
              aria-controls="workspace-mobile-nav"
              aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
              className="-ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[#dbe4f1] transition-colors duration-150 ease-vf-out hover:bg-white/8 hover:text-white lg:hidden"
            >
              {mobileNavOpen ? <IconX className="h-5 w-5" /> : <IconMenu className="h-5 w-5" />}
            </button>

            {/* Finding #129 (RC-16/E12) — this used to be a plain Link
                styled to look like a dropdown (a chevron-down icon, but
                clicking it only ever navigated to Platform Overview).
                Now a real dropdown when there's more than one company to
                switch between; with none or exactly one, it stays the
                simple "back to Platform Overview" link — a dropdown
                listing nothing but itself would be worse, not better. */}
            {companies && companies.length > 1 ? (
              <div ref={switcherRef} className="relative">
                <button
                  type="button"
                  onClick={() => setSwitcherOpen((v) => !v)}
                  aria-expanded={switcherOpen}
                  className="flex min-w-0 items-center gap-2.5 text-[0.95rem] font-medium text-white transition hover:text-[#8cc8ff]"
                >
                  <span className="truncate">{companyName}</span>
                  <IconChevronDown className="h-4 w-4 shrink-0 text-[#c9d4e3]" />
                </button>
                {switcherOpen && (
                  <div role="menu" className="absolute top-full left-0 z-20 mt-2 w-64 rounded-[12px] border border-[#29405c] bg-[#0b1a2b] py-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
                    {companies.map((c) => (
                      <Link
                        key={c.id}
                        href={`/company/${c.id}/dashboard`}
                        role="menuitem"
                        onClick={() => setSwitcherOpen(false)}
                        className={cn(
                          "block truncate px-3.5 py-2 text-sm transition hover:bg-white/6",
                          c.id === companyId ? "font-medium text-[#5cb3ff]" : "text-[#dbe4f1]",
                        )}
                      >
                        {c.name}
                      </Link>
                    ))}
                    <div className="mt-1 border-t border-white/10 pt-1">
                      <Link href="/platform" onClick={() => setSwitcherOpen(false)} className="block px-3.5 py-2 text-sm text-[#9fb0c6] transition hover:bg-white/6">
                        Platform Overview →
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/platform"
                className="flex min-w-0 items-center gap-2.5 text-[0.95rem] font-medium text-white transition hover:text-[#8cc8ff]"
                title="Back to Platform Overview"
              >
                <span className="truncate">{companyName}</span>
              </Link>
            )}

            {/* Workspace-wide search is not built yet, so the field stays
                disabled and says so. */}
            <div className="relative hidden w-full max-w-[600px] flex-1 md:block">
              <IconSearch className="pointer-events-none absolute top-1/2 left-4 h-4.5 w-4.5 -translate-y-1/2 text-[#9fb0c6]" />
              <input
                type="search"
                placeholder="Search — coming soon"
                disabled
                title="Workspace-wide search is not available yet"
                className="h-11 w-full cursor-not-allowed rounded-[12px] border border-[#243a55] bg-[#102133] pr-4 pl-11 text-sm text-[#9fb0c6] outline-none placeholder:text-[#9fb0c6]"
              />
            </div>

            <div className="flex items-center gap-2 text-[#dbe4f1] [&_button]:text-[#dbe4f1] [&_button:hover]:bg-white/8">
              <NotificationBell companyId={companyId} previewMode={previewMode} />
              <span
                className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full text-[#dbe4f1]"
                role="img"
                aria-label="Help — documentation coming soon"
                title="Help documentation is coming soon"
              >
                <IconHelpCircle className="h-5 w-5" />
              </span>
              <div ref={userMenuRef} className="relative ml-2 sm:ml-3">
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  aria-expanded={userMenuOpen}
                  aria-label="Account menu"
                  className="flex items-center gap-3 rounded-full py-0.5 pr-1 pl-0.5 hover:!bg-transparent"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-[#1b7cff] to-[#0b4fc4] text-sm font-semibold text-white shadow-[0_0_0_2px_rgba(47,155,255,0.3)]">
                    {initials}
                  </span>
                  {displayName && <span className="hidden text-[0.92rem] font-medium text-white sm:inline">{displayName}</span>}
                  <IconChevronDown className="h-4 w-4 text-[#c9d4e3]" />
                </button>
                {userMenuOpen && (
                  <div role="menu" className="absolute top-full right-0 z-20 mt-2 w-60 rounded-[12px] border border-[#29405c] bg-[#0b1a2b] py-1.5 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)]">
                    {userEmail && <p className="truncate border-b border-white/10 px-3.5 pt-1.5 pb-2.5 text-xs text-[#9fb0c6]">{userEmail}</p>}
                    <Link href="/platform" role="menuitem" onClick={() => setUserMenuOpen(false)} className="block px-3.5 py-2 text-sm text-[#dbe4f1] hover:bg-white/6">
                      Platform Workspace
                    </Link>
                    <Link href="/platform/account" role="menuitem" onClick={() => setUserMenuOpen(false)} className="block px-3.5 py-2 text-sm text-[#dbe4f1] hover:bg-white/6">
                      Change Password
                    </Link>
                    {userEmail && (
                      <div className="mt-1 border-t border-white/10 px-3.5 pt-2 pb-1">
                        <SignOutButton className="text-sm font-medium text-[#dbe4f1] transition hover:text-white" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>

          <main
            ref={mainRef}
            onClick={refocusExplorerIfProcessing}
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto",
              isDashboardRoute ? "pc-canvas" : "bg-vf-workspace-bg",
              isProcessingRoute ? "px-4 py-3 sm:px-6" : isDashboardRoute ? "px-4 pt-[19px] pb-3 sm:px-[17px]" : "px-4 py-6 sm:px-6 lg:px-8 2xl:px-10",
            )}
          >
            <div className="flex-1">{children}</div>
            {/* The reference's footer line. Only links to pages that exist
                are shown — there is no Privacy or Terms page yet. */}
            <footer
              className={cn(
                "mt-6 flex shrink-0 flex-wrap items-center justify-between gap-3 pt-3 font-sans text-[0.82rem]",
                isDashboardRoute ? "text-[#c2cedd]" : "border-t border-vf-paper-border text-vf-ink-faint",
              )}
            >
              <VyronsoftAttribution className="text-[0.82rem] [&_span]:font-medium" />
              <Link href="/platform#support" className="hover:underline">Support</Link>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
