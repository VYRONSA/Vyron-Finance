import type { Metadata } from "next";
import { Container, Section, Eyebrow } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing — VYRON FINANCE",
  description: "Plans priced for how many companies you run.",
};

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-vf-success">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const PLANS = [
  {
    name: "Starter",
    tagline: "Designed for accountants and consultants working one company at a time.",
    price: "R450",
    period: "/ month",
    specs: [
      ["Ideal For", "Solo practitioners"],
      ["Companies", "1"],
      ["Support", "Email"],
      ["Implementation", "Self-service"],
      ["AI Capability", "Merchant Rules"],
      ["Exports", "Excel, CSV"],
    ],
    features: ["Import Centre & Merchant Rules", "GL & VAT Coding", "Standard reports & exports"],
    cta: "Start Free Trial",
    featured: false,
  },
  {
    name: "Professional",
    tagline: "For growing businesses coding their own books month to month.",
    price: "R950",
    period: "/ month",
    specs: [
      ["Ideal For", "Growing businesses"],
      ["Companies", "Up to 3"],
      ["Support", "Priority email"],
      ["Implementation", "Guided onboarding"],
      ["AI Capability", "Rule Intelligence"],
      ["Exports", "Excel, CSV, PDF"],
    ],
    features: ["Everything in Starter", "Rule Intelligence & conflict detection", "Rule import / export"],
    cta: "Start Free Trial",
    featured: false,
  },
  {
    name: "Business",
    tagline: "For multi-company finance teams who need the full picture.",
    price: "R2,400",
    period: "/ month",
    specs: [
      ["Ideal For", "Multi-company teams"],
      ["Companies", "Up to 15"],
      ["Support", "Phone & priority"],
      ["Implementation", "Dedicated session"],
      ["AI Capability", "Full Financial Intelligence"],
      ["Exports", "All formats + scheduled"],
    ],
    features: ["Everything in Professional", "Executive Dashboard", "Full Audit Trail"],
    cta: "Start Free Trial",
    featured: true,
  },
  {
    name: "Enterprise",
    tagline: "Unlimited companies, enterprise deployment, and priority support.",
    price: "Custom",
    period: null,
    specs: [
      ["Ideal For", "Enterprise groups"],
      ["Companies", "Unlimited"],
      ["Support", "Dedicated manager, SLA"],
      ["Implementation", "White-glove deployment"],
      ["AI Capability", "Custom rule tuning"],
      ["Exports", "All formats + integrations"],
    ],
    features: ["Everything in Business", "Custom integrations & SLA", "Dedicated account manager"],
    cta: "Book Demo",
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <Section>
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow className="justify-center before:hidden">Pricing</Eyebrow>
          <h1 className="mt-2.5 text-3xl font-medium text-vf-on-dark sm:text-4xl">
            Priced for how many companies you run, not how many people ask you questions.
          </h1>
          <p className="mt-3.5 text-vf-on-dark-soft">
            All plans include unlimited users. Prices in ZAR, billed monthly. Annual billing available.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "relative flex flex-col rounded-vf-md border border-vf-paper-border bg-vf-paper p-6 shadow-vf-paper-sm",
                plan.featured && "border-vf-red-500 shadow-[0_0_0_1px_var(--color-vf-red-500),var(--shadow-vf-paper-lg)]",
              )}
            >
              {plan.featured && (
                <span className="absolute -top-3 left-6 rounded-full bg-vf-red-500 px-3 py-1 text-[0.68rem] font-bold tracking-[0.05em] text-vf-on-dark uppercase">
                  Most Popular
                </span>
              )}
              <div className="font-sans text-base font-bold text-vf-ink">{plan.name}</div>
              <div className="mt-1.5 min-h-11 text-[0.83rem] text-vf-ink-soft">{plan.tagline}</div>
              <div className="mt-4 flex items-baseline gap-1 font-mono tabular-nums">
                <span className="text-2xl font-semibold text-vf-ink">{plan.price}</span>
                {plan.period && <span className="text-xs text-vf-ink-faint">{plan.period}</span>}
              </div>

              <div className="mt-5 flex flex-col gap-2 border-t border-vf-paper-border pt-4">
                {plan.specs.map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3 text-[0.76rem]">
                    <span className="whitespace-nowrap text-vf-ink-faint">{label}</span>
                    <span className="text-right font-semibold text-vf-ink">{value}</span>
                  </div>
                ))}
              </div>

              <ul className="mt-5 mb-6 flex flex-1 flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-[0.87rem] text-vf-ink-soft">
                    {CHECK}
                    {feature}
                  </li>
                ))}
              </ul>

              <Button href="/#contact" variant={plan.featured ? "primary" : "subtle"} className="w-full">
                {plan.cta}
              </Button>
            </div>
          ))}
        </div>
      </Container>
    </Section>
  );
}
