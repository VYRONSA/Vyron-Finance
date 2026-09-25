import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { PrecisiaWordmark, VyronsoftAttribution } from "@/components/ui/precisia-wordmark";
import { PlanePatches } from "@/components/ui/ref-plane";
import { LOGIN_PLANE } from "@/components/ui/ref-planes.generated";

export const metadata: Metadata = {
  title: "Sign In — PRECISIA",
};

// Built to the owner's "New Login Page" reference (1536 x 1024).
//
// From 1024px the page IS that composition: one photographic plane — the
// reference's own pixels — with the real sign-in card over the
// reference's card. 1rem = 16 reference px, scaled so the plane covers
// the window but NEVER beyond 1:1 (so the photograph is never enlarged);
// on larger windows it is centred on whole pixels and the surround takes
// the photograph's own edge colours. Patches cover only the reference's
// baked-in lettering and form controls, which are real HTML here.
const COMPOSITION_CSS = `
@media (min-width: 1024px) {
  html { font-size: min(16px, max(100vw / 96, 100vh / 64)); }
  .login-art { position: absolute; width: 96rem; height: 64rem;
    left: round(down, calc((100vw - 96rem) / 2), 1px);
    top: round(down, calc((100vh - 64rem) / 2), 1px); }
}`;

export default function LoginPage() {
  const plane = LOGIN_PLANE;
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0b0f16] font-sans text-white lg:h-screen">
      <style>{COMPOSITION_CSS}</style>

      {/* Phone/tablet: the same photograph behind the card (only ever
          downscaled). */}
      {/* eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels, served as-is */}
      <img src={plane.src} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover object-[28%_50%] lg:hidden" />

      {/* Desktop surround, for windows larger than the plane: the
          photograph's own edge colours. */}
      <div aria-hidden className="absolute inset-0 hidden lg:block" style={{ background: `${plane.bands.left} left top / 50% 100% no-repeat, ${plane.bands.right} right top / 50% 100% no-repeat` }} />

      <div className="login-art relative px-5 py-12 sm:px-10 lg:p-0">
        <div aria-hidden className="hidden lg:block">
          {/* eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels, served as-is */}
          <img src={plane.src} alt="" width={plane.w} height={plane.h} className="absolute top-0 left-0 h-[64rem] w-[96rem] max-w-none" draggable={false} />
          <PlanePatches patches={plane.patches} unit="rem" />
        </div>

        {/* The sign-in card. On desktop its glass is the reference card
            itself (part of the photograph above); on phones it has its own. */}
        <div className="relative mx-auto w-full max-w-[34.25rem] rounded-[1rem] border border-white/12 bg-[#141a24]/88 px-6 py-8 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] sm:px-[3.625rem] lg:absolute lg:top-[8.8125rem] lg:left-[51.9375rem] lg:mx-0 lg:h-[45rem] lg:w-[34.25rem] lg:max-w-none lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none">
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
