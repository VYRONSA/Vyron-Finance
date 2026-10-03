import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";
import Link from "next/link";
import {
  PIconArrowRight,
  PIconBadgeInfo,
  PIconBuildingColumns,
  PIconCart,
  PIconClock,
  PIconGear,
  PIconGrowth,
  PIconInvoice,
  PIconOffice,
  PIconSparkles,
} from "@/components/ui/precisia-icons";
import { IconBarChart, IconFileText, IconShieldCheck } from "@/components/ui/icons";
import { LandingTop } from "@/components/marketing/landing-top";
import { HERO_WIDTHS, Photo } from "@/components/marketing/photo";
import { LaptopPreview } from "@/components/marketing/product-preview";

/**
 * The PRECISIA landing page at desktop widths, built to the owner-supplied
 * "Precisia Landing Page" reference (801 × 1962).
 *
 * Every position and size below is in the reference's own pixels and is
 * scaled with the window: `--u` is one reference pixel (100cqw / 801), so
 * the composition keeps the reference's proportions at any desktop width.
 * The photographs are licensed high-resolution originals
 * (public/brand/precisia-photo/manifest.json), each filling its band to
 * the window edges and cropped by its box — never stretched or enlarged;
 * every word, link and button on top of them is real HTML.
 */

const u = (n: number) => `calc(var(--u) * ${n})`;

/** One reference px for a full-width wrapper: the frame is at most 1672px
 * wide, so one of its 801 reference px is at most 1672/801 CSS px. */
const WRAPPER_UNIT = { "--u": "calc(min(100cqw, 1672px) / 801)" } as CSSProperties;
/** A reference x (0–801, frame coordinates) as a position in a full-width
 * wrapper whose frame is centred. */
const wx = (x: number) => `calc(50% + var(--u) * ${x - 400.5})`;
/** The width from that position to the wrapper's right edge. */
const wxToRight = (x: number) => `calc(50% - var(--u) * ${x - 400.5})`;

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

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

/** One slice of the original 801px composition: reference rows y0..y1,
 * scaled to the slice's container width. */
function Slice({ y0, y1, children }: { y0: number; y1: number; children: ReactNode }) {
  return (
    <div className="relative overflow-clip" style={{ height: u(y1 - y0) }}>
      <div className="absolute inset-x-0" style={{ top: u(-y0), height: u(1962) }}>
        {children}
      </div>
    </div>
  );
}

/**
 * The landing page from 1024px. The top — hero and industries — is the
 * owner's "New Landing Page" reference (LandingTop). The sections below
 * it have no new reference, so they keep the approved treatment built on
 * the original "Precisia Landing Page" reference: More Than Accounting
 * Software, The Platform, Real Results and Take The Next Step. The footer
 * is the shared SiteFooter, the same one every public page uses.
 * The composition is at most 1672px wide; on wider windows the
 * photographs and section colours continue to the window edges.
 */
export function LandingArtboard() {
  return (
    <div data-landing-artboard className="hidden font-sans text-white lg:block">
      <LandingTop />
      <div className="relative overflow-clip bg-[#f6f9fc] [container-type:inline-size]" style={WRAPPER_UNIT}>
        <Photo name="plant" widths={[2400, 1200]} sizes="(min-width: 1024px) 55vw, 100vw" className="absolute top-0 h-full" style={{ left: wx(470), width: wxToRight(470), objectPosition: "35% 60%", maskImage: "linear-gradient(90deg, transparent, #000 22%)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 22%)" }} />
        <div className="landing-frame">
          <Slice y0={500} y1={720}>
        {/* ---------------- MORE THAN ACCOUNTING SOFTWARE ---------------- */}
        <section id="solutions" aria-label="More than accounting software">
          {/* eslint-disable-next-line @next/next/no-img-element -- vector lettering */}
          <img src="/brand/precisia-photo/clarity-lettering.svg" alt="" aria-hidden className="absolute" style={{ left: u(385), top: u(540), width: u(167), height: u(150) }} draggable={false} />
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
          {/* "Clarity Creates Opportunity" is the reference's hand lettering,
              traced to vector; screen readers get the phrase here. */}
          <p className="sr-only">Clarity Creates Opportunity</p>
        </section>
          </Slice>
        </div>
      </div>
      <div
        className="relative overflow-clip [container-type:inline-size]"
        style={{ ...WRAPPER_UNIT, background: "linear-gradient(180deg, #f7f9fc 0 calc(var(--u) * 466), #f9fbfd 0 calc(var(--u) * 613), #00122a 0)" }}
      >
        <Photo name="platform" widths={[3200, 1600]} sizes="(min-width: 1024px) 85vw, 100vw" className="absolute" style={{ left: wx(230), width: wxToRight(230), top: 0, height: u(466), objectPosition: "50% 50%", maskImage: "linear-gradient(90deg, transparent, #000 30%)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 30%)" }} />
        <Photo name="cta" widths={HERO_WIDTHS} sizes="100vw" className="absolute left-0 w-full" style={{ top: u(613), height: u(162), objectPosition: "50% 45%" }} />
        <div className="landing-frame">
          <Slice y0={1000} y1={1775}>
        {/* ---------------- THE PLATFORM ---------------- */}
        <section id="platform" aria-label="The platform">
          <Abs x={372} y={1040} w={410}>
            <LaptopPreview caption={false} screenStyle={{ fontSize: u(5.6) }} />
          </Abs>
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
          {/* The reference's navy panel behind the copy, opening onto the
              photograph at both sides. */}
          <div aria-hidden className="absolute" style={{ left: 0, top: u(1613), width: "100%", height: u(162), background: "linear-gradient(180deg,#002342 0%,#031a35 47%,#00122a 78%,#010b16 100%)", maskImage: "linear-gradient(90deg, transparent 6%, #000 33%, #000 67%, transparent 94%)", WebkitMaskImage: "linear-gradient(90deg, transparent 6%, #000 33%, #000 67%, transparent 94%)" }} />
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

          </Slice>
        </div>
      </div>
    </div>
  );
}
