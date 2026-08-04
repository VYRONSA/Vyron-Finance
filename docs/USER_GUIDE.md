# VYRON FINANCE — User Guide

For day-to-day users: bookkeepers, accountants, sales/purchasing clerks, and managers working inside a company. Written against the product as it actually exists today (verified in `docs/PRODUCT_AUDIT_MATRIX.md`), not its intended future state. If a feature below isn't available to you, check with your Company Owner — access is controlled by your assigned role (see "Roles & Permissions" in `docs/ADMINISTRATOR_GUIDE.md`).

## Getting started

You'll receive an email invitation from your Company Owner or an administrator. Follow the link to set your password, then log in at your company's VYRON FINANCE address. Your assigned role determines what you can see and do — if a page or button seems missing, that's very likely deliberate (see your administrator about a role change, not a bug report).

**Before you do anything else**, check with your administrator that a **Financial Year** has been set up (Settings → Financial Years). The product doesn't block you from working without one, but period-based reports won't be meaningful until it exists.

## Everyday workflows

### Recording a bank transaction
Bank Accounts → the account → **Import Bank Statement** (or Import Centre directly). Upload a CSV, XLSX, OFX, or QIF file — the app tells you the expected column order before you upload. Transactions already imported are automatically skipped, so re-uploading a file is always safe.

### Reviewing and matching transactions
Transaction Explorer is your main working grid: filter, search, sort, and select multiple rows for bulk actions (Assign Supplier/Customer/GL Account/VAT, Approve, Reject, Generate Journal). The Matching workspace's Review Queue is the single place every unmatched item across the whole company shows up — nothing hides in a second queue.

**Known limitation**: if you Generate Journal or Apply Rule on a batch of selected transactions and some are skipped (e.g. missing a GL account), the app currently only tells you the action ran — it doesn't yet show you which specific rows were skipped or why. Check the transaction's own status afterward if the count doesn't match what you expected.

### Sales: Quotation to Cash
Quotation → Sales Order → Delivery → Invoice → Receipt. Each stage is a real, separate record — converting a Quotation to an Order, or an Order to an Invoice, doesn't lose the original document. **Approve & Post** on an Invoice creates the real accounting journal immediately; there's no separate "post later" step you might forget.

### Purchasing: Requisition to Payment
Requisition → Purchase Order (a manager approval step exists here that Sales Orders don't have) → Goods Received Note → Bill → Payment. Approving a Payment automatically sends a Remittance Advice to the supplier — you don't need to email it separately.

### Customers and Suppliers
You can create new Customer/Supplier records and toggle them Active/Inactive from their list pages. **Known limitation**: once created, there is currently no way to edit a customer's or supplier's details (credit limit, VAT number, banking details, etc.) from the UI — if you need to correct one, ask your administrator, who can update it directly (see `docs/SUPPORT_TROUBLESHOOTING_GUIDE.md`).

### General Ledger
If you have GL access: journals move Draft → Submitted → Approved → **Posted** (the one step that actually affects the Trial Balance). Posting Rules let an administrator set up automatic journal templates for common event types (Sales Invoice, Supplier Payment, etc.) so you don't have to build a journal by hand for routine transactions.

### VAT
VAT Returns are calculated live from your posted transactions — nothing is cached, so a return always reflects your current data. Approving a return posts a real settlement journal. **Known limitation**: "Submit via SARS eFiling" is intentionally disabled — there is no live SARS integration yet; use the Return's own figures to file manually through SARS's own system.

### Fixed Assets
Acquire an asset, then use Capitalise/Improve/Transfer/Revalue/Impair/Dispose as its lifecycle progresses — every one of these creates a real accounting entry. Depreciation Runs post one consolidated journal per run.

### Documents
Attach files to Customers, Suppliers, and Assets directly from their detail pages — version history is automatic (uploading a new version never deletes the old one). **Known limitation**: document attachments aren't yet available on every entity type (Inventory, Journals, Bank Statements are not yet supported).

### AI Copilot
Ask a question from the fixed list shown in the Ask tab — every answer is computed from your real financial data, never guessed. If your question isn't in the supported list, the Copilot will honestly say so rather than attempt a made-up answer.

### Your Billing (if you're a Company Owner)
Under the "Billing" nav item: see your current plan, usage against your plan's limits, invoices, and payment history. You can cancel or resume your subscription at any time. **Known limitation**: upgrading or downgrading to a different priced plan currently requires a connected payment provider, which is not live yet — contact VYRON FINANCE support for a plan change until then.

## Common questions

**Why can't I see [module]?** Your role doesn't include it, or your plan doesn't include the feature. Ask your Company Owner.

**Why does a report look wrong / a balance not add up?** Check the Financial Period status first (Settings → Financial Years) — a missing or unlocked period can affect what a report includes. If the issue persists, see `docs/SUPPORT_TROUBLESHOOTING_GUIDE.md`.

**Can I undo a posted journal?** Not by deleting it — use Reverse, which creates a real, linked offsetting journal rather than altering history.
