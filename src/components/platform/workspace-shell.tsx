import type { ReactNode } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/ui/brand-mark";
import { SignOutButton } from "@/components/auth/sign-out-button";

const NAV_SECTIONS: { label: string; items: { label: string; href: string }[] }[] = [
  {
    label: "Workspace",
    items: [
      { label: "Overview", href: "/platform" },
      { label: "Operations Centre", href: "/platform/operations" },
      { label: "Billing Operations", href: "/platform/billing" },
    ],
  },
  {
    label: "Manage",
    items: [
      { label: "My Companies", href: "/platform#companies" },
      { label: "Subscription & Billing", href: "/platform#subscription" },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Profile & Platform Settings", href: "/platform#profile" },
      { label: "Change Password", href: "/platform/account" },
      { label: "Support", href: "/platform#support" },
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
  return (
    <div className="min-h-screen bg-vf-canvas">
      {previewMode && (
        <div className="border-b border-vf-red-500/25 bg-vf-red-500/10 px-4 py-2 text-center text-xs font-medium text-vf-red-300">
          Preview Mode — no Supabase project is configured yet, so this workspace is showing mock
          data with authentication disabled. See ARCHITECTURE.md.
        </div>
      )}

      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-vf-dark-border bg-vf-canvas-raised px-4 py-6 lg:flex">
          <Link href="/" className="mb-8 flex items-center gap-2.5 px-2 font-display text-lg text-vf-on-dark">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-vf-charcoal">
              <BrandMark className="h-4 w-4" />
            </span>
            VYRON FINANCE
          </Link>

          <nav className="flex flex-1 flex-col gap-6">
            {NAV_SECTIONS.map((section) => (
              <div key={section.label}>
                <p className="px-2 text-xs font-semibold uppercase tracking-wide text-vf-on-dark-faint">
                  {section.label}
                </p>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {section.items.map((item) => (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        className="block rounded-vf-sm px-2 py-1.5 text-sm text-vf-on-dark-soft transition hover:bg-white/5 hover:text-vf-on-dark"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <p className="px-2 text-xs text-vf-on-dark-faint">Part of the VYRON ecosystem.</p>
        </aside>

        <div className="flex flex-1 flex-col">
          <header className="vf-glass sticky top-0 z-10 flex items-center justify-between border-b border-vf-dark-border px-6 py-3.5">
            <p className="text-sm font-medium text-vf-on-dark">Platform Workspace</p>
            <div className="flex items-center gap-3">
              <span className="text-sm text-vf-on-dark-soft">{userEmail ?? "preview@vyron.finance"}</span>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-vf-red-500 to-vf-red-800 text-xs font-medium text-vf-on-dark">
                {(userEmail ?? "P")[0]?.toUpperCase()}
              </span>
              {userEmail && <SignOutButton />}
            </div>
          </header>

          <main className="flex-1 px-6 py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
