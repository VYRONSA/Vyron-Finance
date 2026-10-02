import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { PrecisiaWordmark, VyronsoftAttribution } from "@/components/ui/precisia-wordmark";
import { HERO_WIDTHS, Photo } from "@/components/marketing/photo";

export const metadata: Metadata = {
  title: "Sign In — PRECISIA",
};

// Built to the owner's "New Login Page" reference (1536 x 1024).
//
// The background is a licensed high-resolution photograph
// (public/brand/precisia-photo) filling the window, cropped by its box —
// never stretched or enlarged. From 1024px the sign-in card sits where the
// reference puts it: 1rem = 16 reference px, scaled with the window up to
// 1:1, the 1536 x 1024 composition centred on whole pixels.
const COMPOSITION_CSS = `
@media (min-width: 1024px) {
  html { font-size: min(16px, max(100vw / 96, 100vh / 64)); }
  .login-art { position: absolute; width: 96rem; height: 64rem;
    left: round(down, calc((100vw - 96rem) / 2), 1px);
    top: round(down, calc((100vh - 64rem) / 2), 1px); }
}`;

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0f16] font-sans text-white lg:h-screen">
      <style>{COMPOSITION_CSS}</style>

      <Photo name="login" widths={HERO_WIDTHS} sizes="(min-width: 1024px) 100vw, 220vw" priority className="absolute inset-0 h-full w-full" style={{ objectPosition: "30% 55%" }} />
      {/* Shade under the attribution line, which sits over the city lights. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#05080d]/80 to-transparent" />

      <div className="login-art relative px-5 py-12 sm:px-10 lg:p-0">
        {/* The sign-in card: dark glass over the photograph. */}
        <div className="relative mx-auto w-full max-w-[34.25rem] rounded-[1rem] border border-white/12 bg-[#141a24]/88 px-6 py-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-[6px] sm:px-[3.625rem] lg:absolute lg:top-[8.8125rem] lg:left-[51.9375rem] lg:mx-0 lg:h-[45rem] lg:w-[34.25rem] lg:max-w-none lg:p-0">
          <div className="flex justify-center lg:absolute lg:top-[3.1rem] lg:left-0 lg:w-full">
            <Link href="/" aria-label="PRECISIA — home">
              <PrecisiaWordmark size="card" className="items-center" />
            </Link>
          </div>
          <p className="mt-8 text-[0.7rem] font-normal tracking-[0.2em] whitespace-nowrap text-[#d4d8de] uppercase max-sm:text-[0.56rem] lg:absolute lg:top-[9.75rem] lg:left-[3.625rem] lg:mt-0">
            Real Data. Clearer Insights. Stronger Businesses.
          </p>
          <div aria-hidden className="mt-5 h-px w-[2.6rem] bg-[#4a5a70] lg:absolute lg:top-[12.3rem] lg:left-[3.625rem] lg:mt-0" />
          <h1 className="pc-heading mt-6 text-[2.35rem] leading-none font-bold tracking-[-0.01em] text-white lg:absolute lg:top-[14.2rem] lg:left-[3.625rem] lg:mt-0">Sign In</h1>
          <p className="mt-3 mb-7 text-[1.08rem] text-[#e6e9ee] lg:absolute lg:top-[17.1rem] lg:left-[3.625rem] lg:m-0">Access your PRECISIA account</p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>

        <VyronsoftAttribution className="mt-8 text-center text-[#e6ebf2] lg:absolute lg:bottom-[1.5rem] lg:left-[3rem] lg:mt-0 lg:text-left" />
      </div>
    </div>
  );
}
