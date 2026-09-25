"use client";

import { useState } from "react";
import Link from "next/link";
import { PrecisiaWordmark } from "@/components/ui/precisia-wordmark";
import { PIconArrowRight } from "@/components/ui/precisia-icons";

// Navigation exactly as the PRECISIA Landing Page reference lists it.
// Each points at the matching section of the one-page site (or the real
// Pricing page) — no new routes invented.
const NAV_LINKS = [
  { href: "/#platform", label: "Platform" },
  { href: "/#solutions", label: "Solutions" },
  { href: "/#industries", label: "Industries" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#results", label: "Resources" },
  { href: "/#about", label: "About" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 bg-gradient-to-b from-[#030a14]/85 to-[#030a14]/55 backdrop-blur-md">
      <div className="mx-auto flex h-[84px] w-full max-w-[1320px] items-center justify-between gap-6 px-5 sm:px-8 lg:px-12">
        <Link href="/" aria-label="PRECISIA — home" className="shrink-0">
          <PrecisiaWordmark size="lg" />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-9 text-[0.86rem] font-medium lg:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.label} href={link.href} className="text-[#dbe4f1] transition-colors hover:text-[#6cc0ff]">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-5 lg:flex">
          <Link href="/login" className="text-[0.86rem] font-medium text-[#dbe4f1] transition-colors hover:text-white">
            Sign In
          </Link>
          <Link href="/#contact" className="pc-btn pc-btn-primary h-11 px-6 text-[0.84rem]">
            Request a Demonstration
            <PIconArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-white/15 text-white lg:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="h-5 w-5">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </div>

      {open && (
        <nav aria-label="Primary mobile" className="flex flex-col gap-4 border-t border-white/10 bg-[#030a14]/95 px-5 py-5 lg:hidden">
          {NAV_LINKS.map((link) => (
            <Link key={link.label} href={link.href} onClick={() => setOpen(false)} className="text-sm font-medium text-[#dbe4f1]">
              {link.label}
            </Link>
          ))}
          <div className="flex flex-col gap-2.5 pt-2">
            <Link href="/login" onClick={() => setOpen(false)} className="pc-btn pc-btn-outline h-11 px-6">
              Sign In
            </Link>
            <Link href="/#contact" onClick={() => setOpen(false)} className="pc-btn pc-btn-primary h-11 px-6">
              Request a Demonstration
              <PIconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
