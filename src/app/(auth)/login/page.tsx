import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { BrandMark } from "@/components/ui/brand-mark";

export const metadata: Metadata = {
  title: "Log In — VYRON FINANCE",
};

const BENEFITS = [
  "Bank statement intelligence across every company you manage",
  "Merchant Rules that code themselves — taught once, applied forever",
  "An audit trail on every coding decision, automatic or manual",
  "Executive reporting built from live, coded transactions",
];

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-vf-canvas">
      <div className="mx-auto grid min-h-screen max-w-[1200px] grid-cols-1 lg:grid-cols-2">
        {/* Dark hero — Part 17: dark hero, red gradients, executive branding */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-vf-red-900 via-vf-canvas to-vf-canvas p-12 text-vf-on-dark lg:flex">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-[20%] -right-[10%] h-[70%] w-[60%] rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(47,151,224,0.35), transparent 70%)",
            }}
          />
          <Link href="/" className="relative flex items-center gap-2.5 font-display text-xl">
            <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-vf-charcoal shadow-[inset_0_0_0_1px_rgba(247,244,241,0.14)]">
              <BrandMark className="h-[18px] w-[18px]" />
            </span>
            VYRON FINANCE
          </Link>

          <div className="relative">
            <h1 className="max-w-md text-3xl font-medium text-vf-on-dark">
              Your books, understood — the moment you sign in.
            </h1>
            <ul className="mt-8 flex flex-col gap-4">
              {BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start gap-3 text-sm text-vf-on-dark-soft">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0 text-vf-red-400">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {benefit}
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-xs text-vf-on-dark-soft">
            Part of the VYRON ecosystem.
          </p>
        </div>

        {/* White login card, floating on the dark canvas — Part 8's "dark
            background, white form container" applied to auth. */}
        <div className="flex flex-col items-center justify-center px-6 py-16 sm:px-12">
          <Card className="w-full max-w-sm">
            <CardContent className="p-8 sm:p-10">
              <Link href="/" className="mb-8 flex items-center gap-2.5 font-display text-lg text-vf-ink lg:hidden">
                <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-vf-charcoal">
                  <BrandMark className="h-4 w-4" />
                </span>
                VYRON FINANCE
              </Link>

              <h2 className="text-2xl font-medium text-vf-ink">Welcome back</h2>
              <p className="mt-1.5 text-sm text-vf-ink-soft">
                Sign in to your Platform Workspace.
              </p>

              <div className="mt-8">
                <Suspense>
                  <LoginForm />
                </Suspense>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
