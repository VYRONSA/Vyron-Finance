"use client";

import type { ComponentType, ReactNode, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, getInitials } from "@/lib/utils";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SessionExpiryGuard } from "@/components/auth/session-expiry-guard";
import { PrecisiaWordmark, VyronsoftAttribution } from "@/components/ui/precisia-wordmark";
import { PIconBilling, PIconHome, PIconLock, PIconOffice, PIconOperations, PIconUsers } from "@/components/ui/precisia-icons";
import { IconFileText, IconHelpCircle } from "@/components/ui/icons";

type NavItem = { label: string; href: string; icon: ComponentType<SVGProps<SVGSVGElement>> };

// Sections and items exactly as the "Precisia Platform Workspace"
// reference lists them (unchanged destinations from before the rebrand).
const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", href: "/platform", icon: PIconHome },
      { label: "Operations Centre", href: "/platform/operations", icon: PIconOperations },
      { label: "Billing Operations", href: "/platform/billing", icon: PIconBilling },
    ],
  },
  {
    label: "Manage",
    items: [
      { label: "My Companies", href: "/platform#companies", icon: PIconOffice },
      { label: "Subscription & Billing", href: "/platform#subscription", icon: IconFileText },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Profile & Platform Settings", href: "/platform#profile", icon: PIconUsers },
      { label: "Change Password", href: "/platform/account", icon: PIconLock },
      { label: "Support", href: "/platform#support", icon: IconHelpCircle },
    ],
  },
];

export function WorkspaceShell({
  children,
  userEmail,
  previewMode,
}: {
  children: ReactNode;
  userEmail?: string;
  previewMode?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#020b16] font-sans text-[#f3f7fd]">
      {!previewMode && <SessionExpiryGuard />}
      {previewMode && (
        <div className="border-b border-vf-red-500/25 bg-vf-red-500/10 px-4 py-2 text-center text-xs font-medium text-vf-red-300">
          Preview Mode — no Supabase project is configured yet, so this workspace is showing mock
          data with authentication disabled. See ARCHITECTURE.md.
        </div>
      )}

      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-[222px] shrink-0 flex-col overflow-hidden border-r border-[#12325a]/60 bg-gradient-to-b from-[#03101f] via-[#020c19] to-[#000912] lg:flex">
          {/* The reference's light-wave detail at the foot of the rail —
              its own pixels (public/brand/precisia-ref). */}
          {/* eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels */}
          <img
            src="/brand/precisia-ref/platform-sidebar-waves.png"
            alt=""
            aria-hidden
            width={222}
            height={265}
            className="pointer-events-none absolute bottom-[82px] left-0 h-[265px] w-[222px] [mask-image:linear-gradient(to_bottom,transparent,#000_40px,#000_calc(100%-30px),transparent)]"
          />
          <Link href="/" className="relative px-6 pt-6 pb-5" aria-label="PRECISIA — home">
            <PrecisiaWordmark size="md" />
          </Link>

          <nav className="relative flex flex-1 flex-col gap-2 overflow-y-auto pb-6">
            {NAV_SECTIONS.map((section, i) => (
              <div key={section.label}>
                {i > 0 && <div aria-hidden className="mx-6 mt-1 mb-3 h-px bg-white/10" />}
                <p className="px-6 pb-3 text-[0.66rem] font-semibold tracking-[0.14em] text-[#a9b8cc] uppercase">{section.label}</p>
                <ul className="flex flex-col gap-[5.5px]">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    const active = !item.href.includes("#") && pathname === item.href;
                    return (
                      <li key={item.label}>
                        <Link
                          href={item.href}
                          className={cn(
                            "mr-3 flex items-center gap-3 rounded-r-[10px] px-6 py-2 text-[0.8rem] font-medium whitespace-nowrap transition-colors duration-150",
                            active ? "pc-nav-active" : "text-[#e6ecf5] hover:bg-white/5 hover:text-white",
                          )}
                        >
                          <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-white" : "text-[#3f9bff]")} />
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <VyronsoftAttribution stacked className="relative px-6 pb-7 text-[#dbe4f1]" />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-[64px] items-center justify-between gap-4 border-b border-[#12325a]/70 bg-[#031321]/95 px-6 backdrop-blur-md">
            <div className="flex items-center gap-4">
              <Link href="/" className="lg:hidden" aria-label="PRECISIA — home">
                <PrecisiaWordmark size="sm" subtitle={false} />
              </Link>
              <p className="truncate text-[1rem] font-semibold text-white">Platform Workspace</p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <span className="hidden border-r border-white/12 pr-5 text-[0.9rem] text-[#e6ecf5] sm:inline">{userEmail ?? "preview@precisia.app"}</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-b from-[#1b7cff] to-[#0b4fc4] text-xs font-semibold text-white shadow-[0_0_0_2px_rgba(47,155,255,0.25)]">
                {getInitials(userEmail, "P")}
              </span>
              {userEmail && <SignOutButton className="text-[0.9rem] font-medium text-[#e6ecf5] transition hover:text-white" />}
            </div>
          </header>

          <main className="min-w-0 flex-1 px-4 pt-7 pb-5 sm:px-5">{children}</main>
        </div>
      </div>
    </div>
  );
}
