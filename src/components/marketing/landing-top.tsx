import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";
import Link from "next/link";
import { PIconArrowRight, PIconBuildingColumns, PIconCart, PIconGear, PIconOffice, PIconUsers } from "@/components/ui/precisia-icons";
import { IconArchive, IconReceipt } from "@/components/ui/icons";
import { PlanePatches } from "@/components/ui/ref-plane";
import { LANDING_PLANE } from "@/components/ui/ref-planes.generated";

/**
 * The top of the landing page — hero and "Built for your business" — from
 * the owner's "New Landing Page" reference (1672 x 941).
 *
 * The photograph is ONE plane: the reference's own pixels, drawn at
 * 1 image px : 1 CSS px at 1672px wide and only ever scaled DOWN below
 * that (`--n` is one reference pixel, never more than 1px). Everything
 * readable or clickable is real HTML at the reference's coordinates;
 * patches cover only the reference's own baked-in lettering and controls.
 * The monitor's screen is part of the photograph — an illustration with
 * sample figures, captioned as such.
 */

const n = (v: number) => `calc(var(--n) * ${v})`;
type Icon = ComponentType<SVGProps<SVGSVGElement>>;

function At({ x, y, w, children, className, style }: { x: number; y: number; w?: number; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`absolute ${className ?? ""}`} style={{ left: n(x), top: n(y), ...(w !== undefined && { width: n(w) }), ...style }}>
      {children}
    </div>
  );
}

const NAV = [
  { href: "/#platform", label: "Platform", x: 500 },
  { href: "/#solutions", label: "Solutions", x: 590 },
  { href: "/#industries", label: "Industries", x: 684 },
  { href: "/pricing", label: "Pricing", x: 781 },
  { href: "/#results", label: "Resources", x: 861 },
  { href: "/#about", label: "About", x: 963 },
];

const TILES: { label: [string, string]; icon: Icon; x0: number }[] = [
  { label: ["Retail", "& Franchises"], icon: PIconCart, x0: 95 },
  { label: ["Hospitality", "& Restaurants"], icon: IconReceipt, x0: 309 },
  { label: ["Food", "Manufacturing"], icon: PIconGear, x0: 522 },
  { label: ["Wholesale", "& Distribution"], icon: IconArchive, x0: 735 },
  { label: ["Professional", "Services"], icon: PIconUsers, x0: 948 },
  { label: ["Construction", "& Contracting"], icon: PIconBuildingColumns, x0: 1162 },
  { label: ["Multi-Company", "Groups"], icon: PIconOffice, x0: 1376 },
];

function Wordmark() {
  return (
    <span className="block">
      <span className="block font-[family-name:var(--font-brand)] leading-none text-white" style={{ fontSize: n(31), letterSpacing: "0.02em" }} role="img" aria-label="PRECISIA">
        <span aria-hidden>PRECISI</span>
        <span aria-hidden className="text-[#1d8dff]">A</span>
      </span>
      <span className="block font-[family-name:var(--font-brand)] font-medium whitespace-nowrap text-[#dbe4f1] uppercase" style={{ fontSize: n(9), letterSpacing: "0.19em", marginTop: n(5), lineHeight: 1 }}>
        Financial Intelligence
      </span>
    </span>
  );
}

export function LandingTop() {
  const plane = LANDING_PLANE;
  return (
    <div className="relative" style={{ background: `${plane.bands.left} left top / 50% 100% no-repeat, ${plane.bands.right} right top / 50% 100% no-repeat` }}>
      <div className="landing-frame relative overflow-clip [container-type:inline-size]" style={{ "--n": "calc(100cqw / 1672)", height: n(941) } as CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the reference's own pixels, served as-is */}
        <img src={plane.src} alt="" aria-hidden width={plane.w} height={plane.h} className="absolute top-0 left-0 max-w-none" style={{ width: n(1672), height: n(941) }} draggable={false} />
        <PlanePatches patches={plane.patches} unit={{ scaleVar: "--n" }} />

        {/* Header */}
        <header>
          <Link href="/" aria-label="PRECISIA — home" className="absolute" style={{ left: n(229), top: n(19) }}>
            <Wordmark />
          </Link>
          <nav aria-label="Primary">
            {NAV.map((l) => (
              <Link key={l.label} href={l.href} className="absolute font-medium text-white transition-colors hover:text-[#6cc0ff]" style={{ left: n(l.x), top: n(28), fontSize: n(14.6), lineHeight: n(20) }}>
                {l.label}
              </Link>
            ))}
          </nav>
          <Link href="/login" className="absolute font-medium text-white hover:text-[#6cc0ff]" style={{ left: n(1179), top: n(28), fontSize: n(14.6), lineHeight: n(20) }}>
            Sign In
          </Link>
          <Link href="/#contact" className="pc-btn pc-btn-primary absolute" style={{ left: n(1246), top: n(17), width: n(214), height: n(43), fontSize: n(12.6), gap: n(12), fontWeight: 500 }}>
            Request a Demonstration
            <PIconArrowRight style={{ width: n(14), height: n(14) }} />
          </Link>
        </header>

        {/* Hero copy */}
        <div aria-hidden className="absolute bg-gradient-to-r from-[#2f9bff] to-[#2f9bff]/30" style={{ left: n(229), top: n(89), width: n(108), height: n(1.5) }} />
        <At x={231} y={115}>
          <p className="font-semibold whitespace-nowrap text-[#1fb5f5] uppercase" style={{ fontSize: n(10.8), letterSpacing: "0.22em", lineHeight: 1 }}>
            Real Data. Clearer Insights. Stronger Businesses.
          </p>
        </At>
        <At x={230} y={146}>
          <h1 className="pc-brand-heading font-bold text-white" style={{ fontSize: n(57), lineHeight: n(56) }}>
            Financial
            <br />
            Intelligence,
            <br />
            <span className="text-[#1d8dff]">Precisely.</span>
          </h1>
        </At>
        <At x={231} y={331}>
          <p className="text-[#e6ebf2]" style={{ fontSize: n(16.2), lineHeight: n(24.6) }}>
            PRECISIA gives you complete financial control
            <br />
            with real-time insights, automated processing
            <br />
            and AI-powered intelligence — so you can
            <br />
            make faster, smarter decisions and build
            <br />a more profitable, resilient business.
          </p>
        </At>
        <Link href="/#contact" className="pc-btn pc-btn-primary absolute" style={{ left: n(226), top: n(476), width: n(212), height: n(47), fontSize: n(12.6), gap: n(14), fontWeight: 500 }}>
          Request a Demonstration
          <PIconArrowRight style={{ width: n(15), height: n(15) }} />
        </Link>
        <Link href="/#platform" className="pc-btn pc-btn-outline absolute" style={{ left: n(452), top: n(476), width: n(180), height: n(47), fontSize: n(12.6), gap: n(14), paddingLeft: n(10), fontWeight: 500 }}>
          See How It Works
          <span className="flex items-center justify-center rounded-full bg-white text-[#1670ff]" aria-hidden style={{ width: n(26), height: n(26) }}>
            <svg viewBox="0 0 10 10" style={{ width: n(10), height: n(10), marginLeft: n(1.5) }}>
              <path d="M2 1.2 L8.6 5 L2 8.8 Z" fill="currentColor" />
            </svg>
          </span>
        </Link>
        <At x={1040} y={530}>
          <p className="whitespace-nowrap text-[#8b98ad]" style={{ fontSize: n(10), lineHeight: 1 }}>Illustrative product preview — sample figures, not live data.</p>
        </At>

        {/* Built for your business */}
        <section id="industries" aria-label="Industries">
          <At x={231} y={569}>
            <p className="font-semibold whitespace-nowrap text-[#1fb5f5] uppercase" style={{ fontSize: n(10.8), letterSpacing: "0.22em", lineHeight: 1 }}>
              Built For Your Business
            </p>
          </At>
          <At x={230} y={588}>
            <h2 className="pc-brand-heading font-bold text-white" style={{ fontSize: n(31.5), lineHeight: n(36) }}>
              Powering Businesses
              <br />
              Across <span className="text-[#1d8dff]">Every Industry.</span>
            </h2>
          </At>
          <At x={231} y={666}>
            <p className="text-[#e6ebf2]" style={{ fontSize: n(13.9), lineHeight: n(20.3) }}>
              Whether you run a single store, a multi-site operation or a complex
              <br />
              manufacturing group, PRECISIA scales with your business — giving
              <br />
              you the tools, insights and automation you need.
            </p>
          </At>
          <ul>
            {TILES.map((t) => {
              const I = t.icon;
              return (
                <li key={t.label.join(" ")} className="absolute flex items-center" style={{ left: n(t.x0 + 21), top: n(849), gap: n(16) }}>
                  <span className="flex items-center justify-center rounded-full border border-[#2f8cff]/60 text-[#3f9bff]" style={{ width: n(36), height: n(36) }}>
                    <I style={{ width: n(19), height: n(19) }} />
                  </span>
                  <span className="text-white" style={{ fontSize: n(13), lineHeight: n(17) }}>
                    {t.label[0]}
                    <br />
                    {t.label[1]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
