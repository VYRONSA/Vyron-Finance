# VYRON FINANCE — Administrator Guide

For Company Owners and anyone holding an administrative role. Covers company setup, user/role management, and the things only an administrator can do. Reflects the product as built — see `docs/PRODUCT_AUDIT_MATRIX.md` for full evidence behind every claim below.

## First-day setup checklist

1. **Company Details** (Settings) — confirm name, registration number, base currency, industry.
2. **Financial Years** (Settings) — create your company's first financial year. **This step is not automatic and nothing in the product currently prompts you to do it** — do it before your team starts transacting, since period-based reports depend on it.
3. **Branches / Departments / Cost Centres / Projects** (Settings) — set up only what you actually use; all four are optional dimensions.
4. **Currencies** (Settings) — your base currency is set at company creation and can't be changed later; add any additional currencies you transact in.
5. **Tax Configuration** (Settings) — a default set of VAT treatments is seeded automatically; review and adjust rates if needed.
6. **Roles & Permissions** (Settings) — invite your team (see below).
7. **Bank Accounts** — add your real bank accounts before importing statements (or let the first statement import auto-create them — either works).

Your Chart of Accounts (12 default accounts) and default VAT treatments are seeded automatically when your company is created — you don't need to build these from scratch.

## Managing users and roles

Settings → Roles & Permissions. 15 pre-built company roles exist (Company Owner, Financial Director, Bookkeeper, Read Only, and others) — each with a real, pre-configured permission set you can further customize per role. You can also create fully custom roles.

**Inviting a new user**: from the Roles & Permissions tab, "Invite" — this creates their login and assigns a role in one step; they receive a real email invitation.

**Approval limits**: several roles carry a real spending-approval ceiling (e.g. a Senior Bookkeeper can approve journals/payments up to a set amount) — configure these per role, not per user.

**Known limitation**: the "View" permission toggle exists in the UI for every module but currently has no effect — every authenticated company member can read data for every module regardless of their role's View setting (only *write* actions are actually gated by role). If restricting read access matters for your organisation, be aware this isn't enforced today.

## Billing and your subscription

Every company starts on a free 14-day trial automatically the moment it's created — no action needed. As Company Owner, you (and Platform Administrators) hold the `ManageBilling` permission needed to manage your subscription.

Under your company's "Billing" nav item: view your plan, usage against its limits, cancel/resume, and see invoice/payment history. **Upgrading or downgrading to a paid plan requires a connected payment provider, which is not live yet** — contact VYRON FINANCE support directly for a plan change in the meantime.

## Financial Period control

Settings → Financial Years lets you mark a year Current or Close it. **A real, built but currently unreachable capability**: the product supports a soft "Lock Date" (block postings on or before a cutoff date while a period is still open) and a "Reopen" action — the backend fully works, but no button exists yet to use it. If you need a period locked, contact support for a manual database action until the UI ships.

## Multi-company / multi-organisation

An organisation can hold several companies (the accounting-firm-with-multiple-clients model). Creating a second company under the same organisation is the same "Create Company" flow as the first — you'll automatically be Company Owner of each one you create.

## Auditing your own team's actions

Every permission denial, every role/permission change, and every automation run is logged automatically (`system_events`/`permission_audit_log`/`automation_audit_log`) — you don't need to enable anything. The Auditor Workspace and General Ledger's own Account Activity pages surface much of this directly; ask VYRON FINANCE support for a raw export if you need something not visible in the UI.

## When something looks wrong

See `docs/SUPPORT_TROUBLESHOOTING_GUIDE.md` first. As an administrator, you have direct access to fix most day-to-day issues (reassign a role, re-invite a locked-out user, correct a Chart of Accounts entry) without needing to contact support.
