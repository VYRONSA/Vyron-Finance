import Link from "next/link";
import { PrecisiaWordmark, VyronsoftAttribution } from "@/components/ui/precisia-wordmark";

const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/#platform", label: "Platform" },
      { href: "/#platform", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/#platform", label: "How It Works" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/#about", label: "About" },
      { href: "/#results", label: "Resources" },
      { href: "/#contact", label: "Contact" },
      { href: "/#contact", label: "Request a Demo" },
    ],
  },
];

// The Vyronsoft product family, as listed in the PRECISIA Landing Page
// reference. Names only — none of these products has a public URL here.
const ECOSYSTEM = [
  { name: "SAFENZA", tagline: "Safety Intelligence" },
  { name: "UMORA", tagline: "Human & Workforce Intelligence" },
  { name: "VALORA", tagline: "Profitability Intelligence" },
  { name: "PROVENA", tagline: "Sustainability & Compliance" },
];

export function SiteFooter() {
  return (
    <footer id="about" className="bg-[#0d0e11] pt-16 pb-10 text-sm text-[#aeb6c3]">
      <div className="mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 gap-10 pb-12 sm:grid-cols-2 lg:grid-cols-[1.35fr_0.8fr_0.8fr_1.3fr]">
          <div>
            <Link href="/" aria-label="PRECISIA — home">
              <PrecisiaWordmark size="lg" />
            </Link>
            <VyronsoftAttribution className="mt-10 text-[#e6ebf2]" />
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <h4 className="mb-5 font-sans text-[0.68rem] font-bold tracking-[0.2em] text-[#e6ebf2] uppercase">{col.heading}</h4>
              <ul className="flex flex-col gap-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-[#d5dbe4] transition-colors hover:text-[#6cc0ff]">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h4 className="mb-5 font-sans text-[0.68rem] font-bold tracking-[0.2em] text-[#e6ebf2] uppercase">Ecosystem</h4>
            <ul className="flex flex-col gap-3">
              {ECOSYSTEM.map((product) => (
                <li key={product.name} className="grid grid-cols-[6.5rem_1fr] items-baseline gap-3">
                  <span className="font-[family-name:var(--font-brand)] font-medium tracking-[0.06em] text-[#e6ebf2]">{product.name}</span>
                  <span className="text-xs text-[#8b94a3]">{product.tagline}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-7 text-xs text-[#8b94a3]">
          <span>&copy; {new Date().getFullYear()} Precisia. All rights reserved.</span>
          <span className="flex gap-9">
            <Link href="/" className="hover:text-white">Privacy</Link>
            <Link href="/" className="hover:text-white">Terms</Link>
            <Link href="/" className="hover:text-white">Security</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
