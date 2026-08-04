# VYRON FINANCE — Support & Troubleshooting Guide

For internal/support staff handling customer issues. Grounded in `docs/OPERATIONS_MANUAL.md`'s real operational detail and `docs/DEFECT_REGISTER.md`'s known-issue list — every "known limitation" below is a real, verified gap, not a guess at what might be wrong.

## Before anything else: check the known-issues list

Many "something's broken" reports will match a known, already-diagnosed item in `docs/DEFECT_REGISTER.md`. Check there first — it has root cause, real impact, and priority for every open issue in the product.

## Common customer-reported issues and what's actually happening

### "I can't see [module/page]"
Almost always a role/permission issue, not a bug. Check Settings → Roles & Permissions for their assigned role's grants. **Known limitation**: the "View" toggle currently has no real effect on read access (every company member can read every module's data regardless) — if the complaint is specifically "I can see data I shouldn't," this is a known gap (D-001 equivalent finding), not something you can fix per-user; escalate to engineering.

### "I can't edit a Customer/Supplier's details"
This is real and expected today — no edit UI exists for Customer/Supplier master records after creation (`docs/DEFECT_REGISTER.md` D-010). **Your fix**: as support/admin, use direct database access (or ask engineering) to update the record — the backend `updateCustomer`/`updateSupplier` functions are real and safe to call, just not exposed in the UI yet.

### "My bulk action (Generate Journal / Apply Rule) didn't do what I expected"
Known gap: the UI doesn't currently show which specific rows in a bulk selection were skipped or why (D-004). **Your fix**: ask the customer to check the individual transaction's status/journal link directly — the underlying action did run correctly, it just doesn't summarize failures back to the user yet.

### "Suggested Merge doesn't do anything" (Matching → Duplicate Detection)
**This was a real, always-broken defect (D-026) and has been fixed in this codebase.** If a customer reports this on a version older than the fix, confirm they're on current code; if they still see it fail on current code, that's a genuine regression — escalate immediately, don't assume it's the known (fixed) issue.

### "The AI Copilot won't answer my questions" / gives a 403
If this started happening for an existing (not brand-new) company: this matches a real, critical defect (D-018) that has been fixed via a backfill migration (`0054`). **Check first**: has migration `0054` actually been applied to this environment's database? If not, this is the expected (if unacceptable) symptom until it is — escalate to get the migration applied, don't try to work around it per-customer.

### "A note I added in the Internal Console appeared on the wrong customer"
This was a real defect (D-029) — support notes used to always write against whichever billing account happened to be first in an internal list, regardless of which one staff were viewing. **Fixed** — staff now explicitly select the account from a dropdown before adding a note. If this is still happening on current code, escalate — it should not be possible anymore.

### "Nothing happened when I clicked Upgrade/Downgrade on my plan"
Expected today, not a bug: changing to any priced plan requires a connected payment provider (Stripe), which isn't live yet (`docs/STRIPE_PROVIDER.md`). The button correctly shows a "requires a connected payment provider" state. **Your fix**: handle the plan change manually and let the customer know self-service is coming.

### "A report doesn't look right" / "the Trial Balance doesn't balance"
1. Check whether a Financial Year exists for the company at all (Settings → Financial Years) — a missing one is the most common root cause and isn't blocked by the product itself.
2. Check for unposted (Draft/Submitted/Approved-but-not-Posted) journals — only Posted journals affect the Trial Balance.
3. Check the Financial Period isn't accidentally including transactions outside the expected date range.

### "I can't submit my VAT return to SARS from the app"
Expected — SARS eFiling submission is honestly disabled, not built yet. Direct the customer to file manually using the Return's calculated figures.

## Escalation triggers — when to involve engineering directly

- Anything matching a **Critical** or **High** severity item in `docs/DEFECT_REGISTER.md` that appears NOT fixed (the register marks fixed items explicitly — if a customer hits one marked "Status: FIXED," that's a real regression, escalate immediately).
- Any cross-tenant data visibility report (a customer seeing another company's data) — treat as security-critical regardless of how minor it seems; see `docs/SECURITY_ARCHITECTURE.md`'s incident-log for why this class of issue is taken especially seriously in this codebase's history.
- Any report of a posted journal being wrong in a way that isn't explained by the checks above — journals should never silently misbehave; this needs engineering's direct investigation.
- A scheduler/automation task that appears stuck — check `automation_task_runs` for the task's `retryCount` vs `maxRetries` and `automation_audit_log` for the real captured error first (per `docs/OPERATIONS_MANUAL.md`), then escalate with those details rather than "it's not working."

## What you can safely tell a customer is "coming soon" vs. "not planned"

**Coming soon** (real, scoped, tracked in `docs/DEFECT_REGISTER.md`): Customer/Supplier edit UI, Financial Period Lock/Reopen UI, Audit Engagement creation UI, in-app help/search, Stripe-based self-service plan changes.

**Not currently planned / architecturally deliberate, don't promise a date**: SARS eFiling integration, direct migration tooling from other accounting packages, self-service registration (invite-only by design).
