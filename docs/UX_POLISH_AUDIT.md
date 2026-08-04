# VYRON FINANCE 1.0 — UX & Product Polish Audit

Launch Readiness Programme (LR1) Phase 3: "No redesign. Only refinement." Synthesized from the Phase 1 Product Audit's 7 independent passes — every item below was found during real code reading, not a fresh visual pass, and is cross-referenced to its `docs/DEFECT_REGISTER.md` entry where one exists.

## Empty states

**Strong, consistent pattern found almost everywhere**: this codebase's own `EmptyState` component (real title + description + optional action, per its own "guide-forward" docstring) is used consistently across Cashbook, Matching, Documents, Communications, the new Billing Portal, and the new Internal Console. No bare "No data" text was found anywhere in the audited modules — every empty state names what's missing and, where a fix exists, how to address it.

**One real gap**: the Auditor Workspace's Planning tab, when no engagement exists, shows a bare `<p>No audit engagement exists yet.</p>` — not the real `EmptyState` component, and with no action to create one (see Phase 1's D-019, High — a functional dead-end, not just a polish gap).

## Loading states

Consistent `disabled={loading}` + button-text-swap pattern ("Save" → "Saving…", "Add Note" → "Adding…") found across every mutating control audited, in every module including the newly-built Billing Platform. No inconsistency found here.

## Error messages

**Consistent, correct pattern in most places**: `if (!res.ok) { const body = await res.json(); setError(body.error ?? \`Request failed (${res.status})\`); }`, found in Cashbook, Matching, Communications, Documents, the Billing Portal's Plan tab, and the Internal Console.

**Real, found inconsistency** (`docs/DEFECT_REGISTER.md` D-027, Medium): Financial Statements' "Save Commentary" and "Generate Reporting Package" actions never check `res.ok` at all — a failure is completely invisible to the user, unlike every other module's equivalent action. A preparer's typed commentary can be silently discarded on a failed save.

**Real, found mismatch** (D-041, Medium): a billing-configuration failure during company creation surfaces the generic client-side catch-all "Couldn't reach the API. Check the dev server is running." — actively wrong messaging for what would really be a server-side fault, not a dev-server connectivity issue.

## Validation messages

Server-side `ValidationError`s are consistently mapped to `400` with the real message surfaced to the user across every module audited — no generic "Something went wrong" masking a specific, useful validation failure.

## Success feedback

Consistent `router.refresh()` after a successful mutation across the entire application — the established pattern, correctly followed even in the newest code (Billing Platform).

## Button consistency

The shared `Button` component (`variant`/`size` from one `cva` definition) is used everywhere — no ad hoc button styling was found in any audited module. **Real gap found**: several buttons render with no `href` and no `onClick`, indistinguishable from a working button until clicked:
- Platform Overview: "Invite User," "Edit Profile," "Contact Support" (D-031, High) — **fixed in this pass**, now real links or an honestly-disabled state.
- Dashboard: "View All Insights" (D-038, Low) — still open.
- Financial Workspace shell: header search input, sidebar Collapse button, Help icon (D-034/D-043, Medium) — still open, and specifically worse for a first-time user (see Phase 4).

## Icons & labels

No inconsistency found — icon usage (`@/components/ui/icons`) is applied consistently by semantic meaning (e.g. `IconShieldCheck` for audit-adjacent content, `IconBanknote` for money) across every module, including the newly-built Billing Platform, which reuses the same icon set rather than introducing new ones.

## Keyboard navigation & accessibility

Not independently re-audited in this pass (no browser-automation tool exists in this environment, matching the exact limitation `docs/SECURITY_ARCHITECTURE.md` already discloses for its own testing). What's known from the existing codebase: `jest-axe` component-level accessibility tests exist for several modules (confirmed present in Assets, Automation Dashboard, and others per prior engagement history) but were **not** added for the new Commercial Billing Platform's Customer Portal or Internal Console pages — a disclosed gap already noted in `docs/MIGRATION_ROADMAP.md`'s Sub-Phase 5 section, not new to this audit.

## Responsive layouts

Not independently re-verified (same tooling limitation as above). No responsive-specific defect was reported by any of the 7 audit passes, but none specifically tested narrow-viewport rendering either — this is a genuine gap in this audit's own coverage, disclosed rather than silently assumed fine.

## Visual consistency — "does every page feel like one product"

**Yes, with high confidence.** Every module audited — including the Billing Platform, built in a separate, later engagement pass — reuses the exact same `Card`/`Table`/`Badge`/`Button`/`StatTile`/`EmptyState` component set with no ad hoc styling, no second design system, and no visual divergence found anywhere. The tab-shell pattern (`Card` + underlined-tab-buttons + `CardContent`) is identical across General Ledger, Assets, Auditor Workspace, Matching, and the new Billing Console — confirmed by direct code comparison across modules built months apart in this codebase's history.

## Consolidated polish findings not already in the Defect Register as their own entries

1. **Decorative, non-functional controls present false affordances** — the header search box and Help icon in the Financial Workspace shell look interactive but do nothing; this reads as more broken than simply omitting them would. Recommend either wiring real functionality (a genuine global search is real, scoped feature work — not a quick polish fix) or removing the controls until they're real.
2. **Journal-number drill-through is inconsistent** — linked in Account Activity, plain text in GL Inquiry, Sales Invoices, and Purchase Bills (D-011). A one-pattern, three-file fix.
3. **Recovery Alerts lose their click-through link outside Preview Mode** (D-039) — works in the demo, degrades to plain text in production. The kind of thing a demo-vs-production discrepancy check would catch before launch.

## What "no redesign, only refinement" means for this list

Every item above is a real, scoped, small-to-medium fix — none require a new visual language, a new component, or a new page structure. The two largest ("wire a real global search," "audit Engagement creation UI") are the only ones that cross from "polish" into "a real missing capability," and both are already tracked as their own Defect Register entries (D-019, D-034) with honest effort estimates rather than folded into this polish pass.
