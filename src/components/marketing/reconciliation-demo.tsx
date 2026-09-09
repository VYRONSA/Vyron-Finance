const ROWS = [
  { key: "r1", desc: "CHECKERS TYGER VALLEY", rule: "Checkers · GL 5100" },
  { key: "r2", desc: "FNB OB PMT ENGEN N1", rule: "Engen · GL 5400" },
  { key: "r3", desc: "THREE STREAMS SMOKEHSE", rule: "Three Streams · GL 5100" },
];

const PIPELINE = ["Import", "Merchant", "Rule", "GL", "VAT", "Reports", "Dashboard"];

/** The approved hero signature: a live reconciliation panel showing the
 * product's actual mechanic (teach a rule once, every match codes
 * itself) rather than a static dashboard screenshot, extended with a
 * pipeline strip foreshadowing the full processing chain. */
export function ReconciliationDemo() {
  return (
    <div>
      <div className="relative overflow-hidden rounded-vf-lg bg-vf-charcoal p-6 pb-7 text-vf-on-dark shadow-vf-dark-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-[40%] -right-[20%] h-[140%] w-[60%] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(47,151,224,0.3), transparent 70%)",
          }}
        />
        <div className="mb-3.5 flex items-center justify-between border-b border-white/12 pb-3.5 text-[0.72rem] tracking-[0.09em] text-vf-on-dark-soft uppercase">
          <span>Live Reconciliation</span>
          <strong className="font-semibold text-vf-on-dark">Bank Feed &rarr; Coded Ledger</strong>
        </div>

        <div className="hidden grid-cols-[1.3fr_1fr_1fr] gap-2 px-0.5 pb-2.5 text-[0.68rem] tracking-[0.08em] text-vf-on-dark-soft uppercase sm:grid">
          <span>Transaction</span>
          <span>Merchant Rule</span>
          <span>Status</span>
        </div>

        {ROWS.map((row) => (
          <div
            key={row.key}
            className={`ledger-row animated ${row.key} mb-2 grid grid-cols-[1.1fr_1fr_1fr] items-center gap-2 rounded-[10px] border border-white/8 bg-white/[0.035] px-3 py-2.5 text-sm sm:grid-cols-[1.3fr_1fr_1fr]`}
          >
            <span className="truncate font-mono text-[0.78rem] text-vf-on-dark">{row.desc}</span>
            <span className="relative h-[1.3em] text-[0.78rem] text-vf-on-dark-soft">
              <span className="rule-pending absolute inset-0 flex items-center">&mdash;</span>
              <span className="rule-resolved absolute inset-0 flex items-center font-semibold text-vf-red-400">
                {row.rule}
              </span>
            </span>
            <span className="relative h-[1.6em] justify-self-start">
              <span className="status-pending absolute inset-0 inline-flex items-center gap-1 rounded-full bg-vf-warning/16 px-2.5 py-1 text-[0.7rem] font-bold text-[#e3a35b]">
                Needs Coding
              </span>
              <span className="status-resolved absolute inset-0 inline-flex items-center gap-1 rounded-full bg-vf-success/18 px-2.5 py-1 text-[0.7rem] font-bold text-[#6cd2a4]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className="h-[11px] w-[11px]">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Coded
              </span>
            </span>
          </div>
        ))}

        <div className="mt-4 flex items-center justify-between border-t border-white/12 pt-4 font-mono text-[0.78rem] text-vf-on-dark-soft">
          <span>Teach a rule once &mdash; every match, past and future, codes itself.</span>
          <strong className="font-semibold text-vf-red-400">100% automated</strong>
        </div>
      </div>

      <div
        aria-hidden
        className="mt-3.5 flex items-center overflow-x-auto rounded-vf-md bg-vf-charcoal px-4.5 py-3.5 shadow-vf-dark-card"
      >
        {/* Flat, alternating node/connector siblings — the CSS staggered
            animation delays target `.pipeline-node:nth-child(odd)`, which
            only works if every node is a direct sibling, not nested. */}
        {PIPELINE.flatMap((step, i) => [
          i > 0 ? (
            <span key={`sep-${step}`} className="mx-1.5 h-px w-4 shrink-0 bg-white/16 sm:w-6" />
          ) : null,
          <span
            key={step}
            className="pipeline-node font-mono text-[0.64rem] tracking-[0.02em] whitespace-nowrap text-vf-on-dark-soft"
          >
            {step}
          </span>,
        ])}
      </div>
    </div>
  );
}
