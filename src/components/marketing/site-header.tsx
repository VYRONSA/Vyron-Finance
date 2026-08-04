"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/ui/brand-mark";
import { Container } from "@/components/ui/section";

const NAV_LINKS = [
  { href: "/#workflow", label: "How It Works" },
  { href: "/#features", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#contact", label: "Contact" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="vf-glass sticky top-0 z-50 border-b border-vf-dark-border">
      <Container className="flex h-[72px] items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2.5 font-display text-xl text-vf-on-dark">
          <span className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-[9px] bg-vf-charcoal shadow-[inset_0_0_0_1px_rgba(247,244,241,0.14)]">
            <BrandMark className="h-[18px] w-[18px]" />
          </span>
          <span className="flex flex-col leading-none">
            VYRON FINANCE
            <small className="mt-0.5 font-sans text-[0.62rem] font-normal tracking-[0.16em] text-vf-on-dark-faint uppercase">
              Financial Intelligence Platform
            </small>
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-8 text-sm font-medium md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-vf-on-dark-soft transition-colors hover:text-vf-red-300">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Button href="/login" variant="ghostDark" size="sm">
            Log In
          </Button>
          <Button href="/pricing" variant="primary" size="sm">
            Start Free Trial
          </Button>
        </div>

        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-vf-dark-border text-vf-on-dark md:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className="h-5 w-5">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </Container>

      {open && (
        <nav
          aria-label="Primary mobile"
          className="vf-glass flex flex-col gap-4 border-b border-vf-dark-border px-5 py-5 md:hidden"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-sm font-medium text-vf-on-dark-soft"
            >
              {link.label}
            </Link>
          ))}
          <div className="flex flex-col gap-2 pt-2">
            <Button href="/login" variant="ghostDark" size="sm">
              Log In
            </Button>
            <Button href="/pricing" variant="primary" size="sm">
              Start Free Trial
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
