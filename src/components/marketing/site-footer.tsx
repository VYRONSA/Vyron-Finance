import Link from "next/link";
import { Container } from "@/components/ui/section";
import { BrandMark } from "@/components/ui/brand-mark";

const FOOTER_COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/pricing", label: "Pricing" },
      { href: "/#workflow", label: "How It Works" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/#faq", label: "FAQ" },
      { href: "/#contact", label: "Contact" },
      { href: "/#contact", label: "Book Demo" },
    ],
  },
  {
    heading: "Ecosystem",
    links: [
      { href: "/", label: "VYRON FINANCE" },
      { href: "/", label: "VYRON CORE" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-vf-canvas-raised py-14 text-sm text-vf-on-dark-soft">
      <Container>
        <div className="grid grid-cols-1 gap-10 border-b border-white/10 pb-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5 font-display text-lg text-vf-on-dark">
              <span className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-[9px] bg-vf-charcoal shadow-[inset_0_0_0_1px_rgba(247,244,241,0.14)]">
                <BrandMark className="h-[18px] w-[18px]" />
              </span>
              VYRON FINANCE
            </Link>
            <p className="mt-3.5 max-w-[32ch]">
              Part of the VYRON ecosystem — intelligent accounting recovery and financial intelligence, built for finance teams who need to trust their own numbers.
            </p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading}>
              <h4 className="mb-4 font-sans text-xs font-bold tracking-[0.07em] text-vf-on-dark uppercase">
                {col.heading}
              </h4>
              <ul className="flex flex-col gap-2.5">
                {col.links.map((link, i) => (
                  <li key={`${link.label}-${i}`}>
                    <Link href={link.href} className="hover:text-vf-red-400">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 pt-6 text-xs">
          <span>&copy; {new Date().getFullYear()} VYRON FINANCE. All rights reserved.</span>
          <span className="flex gap-5">
            <Link href="/" className="hover:text-vf-on-dark">Privacy</Link>
            <Link href="/" className="hover:text-vf-on-dark">Terms</Link>
            <Link href="/" className="hover:text-vf-on-dark">Security</Link>
          </span>
        </div>
      </Container>
    </footer>
  );
}
