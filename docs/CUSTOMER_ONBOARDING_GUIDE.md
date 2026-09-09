# VYRON FINANCE — Customer Onboarding Guide

For a new customer's first day, and the first two weeks of their free trial. Written from the customer's own point of view. Informed by `docs/CUSTOMER_EXPERIENCE_REVIEW.md`'s real, code-verified findings — this guide exists specifically to close the gaps that review found (nothing in the product currently tells you most of what's below on its own).

## Welcome — what just happened

When your company was created, VYRON FINANCE automatically started your **14-day free trial**. You don't need to do anything to activate it — it's already running. (The product doesn't currently show you this on screen, so consider this your notification: check the "Billing" section of your workspace at any time to see exactly how many days remain.)

## Your first 15 minutes

1. **Log in** using the link from your invitation email.
2. **Set up your Financial Year** — go to Settings → Financial Years and create one matching your company's real financial year-end. **Do this first.** The product will let you start entering transactions without one, but your reports won't be period-accurate until it exists.
3. **Check your Chart of Accounts** (General Ledger → Chart of Accounts) — a sensible default set is already there for you; you can add, rename, or archive accounts as you go.
4. **Check your VAT setup** (Settings → Tax Configuration) — default South African VAT treatments are pre-loaded; confirm they match your actual registration.
5. **Add your bank account(s)** (Bank Accounts → Add) — or skip this and let your first bank statement import create it automatically.

## Your first real task: import a bank statement

Import Centre → upload a CSV, Excel, OFX, or QIF file from your bank. The screen tells you the expected column order before you upload. If you upload the same file twice by mistake, VYRON FINANCE automatically skips anything already imported — nothing gets duplicated.

## Your first invoice

Sales → Quotations (if you want to start with a quote) or straight to Sales Orders/Invoices. Creating and posting an invoice happens in the same real accounting engine every other transaction uses — there's no "draft mode" that behaves differently from the real thing.

## Your first report

Reports → Financial Statements, once you have some real transactions posted. Every figure is computed live from your actual data — there's nothing to "generate and wait for" or refresh separately.

## Your first month-end

There's no single "close the month" button yet — here's the real sequence:
1. Confirm all bank statements for the month are imported and matched (Matching workspace's Review Queue shows everything still outstanding, across the whole company, in one place).
2. Make sure every Draft/Submitted journal that should be posted this month is Approved and Posted (General Ledger → Journals).
3. Check the Trial Balance is in balance (shown as a live tile on your Dashboard).
4. Generate your Financial Statements for the period.

If you use Fixed Assets, remember to run your monthly Depreciation Run before finalizing the period.

## Inviting your team

Settings → Roles & Permissions → Invite. Choose a role that matches what they should be able to do — a Bookkeeper role, for example, can capture transactions but can't approve payments; a Financial Manager can do both. You can always adjust someone's role later.

## Things to know are real limitations right now, not something you're doing wrong

- You currently can't edit a Customer or Supplier's details (credit limit, banking details, etc.) once created — contact support if you need one corrected.
- Upgrading your plan to a paid tier isn't self-service yet — contact us directly and we'll sort it out manually.
- SARS eFiling submission from inside VYRON FINANCE isn't available yet — use your VAT Return's calculated figures to file directly with SARS.
- If you migrated from another accounting system, there's no automated migration tool yet — we'll help you get your opening balances in correctly as part of onboarding (see `docs/IMPLEMENTATION_GUIDE.md` if you're doing this yourself).

## Getting help

Nothing in-app currently links to documentation or support directly (a known gap we're aware of) — bookmark this guide and `docs/USER_GUIDE.md`, and reach out to your onboarding contact directly for anything not covered here.
