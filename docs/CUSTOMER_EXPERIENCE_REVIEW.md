# VYRON FINANCE 1.0 — Customer Experience Review

Launch Readiness Programme (LR1) Phase 4: "Imagine this is a customer's first day." Synthesized from the Phase 1 Product Audit's dedicated first-day-journey pass — real code tracing of the actual current onboarding path, not a hypothetical walkthrough.

## The journey, stage by stage

### 1. Registration
**No self-service signup exists.** The only account-creation paths are a one-time first-super-admin bootstrap (`/setup`) and admin-initiated invites. **Verdict: inherent, not a defect** — this is a real, deliberate property of a B2B multi-tenant ERP sold sales-assisted or invite-based, not a gap. Flagged for product-owner awareness only if self-serve trial signup is ever intended, since nothing in the code supports one today.

### 2. Company creation
Real, working, but has gotten measurably heavier this engagement: `createCompany` now runs ~12+ sequential (unbatched) writes, the last several being the new billing-provisioning chain (`subscribeCompanyToPlan`'s own 4-5 writes). The form shows only a static "Creating…" state with no incremental feedback (D-040, Medium). **A related, more serious finding**: a billing-side failure during this chain (e.g. the plan catalog not being seeded) would surface the misleading client-side message "Couldn't reach the API. Check the dev server is running." — actively wrong for what would really be a server configuration fault (D-041, Medium).

### 3. Trial activation
**Real, automatic, zero Stripe dependency** — confirmed in code, matching `docs/BILLING_ARCHITECTURE.md`'s own claim exactly. **But completely silent**: a `TrialStarted` billing event is genuinely published, but nothing in the Dashboard, the workspace shell, or anywhere in the authenticated app tells a first-time user their 14-day trial clock just started (D-042, Medium). The only place it's visible is the Billing page, which a new user has no reason to visit on day one.

### 4. Navigation
**Genuinely good** — all 26 items across the 3-group sidebar nav resolve to real, working pages; the code's own comment about "inert" placeholder items is now stale (every item currently has a real destination), which is a documentation cleanup opportunity, not a defect. No dead links found anywhere in primary navigation.

### 5. Help / documentation
**A real gap.** The header's Help icon and Search box both render as if interactive but have no handler at all — worse than omitting them, since they signal a capability that isn't there (D-034/D-043, Medium, elevated specifically for first-day impact). No in-app tour, no contextual help, no documentation link anywhere in the authenticated shell. A new user is dropped into a 26-item, 3-group navigation with zero guidance beyond the item labels themselves.

### 6. First import
**A genuine strength.** Import Centre explains its expected CSV column order clearly for both Bills/Credit Notes and Bank Statements, and — a real, good design choice — a bank statement's referenced bank account is auto-created on import (`getOrCreateBankAccountByNumber`) rather than requiring the user to pre-create one. This removes a real friction point many comparable products impose. **Verdict: no fix needed, close to best practice.**

### 7. First transaction / first invoice / first bank import
Reasonably low-friction given the module design: a Chart of Accounts (12 default accounts) and default VAT treatments (6) are auto-seeded on company creation, removing real setup burden before a first transaction can even be captured. Sales/Purchasing document creation, once the concepts are understood, requires no undisclosed prerequisite steps.

### 8. First report / first month-end
**The one genuinely unguided gap in an otherwise well-designed onboarding path.** No `financial_years` row is auto-seeded for a new company (unlike Chart of Accounts/VAT treatments) — journal posting is not blocked by a missing Financial Year, so a user can transact for weeks before discovering, only via a failed or empty period-bounded report, that they needed to visit Settings → Financial Years first (D-044, Medium). There is also no guided month-end/period-close flow anywhere in the product — no "lock the period," "run depreciation," "generate statements" checklist step, despite the Dashboard's own real "Recovery Health" checklist proving the product team already believes in guided completion for *other* steps (Bank Statements Imported → Matching → Journals Generated → Journals Posted → VAT Exceptions Cleared).

## What's a real, fixable friction point vs. an inherent property of professional accounting software

**Real, fixable, worth doing before/soon after launch** (all already tracked in `docs/DEFECT_REGISTER.md`):
- D-040 — batch/parallelize the company-creation write chain, or at minimum show incremental progress.
- D-041 — fix the misleading error message on a billing-side company-creation failure.
- D-042 — surface trial activation to the user (a banner or a prominent notification on first Dashboard visit — the event and content already exist, this is a visibility fix, not new plumbing).
- D-043 — wire or remove the decorative Help/Search/Collapse controls; their false affordance is specifically worse for a first-time user.
- D-044 — a one-time "Set up your first Financial Year" prompt on an empty Dashboard.

**Acceptable, inherent to the product category — explicitly not recommended for a pre-launch fix**:
- Invite-only registration (a deliberate B2B model, not an oversight).
- CSV-literacy expectations for imports (standard for the category, and the product already does real work — auto-creating bank accounts — to reduce the burden where it reasonably can).
- Base-level accounting/Financial-Period literacy assumed for a professional double-entry tool — this is not consumer software, and dumbing down the underlying concepts would be a worse product decision than leaving them as-is.

**A real gap, but scoped as future feature work, not a launch blocker**: extending the existing, already-good "Recovery Health" guided-checklist pattern to a true month-end/period-close ritual. The team's own prior design work proves this is the right direction; building it out is real, non-trivial feature work, not a quick pre-launch polish item.

## Overall verdict

The first-day path is **substantially better than the average multi-tenant ERP's** in the specific places this product's team clearly invested deliberate design effort (auto-seeded Chart of Accounts/VAT, auto-created bank accounts on import, the Recovery Health checklist). The gaps found are concentrated in two places: (1) the newest code — the Billing Platform's own onboarding-adjacent additions (trial silence, the heavier write chain, the misleading error) — and (2) a handful of long-standing, low-cost fixes (decorative controls, the missing Financial Year prompt) that were never prioritized because nothing before this audit systematically looked for them. None of the 5 tracked items are individually large; together they would meaningfully improve day-one confidence for a new customer.
