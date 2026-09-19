# Phase 5J — Accounting-critical invoicing correction

Phase 5I deliberately stopped at an accounting boundary and listed five
defects it would not touch, because each of them changes numbers. This
phase crosses that boundary and fixes them, plus two more found while
tracing the flow.

Everything here is **local only**. Nothing is committed, pushed or
deployed; migrations `0105` and `0106` have been applied to a local
Docker Postgres and to nothing else.

---

## 1. The defects, and what each one actually was

| # | Defect | What it did | Status |
| --- | --- | --- | --- |
| 1 | Per-line VAT ignored | A line marked Zero Rated was still charged VAT at the header rate | Fixed |
| 2 | Per-line discount ignored | A discount reduced no figure anywhere | Fixed |
| 3 | `COUNT(*) + 1` numbering | Raced; could re-issue a number after a delete | Fixed (0105) |
| 4 | Due date never derived | Payment terms captured, displayed, and read by nothing; a null due date is permanently "Current" in every ageing report | Fixed (0106) |
| 5 | Credit/debit notes non-compliant | `original_invoice_id` stored but never printed; no reason field existed at all | Fixed (0106) |
| 6 | **Journal dated the approval date** | Revenue and output VAT landed in the period the invoice was *approved*, not the period it was *dated* | Fixed — **see §7, this is the largest behaviour change** |
| 7 | **Xero `Discount` is a percentage** | Stored verbatim into a column the rest of the system reads as an amount | Fixed for new imports; existing rows deliberately untouched (§6) |

Defects 6 and 7 were not in the brief. They were found tracing the flow
and are recorded here rather than left for someone else to hit.

---

## 2. The calculation

One module is now authoritative: **`src/server/sales/invoice-totals.ts`**.

It is not new arithmetic. The per-line math is
`purchasing/line-amounts.ts::computeLineAmounts` — already used by
Purchase Orders, Purchase Bills **and Sales Orders**. Sales Invoices were
the single document type in the system not using it.

```
per line:  net      = round2(quantity × unitPrice − discount)
           vat      = round2(net × rate / 100)
           lineTotal= round2(net + vat)

header:    subtotal = round2(Σ line.net)
           vatAmount= round2(Σ line.vat)
           total    = round2(subtotal + vatAmount)
```

**Rate resolution**: a line's own `vatCode` if it names one, otherwise the
document's header `vat_treatment_code`. A code the company does not have
is refused by name — never silently substituted.

**Rounding**: one rule, `round2(x) = Math.round(x * 100) / 100`, the
idiom already used throughout the accounting paths. Each figure is
rounded exactly once, where it is produced. Because line `net` and `vat`
are each rounded *before* being summed, and the header figures *are* those
sums, two identities hold exactly and are asserted directly in
`invoice-totals.test.ts`:

- `subtotal + vatAmount === total`
- `Σ lineTotal === total`

So the printed lines, the stored header and the posted journal cannot
drift apart by rounding. SARS prescribes no rounding method for invoice
VAT (confirmed against VAT 404 Issue 15, IN 83 and the VAT201 guide — an
explicit negative finding, not an unsearched gap); what it requires is
that the printed figure be *correct*, and that consistency is what the
identities above buy.

**The client previews the same module.** `invoice-totals.ts` imports only
pure arithmetic, so the `"use client"` form bundles it and shows exactly
what will be saved. The server recomputes from its own
`vat_treatments` on every save and stores *its* result. A tampered or
stale client cannot decide what an invoice is worth.

---

## 3. Discount — the ambiguity, and how it was resolved

Part 3 of the brief said to stop and document if the data model was
ambiguous. It was, and here is the resolution.

`sales_invoice_lines.discount` was added by `0071` as `numeric not null
default 0` with **no stated unit**. Two readings existed in the codebase:

- **Amount.** `purchasing/line-amounts.ts` — `quantity * unitCost -
  discount` — used by Purchase Orders, Purchase Bills and Sales Orders,
  with unit tests. This is the system-wide convention.
- **Percentage.** The Xero importer copied Xero's `Discount` CSV column
  straight in. Xero's column is a percentage. The importer's own test
  fixture proves it: `Quantity 16, UnitAmount 28.64, Discount 5,
  LineAmount 458.24` — and 16 × 28.64 = 458.24 exactly, so the "5"
  reduced nothing.

**Resolved as: a money amount**, because that is the established
convention in three other document types and the only one with tests.

**VAT is charged after the discount**, which is also the correct SARS
treatment for a trade discount: VAT is levied on the *consideration*
(VAT 404 §5.3.1), and a discount netted off before the invoice is raised
reduces the consideration (BGR 6 §3.1, §5.1).

> **Not implemented: settlement / prompt-payment discounts.** These work
> the opposite way — output VAT is declared on the *full* amount, and the
> adjustment happens in the period the discount is taken (VAT 404 §9.4,
> s21(3) proviso (C)). Critically, the credit-note exemption only applies
> **if the discount terms are printed on the face of the tax invoice**.
> This system has no settlement-discount concept, and `discount` must not
> be used for one. Flagged for its own phase.

---

## 4. Numbering

`document_number_sequences` — a company- and type-scoped counter row,
claimed with a single `insert … on conflict do update … returning`
statement.

**Why a counter row and not the alternatives**, since the brief asked not
to choose on convenience:

- **A Postgres sequence** is the reflexive answer and is wrong here.
  Sequences are schema objects, so per-company-per-type means issuing DDL
  at tenant creation and holding thousands of catalogue entries. Worse,
  `nextval` is explicitly non-transactional: a rolled-back invoice burns
  its number and leaves a gap nothing can account for.
- **An advisory lock** serialises correctly but stores nothing — the
  counter would still be derived by scanning invoices, which is the
  defect.
- **A counter row** is one statement, so Postgres holds a row lock on
  exactly that company's counter; concurrent callers serialise on it and
  each gets a distinct number, while other tenants never contend. It is
  an ordinary row write, so it participates in the caller's transaction.

**Verified locally**: 40 concurrent connections claiming simultaneously
returned 40 distinct, contiguous numbers, zero duplicates.

### Unique/serialised vs gap-free

The brief asked for this distinction researched. VAT Act **s20(4)(d)**
requires:

> "an **individual serialized number** and the date upon which the tax
> invoice is issued"

That is the entire statutory requirement on numbering. It requires
**uniqueness** (each invoice has its own number, distinguishing it from
every other) and that numbers come from a **series**. It does **not** say
"sequential", "consecutive", "unbroken" or "gap-free". A full-text search
of VAT 404 Issue 15 finds no gap-free requirement anywhere; the only
numbering text is "Serial number and date of issue". The widely repeated
"SARS requires no gaps" claim is vendor commentary with no cited
provision.

The closest statutory anchor to uniqueness is the proviso to s20(1):
*"it shall not be lawful to issue more than one tax invoice for each
taxable supply."*

**Consequences for the design, stated deliberately:**

- A **cancelled** invoice keeps its number, and that number is never
  re-issued. Re-using it would attach one serial number to two documents
   — the thing the requirement actually prohibits. A gap remains, and a
  gap is lawful.
- Gaps are unavoidable anyway once a transaction can roll back.
- Gap-free is nonetheless **good practice** — an unexplained gap invites a
  SARS question. The design supports that: cancelled documents are
  retained and marked Cancelled, never deleted, so every allocated number
  is accounted for.
- **No historical renumbering.** The backfill seeds each counter from the
  highest number *already issued*, so existing series continue. Verified
  locally against a fixture with a gap (INV000001, 2, 7) and a
  non-conforming imported number (INV-XERO-42): the counter resumed at
  INV000008, ignored the non-conforming number, and rewrote nothing.
- The generator **skips past** any number already taken by an imported or
  hand-typed document rather than failing on the unique index.

---

## 5. Payment terms and due date

Hierarchy, most specific first:

1. an explicit due date on the request — someone chose it, so it stands,
   and `payment_terms_days` is recorded as `null` because no terms
   produced it;
2. `customers.payment_terms_days` (exists since 0008, `not null default
   30`);
3. `companies.default_payment_terms_days` (new in 0106, defaults to 30 to
   match, so it introduces no behaviour on its own).

The derived terms are **stored on the invoice**. `customers.payment_terms_days`
is editable; an invoice already sent must not silently re-date when
someone changes it.

Arithmetic is UTC date-only — the `due_date` column has no timezone, and
adding days through a local-time `Date` would shift across a DST boundary
on a non-SAST host. Tested.

**Why this matters more than it looks**: `shared/aging.ts` puts the whole
outstanding balance of a null-due-date invoice into `Current`. Such an
invoice is *never* overdue, in any ageing report, statement or dashboard,
however old it gets. Before this phase, every invoice created from an
order got `due_date = null` unconditionally.

Historical due dates are **not** touched.

---

## 6. Historical data

**Nothing historical is recalculated, re-dated or renumbered.** Not as an
oversight — as the rule. The figures on an existing invoice are the
figures on the document the customer received and on the journal already
posted. Rewriting them to match new logic would falsify a tax record.

The new calculation applies to documents created **after** the change.

### What the change does *not* disturb

A pre-5J invoice has no per-line VAT codes and no discounts that matter,
so `subtotal = Σ quantity × unitPrice` and `vatAmount = subtotal × header
rate`. Running the new calculation over such a document produces the
**same figures** — asserted in `invoice-totals.test.ts`
("reproduces the pre-5J figures exactly…"). A Draft captured before the
change and approved after it is therefore unaffected.

Likewise, the posting change (§7) reads `subtotal`/`vatAmount` off the
invoice instead of re-splitting `total`. For every pre-5J row those are
arithmetically identical, so no existing Draft posts differently.

### The Xero discount contamination

Rows imported before this phase hold a **percentage** in
`sales_invoice_lines.discount`, a column now read as an **amount**. This
was harmless while nothing read the column. It is material only if
something recalculates those documents — which is exactly what must not
happen.

- New imports are fixed: the discount is now **derived** from Xero's own
  authoritative `LineAmount` (`quantity × unitAmount − lineAmount`),
  which is unit-correct whatever Xero's column meant.
- Existing rows are **not rewritten**. Section 4 of the analysis script
  below lists them.

### The analysis script

`supabase/tests/phase_5j_historical_invoice_analysis.sql` — **read only**,
every statement a `SELECT`. It quantifies the population, the documents
that *would* change under the new logic, the Xero-contaminated rows, the
un-ageable AR, the non-compliant credit notes, numbering conformance, and
the value sitting in the wrong VAT period.

It is a script and not a result because **the local database holds no
sales documents** (`select count(*) from sales_invoices` = 0), and the
population that matters is in production, which this phase may not touch.
The script has been executed locally against seeded fixtures to prove it
runs clean.

**No migration of historical values is proposed. Its answers should be
reviewed before any is.**

---

## 7. Posting — and the one large behaviour change

### The journal is now the invoice

`approveAndPostInvoice` used to hand the posting engine
`{ grossAmount: invoice.total, vatRatePercent }` and let
`splitGrossAmount` re-derive the net/VAT split. Three things were wrong
with that, and all three disappear by passing the stored split:

1. **One blended rate cannot express a mixed-rate invoice.** With per-line
   VAT now counting, a document with a standard-rated and a zero-rated
   line has no single rate reproducing its VAT. On the reconciliation
   test's worked example, re-deriving would have overstated output VAT by
   R174.78 on one document, silently.
2. **`treatment?.rate ?? 0`.** A treatment renamed or deactivated between
   capture and approval silently zero-rated the posting — whole gross to
   Sales, no VAT Output line, no error — while the invoice still showed
   the VAT.
3. **`vat_treatments.rate` is mutable.** A rate change between capture and
   approval posted the new rate against the old total.

`buildJournalLinesFromRule` now accepts an optional `amounts` split and
uses it verbatim, checking exactly that `net + vat === gross` first (a
one-cent imbalance would otherwise slip past the 0.01 balance tolerance
and reach `gl_transactions`). Callers that pass nothing are completely
unaffected — asserted by test.

The posting *rules* are untouched: the engine still chooses the accounts
(DR 1100 / CR 4000 / CR 2200, as seeded). Only the amounts' source moved.

### ⚠ The journal date — read this before approving

`createJournal` defaults `journalDate` to *today* when the caller omits
one, and this caller omitted one. `posting_date` derives from it, and the
trial balance, the financial statements and the **statutory VAT Return**
(which reads GL accounts 2100/2200 by `posting_date`) all period-assign
from it.

So an invoice dated 31 August but approved on 3 September recognised its
revenue and output VAT in **September**, while every document-based report
placed it in August. They could never reconcile, and the August VAT201 was
understated by exactly that invoice. The Report Centre's own
reconciliation check already anticipates this — its failure hint reads
*"a document dated in this period was posted to the ledger in another
period."*

It now posts with `journalDate: invoice.invoiceDate`.

**Operational consequence, requiring an explicit decision:** a document
dated inside a **closed or locked financial period can no longer be
posted**. The Posting Engine refuses it, the invoice honestly stays
`Approved`-but-unposted with the reason shown, and the existing
`retryPostInvoice` path picks it up once the period is reopened. That is
the correct answer — the previous behaviour did not avoid the problem, it
posted into the wrong period instead — but it will be visible to users who
back-date, and it is the change most likely to need a conversation before
it ships.

**Existing mis-dated journals are not re-dated.** Re-dating a posted
journal is a correction with its own approval, not a side effect of a code
change. Section 8 of the analysis script quantifies the exposure.

---

## 8. Documents

- Per-line VAT prints the real figure. Every UI-created invoice previously
  printed "—" in the VAT column on every line, because per-line VAT was
  never computed. A zero now prints as `0.00`, which states a fact
  (zero-rated / exempt); "—" meant "never computed".
- A **Discount** column appears only when a line carries one, so an
  undiscounted document prints exactly the columns it always did.
- The discount total in the totals block is **summed from the saved
  lines**, never recomputed from prices.
- Credit and debit notes now print the s21(3) particulars: **"Adjusts tax
  invoice: INV000042 dated 2026-05-14"** and **"Reason: …"**. SARS's own
  worked examples (VAT 404, Examples 42–43) satisfy "information
  sufficient to identify the transaction" with the original invoice's
  number *and* date, which is what is printed.
- A pre-5J note carrying neither prints **"not recorded on this
  document"** rather than a blank that reads as compliant.
- The in-app preview receives the same particulars as the PDF.

Document titles were already correct and are unchanged: `Invoice` →
**"Tax Invoice"**, and credit/debit notes print those exact words —
s21(3)(a)(i)/(b)(i) permit no alternative wording, unlike s20(4)(a) which
allows "tax invoice", "VAT invoice" or "invoice".

---

## 9. Migrations

Applied **locally only**. Both are idempotent (re-run verified clean) and
both have rollbacks.

| Migration | Purpose |
| --- | --- |
| `0105_document_number_sequences.sql` | Counter table, `next_document_number()`, `document_number_prefix()`, and a backfill seeded from numbers already issued. Reads `sales_invoices`; writes only the new table. |
| `0106_sales_document_particulars.sql` | `sales_invoices.reason`, `sales_invoices.payment_terms_days`, `companies.default_payment_terms_days`. All additive with defaults reproducing current meaning. |
| `supabase/rollbacks/0105_…_down.sql` | Drops the table and both functions. No document number is affected — the migration never wrote to `sales_invoices`. Run the application rollback **first**. |
| `supabase/rollbacks/0106_…_down.sql` | Drops the three columns. Loses the stated reason on every note issued since — a tax record; export first if within the five-year retention period. |

`reason` is **not** enforced by a CHECK constraint. Existing credit notes
genuinely have none, and a constraint would retroactively invalidate
documents already issued to customers and to SARS. The rule binds new
documents, at the service layer, where the message can name the field.

---

## 10. Known residuals — not fixed here

1. **Settlement/prompt-payment discounts** are not modelled (§3).
2. **Company default payment terms** exist in the database and in the
   hierarchy but are not yet editable in Settings; the default of 30
   matches the customer-level default, so behaviour is unchanged.
3. **`sales_invoice_lines.discount/net_amount/vat_amount` are unbounded
   `numeric`** while header figures are `numeric(14,2)`. The application
   rounds to 2dp before insert. Not altered: narrowing the type would
   round existing data.
4. **`reduceInvoiceOutstanding` is a non-atomic read-modify-write** with
   no locking and no constraint preventing `outstanding` going negative.
   Pre-existing; out of scope.
5. **Bank-settled customer money never reduces `sales_invoices.outstanding`**,
   so the module-stack debtors figure can overstate. Pre-existing and
   documented in `report-centre/party-ledger.ts`; out of scope.
6. **The Customer Financial tab labels the >90-day bucket "120+ Days"**.
   Cosmetic mislabel; the Report Centre calls the same number "90+ Days".
7. **Non-invoice Sales GET routes have no permission check** (session +
   RLS only). Invoices were fixed in 5I.
8. **Other numbering generators** (journals, receipts, orders, quotations,
   deliveries) still use `COUNT(*) + 1` and share the original race. 0105
   deliberately covers Sales documents only.
9. **Companies Act s32(4)** requires the registered name and registration
   number on invoices. `DocumentBrandingBlock` renders company details;
   worth a separate confirmation that the registration number is always
   present.

---

## 11. VAT rate

**15%**, and this was verified rather than assumed. In force since
1 April 2018 (VAT Act s7(1)). The increase to 15.5% announced on
12 March 2025 was reversed, and the reversal is now statute:
**Rates and Monetary Amounts and Amendment of Revenue Laws Act 3 of 2026**,
s13 — *"the alteration of the VAT rate specified in section 7 of that Act,
1991, does not come into effect"*, deemed effective 1 May 2025.

No rate is hardcoded in React or in a PDF. Rates come from
`vat_treatments`, per company, as they already did. The six seeded
treatments are unchanged and no new category was invented:

| Code | Rate | VAT type |
| --- | --- | --- |
| Standard Rated | 15.00 | Standard |
| Zero Rated | 0.00 | ZeroRated |
| Exempt | 0.00 | Exempt |
| No VAT | 0.00 | OutsideScope |
| Fuel VAT | 0.00 | ZeroRated |
| Import VAT | 15.00 | Import |
