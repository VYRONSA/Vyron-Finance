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
import { MonitorPreview, LaptopPreview } from "@/components/marketing/product-preview";
import { ClarityScript } from "@/components/ui/precisia-script";

// PRECISIA Landing Page — reproduces the approved "Precisia Landing Page"
// reference section by section, in its order: hero, feature strip, More
// Than Accounting Software, Built For Your Business, The Platform, Real
// Results, Take The Next Step, footer (in the marketing layout). Copy is
// taken verbatim from the reference. The product screens on the monitor
// and laptop are rebuilt in HTML/CSS (see product-preview.tsx) and are
// captioned as illustrations. The reference's PHOTOGRAPHS (the man at
// the monitor, the plant, the industry scenes, the mountains) are not
// available as standalone source images, so no photograph is shown and
// none is substituted — those areas carry lighting and icons only.

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const FEATURE_STRIP: { icon: Icon; title: string; body: string }[] = [
  { icon: PIconBars, title: "Complete\nFinancial Control", body: "From capture to reporting." },
  { icon: PIconClock, title: "Real-Time\nInsights", body: "Know where you stand." },
  { icon: PIconGear, title: "Automated\nProcessing", body: "Less admin. More time." },
  { icon: PIconShield, title: "Compliance\nMade Simple", body: "VAT, PAYE and more." },
  { icon: PIconBrain, title: "AI-Powered\nDecisions", body: "Turn data into action." },
  { icon: PIconTrendUp, title: "Built for\nGrowing Businesses", body: "From 1 entity to multi-company." },
];

const INDUSTRIES: { label: string; icon: Icon }[] = [
  { label: "Retail\n& Franchises", icon: PIconCart },
  { label: "Hospitality\n& Restaurants", icon: IconReceipt },
  { label: "Food\nManufacturing", icon: PIconGear },
  { label: "Wholesale\n& Distribution", icon: IconArchive },
  { label: "Professional\nServices", icon: PIconBadgeInfo },
  { label: "Construction\n& Contracting", icon: PIconBuildingColumns },
  { label: "Multi-Company\nGroups", icon: PIconOffice },
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
    <div className="font-sans">
      {/* HERO — pulled up under the translucent sticky header, as in the
          reference: copy on the left, the product on a monitor on the
          right. The reference's office photograph behind the monitor is
          not available as a standalone image, so only its lighting is
          echoed. */}
      <section className="relative -mt-[84px] overflow-hidden bg-[#030a14] pt-[84px] text-white">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(700px 420px at 72% 38%, rgba(30,110,230,0.28), transparent 70%), radial-gradient(380px 300px at 92% 12%, rgba(255,190,110,0.10), transparent 70%), linear-gradient(180deg, #06101d 0%, #030a14 100%)",
          }}
        />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#030a14] to-transparent" />

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
          <MonitorPreview className="hidden lg:block" />
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
          {/* The reference's hand-lettered line, as real text. The plant
              photograph beside it is not available as a standalone image. */}
          <div aria-hidden className="pointer-events-none absolute top-1/2 right-[16%] hidden -translate-y-1/3 lg:block">
            <ClarityScript tone="onLight" className="text-[4.6rem]" />
          </div>
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
                  {/* The reference's industry photograph is not available as
                      a standalone image, so the picture area carries the
                      industry's icon on a lit panel instead of a photo. */}
                  <div aria-hidden className="flex aspect-[1.25] w-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(47,155,255,0.22),transparent_65%),linear-gradient(180deg,#0d2442,#081a31)]">
                    <Icon className="h-12 w-12 text-[#2f9bff]/80" strokeWidth={1.3} />
                  </div>
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
          <LaptopPreview className="hidden lg:block" />
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
        {/* The reference's mountain-sunrise photograph is not available as
            a standalone image; only its dawn lighting is echoed. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(420px 220px at 86% 30%, rgba(255,176,80,0.22), transparent 70%), radial-gradient(900px 360px at 50% 120%, rgba(22,90,190,0.45), transparent 70%), linear-gradient(180deg, #0a2a55 0%, #051f44 55%, #03152f 100%)",
          }}
        />
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
  );
}
