import type { Metadata } from "next";
import type { ComponentType, SVGProps } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { PrecisiaWordmark, VyronsoftAttribution } from "@/components/ui/precisia-wordmark";
import { PIconBrain, PIconShield, PIconTrendUp } from "@/components/ui/precisia-icons";
import { IconFileText } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Sign In — PRECISIA",
};

// Copy verbatim from the approved "Precisia Login Page" reference.
const FEATURES: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  { icon: PIconTrendUp, title: "Complete Financial Control", body: "From capture to reporting." },
  { icon: PIconShield, title: "Automated Processing", body: "Less admin. More time." },
  { icon: IconFileText, title: "Compliance Made Simple", body: "VAT, PAYE and more." },
  { icon: PIconBrain, title: "AI-Powered Insights", body: "Turn data into action." },
];

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05080d] font-sans text-white">
      {/* The reference's office-at-dusk photograph is not available as a
          standalone image, so none is shown. Only its lighting is echoed:
          a warm dusk glow top-right and cool city-blue low on the right,
          fading to the dark brand column on the left. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(640px 420px at 100% 18%, rgba(255,170,80,0.30), transparent 70%), radial-gradient(760px 520px at 88% 82%, rgba(30,110,230,0.28), transparent 70%), radial-gradient(900px 700px at 60% 40%, rgba(20,60,120,0.25), transparent 70%)",
        }}
      />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#03070d]/80 via-[#03070d]/35 to-transparent" />

      <div className="relative grid min-h-screen w-full grid-cols-1 items-center gap-12 px-5 py-12 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:gap-10 lg:px-12 lg:py-16 xl:grid-cols-[508px_524px] xl:gap-[62px] xl:py-[72px] xl:pl-[9.2vw]">
        {/* Brand column */}
        <div className="flex flex-col justify-between self-stretch lg:py-4">
          <div>
            <Link href="/" aria-label="PRECISIA — home" className="inline-block">
              <PrecisiaWordmark size="xl" />
            </Link>
            <div aria-hidden className="mt-8 h-px w-18 bg-[#2f9bff]" />
            <p className="mt-8 text-[0.84rem] font-semibold tracking-[0.15em] whitespace-nowrap text-[#1d9bf0] uppercase max-sm:whitespace-normal">
              Real Data. Clearer Insights. Stronger Businesses.
            </p>
            <h1 className="pc-brand-heading mt-8 text-[2.3rem] leading-[1.06] font-bold text-white sm:text-[3.1rem] xl:text-[3.55rem]">
              Your books,
              <br />
              understood —
              <br />
              <span className="text-[#12a1f8]">
                the moment you
                <br />
                sign in.
              </span>
            </h1>
            <ul className="mt-8 hidden flex-col gap-4 lg:flex">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.title} className="flex items-center gap-5">
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[12px] border border-[#0096f1]/70 bg-[#06111e]/70 text-[#1d9bf0] shadow-[inset_0_0_16px_rgba(0,150,241,0.18)]">
                      <Icon className="h-9 w-9" strokeWidth={1.9} />
                    </span>
                    <span>
                      <span className="block text-[1.12rem] font-semibold text-white">{feature.title}</span>
                      <span className="mt-1 block text-[0.98rem] text-[#c9d4e3]">{feature.body}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="mt-10 hidden lg:block">
            <div aria-hidden className="h-px w-18 bg-[#2f9bff]" />
            <VyronsoftAttribution className="mt-5 text-[1.02rem] text-[#e6ebf2]" />
          </div>
        </div>

        {/* Glass login card */}
        <div className="pc-glass w-full rounded-[28px] px-7 py-10 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-[60px] sm:py-[58px]">
          <h2 className="font-display text-[2.4rem] leading-tight font-medium text-white sm:text-[2.9rem]">Welcome back</h2>
          <p className="mt-3 text-[1.1rem] text-[#dbe4f1]">Sign in to your PRECISIA workspace.</p>
          <div className="mt-10">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
        </div>

        <VyronsoftAttribution className="text-center text-[#e6ebf2] lg:hidden" />
      </div>
    </div>
  );
}
