import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import {
  PIconArrowRight,
  PIconBars,
  PIconBrain,
  PIconBuildingColumns,
  PIconCart,
  PIconClock,
  PIconGear,
  PIconGrowth,
  PIconBadgeInfo,
  PIconInvoice,
  PIconOffice,
  PIconPlay,
  PIconShield,
  PIconSparkles,
  PIconTrendUp,
} from "@/components/ui/precisia-icons";
import { IconArchive, IconBarChart, IconFileText, IconReceipt, IconShieldCheck } from "@/components/ui/icons";
import { LandingArtboard } from "@/components/marketing/landing-artboard";
import { HERO_WIDTHS, Photo, TILE_WIDTHS } from "@/components/marketing/photo";
import { LaptopPreview, MonitorPreview } from "@/components/marketing/product-preview";

// PRECISIA Landing Page, built to the owner-supplied "Precisia Landing
// Page" reference. From 1024px wide the page is `LandingArtboard` — the
// reference composition itself, scaled to the window. Narrower screens get
// this single-column version of the same sections and copy, using the same
// photographs (public/brand/precisia-photo). Copy is verbatim from the
// reference.

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const FEATURE_STRIP: { icon: Icon; title: string; body: string }[] = [
  { icon: PIconBars, title: "Complete\nFinancial Control", body: "From capture to reporting." },
  { icon: PIconClock, title: "Real-Time\nInsights", body: "Know where you stand." },
  { icon: PIconGear, title: "Automated\nProcessing", body: "Less admin. More time." },
  { icon: PIconShield, title: "Compliance\nMade Simple", body: "VAT, PAYE and more." },
  { icon: PIconBrain, title: "AI-Powered\nDecisions", body: "Turn data into action." },
  { icon: PIconTrendUp, title: "Built for\nGrowing Businesses", body: "From 1 entity to multi-company." },
];

const INDUSTRIES: { label: string; icon: Icon; photo: string }[] = [
  { label: "Retail\n& Franchises", icon: PIconCart, photo: "tile-retail" },
  { label: "Hospitality\n& Restaurants", icon: IconReceipt, photo: "tile-hospitality" },
  { label: "Food\nManufacturing", icon: PIconGear, photo: "tile-food" },
  { label: "Wholesale\n& Distribution", icon: IconArchive, photo: "tile-wholesale" },
  { label: "Professional\nServices", icon: PIconBadgeInfo, photo: "tile-professional" },
  { label: "Construction\n& Contracting", icon: PIconBuildingColumns, photo: "tile-construction" },
  { label: "Multi-Company\nGroups", icon: PIconOffice, photo: "tile-multi" },
];

const PLATFORM_FEATURES: { icon: Icon; label: string }[] = [
  { icon: PIconBuildingColumns, label: "Banking & Reconciliation" },
  { icon: PIconInvoice, label: "Sales & Invoicing" },
  { icon: PIconCart, label: "Purchases & Expenses" },
  { icon: IconShieldCheck, label: "VAT & Compliance" },
  { icon: IconFileText, label: "Financial Reports" },
  { icon: IconBarChart, label: "Business Intelligence" },
  { icon: PIconSparkles, label: "AI Insights & Automation" },
  { icon: PIconOffice, label: "Multi-Company Management" },
];

const RESULTS: { icon: Icon; value: string; label: string; accent?: boolean }[] = [
  { icon: PIconGear, value: "80%", label: "Less time on\nmanual processing" },
  { icon: PIconBadgeInfo, value: "100%", label: "Audit-ready\ncompliance" },
  { icon: PIconClock, value: "Real-time", label: "Financial visibility", accent: true },
  { icon: PIconGrowth, value: "Better", label: "Profitability & growth", accent: true },
];

function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[0.7rem] font-semibold tracking-[0.24em] uppercase ${className}`}>{children}</p>;
}

function Lines({ text }: { text: string }) {
  const parts = text.split("\n");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

export default function HomePage() {
  return (
    <>
    <LandingArtboard />
    <div className="font-sans lg:hidden">
      {/* HERO — pulled up under the translucent sticky header, as in the
          reference: copy first, then the product on a monitor, over the
          hero photograph. */}
      <section className="relative -mt-[84px] overflow-hidden bg-[#030a14] pt-[84px] text-white">
        <Photo name="hero" widths={HERO_WIDTHS} sizes="250vw" portrait={{ name: "hero-portrait", widths: [2200, 1400], sizes: "200vw" }} priority className="absolute inset-0 h-full w-full" style={{ objectPosition: "30% 50%" }} />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-[#030a14]/75 via-[#030a14]/35 to-[#030a14]" />

        <div className="relative mx-auto grid w-full max-w-[1320px] grid-cols-1 items-center gap-12 px-5 pt-4 pb-36 sm:px-8 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:px-12 lg:pb-40">
          <div className="max-w-[600px]">
            <div aria-hidden className="mb-9 h-px w-56 bg-gradient-to-r from-[#2f9bff] to-transparent" />
            <Eyebrow className="text-[#1fb5f5]">Real Data. Clearer Insights. Stronger Businesses.</Eyebrow>
            <h1 className="pc-brand-heading mt-8 text-[2.8rem] leading-[1.02] font-bold text-white sm:text-[3.9rem] lg:text-[4.35rem]">
              Financial
              <br />
              Intelligence,
              <br />
              <span className="text-[#1d8dff]">Precisely.</span>
            </h1>
            <p className="mt-7 max-w-[470px] text-[1.2rem] leading-[1.55] text-[#e3e9f2]">
              PRECISIA gives you complete financial control with real-time insights, automated processing and AI-powered intelligence — so you can make faster, smarter decisions and build a more profitable, resilient business.
            </p>
            <div className="mt-10 flex flex-wrap gap-5">
              <Link href="/#contact" className="pc-btn pc-btn-primary h-14 px-8 text-[0.92rem]">
                Request a Demonstration
                <PIconArrowRight className="h-4.5 w-4.5" />
              </Link>
              <Link href="/#platform" className="pc-btn pc-btn-outline h-14 pr-3 pl-8 text-[0.92rem]">
                See How It Works
                <PIconPlay className="h-8 w-8" />
              </Link>
            </div>
          </div>
          <MonitorPreview screenStyle={{ fontSize: "clamp(7px, 2.6vw, 13px)" }} />
        </div>
      </section>

      {/* FEATURE STRIP — the dark rounded bar straddling the hero and the
          light section beneath it. */}
      <div className="relative z-10 -mt-28 px-4 sm:px-6">
        <div className="mx-auto grid w-full max-w-[1400px] grid-cols-2 gap-y-8 rounded-[18px] border border-[#2d5f9e]/40 bg-gradient-to-b from-[#0a1b30] to-[#06111f] px-4 py-9 shadow-[0_30px_60px_-30px_rgba(2,10,24,0.9)] sm:grid-cols-3 lg:grid-cols-6 lg:py-10">
          {FEATURE_STRIP.map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className={`flex flex-col items-center px-3 text-center ${i > 0 ? "lg:border-l lg:border-white/10" : ""}`}>
                <Icon className="h-14 w-14 text-[#1d8dff]" strokeWidth={1.4} />
                <p className="mt-5 text-[1.12rem] leading-snug font-semibold text-white">
                  <Lines text={item.title} />
                </p>
                <p className="mt-2 text-[0.8rem] text-[#b4c1d6]">{item.body}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* MORE THAN ACCOUNTING SOFTWARE */}
      <section id="solutions" className="relative -mt-24 overflow-hidden bg-gradient-to-r from-[#f3f7fd] via-[#f0f5fc] to-[#eef3fa] pt-36 pb-16 lg:pb-20">
        <div className="relative mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-12">
          <div className="max-w-[600px]">
            <Eyebrow className="text-[#1e57b5]">More Than Accounting Software</Eyebrow>
            <h2 className="pc-brand-heading mt-5 text-[2rem] leading-[1.12] font-bold text-[#0a1640] sm:text-[2.65rem]">
              Turn your financial data
              <br />
              into a <span className="text-[#1670ff]">stronger tomorrow.</span>
            </h2>
            <p className="mt-5 max-w-[600px] text-[0.98rem] leading-[1.7] text-[#1f2c48]">
              PRECISIA combines accounting, banking, invoicing, VAT, reporting and AI into one intelligent platform — giving you the clarity, control and confidence to grow a more profitable business.
            </p>
            <Link href="/#platform" className="pc-btn pc-btn-primary mt-9 h-14 px-9 text-[0.92rem]">
              Explore the Platform
              <PIconArrowRight className="h-4.5 w-4.5" />
            </Link>
          </div>
          <Photo name="plant" widths={[1200, 2400]} sizes="(min-width: 640px) 560px, 130vw" className="mt-10 aspect-[5/4] w-full max-w-[420px] rounded-[12px]" style={{ objectPosition: "35% 60%" }} />
        </div>
      </section>

      {/* BUILT FOR YOUR BUSINESS */}
      <section id="industries" className="relative overflow-hidden bg-[#061328] pt-16 pb-16 text-white">
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#061328] to-transparent" />
        <div className="relative mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-12">
          <div className="max-w-[640px]">
            <Eyebrow className="text-[#1fb5f5]">Built For Your Business</Eyebrow>
            <h2 className="pc-brand-heading mt-5 text-[2rem] leading-[1.12] font-bold sm:text-[2.65rem]">
              Powering Businesses
              <br />
              Across <span className="text-[#1d8dff]">Every Industry.</span>
            </h2>
            <p className="mt-5 max-w-[600px] text-[0.98rem] leading-[1.7] text-[#dbe4f1]">
              Whether you run a single store, a multi-site operation or a complex manufacturing group, PRECISIA scales with your business — giving you the tools, insights and automation you need.
            </p>
          </div>

          <ul className="mt-12 grid grid-cols-2 gap-3.5 sm:grid-cols-4 lg:grid-cols-7">
            {INDUSTRIES.map((industry) => {
              const Icon = industry.icon;
              return (
                <li key={industry.label} className="overflow-hidden rounded-[10px] border border-[#2d6fc0]/45 bg-[#07152a] shadow-[0_18px_40px_-24px_rgba(22,112,255,0.6)]">
                  <Photo name={industry.photo} widths={TILE_WIDTHS} sizes="(min-width: 640px) 25vw, 50vw" className="aspect-[1.25] w-full" />
                  <div className="flex items-center gap-2.5 px-3 py-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1d8dff]/70 text-[#2f9bff]">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-[0.74rem] leading-tight font-medium text-white">
                      <Lines text={industry.label} />
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* THE PLATFORM */}
      <section id="platform" className="relative overflow-hidden bg-gradient-to-r from-[#f5f8fc] via-[#eef3fa] to-[#dfe7f1] py-16 lg:py-20">
        <div className="relative mx-auto grid w-full max-w-[1320px] grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)] lg:px-12">
          <div className="max-w-[560px]">
            <Eyebrow className="text-[#1e57b5]">The Platform</Eyebrow>
            <h2 className="pc-brand-heading mt-5 text-[2rem] leading-[1.12] font-bold text-[#0a1640] sm:text-[2.55rem]">
              Everything Your Finance
              <br />
              Team Needs. <span className="text-[#1670ff]">In One Place.</span>
            </h2>
            <p className="mt-5 max-w-[540px] text-[0.95rem] leading-[1.7] text-[#1f2c48]">
              From bank feeds and automated reconciliations to invoicing, VAT submissions, management reports and AI insights — PRECISIA brings your entire financial operation together in one connected platform.
            </p>
            <ul className="mt-8 flex flex-col gap-3.5">
              {PLATFORM_FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.label} className="flex items-center gap-5 text-[0.92rem] font-medium text-[#1b2744]">
                    <span className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[#dbe5f3] bg-white text-[#1670ff] shadow-[0_6px_16px_-10px_rgba(20,60,140,0.45)]">
                      <Icon className="h-6 w-6" />
                    </span>
                    {feature.label}
                  </li>
                );
              })}
            </ul>
            <Link href="/pricing" className="pc-btn pc-btn-primary mt-10 h-14 px-9 text-[0.92rem]">
              See All Features
              <PIconArrowRight className="h-4.5 w-4.5" />
            </Link>
          </div>
          <LaptopPreview screenStyle={{ fontSize: "clamp(6px, 2.3vw, 12px)" }} />
        </div>
      </section>

      {/* REAL RESULTS */}
      <section id="results" className="bg-[#f9fafc] py-14 lg:py-16">
        <div className="mx-auto grid w-full max-w-[1320px] grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.25fr] lg:px-12">
          <div>
            <Eyebrow className="text-[#1e57b5]">Real Results</Eyebrow>
            <h2 className="pc-brand-heading mt-5 text-[2rem] leading-[1.12] font-bold text-[#0a1640] sm:text-[2.55rem]">
              Smarter Finance.
              <br />
              Stronger Businesses.
            </h2>
            <p className="mt-5 max-w-[520px] text-[0.95rem] leading-[1.7] text-[#1f2c48]">
              PRECISIA helps businesses reduce manual work, improve accuracy, ensure compliance and make better decisions — every day.
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-y-10 sm:grid-cols-4">
            {RESULTS.map((result) => {
              const Icon = result.icon;
              return (
                <li key={result.value} className="flex flex-col items-center border-[#dfe5ee] px-3 text-center sm:border-l">
                  <Icon className="h-10 w-10 text-[#1670ff]" strokeWidth={1.6} />
                  <p className={`pc-brand-heading mt-5 text-[1.6rem] font-bold ${result.accent ? "text-[#1670ff]" : "text-[#0a1640]"}`}>{result.value}</p>
                  <p className="mt-1.5 text-xs leading-snug text-[#4a5670]">
                    <Lines text={result.label} />
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* TAKE THE NEXT STEP */}
      <section id="contact" className="relative overflow-hidden bg-[#051f44] py-16 text-center text-white lg:py-20">
        <Photo name="cta" widths={HERO_WIDTHS} sizes="250vw" className="absolute inset-0 h-full w-full" style={{ objectPosition: "50% 50%" }} />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-[#051f44]/80 via-[#051f44]/70 to-[#03152f]/90" />
        <div className="relative mx-auto w-full max-w-[960px] px-5">
          <Eyebrow className="text-[#1fb5f5]">Take The Next Step</Eyebrow>
          <h2 className="pc-brand-heading mt-5 text-[1.9rem] leading-tight font-bold sm:text-[2.35rem]">See What PRECISIA Can Do for Your Business.</h2>
          <p className="mx-auto mt-4 max-w-[640px] text-[1rem] leading-[1.65] text-[#e3e9f2]">
            Get a personalised demonstration and see how PRECISIA can give you complete financial control, clearer insights and a stronger tomorrow.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-5">
            <Link href="/pricing" className="pc-btn pc-btn-primary h-14 px-9 text-[0.92rem]">
              Request a Demonstration
              <PIconArrowRight className="h-4.5 w-4.5" />
            </Link>
          </div>
        </div>
      </section>

    </div>
    </>
  );
}
