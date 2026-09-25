import type { Metadata } from "next";
import type { ComponentType, CSSProperties, SVGProps } from "react";
import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { PrecisiaWordmark, VyronsoftAttribution } from "@/components/ui/precisia-wordmark";
import { PIconBrain, PIconShield, PIconTrendUp } from "@/components/ui/precisia-icons";
import { IconFileText } from "@/components/ui/icons";
import { LOGINCOLUMN_FILL } from "@/components/ui/ref-fills.generated";

export const metadata: Metadata = {
  title: "Sign In — PRECISIA",
};

// Copy verbatim from the owner-supplied "Precisia Login Page" reference.
const FEATURES: { icon: ComponentType<SVGProps<SVGSVGElement>>; title: string; body: string }[] = [
  { icon: PIconTrendUp, title: "Complete Financial Control", body: "From capture to reporting." },
  { icon: PIconShield, title: "Automated Processing", body: "Less admin. More time." },
  { icon: IconFileText, title: "Compliance Made Simple", body: "VAT, PAYE and more." },
  { icon: PIconBrain, title: "AI-Powered Insights", body: "Turn data into action." },
];

// From 1024px the page IS the reference composition (1536 x 1024): the
// root font size is set so 1rem = 16 reference pixels, scaled to cover the
// window, and everything — including the real sign-in form, which is sized
// in rem — keeps the reference's proportions. The photograph is the
// reference's own pixels, used only where no text or UI is baked into it
// (public/brand/precisia-ref/manifest.json); the text column and the card
// sit over a matching dark fill.
const ARTBOARD_SCALE = "@media (min-width: 1024px) { html { font-size: max(calc(100vw / 96), calc(100vh / 64)); } }";

const r = (px: number) => `${px / 16}rem`;

/** A reference crop at its original coordinates and size (reference px),
 * rendered as-is: no mask, filter, opacity or overlay. */
function Piece({ name, x, y, w, h }: { name: string; x: number; y: number; w: number; h: number }) {
  const style: CSSProperties = { position: "absolute", left: r(x), top: r(y), width: r(w), height: r(h) };
  // eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels, served as-is
  return <img src={`/brand/precisia-ref/${name}.png`} alt="" aria-hidden width={w} height={h} style={style} draggable={false} />;
}

export default function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05121f] font-sans text-white lg:h-screen">
      <style>{ARTBOARD_SCALE}</style>

      {/* Phone/tablet: the reference's office-at-dusk photograph (its clean
          right-hand strip, the widest text-free region) behind the page —
          full opacity, no overlay. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels */}
      <img src="/brand/precisia-ref/login-right.png" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover object-center lg:hidden" />

      <div className="relative lg:absolute lg:top-1/2 lg:left-1/2 lg:h-[64rem] lg:w-[96rem] lg:-translate-x-1/2 lg:-translate-y-1/2">
        {/* Desktop: the reference photograph around the text column and card.
            The pieces reach 28px under the card so its rounded corners show
            the reference's own photograph (those strips hold no text). */}
        <div aria-hidden className="hidden lg:block">
          <div className="absolute inset-0" style={{ background: "linear-gradient(90deg,#03101b 0%,#061624 45%,#05182a 100%)" }} />
          <Piece name="login-top" x={0} y={0} w={1240} h={74} />
          <Piece name="login-left-strip" x={0} y={74} w={138} h={878} />
          <Piece name="login-above-card" x={652} y={74} w={588} h={100} />
          <Piece name="login-gap" x={652} y={144} w={88} h={766} />
          <Piece name="login-below-card" x={440} y={878} w={800} h={74} />
          <Piece name="login-bottom" x={0} y={952} w={1240} h={72} />
          <Piece name="login-right" x={1206} y={0} w={330} h={1024} />
          {/* The text column: the reference photograph between and around
              the lines of text (exact crops), with a patch only directly
              behind each line, where the reference has its own lettering. */}
          {LOGINCOLUMN_FILL.patches.map((p) => (
            <div key={`${p.x},${p.y}`} className="absolute" style={{ left: r(p.x), top: r(p.y), width: r(p.w), height: r(p.h), background: p.top }}>
              <div className="absolute inset-0" style={{ background: p.bottom, maskImage: "linear-gradient(to bottom, transparent, #000)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000)" }} />
            </div>
          ))}
          {LOGINCOLUMN_FILL.pieces.map((p) => (
            <Piece key={p.name} name={p.name} x={p.x} y={p.y} w={p.w} h={p.h} />
          ))}
        </div>

        <div className="grid min-h-screen w-full grid-cols-1 items-center gap-10 px-5 py-12 sm:px-10 lg:block lg:min-h-0 lg:p-0">
          {/* Brand column */}
          <div className="flex flex-col justify-between lg:absolute lg:top-[4.625rem] lg:left-[8.875rem] lg:h-[54.75rem] lg:w-[32rem]">
            <div>
              <Link href="/" aria-label="PRECISIA — home" className="inline-block">
                <PrecisiaWordmark size="xl" />
              </Link>
              <div aria-hidden className="mt-8 h-[2px] w-16 bg-gradient-to-r from-[#2f9bff] to-[#2f9bff]/40" />
              <p className="mt-8 text-[0.84rem] font-semibold tracking-[0.15em] whitespace-nowrap text-[#1d9bf0] uppercase max-sm:whitespace-normal">
                Real Data. Clearer Insights. Stronger Businesses.
              </p>
              <h1 className="pc-brand-heading mt-8 text-[2.3rem] leading-[1.03] font-bold text-white sm:text-[3.1rem] lg:text-[3.62rem]">
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
                    <li key={feature.title} className="flex items-center gap-[1.4rem]">
                      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[0.75rem] border border-[#0096f1]/70 bg-[#06111e]/70 text-[#1d9bf0] shadow-[inset_0_0_16px_rgba(0,150,241,0.18)]">
                        <Icon className="h-9 w-9" strokeWidth={1.9} />
                      </span>
                      <span>
                        <span className="block text-[1.16rem] font-semibold text-white">{feature.title}</span>
                        <span className="mt-1 block text-[1.02rem] text-[#c9d4e3]">{feature.body}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="mt-10 hidden lg:block">
              <div aria-hidden className="h-[2px] w-16 bg-[#2f9bff]" />
              <VyronsoftAttribution className="mt-6 text-[1.12rem] text-[#e6ebf2]" />
            </div>
          </div>

          {/* Glass sign-in card — the reference's geometry (522 x 760 at
              712, 146). The reference's "OR / Continue with SSO" row is not
              reproduced: SSO is not implemented, and a control that does
              nothing would mislead. "Need help?" keeps its reference
              position at the foot of the card. */}
          <div style={{ backdropFilter: "none", WebkitBackdropFilter: "none" }} className="pc-glass relative w-full rounded-[1.75rem] px-7 py-10 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)] sm:px-[3.875rem] sm:py-[3.6rem] lg:absolute lg:top-[9.125rem] lg:left-[44.5rem] lg:h-[47.5rem] lg:w-[32.625rem] lg:pt-[4.35rem] lg:[&_form>p:last-child]:absolute lg:[&_form>p:last-child]:inset-x-0 lg:[&_form>p:last-child]:bottom-[2.9rem]">
            <h2 className="font-display text-[2.4rem] leading-none font-medium text-white sm:text-[2.8rem]">Welcome back</h2>
            <p className="mt-3 text-[1.18rem] text-[#dbe4f1]">Sign in to your PRECISIA workspace.</p>
            <div className="mt-[1.7rem] lg:[&_form>button]:mt-[1.45rem] lg:[&_form>label:not(:first-child)]:mt-[1.15rem]">
              <Suspense>
                <LoginForm />
              </Suspense>
            </div>
          </div>

          <VyronsoftAttribution className="text-center text-[#e6ebf2] lg:hidden" />
        </div>
      </div>
    </div>
  );
}
