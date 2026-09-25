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
import { LEGACY_LANDING_BANDS } from "@/components/ui/ref-planes.generated";
import {
  LANDINGCLARITY_FILL,
  LANDINGCTA_FILL,
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
 * Software, The Platform, Real Results, Take The Next Step and the footer.
 * The whole page is at most 1672px wide (the new reference's own width,
 * so its photography is never enlarged); wider windows get the
 * photographs' own edge colours at the sides.
 */
export function LandingArtboard() {
  return (
    <div data-landing-artboard className="hidden font-sans text-white lg:block">
      <LandingTop />
      <div className="relative" style={{ background: `${LEGACY_LANDING_BANDS.clarityLeft} left top / 50% 100% no-repeat, ${LEGACY_LANDING_BANDS.clarityRight} right top / 50% 100% no-repeat` }}>
        <div className="landing-frame [container-type:inline-size]" style={{ "--u": "calc(100cqw / 801)" } as CSSProperties}>
          <Slice y0={500} y1={720}>
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
          </Slice>
        </div>
      </div>
      <div className="relative" style={{ background: `${LEGACY_LANDING_BANDS.restLeft} left top / 50% 100% no-repeat, ${LEGACY_LANDING_BANDS.restRight} right top / 50% 100% no-repeat` }}>
        <div className="landing-frame [container-type:inline-size]" style={{ "--u": "calc(100cqw / 801)" } as CSSProperties}>
          <Slice y0={1000} y1={1962}>
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
          </Slice>
        </div>
      </div>
    </div>
  );
}
