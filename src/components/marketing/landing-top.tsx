import type { ComponentType, CSSProperties, ReactNode, SVGProps } from "react";
import Link from "next/link";
import { PIconArrowRight, PIconBuildingColumns, PIconCart, PIconGear, PIconOffice, PIconUsers } from "@/components/ui/precisia-icons";
import { IconArchive, IconReceipt } from "@/components/ui/icons";
import { MonitorPreview } from "@/components/marketing/product-preview";
import { HERO_WIDTHS, Photo, TILE_WIDTHS } from "@/components/marketing/photo";

/**
 * The top of the landing page — hero and "Built for your business" — laid
 * out on the owner's "New Landing Page" reference (1672 x 941): every
 * position below is in that reference's pixels (`--n` is one of them,
 * never more than 1px).
 *
 * The photography is real, licensed, high-resolution photographs
 * (public/brand/precisia-photo), each filling its band edge to edge and
 * cropped by its box, never stretched or enlarged. The monitor's screen is
 * an HTML/SVG illustration with sample figures, captioned as such.
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

const TILES: { label: [string, string]; icon: Icon; x0: number; photo: string; focus: string }[] = [
  { label: ["Retail", "& Franchises"], icon: PIconCart, x0: 95, photo: "tile-retail", focus: "50% 50%" },
  { label: ["Hospitality", "& Restaurants"], icon: IconReceipt, x0: 309, photo: "tile-hospitality", focus: "68% 40%" },
  { label: ["Food", "Manufacturing"], icon: PIconGear, x0: 522, photo: "tile-food", focus: "50% 55%" },
  { label: ["Wholesale", "& Distribution"], icon: IconArchive, x0: 735, photo: "tile-wholesale", focus: "50% 50%" },
  { label: ["Professional", "Services"], icon: PIconUsers, x0: 948, photo: "tile-professional", focus: "50% 35%" },
  { label: ["Construction", "& Contracting"], icon: PIconBuildingColumns, x0: 1162, photo: "tile-construction", focus: "50% 50%" },
  { label: ["Multi-Company", "Groups"], icon: PIconOffice, x0: 1376, photo: "tile-multi", focus: "50% 50%" },
];

// Band heights in reference px: the hero photograph runs to the desk edge
// at 557; the industries photograph fills the rest.
const HERO_H = 557;
const PAGE_H = 941;

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
  return (
    <div className="relative overflow-clip bg-[#020b17] [container-type:inline-size]" style={{ "--n": "calc(min(100cqw, 1672px) / 1672)" } as CSSProperties}>
      {/* Full-bleed photographs: as wide as the window, as tall as the
          composition's bands. */}
      <Photo name="hero" widths={HERO_WIDTHS} sizes="100vw" priority className="absolute top-0 left-0 w-full" style={{ height: n(HERO_H), objectPosition: "50% 55%" }} />
      <Photo name="industries" widths={HERO_WIDTHS} sizes="100vw" className="absolute left-0 w-full" style={{ top: n(HERO_H), height: n(PAGE_H - HERO_H), objectPosition: "50% 36%" }} />
      {/* Shade behind the copy column, as the reference's darker left side. */}
      <div aria-hidden className="absolute top-0 left-0 w-full" style={{ height: n(HERO_H), background: "linear-gradient(90deg, rgba(2,9,20,0.86) 0%, rgba(2,9,20,0.7) 28%, rgba(2,9,20,0.25) 46%, rgba(2,9,20,0) 60%)" }} />
      <div aria-hidden className="absolute left-0 w-full" style={{ top: n(HERO_H), height: n(PAGE_H - HERO_H), background: "linear-gradient(90deg, rgba(2,9,20,0.7) 0%, rgba(2,9,20,0.45) 32%, rgba(2,9,20,0) 52%)" }} />
      <div className="landing-frame relative" style={{ height: n(PAGE_H) }}>
        <At x={624} y={143} w={600}>
          <MonitorPreview caption={false} stand screenStyle={{ fontSize: n(12.5) }} />
        </At>

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
          {TILES.map((t) => (
            <div key={t.photo} aria-hidden className="absolute overflow-hidden border-[1.5px] border-[#1e6fd0]/60 bg-[#011226] shadow-[0_18px_40px_-24px_rgba(22,112,255,0.6)]" style={{ left: n(t.x0 - 1), top: n(733), width: n(201), height: n(164), borderRadius: n(6) }}>
              <Photo name={t.photo} widths={TILE_WIDTHS} sizes="(min-width: 1024px) 13vw, 45vw" className="block w-full" style={{ height: n(103), objectPosition: t.focus }} />
            </div>
          ))}
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
