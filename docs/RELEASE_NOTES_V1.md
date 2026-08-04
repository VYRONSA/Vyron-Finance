# VYRON FINANCE — Release Notes: Version 1.0

These notes describe the product as it actually is at this release, verified against source during the Launch Readiness Programme (LR1) audit — not a list of original intentions. See `docs/PRODUCT_AUDIT_MATRIX.md` for the full page-by-page evidence and `docs/DEFECT_REGISTER.md` for every known issue referenced below.

## What's in Version 1.0

**Core accounting**: Customers, Suppliers, Sales (Quotation → Order → Delivery → Invoice → Receipt), Purchasing (Requisition → Purchase Order → Goods Received Note → Bill → Payment), Inventory, Cashbook, Bank Import (CSV/XLSX/OFX/QIF, with duplicate-safe re-import), Transaction Matching, General Ledger with Posting Rules, VAT (South African, live-calculated returns), Fixed Assets (full lifecycle: Acquire/Capitalise/Improve/Transfer/Revalue/Impair/Dispose, Depreciation Runs), Financial Statements, Audit workspace, Communications, Automation (rule-based and scheduled), and an AI Copilot for guided-question financial queries.

**Platform**: Multi-tenant, multi-company organisations; 15 pre-built company roles with configurable permission sets and approval limits; a full permission/audit trail on every sensitive action.

**Commercial Billing Platform** (new in this release): every company automatically receives a real 14-day free trial on creation. Six data-driven subscription plans (Free Trial, Starter, Professional, Enterprise, Partner, Internal) with entitlements across 8 license limits and 10 feature flags. A Customer Billing Portal (plan, usage, invoices, payment history, cancel/resume) and an Internal Billing Operations Console for platform staff. Usage metering is live-counted for user/company/storage/document-type limits and event-metered for activity-based limits (communications, automation runs, AI requests, etc.). A Billing Event Bus publishes every significant billing action for downstream notification and audit use. Full architecture: `docs/BILLING_ARCHITECTURE.md`.

## Known limitations at this release

These are real, verified gaps — not defects to be "discovered" later, disclosed here deliberately:

- **No self-service paid-plan upgrade yet.** Changing to a priced plan requires a connected payment provider (Stripe), which is not live at this release. The trial and manually-provisioned plans work fully; contact support for a paid-plan change until Stripe is connected. See `docs/STRIPE_PROVIDER.md`.
- **No Customer/Supplier edit UI.** Records can be created and toggled Active/Inactive, but not edited after creation, from the UI. Support can correct records directly.
- **No SARS eFiling integration.** VAT Returns calculate correctly and post real settlement journals; submission to SARS itself is a manual step using the Return's own figures.
- **No automated migration tool** from Sage Pastel, Sage Business Cloud, Xero, or QuickBooks Online. CSV/OFX/QIF import covers bank statements and bills; other migrated data is entered via manual opening-balance journals. See `docs/IMPLEMENTATION_GUIDE.md`.
- **Financial Period Lock/Reopen has no UI yet.** The capability is fully built and functional in the backend but has no button to trigger it. Support can perform this action directly on request.
- **Bulk actions don't report per-row skip reasons.** A bulk Generate Journal or Apply Rule that skips some selected rows currently only confirms the action ran, not which rows were skipped or why.
- **Role "View" permission is not yet enforced for reads.** Every company member can currently read data across all modules regardless of role; only write actions are gated by role today.
- **Document attachments** are available on Customers, Suppliers, and Assets only — not yet on Inventory, Journals, or Bank Statements.

## Fixed during Launch Readiness (LR1) — resolved before this release

Four Critical-severity defects were found during LR1's audit and are fixed in this release:

- Companies created before the Commercial Billing Platform shipped had no subscription record, which would have blocked their access entirely once billing enforcement went live — fixed via a one-time backfill migration granting each existing company an active enterprise-tier subscription.
- The Duplicate Detection "Suggested Merge" action in Matching was non-functional — it now correctly identifies and merges the surviving record.
- The Internal Billing Console's support-note feature could silently write a note against the wrong billing account — staff now explicitly select the account before adding a note.
- The Platform Dashboard showed fabricated placeholder activity and notification data instead of real billing activity — it now shows real, live billing events.

One Medium-severity defect (a hardcoded placeholder Financial Year label on the company dashboard) was fixed in the same pass. The remaining 6 High, 15 Medium, 12 Low, and 1 Nice-to-have findings from the LR1 audit are intentionally not fixed in this release — see `docs/DEFECT_REGISTER.md` for the full prioritised list and rationale.

## External dependencies still required before commercial launch

Per the LR1 directive, these are explicitly out of scope for this codebase and must be completed separately before Version 1.0 is sold to real customers:

- Stripe Marketplace Terms acceptance and live Stripe provisioning.
- Production SMTP configuration for real email volume.
- Production domain, SSL, and DNS.
- Applying database migrations `0045`-`0054` (the Commercial Billing Platform and its LR1 fixes) to the live production database — not yet done in this environment.

See `docs/LAUNCH_CHECKLIST.md` for the full go-live checklist.
