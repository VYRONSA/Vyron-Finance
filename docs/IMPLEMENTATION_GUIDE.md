# VYRON FINANCE — Implementation Guide

For whoever is setting up VYRON FINANCE for a new customer — an internal implementation consultant, a partner, or a technical administrator. Two separate concerns: standing up the **platform** (once, for the whole multi-tenant deployment — see `docs/DEPLOYMENT_GUIDE.md` for that) and onboarding **one customer company** onto an already-running platform (this document).

## Prerequisite: is the platform itself ready?

Before onboarding any customer, confirm against `docs/LAUNCH_CHECKLIST.md`:
- All migrations applied (as of this writing, migrations `0045`-`0054` — the Commercial Billing Platform and its Launch Readiness fixes — are written but **not yet applied to any live database**; confirm this has been done).
- Stripe connected, if the customer needs a paid plan from day one (see `docs/STRIPE_PROVIDER.md`) — until then, only the free trial is available.
- SMTP configured for production email volume.
- The production domain, SSL, and DNS are live.

## Onboarding one customer company

### 1. Company creation
Someone with a platform login creates the company (Platform Workspace → Create Company, or has one created for them if this is a guided/sales-assisted onboarding). This one action automatically:
- Creates the company record.
- Seeds a Chart of Accounts (12 default accounts) and default VAT treatments.
- Seeds all 15 company roles with their standard permission sets.
- Assigns the creating user as Company Owner.
- **Starts a real 14-day free trial** — no separate billing step needed; the company can be used immediately.

### 2. Financial Year setup
**Not automatic — do this manually before any real transacting begins.** Settings → Financial Years → create the company's first year, matching their real financial year-end. This is the single most important manual step in the entire onboarding flow, since nothing in the product currently blocks work or prompts for it if skipped.

### 3. Chart of Accounts review
The seeded 12 accounts are a real, usable starting point, not a placeholder — but review them against the customer's actual reporting needs (branch/department/cost-centre/project dimensions, additional account granularity) and add/adjust before go-live.

### 4. VAT Configuration
Review the seeded VAT treatments against the customer's actual registration status and applicable rates.

### 5. Bank Accounts
Add the customer's real bank accounts, or let the first bank statement import auto-create them (works either way — no need to pre-create if you're going straight to import).

### 6. Data migration — honest current scope
**What's real today**: CSV import for Bills/Credit Notes, and CSV/XLSX/OFX/QIF import for bank statements, both with real duplicate-detection so a re-import is always safe.

**What is not built**: direct migration from Sage Pastel Partner, Sage Business Cloud Accounting, Xero, or QuickBooks Online. If a customer is migrating from one of these systems, the practical path today is exporting their data to CSV (most of these systems support this) and using the existing CSV import paths, or a manual opening-balance journal for anything CSV import doesn't cover (e.g. existing fixed assets, existing customer/supplier balances). There is no automated reconciliation-report generator for a migration today — verify opening balances manually against the source system's own reports before declaring the migration complete.

### 7. Opening balances
No dedicated "opening balance" wizard exists. The practical approach: a manual journal (or several, by module) dated at the migration cut-over date, using the real Journal creation flow and posting through the one real Posting Engine like any other journal.

### 8. Users and roles
Invite the customer's team via Settings → Roles & Permissions, assigning each person one of the 15 standard roles (or a custom role if their structure needs one). Confirm approval limits are set correctly per role before go-live, especially for any role with payment/journal approval authority.

### 9. Go-live checklist
- [ ] Financial Year created and correct.
- [ ] Chart of Accounts reviewed and adjusted.
- [ ] VAT treatments correct for the customer's real registration.
- [ ] Bank accounts added.
- [ ] All required users invited with correct roles/approval limits.
- [ ] Opening balances entered and reconciled against the source system (if migrating).
- [ ] A real login, first transaction, and first report walked through with the customer before handoff.

### 10. After go-live
Point the customer at `docs/USER_GUIDE.md`/`docs/ADMINISTRATOR_GUIDE.md`. Their trial clock is already running (started automatically at company creation) — if they need a paid plan, note that self-service upgrade requires Stripe to be connected (`docs/STRIPE_PROVIDER.md`); until then, coordinate any paid-plan need directly.
