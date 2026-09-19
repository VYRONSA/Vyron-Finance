# Phase 5I — Invoicing, Customer and Supplier improvements

Implements the safe subset of the Phase 5H audit. Nothing in this phase
changes how an amount is calculated, how a journal is posted, how an
invoice is numbered, how AR is aged, or how a credit note is accounted
for. Every figure on every screen and document in this phase is read from
already-saved data.

## The accounting boundary, and why each item was left alone

Five known defects were deliberately **not** fixed here. They are real,
they are recorded, and each one changes numbers — which is why they need
their own phase with its own approval and a data-migration plan for the
records already posted under the current behaviour.

| Left alone | What is actually wrong | Why it cannot be done as a UX change |
| --- | --- | --- |
| Per-line VAT | A line's `vatCode` does not affect the invoice's VAT | Fixing it changes `vatAmount`/`total` on every future invoice, and makes existing invoices inconsistent with new ones |
| Per-line discount | A line's `discount` does not affect the invoice total | Same: changes totals, and the posted journals that follow them |
| Invoice numbering | `COUNT(*) + 1` — not gap-free, not concurrency-safe | A tax invoice's serial number is a legal identifier (VAT Act s.20(4)(b)); changing the generator needs a migration that preserves issued numbers |
| AR ageing | Ages on invoice date, not due date/payment terms | Changes every ageing bucket and every statement |
| Credit/debit note compliance | See "Credit notes" below | Needs new stored fields, so it is a schema + posting change |

## What changed

### Horizontal overflow (the one shared fix)

Wide tables made the **page** scroll sideways instead of the table
(measured: Sales 171px of document scroll at 1440px, 949px at 390px;
Customers 676px at 390px). Fixed once, in `src/components/ui/table.tsx`,
so no page has to remember. Two causes, both needed:

- `min-w-0` — a flex item's automatic minimum size is its content width,
  so inside a flex parent the scroll container grew to the table's width
  instead of shrinking (the VR-022 gotcha again).
- `relative` — the actual culprit. Tailwind's `sr-only` is
  `position: absolute`, and an absolutely positioned element is only
  clipped by an ancestor that is its *containing block*. With no
  positioned ancestor, an `sr-only` label in a far-right column had the
  **document** as its containing block and extended the page's scrollable
  width, straight through `overflow-x-auto`.

This defect predates Phase 5A — every affected file was untouched by 5A–5G.

### Customer and supplier capture

- Fields grouped into sections (`master-data-form.tsx`) instead of one
  flat grid: Basic, Tax, Address, Contact, Accounting Defaults.
- VAT number (`/^\d{10}$/`) and registration number
  (`/^\d{4}\/\d{6}\/\d{2}$/`) captured and validated client-side. These
  are the recipient particulars a tax invoice needs (VAT Act s.20(4)(c));
  previously they could not be captured at all on a customer.
- Suppliers gained `defaultGlAccount` and `defaultVatCode` pickers — the
  two fields the Allocation Engine already reads but nothing could set.
- An advisory duplicate-name warning on supplier creation. Advice, not a
  rule: it never blocks the save.
- The supplier merge preview now shows the registration number, the
  strongest signal that two supplier records are the same legal entity.

### Invoice creation

- **No customer is preselected.** This was `customers[0]?.id`, so a form
  opened and saved without touching the customer field silently billed
  whichever customer sorted first. Save now refuses until one is chosen.
- `notes` is offered on the form. It already existed in the API, the
  database and the printed document; only the form never captured it.
- The summary says **"Lines total (excl. VAT)"** and states that VAT is
  calculated on saving, rather than implying the figure shown is the
  invoice total. This is a labelling fix for the per-line VAT defect
  above — it describes the current behaviour honestly instead of hiding it.
- Dead ends now explain themselves: `New Document` was already disabled
  with no customers or no VAT treatments but gave a reason only in preview
  mode; and a company whose customers are all inactive now gets told so,
  with a link to Customers.

**Customer creation is deliberately not offered inline on the invoice
form.** A customer captured mid-invoice, with a name and nothing else,
lacks exactly the VAT number and address that make the document a valid
tax invoice, and is the usual route to a duplicated customer whose AR
balance is then split across two records. Capture stays on the Customers
screen, which asks for the full set. A test asserts the absence so it is
not reversed by accident.

### Documents

- The currency code is stated against the totals when the company has one
  configured, and omitted entirely when it does not — previously the
  figures were bare numbers with no unit.
- "Outstanding" relabelled **"Amount Due"**.
- Optional payment block: bank details, payment instructions and a
  footer. **Nothing is printed unless the company explicitly configured
  it** — a bank account appears only when it is ticked
  `show_on_documents`, never merely because it exists.
- `invoicePaymentDetails()` returns `undefined` when nothing is
  configured, so a company that sets nothing up gets exactly the document
  it gets today.

`src/server/pdf/pdf-assets.generated.ts` was regenerated
(`npm run pdf:assets -- --css-only`) because the payment block introduced
classes the embedded PDF stylesheet did not carry. The repo's own guard
test catches this.

### Read permission on invoices

Both invoice `GET` routes now require `Sales:View`. They previously
checked only that someone was signed in, while the PDF route for the
**same document** already required `Sales:View` — so a caller refused the
PDF could still read every invoice's customer, amounts, dates and status
as JSON. RLS still enforces the tenant boundary underneath; this adds the
module permission the rest of Sales already uses.

## Credit notes — what is still missing (not fixed here)

The architecture is mostly present: `documentType`, `originalInvoiceId`
(captured, persisted, and narrowed to the same customer's invoices), and
correct document titling. Two gaps remain, both requiring stored fields
and therefore out of scope for a presentation phase:

1. **The original invoice is never printed.** `originalInvoiceId` is
   stored and shown in the Reporting Centre ("Against invoice #N"), but
   the customer-facing document has no reference to it. VAT Act s.21(3)(g)
   requires sufficient information to identify the transaction the credit
   note refers to.
2. **No reason field exists.** VAT Act s.21(3)(f) requires a brief
   explanation of the circumstances giving rise to the credit note. There
   is nowhere to record one.

Fixing (1) alone is presentation-only and could be done safely; it is
listed here rather than done because credit-note compliance was named in
the phase's own do-not-fix list, and the two gaps should be closed
together so the document becomes compliant in one reviewable step.

## Migrations — created and tested locally, NOT applied

Neither has been run against production.

**`0103_supplier_registration_number.sql`**

```sql
alter table ae_suppliers add column if not exists registration_number text not null default '';
```

Additive, defaulted, idempotent. No existing row changes meaning; no
accounting field is touched. Rollback: `0103_..._down.sql`.

**`0104_document_payment_details.sql`**

Adds `companies.invoice_footer`, `companies.payment_instructions` and
`ae_bank_accounts.show_on_documents boolean not null default false`. The
default is `false`, so applying it prints nothing new on any document
until someone opts in. Rollback: `0104_..._down.sql`.

## Verification

- `tsc --noEmit` — exit 0.
- `eslint` — 0 errors, 3 warnings, the same 3 that predate this phase.
- `next build` — exit 0.
- Full suite — 4752 passed, 2 failed. Both failures are the Phase 5F
  intermittent `Test timed out in 5000ms` contention pattern
  (`roles-permissions-tab`, `transaction-grid`); both pass in isolation.
  This is documented in Phase 5F, not a 5I regression.
- Browser, at 1440×900 / 1024×768 / 768×1024 / 390×844: 16/16 overflow
  checks pass, and the Phase 5G sidebar still behaves.

**A stated limitation.** Preview Mode (no Supabase configured) disables
every mutation button, so the create panels cannot be opened in a browser
session. Rather than claim those checks passed, the forms are verified by
mounting the real components with `previewMode={false}` in
`master-data-forms.render.test.tsx` (22 tests) — which is stronger than a
screenshot, because it runs on every suite.
