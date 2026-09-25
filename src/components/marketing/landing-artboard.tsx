import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";
import Link from "next/link";
import {
  PIconArrowRight,
  PIconBadgeInfo,
  PIconBars,
  PIconBrain,
  PIconBuildingColumns,
  PIconCart,
  PIconClock,
  PIconGear,
  PIconGrowth,
  PIconInvoice,
  PIconOffice,
  PIconShield,
  PIconSparkles,
  PIconTrendUp,
  PIconUsers,
} from "@/components/ui/precisia-icons";
import { IconArchive, IconBarChart, IconFileText, IconReceipt, IconShieldCheck } from "@/components/ui/icons";
import {
  LANDINGCLARITY_FILL,
  LANDINGCTA_FILL,
  LANDINGHEADER_FILL,
  LANDINGHERO_FILL,
  LANDINGINDUSTRIES_FILL,
  LANDINGPLATFORMLEFT_FILL,
  LANDINGPLATFORMTOP_FILL,
  type RefFillPatch,
  type RefFillPiece,
} from "@/components/ui/ref-fills.generated";

/**
 * The PRECISIA landing page at desktop widths, built to the owner-supplied
 * "Precisia Landing Page" reference (801 × 1962).
 *
 * Every position and size below is in the reference's own pixels and is
 * scaled with the window: `--u` is one reference pixel (100cqw / 801), so
 * the composition keeps the reference's proportions at any desktop width.
 * The photographic regions are the reference's own pixels (see
 * public/brand/precisia-ref/manifest.json for each crop's source box);
 * every word, link and button on top of them is real HTML.
 */

const u = (n: number) => `calc(var(--u) * ${n})`;
const REF = "/brand/precisia-ref/";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** A reference crop placed at its original coordinates and size (reference
 * px). Rendered as-is: no mask, filter, opacity or overlay. */
function Crop({ name, x, y, w, h }: { name: string; x: number; y: number; w: number; h: number }) {
  const style: CSSProperties = { position: "absolute", left: u(x), top: u(y), width: u(w), height: u(h) };
  // eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels, served as-is (no re-encoding)
  return <img src={`${REF}${name}.png`} alt="" aria-hidden width={w} height={h} style={style} draggable={false} />;
}

/** The reference photograph around a block of real text: exact crops of
 * every text-free rectangle, plus a patch behind each line of text (where
 * the reference has its own lettering baked in), coloured from the
 * photograph just outside it. See ref-fills.generated.ts. */
function Fill({ data }: { data: { pieces: RefFillPiece[]; patches: RefFillPatch[] } }) {
  return (
    <>
      {data.patches.map((p) => (
        <div key={`${p.x},${p.y}`} aria-hidden className="absolute" style={{ left: u(p.x), top: u(p.y), width: u(p.w), height: u(p.h), background: p.top }}>
          <div className="absolute inset-0" style={{ background: p.bottom, maskImage: "linear-gradient(to bottom, transparent, #000)", WebkitMaskImage: "linear-gradient(to bottom, transparent, #000)" }} />
        </div>
      ))}
      {data.pieces.map((p) => (
        <Crop key={p.name} name={p.name} x={p.x} y={p.y} w={p.w} h={p.h} />
      ))}
    </>
  );
}

function Abs({ x, y, w, children, style, className }: { x: number; y: number; w?: number; children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <div className={className} style={{ position: "absolute", left: u(x), top: u(y), ...(w !== undefined && { width: u(w) }), ...style }}>
      {children}
    </div>
  );
}

const eyebrow = (size = 6.1): CSSProperties => ({ fontSize: u(size), letterSpacing: "0.26em", fontWeight: 600, textTransform: "uppercase", lineHeight: 1 });

function Btn({ href, x, y, w, h, variant, size = 7.6, children }: { href: string; x: number; y: number; w: number; h: number; variant: "primary" | "outline"; size?: number; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`pc-btn ${variant === "primary" ? "pc-btn-primary" : "pc-btn-outline"} absolute`}
      style={{ left: u(x), top: u(y), width: u(w), height: u(h), fontSize: u(size), gap: u(5) }}
    >
      {children}
    </Link>
  );
}

const Arrow = ({ s = 7.5 }: { s?: number }) => <PIconArrowRight style={{ width: u(s), height: u(s) }} />;

const NAV = [
  { href: "/#platform", label: "Platform", x: 248 },
  { href: "/#solutions", label: "Solutions", x: 296 },
  { href: "/#industries", label: "Industries", x: 345 },
  { href: "/pricing", label: "Pricing", x: 398 },
  { href: "/#results", label: "Resources", x: 439 },
  { href: "/#about", label: "About", x: 494 },
];

const FEATURES: { icon: Icon; title: [string, string]; body: string; cx: number }[] = [
  { icon: PIconBars, title: ["Complete", "Financial Control"], body: "From capture to reporting.", cx: 72 },
  { icon: PIconClock, title: ["Real-Time", "Insights"], body: "Know where you stand.", cx: 189 },
  { icon: PIconGear, title: ["Automated", "Processing"], body: "Less admin. More time.", cx: 309 },
  { icon: PIconShield, title: ["Compliance", "Made Simple"], body: "VAT, PAYE and more.", cx: 432 },
  { icon: PIconBrain, title: ["AI-Powered", "Decisions"], body: "Turn data into action.", cx: 567 },
  { icon: PIconTrendUp, title: ["Built for", "Growing Businesses"], body: "From 1 entity to multi-company.", cx: 710 },
];
const STRIP_DIVIDERS = [130, 249, 369, 500, 634];

const INDUSTRIES: { label: [string, string]; icon: Icon; x0: number; x1: number }[] = [
  { label: ["Retail", "& Franchises"], icon: PIconCart, x0: 26, x1: 123 },
  { label: ["Hospitality", "& Restaurants"], icon: IconReceipt, x0: 134, x1: 231 },
  { label: ["Food", "Manufacturing"], icon: PIconGear, x0: 242, x1: 339 },
  { label: ["Wholesale", "& Distribution"], icon: IconArchive, x0: 351, x1: 447 },
  { label: ["Professional", "Services"], icon: PIconUsers, x0: 459, x1: 556 },
  { label: ["Construction", "& Contracting"], icon: PIconBuildingColumns, x0: 567, x1: 664 },
  { label: ["Multi-Company", "Groups"], icon: PIconOffice, x0: 676, x1: 772 },
];

const PLATFORM_FEATURES: { icon: Icon; label: string; y: number }[] = [
  { icon: PIconBuildingColumns, label: "Banking & Reconciliation", y: 1163 },
  { icon: PIconInvoice, label: "Sales & Invoicing", y: 1192 },
  { icon: PIconCart, label: "Purchases & Expenses", y: 1221 },
  { icon: IconShieldCheck, label: "VAT & Compliance", y: 1251 },
  { icon: IconFileText, label: "Financial Reports", y: 1281 },
  { icon: IconBarChart, label: "Business Intelligence", y: 1311 },
  { icon: PIconSparkles, label: "AI Insights & Automation", y: 1341 },
  { icon: PIconOffice, label: "Multi-Company Management", y: 1371 },
];

const RESULTS: { icon: Icon; value: string; label: [string, string?]; cx: number; accent?: boolean }[] = [
  { icon: PIconGear, value: "80%", label: ["Less time on", "manual processing"], cx: 410 },
  { icon: PIconBadgeInfo, value: "100%", label: ["Audit-ready", "compliance"], cx: 506 },
  { icon: PIconClock, value: "Real-time", label: ["Financial visibility"], cx: 609, accent: true },
  { icon: PIconGrowth, value: "Better", label: ["Profitability & growth"], cx: 719, accent: true },
];
const RESULT_DIVIDERS = [361, 458, 553, 664];

const FOOTER_COLS = [
  {
    heading: "Product",
    x: 277,
    links: [
      { href: "/#platform", label: "Platform" },
      { href: "/#platform", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/#platform", label: "How It Works" },
    ],
  },
  {
    heading: "Company",
    x: 431,
    links: [
      { href: "/#about", label: "About" },
      { href: "/#results", label: "Resources" },
      { href: "/#contact", label: "Contact" },
      { href: "/#contact", label: "Request a Demo" },
    ],
  },
];
const ECOSYSTEM = [
  { name: "SAFENZA", tagline: "Safety Intelligence" },
  { name: "UMORA", tagline: "Human & Workforce Intelligence" },
  { name: "VALORA", tagline: "Profitability Intelligence" },
  { name: "PROVENA", tagline: "Sustainability & Compliance" },
];

export function LandingArtboard() {
  return (
    <div data-landing-artboard className="hidden [container-type:inline-size] lg:block">
      <div
        className="relative overflow-clip bg-[#000c1a] font-sans text-white"
        style={{ "--u": "calc(100cqw / 801)", height: u(1962) } as CSSProperties}
      >
        {/* ---------------- HERO BACKGROUND (reference pixels) ---------------- */}
        <div aria-hidden className="absolute inset-x-0 top-0" style={{ height: u(396), background: "linear-gradient(180deg,#000c1a,#000913 60%,#08131f)" }} />
        <Crop name="landing-hero-left" x={0} y={48} w={52} h={348} />
        <Crop name="landing-hero-top" x={330} y={48} w={471} h={47} />
        <Crop name="landing-hero-main" x={305} y={95} w={496} h={240} />
        <Crop name="landing-hero-bottom" x={330} y={335} w={471} h={61} />
        <Fill data={LANDINGHERO_FILL} />
        <Fill data={LANDINGHEADER_FILL} />

        {/* ---------------- HEADER (real navigation, over the photograph) ---------------- */}
        <header className="absolute inset-x-0 top-0 z-50" style={{ height: u(48) }}>
          <Link href="/" aria-label="PRECISIA — home" className="absolute" style={{ left: u(55), top: u(12) }}>
            <span className="block font-[family-name:var(--font-brand)] leading-none text-white" style={{ fontSize: u(26.5), letterSpacing: "0.02em" }}>
              PRECISI<span className="text-[#1d8dff]">A</span>
            </span>
            <span className="block font-[family-name:var(--font-brand)] font-medium whitespace-nowrap text-[#dbe4f1] uppercase" style={{ fontSize: u(7.4), letterSpacing: "0.2em", marginTop: u(4.5), lineHeight: 1 }}>
              Financial Intelligence
            </span>
          </Link>
          <nav aria-label="Primary">
            {NAV.map((n) => (
              <Link key={n.label} href={n.href} className="absolute font-medium text-[#dbe4f1] transition-colors hover:text-[#6cc0ff]" style={{ left: u(n.x), top: u(21), fontSize: u(7.6), lineHeight: 1 }}>
                {n.label}
              </Link>
            ))}
          </nav>
          <Link href="/login" className="absolute font-medium text-[#dbe4f1] hover:text-white" style={{ left: u(598), top: u(21), fontSize: u(7.2), lineHeight: 1 }}>
            Sign In
          </Link>
          <Btn href="/#contact" x={641} y={14} w={120} h={23} variant="primary" size={6.6}>
            Request a Demonstration
            <Arrow s={7} />
          </Btn>
        </header>
        <div aria-hidden className="absolute bg-gradient-to-r from-[#2f9bff] to-transparent" style={{ left: u(55), top: u(67), width: u(126), height: 1 }} />

        {/* ---------------- HERO COPY ---------------- */}
        <Abs x={55} y={85}>
          <p className="text-[#1fb5f5]" style={{ ...eyebrow(6.2), letterSpacing: "0.27em" }}>
            Real Data. Clearer Insights. Stronger Businesses.
          </p>
        </Abs>
        <Abs x={54} y={110}>
          <h1 className="pc-brand-heading font-bold text-white" style={{ fontSize: u(40.5), lineHeight: u(36.5) }}>
            Financial
            <br />
            Intelligence,
            <br />
            <span className="text-[#1d8dff]">Precisely.</span>
          </h1>
        </Abs>
        <Abs x={55} y={238} w={300}>
          <p className="text-[#e3e9f2]" style={{ fontSize: u(10.6), lineHeight: u(16.3) }}>
            PRECISIA gives you complete financial control
            <br />
            with real-time insights, automated processing
            <br />
            and AI-powered intelligence — so you can
            <br />
            make faster, smarter decisions and build
            <br />a more profitable, resilient business.
          </p>
        </Abs>
        <Btn href="/#contact" x={55} y={339} w={139} h={31} variant="primary">
          Request a Demonstration
          <Arrow />
        </Btn>
        <Link href="/#platform" className="pc-btn pc-btn-outline absolute" style={{ left: u(207), top: u(339), width: u(118), height: u(31), fontSize: u(7.6), gap: u(8), paddingLeft: u(8) }}>
          See How It Works
          <span className="flex items-center justify-center rounded-full bg-white text-[#1670ff]" style={{ width: u(17), height: u(17) }} aria-hidden>
            <svg viewBox="0 0 10 10" style={{ width: u(7), height: u(7), marginLeft: u(1) }}>
              <path d="M2 1.2 L8.6 5 L2 8.8 Z" fill="currentColor" />
            </svg>
          </span>
        </Link>
        <Abs x={560} y={384}>
          <p className="text-[#8b98ad]" style={{ fontSize: u(4.2), lineHeight: 1 }}>Illustrative product preview — sample figures, not live data.</p>
        </Abs>

        {/* ---------------- FEATURE STRIP ---------------- */}
        <div
          className="absolute border border-[#2d5f9e]/40 shadow-[0_18px_30px_-16px_rgba(2,10,24,0.9)]"
          style={{ left: u(15), top: u(396), width: u(771), height: u(104), borderRadius: u(12), background: "linear-gradient(180deg,#0a1b30,#06111f)", zIndex: 2 }}
        >
          {STRIP_DIVIDERS.map((x) => (
            <span key={x} aria-hidden className="absolute bg-white/10" style={{ left: u(x - 15), top: u(19), width: 1, height: u(70) }} />
          ))}
          {FEATURES.map((f) => {
            const I = f.icon;
            return (
              <div key={f.body} className="absolute flex flex-col items-center text-center" style={{ left: u(f.cx - 15 - 60), top: u(12), width: u(120) }}>
                <I className="text-[#1d8dff]" style={{ width: u(30), height: u(30) }} strokeWidth={1.8} />
                <p className="font-semibold text-white" style={{ fontSize: u(9.1), lineHeight: u(12.8), marginTop: u(10) }}>
                  {f.title[0]}
                  <br />
                  {f.title[1]}
                </p>
                <p className="text-[#b4c1d6]" style={{ fontSize: u(6.1), marginTop: u(6), whiteSpace: "nowrap" }}>
                  {f.body}
                </p>
              </div>
            );
          })}
        </div>

        {/* ---------------- MORE THAN ACCOUNTING SOFTWARE ---------------- */}
        <section id="solutions" aria-label="More than accounting software">
          <div aria-hidden className="absolute" style={{ left: 0, top: u(470), width: "100%", height: u(250), background: "linear-gradient(90deg,#f7f9fc 0%,#f0f6fc 55%,#fefcf1 72%)" }} />
          <Crop name="landing-plant" x={548} y={506} w={253} h={214} />
          <Fill data={LANDINGCLARITY_FILL} />
          <Abs x={43} y={529}>
            <p className="text-[#1e57b5]" style={eyebrow()}>More Than Accounting Software</p>
          </Abs>
          <Abs x={42} y={548}>
            <h2 className="pc-brand-heading font-bold text-[#0a1640]" style={{ fontSize: u(22.5), lineHeight: u(25.5) }}>
              Turn your financial data
              <br />
              into a <span className="text-[#1670ff]">stronger tomorrow.</span>
            </h2>
          </Abs>
          <Abs x={43} y={605}>
            <p className="text-[#1f2c48]" style={{ fontSize: u(9), lineHeight: u(14.2) }}>
              PRECISIA combines accounting, banking, invoicing, VAT, reporting and AI
              <br />
              into one intelligent platform — giving you the clarity, control and confidence
              <br />
              to grow a more profitable business.
            </p>
          </Abs>
          <Btn href="/#platform" x={45} y={664} w={145} h={31} variant="primary">
            Explore the Platform
            <Arrow />
          </Btn>
          {/* "Clarity Creates Opportunity" is shown as the reference's own
              hand lettering (part of the photograph above); screen readers
              get the phrase here. */}
          <p className="sr-only">Clarity Creates Opportunity</p>
        </section>

        {/* ---------------- BUILT FOR YOUR BUSINESS ---------------- */}
        <section id="industries" aria-label="Industries">
          <div aria-hidden className="absolute" style={{ left: 0, top: u(720), width: "100%", height: u(280), background: "linear-gradient(180deg,#000c19,#01101f 55%,#010b18)" }} />
          <Crop name="landing-industries-bg" x={350} y={720} w={451} h={148} />
          <Fill data={LANDINGINDUSTRIES_FILL} />
          <Abs x={46} y={738}>
            <p className="text-[#1fb5f5]" style={eyebrow()}>Built For Your Business</p>
          </Abs>
          <Abs x={45} y={755}>
            <h2 className="pc-brand-heading font-bold text-white" style={{ fontSize: u(22.5), lineHeight: u(25.5) }}>
              Powering Businesses
              <br />
              Across <span className="text-[#1d8dff]">Every Industry.</span>
            </h2>
          </Abs>
          <Abs x={46} y={809}>
            <p className="text-[#dbe4f1]" style={{ fontSize: u(9), lineHeight: u(14.2) }}>
              Whether you run a single store, a multi-site operation or a complex
              <br />
              manufacturing group, PRECISIA scales with your business — giving
              <br />
              you the tools, insights and automation you need.
            </p>
          </Abs>
          <ul>
            {INDUSTRIES.map((ind, i) => {
              const I = ind.icon;
              return (
                <li
                  key={ind.label.join(" ")}
                  className="absolute overflow-hidden border border-[#2d6fc0]/55 bg-[#091628] shadow-[0_10px_24px_-14px_rgba(22,112,255,0.7)]"
                  style={{ left: u(ind.x0), top: u(871), width: u(ind.x1 - ind.x0), height: u(110), borderRadius: u(4) }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels */}
                  <img src={`${REF}landing-industry-${i + 1}.png`} alt="" aria-hidden style={{ position: "absolute", left: u(1), top: u(1), width: u(ind.x1 - ind.x0 - 4), height: u(73) }} />
                  <span className="absolute flex items-center justify-center rounded-full border border-[#1d8dff]/70 text-[#2f9bff]" style={{ left: u(8), top: u(81), width: u(20), height: u(20) }}>
                    <I style={{ width: u(11), height: u(11) }} />
                  </span>
                  <span className="absolute font-medium text-white" style={{ left: u(33), top: u(82), fontSize: u(6.9), lineHeight: u(8.8) }}>
                    {ind.label[0]}
                    <br />
                    {ind.label[1]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---------------- THE PLATFORM ---------------- */}
        <section id="platform" aria-label="The platform">
          <div aria-hidden className="absolute" style={{ left: 0, top: u(1000), width: "100%", height: u(466), background: "linear-gradient(90deg,#f7f9fc 0%,#f7fafd 25%,#e8f0f7 37.5%,#d2e3f4 43%,#bcd3ea 60%)" }} />
          <Crop name="landing-platform-laptop-left" x={200} y={1138} w={145} h={328} />
          <Crop name="landing-platform-laptop-top" x={345} y={1000} w={456} h={138} />
          <Crop name="landing-platform-laptop" x={345} y={1138} w={456} h={328} />
          <Fill data={LANDINGPLATFORMTOP_FILL} />
          <Fill data={LANDINGPLATFORMLEFT_FILL} />
          <Abs x={43} y={1024}>
            <p className="text-[#1e57b5]" style={eyebrow()}>The Platform</p>
          </Abs>
          <Abs x={42} y={1041}>
            <h2 className="pc-brand-heading font-bold text-[#0a1640]" style={{ fontSize: u(20.6), lineHeight: u(24.5) }}>
              Everything Your Finance
              <br />
              Team Needs. <span className="text-[#1670ff]">In One Place.</span>
            </h2>
          </Abs>
          <Abs x={43} y={1093}>
            <p className="text-[#1f2c48]" style={{ fontSize: u(8.1), lineHeight: u(13.5) }}>
              From bank feeds and automated reconciliations to invoicing, VAT submissions,
              <br />
              management reports and AI insights — PRECISIA brings your entire financial
              <br />
              operation together in one connected platform.
            </p>
          </Abs>
          <ul>
            {PLATFORM_FEATURES.map((f) => {
              const I = f.icon;
              return (
                <li key={f.label} className="absolute flex items-center font-medium text-[#1b2744]" style={{ left: u(45), top: u(f.y - 11), height: u(22), fontSize: u(8.1), gap: u(12) }}>
                  <span className="flex items-center justify-center border border-[#dbe5f3] bg-white text-[#1670ff] shadow-[0_4px_10px_-6px_rgba(20,60,140,0.45)]" style={{ width: u(22), height: u(22), borderRadius: u(5) }}>
                    <I style={{ width: u(13), height: u(13) }} strokeWidth={1.9} />
                  </span>
                  {f.label}
                </li>
              );
            })}
          </ul>
          <Btn href="/pricing" x={45} y={1404} w={127} h={32} variant="primary">
            See All Features
            <Arrow />
          </Btn>
          <Abs x={600} y={1456}>
            <p className="text-[#5d6a82]" style={{ fontSize: u(4.2), lineHeight: 1 }}>Illustrative product preview — sample figures, not live data.</p>
          </Abs>
        </section>

        {/* ---------------- REAL RESULTS ---------------- */}
        <section id="results" aria-label="Results">
          <div aria-hidden className="absolute bg-[#f9fbfd]" style={{ left: 0, top: u(1466), width: "100%", height: u(148) }} />
          <Abs x={45} y={1491}>
            <p className="text-[#1e57b5]" style={eyebrow()}>Real Results</p>
          </Abs>
          <Abs x={44} y={1508}>
            <h2 className="pc-brand-heading font-bold text-[#0a1640]" style={{ fontSize: u(22.5), lineHeight: u(26) }}>
              Smarter Finance.
              <br />
              Stronger Businesses.
            </h2>
          </Abs>
          <Abs x={45} y={1566}>
            <p className="text-[#1f2c48]" style={{ fontSize: u(9), lineHeight: u(13.8) }}>
              PRECISIA helps businesses reduce manual work, improve accuracy,
              <br />
              ensure compliance and make better decisions — every day.
            </p>
          </Abs>
          {RESULT_DIVIDERS.map((x) => (
            <span key={x} aria-hidden className="absolute bg-[#dfe5ee]" style={{ left: u(x), top: u(1506), width: 1, height: u(84) }} />
          ))}
          {RESULTS.map((r) => {
            const I = r.icon;
            return (
              <div key={r.value} className="absolute flex flex-col items-center text-center" style={{ left: u(r.cx - 50), top: u(1508), width: u(100) }}>
                <I className="text-[#1670ff]" style={{ width: u(25), height: u(25) }} strokeWidth={1.9} />
                <p className={`pc-brand-heading font-bold ${r.accent ? "text-[#1670ff]" : "text-[#0a1640]"}`} style={{ fontSize: u(14.2), marginTop: u(10), lineHeight: 1 }}>
                  {r.value}
                </p>
                <p className="text-[#4a5670]" style={{ fontSize: u(6.9), lineHeight: u(9.2), marginTop: u(6) }}>
                  {r.label[0]}
                  {r.label[1] && (
                    <>
                      <br />
                      {r.label[1]}
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </section>

        {/* ---------------- TAKE THE NEXT STEP ---------------- */}
        <section id="contact" aria-label="Request a demonstration">
          <div aria-hidden className="absolute" style={{ left: 0, top: u(1613), width: "100%", height: u(162), background: "linear-gradient(180deg,#002342 0%,#002342 14%,#031a35 47%,#00122a 78%,#010b16 100%)" }} />
          <Crop name="landing-cta-left" x={0} y={1614} w={195} h={161} />
          <Crop name="landing-cta-right" x={606} y={1614} w={195} h={161} />
          {/* Full-width top and bottom bands drawn over the side crops: the
              same reference pixels continue across, so no seam shows. */}
          <Crop name="landing-cta-top" x={0} y={1614} w={801} h={19} />
          <Crop name="landing-cta-bottom" x={0} y={1757} w={801} h={18} />
          <Fill data={LANDINGCTA_FILL} />
          <Abs x={0} y={1635} w={801} className="text-center">
            <p className="text-[#1fb5f5]" style={eyebrow()}>Take The Next Step</p>
          </Abs>
          <Abs x={0} y={1651} w={801} className="text-center">
            <h2 className="pc-brand-heading font-bold text-white" style={{ fontSize: u(17.2), lineHeight: 1.2 }}>
              See What PRECISIA Can Do for Your Business.
            </h2>
          </Abs>
          <Abs x={0} y={1678} w={801} className="text-center">
            <p className="text-[#e3e9f2]" style={{ fontSize: u(9), lineHeight: u(13.8) }}>
              Get a personalised demonstration and see how PRECISIA can give you
              <br />
              complete financial control, clearer insights and a stronger tomorrow.
            </p>
          </Abs>
          <Btn href="/pricing" x={325} y={1720} w={151} h={33} variant="primary">
            Request a Demonstration
            <Arrow />
          </Btn>
        </section>

        {/* ---------------- FOOTER ---------------- */}
        <footer id="about" className="absolute inset-x-0 bg-[#0d0e11]" style={{ top: u(1775), height: u(187) }}>
          <Link href="/" aria-label="PRECISIA — home" className="absolute" style={{ left: u(51), top: u(34) }}>
            <span className="block font-[family-name:var(--font-brand)] leading-none text-white" style={{ fontSize: u(24), letterSpacing: "0.02em" }}>
              PRECISI<span className="text-[#1d8dff]">A</span>
            </span>
            <span className="block font-[family-name:var(--font-brand)] font-medium whitespace-nowrap text-[#dbe4f1] uppercase" style={{ fontSize: u(6.6), letterSpacing: "0.2em", marginTop: u(4), lineHeight: 1 }}>
              Financial Intelligence
            </span>
          </Link>
          <p className="absolute text-[#e6ebf2]" style={{ left: u(51), top: u(94), fontSize: u(8), lineHeight: 1 }}>
            A product of <span className="font-semibold">Vyronsoft (Pty) Ltd.</span>
          </p>
          {FOOTER_COLS.map((col) => (
            <div key={col.heading} className="absolute" style={{ left: u(col.x), top: u(27) }}>
              <h4 className="font-bold text-[#e6ebf2] uppercase" style={{ fontSize: u(6), letterSpacing: "0.2em", lineHeight: 1 }}>
                {col.heading}
              </h4>
              <ul className="flex flex-col" style={{ marginTop: u(10), gap: u(7.4) }}>
                {col.links.map((l) => (
                  <li key={l.label} style={{ fontSize: u(8.1), lineHeight: 1 }}>
                    <Link href={l.href} className="text-[#d5dbe4] hover:text-[#6cc0ff]">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="absolute" style={{ left: u(598), top: u(27) }}>
            <h4 className="font-bold text-[#e6ebf2] uppercase" style={{ fontSize: u(6), letterSpacing: "0.2em", lineHeight: 1 }}>
              Ecosystem
            </h4>
            <ul className="flex flex-col" style={{ marginTop: u(10), gap: u(7.4) }}>
              {ECOSYSTEM.map((p) => (
                <li key={p.name} className="flex items-baseline" style={{ lineHeight: 1 }}>
                  <span className="font-[family-name:var(--font-brand)] font-medium tracking-[0.06em] text-[#e6ebf2]" style={{ fontSize: u(8.1), width: u(53) }}>
                    {p.name}
                  </span>
                  <span className="text-[#8b94a3]" style={{ fontSize: u(6.2) }}>
                    {p.tagline}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <span aria-hidden className="absolute bg-white/10" style={{ left: u(51), top: u(133), width: u(699), height: 1 }} />
          <p className="absolute text-[#8b94a3]" style={{ left: u(51), top: u(143), fontSize: u(6.2), lineHeight: 1 }}>
            &copy; {new Date().getFullYear()} Precisia. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
}
