import { Container, Section, Eyebrow } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Card } from "@/components/ui/card";
import { ReconciliationDemo } from "@/components/marketing/reconciliation-demo";

const STATS = [
  { value: "500,000+", label: "Transactions coded per company, verified responsive" },
  { value: "100,000+", label: "Merchant Rules supported without slowdown" },
  { value: "1", label: "Rule taught once — coded automatically, forever" },
  { value: "100%", label: "Audit trail on every coding decision made" },
];

const OUTCOMES = [
  {
    tag: "Recovery",
    title: "Thousands of uncoded transactions, recovered",
    body: "A backlog of unreconciled statements stops being a write-off. The Recovery Wizard and Merchant Rules work through it once, properly, instead of forever.",
  },
  {
    tag: "Speed",
    title: "Month-end shrinks from weeks to days",
    body: "Coding that used to happen line by line at month-end has already happened — automatically, as statements were imported.",
  },
  {
    tag: "Effort",
    title: "Repetitive coding, eliminated",
    body: "You code a merchant once. Every transaction from that merchant, past and future, codes itself from then on — no re-work, no re-checking.",
  },
  {
    tag: "Asset",
    title: "Merchant knowledge becomes a permanent asset",
    body: "Every rule you teach is reusable — across financial years, across companies, exportable across your whole client base.",
  },
  {
    tag: "Readiness",
    title: "Audit-ready, by default",
    body: "Automatic, bulk, and manual coding are all permanently recorded. When an auditor asks why a number is what it is, the answer already exists.",
  },
  {
    tag: "Clarity",
    title: "Financial reporting, accelerated",
    body: "GL, VAT, and spend reports build themselves from coded transactions in real time — not rebuilt from a spreadsheet every reporting cycle.",
  },
];

const FEATURES = [
  { title: "Import Centre", body: "Bring in statements from every bank you hold accounts with — PDF or Excel — reconciled against what's already on file." },
  { title: "Merchant Intelligence", body: "Every merchant recognised, normalised, and grouped from raw, inconsistent bank description text." },
  { title: "Rule Intelligence", body: "Priority, conflict detection, version history, and health checks over the rules that run your coding." },
  { title: "VAT Coding", body: "A focused pass to apply the correct VAT treatment across every transaction, with exceptions surfaced early." },
  { title: "GL Coding", body: "A governed Chart of Accounts and General Ledger, coded automatically the moment a merchant is recognised." },
  { title: "Financial Reports", body: "General Ledger, VAT, monthly spend, and merchant summaries — exportable to Excel, CSV, or PDF." },
  { title: "Executive Dashboard", body: "Total spend, income, VAT position, coding progress, and top suppliers — one screen, board-ready." },
  { title: "Export Centre", body: "Every report, in the format your auditor or board actually asks for, with full metadata attached." },
  { title: "Audit Trail", body: "Every coding decision — automatic, bulk, or manual override — permanently recorded and traceable." },
  { title: "Recovery Wizard", body: "A guided path back to reconciled, reportable books when the books have fallen behind." },
];

export default function HomePage() {
  return (
    <>
      {/* HERO — dark, executive red glow */}
      <section className="relative overflow-hidden border-b border-vf-dark-border bg-vf-canvas pt-10 pb-16 sm:pt-14 sm:pb-20">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-1/4 left-1/2 h-[70%] w-[80%] -translate-x-1/2 rounded-full opacity-60"
          style={{ background: "radial-gradient(circle, rgba(15,92,150,0.4), transparent 70%)" }}
        />
        <Container className="relative grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <Eyebrow>Financial Intelligence Platform</Eyebrow>
            <h1 className="mt-4 text-[2.3rem] leading-[1.06] font-medium text-vf-on-dark sm:text-5xl lg:text-6xl">
              Recover. Understand.
              <br />
              <span className="text-vf-red-400">Control.</span>
            </h1>
            <p className="mt-5 max-w-[46ch] text-lg text-vf-on-dark-soft">
              VYRON FINANCE turns raw bank statements into audited, reportable
              financial truth — bank transaction intelligence, self-teaching
              Merchant Rules, automatic General Ledger and VAT coding, and
              executive reporting your finance team can stand behind.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {["Bank Transaction Intelligence", "Merchant Rules", "VAT Intelligence", "GL Automation", "Executive Reporting"].map(
                (tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-vf-red-500/30 bg-vf-red-500/10 px-3.5 py-1.5 text-xs font-semibold text-vf-red-300"
                  >
                    {tag}
                  </span>
                ),
              )}
            </div>
            <div className="mt-8 flex flex-wrap gap-3.5">
              <Button href="/pricing" variant="primary">Start Free Trial</Button>
              <Button href="/#contact" variant="outline">Book Demo</Button>
            </div>
          </div>
          <ReconciliationDemo />
        </Container>
      </section>

      {/* STATS */}
      <div className="border-b border-vf-dark-border bg-vf-canvas-raised">
        <Container className="grid grid-cols-2 gap-6 py-8 lg:grid-cols-4">
          {STATS.map((s) => (
            <StatTile key={s.label} tone="dark" value={s.value} label={s.label} />
          ))}
        </Container>
      </div>

      {/* EXECUTIVE OUTCOMES — white paper cards on the dark canvas */}
      <Section className="border-b border-vf-dark-border bg-vf-canvas" id="outcomes">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>What Changes</Eyebrow>
            <h2 className="mt-2.5 text-3xl font-medium text-vf-on-dark sm:text-4xl">
              Not another feature list. What actually happens to your finance function.
            </h2>
            <p className="mt-3.5 text-vf-on-dark-soft">
              This is the difference between software that records transactions and a platform that changes how your finance department runs.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {OUTCOMES.map((o) => (
              <Card key={o.tag} className="p-7">
                <div className="font-sans text-xs font-bold tracking-[0.1em] text-vf-red-600 uppercase">{o.tag}</div>
                <h3 className="mt-2.5 text-lg font-medium text-vf-ink">{o.title}</h3>
                <p className="mt-2.5 text-sm text-vf-ink-soft">{o.body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* FEATURES — white paper cards */}
      <Section id="features" className="bg-vf-canvas">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow>The Platform</Eyebrow>
            <h2 className="mt-2.5 text-3xl font-medium text-vf-on-dark sm:text-4xl">
              Every module your finance function actually runs on.
            </h2>
            <p className="mt-3.5 text-vf-on-dark-soft">
              From the first bank statement import to the executive report
              that lands on a director&rsquo;s desk, VYRON FINANCE is built
              as one connected system — not a spreadsheet with extra steps.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <Card key={f.title} className="p-5.5 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-vf-paper-lg">
                <div className="flex h-10.5 w-10.5 items-center justify-center rounded-[11px] bg-vf-red-500/12 text-vf-red-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                    <path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" />
                  </svg>
                </div>
                <h3 className="mt-4 font-sans text-[1.02rem] font-semibold text-vf-ink">{f.title}</h3>
                <p className="mt-2 text-sm text-vf-ink-soft">{f.body}</p>
              </Card>
            ))}
          </div>
        </Container>
      </Section>

      {/* CLOSING CTA */}
      <section className="relative overflow-hidden bg-gradient-to-br from-vf-red-900 to-vf-canvas py-16 text-center text-vf-on-dark sm:py-20" id="contact">
        <Container>
          <Eyebrow className="text-vf-red-300">Next Step</Eyebrow>
          <h2 className="mt-3 text-3xl font-medium text-vf-on-dark sm:text-4xl">
            Bring a real statement. See your own books coded, in thirty minutes.
          </h2>
          <p className="mx-auto mt-3.5 max-w-[62ch] text-vf-on-dark-soft">
            Not a generic demo environment — a guided session against your
            own data, with someone who understands how your books actually
            work.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3.5">
            <Button href="/pricing" variant="primary">Book a Guided Demo</Button>
            <Button href="/pricing" variant="ghostDark">View Pricing</Button>
          </div>
        </Container>
      </section>
    </>
  );
}
