import Link from "next/link";
import { PrecisiaWordmark } from "@/components/ui/precisia-wordmark";
import { VYRONSOFT, VYRONSOFT_ECOSYSTEM } from "@/lib/precisia-site";

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

const HEADING = "mb-5 font-sans text-[0.68rem] font-bold tracking-[0.2em] text-[#e6ebf2] uppercase";

export function SiteFooter() {
  return (
    <footer id="about" className="bg-[#0d0e11] pt-16 pb-10 text-sm text-[#aeb6c3]">
      <div className="mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 gap-10 pb-12 sm:grid-cols-2 lg:grid-cols-[2.65fr_0.8fr_0.8fr]">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" aria-label="PRECISIA — home">
              <PrecisiaWordmark size="lg" />
            </Link>
            <p className="mt-10 text-sm text-[#e6ebf2]">
              A product of{" "}
              <a href={VYRONSOFT.url} className="font-semibold transition-colors hover:text-[#6cc0ff]">
                {VYRONSOFT.name}
              </a>
            </p>
            <p className="mt-3 text-[0.68rem] font-semibold tracking-[0.2em] text-[#8b94a3]">{VYRONSOFT.statement}</p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <h4 className={HEADING}>{col.heading}</h4>
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
        </div>
        {/* The VYRONSOFT software ecosystem — the same six products, in the
            same order and words, on every VYRONSOFT product site. Each name
            is an ordinary link to that product's own site. */}
        <nav aria-labelledby="vyronsoft-ecosystem" className="border-t border-white/10 py-10">
          <h4 id="vyronsoft-ecosystem" className={HEADING}>
            VYRONSOFT Software Ecosystem
          </h4>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-6">
            {VYRONSOFT_ECOSYSTEM.map((product) => (
              <li key={product.name}>
                <a
                  href={product.url}
                  className="inline-block py-1 font-[family-name:var(--font-brand)] font-medium tracking-[0.06em] text-[#e6ebf2] transition-colors hover:text-[#6cc0ff]"
                >
                  {product.name}
                </a>
                <p className="mt-0.5 text-xs leading-snug text-[#8b94a3]">{product.descriptor}</p>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-7 text-xs text-[#8b94a3]">
          <span>&copy; {new Date().getFullYear()} {VYRONSOFT.name}. All rights reserved.</span>
          {/* The reference also lists Privacy, Terms and Security. Those pages
              do not exist yet, so no link is shown rather than one that goes
              nowhere. */}
        </div>
      </div>
    </footer>
  );
}
