# Supplier Document Intelligence — SD-3G: document reconciliation (production UAT corrective)

**Status:**
- Implemented on `security/sd0-supplier-capture-hardening`, on top of `3c3be99` (SD-3F, which is live in production).
- Migration **0117**, with rollback `supabase/rollbacks/0117_supplier_statement_document_reconciliation_down.sql`.
- **Not applied to production, not pushed, not deployed.**

## Why

In production UAT a real supplier statement (Gourmet Foods) showed that the business reconciles supplier
**documents**, not the supplier's balance:

> "Which supplier documents appearing on this statement do we have in PRECISIA, and do the amounts and references
> agree?"

The statement's payment rows produced hundreds of "could not be read" blockers, and its header (date, total due,
ageing) was not recognised. SD-3G corrects both.

## The rule (owner, final)

- **The reconciliation population is supplier invoices, debit notes and credit notes.**
- **Payments are "Out of Scope — Payment".** A payment line:
  - is kept, visible and unchanged, with its raw text;
  - is never matched or suggested;
  - never produces Missing in PRECISIA, Missing on Statement, Amount Difference, Potential Duplicate or Unclassified;
  - has no effect on any figure;
  - never blocks Ready because of an unreadable value.
- **PRECISIA supplier payments, bank transactions and opening balances are not read.**

**Owner decisions taken during SD-3G:**
1. **Zero-padded references:**
   - The statement prints the bill number padded to 15 digits (`000000002251125`); PRECISIA holds
     `ae_imported_bills.invoice_number` = `02251125`.
   - New match tier **T3 zero-padded**, used only when all of the following hold:
     - both numbers are digits-only;
     - they are equal once leading zeros are removed;
     - there is exactly one candidate of a compatible type;
     - the reference is printed at the statement's own consistent padding width.
   - Stored text is never changed. Two or more candidates are a Potential Duplicate.
2. **Unposted bills count as "in PRECISIA" and are always flagged "not posted".** They appear as "Matched — not posted",
   and Documents in PRECISIA reports how much is not posted.
3. **The UAT statement was uploaded to a different company from the one holding "Gourmet Cape Distributors
   (PTY)LTD" and its bills.** This is noted only; no production data was changed.

## What changed

### Engine (`reconciliation-engine.ts`, version `sd3g-1`)

**Figures:**

| Figure | Meaning |
|---|---|
| Documents on Statement (S) | Sum of the in-scope lines; credit notes are negative. |
| Documents in PRECISIA (P) | Sum of the supplier's documents in the window, posted and not posted. |
| Document Difference (D) | S − P. |

- **D = Explained + Unexplained**, to the cent. Every item carries its effect on D, and the residual is reported
  (it is 0).
- **Tiers:** T0 manual, T1 exact, T2 normalised (leading zeros kept), T3 zero-padded. Suggestions remain suggestions,
  and amount alone never matches.

**Classifications:**
- **Matched** (posted or not posted), split by invoice, debit note and credit note.
- **Amount Difference**, with a VAT hint where it applies.
- **Missing in PRECISIA:** either not captured, or captured but not yet a bill.
- **Missing on Statement:** in period, or timing (near the statement date).
- **Potential Duplicate:**
  - the same line printed twice;
  - the same number with a different amount;
  - several PRECISIA candidates;
  - the same number twice in PRECISIA.
- **Unclassified:** interest, adjustment and other lines, or a credit of unknown type.
- **Out of Scope — Payment.**

**Earlier runs:** the SD-3D balance engine is kept unchanged (`reconciliation-engine-sd3d.ts`). Earlier runs replay
exactly with the engine that produced them; new runs never use it.

### Reader (`layout.ts`)

1. **Minus-signed credits in the Credit column** are read as credits, but only when the whole statement prints credits
   that way: at least two of them, and no credit printed without a minus. Otherwise they stay unread. The reader adds a
   warning, and the raw text is kept.
2. **"Total Due" beneath its heading** is the closing balance, unless the table prints one. A heading beside the label
   is never read as its value.
3. **New ageing labels:** "90+ Days" fills the 90-day bucket; "Overdue" is recognised but is not a bucket.
4. **Every ageing block** (first and last page) is consumed, so ageing rows never become transactions.
5. **Monthly subtotal rows** such as "Total: October 2026" are excluded subtotals, not the statement's totals. This
   removes the false printed-total mismatches.
6. **The statement date** is read from a bare "Date:" label in the header, or from "Statement Date:" inside a longer cell.
7. **No opening balance is manufactured.**
8. **Supplier name:** a telephone line, e-mail, web address or letter-spaced title is never taken as the supplier's name.

### Validation (`validation.ts`)

- **Payments never block:**
  - unread payment values become one review note (`payment-unread`);
  - the balance arithmetic is reported as `balance-not-verifiable`, not failed;
  - repeated payment rows are not a repeated-line finding.
- **Opening and closing balances:** missing values are review notes. They are not needed for documents and are never
  invented.
- **Document lines:** unread invoice, debit-note, credit-note and unknown-type values still block.
- **Running balance:** followed in the statement's own date order, so newest-first statements are checked correctly.

### Database (0117)

- **Ready:** unread values on payment lines no longer block. This is the 0115 guard with only that condition changed.
- **Runs:** a second basis, `supplier-statement-documents`.
  - S and P are stored in `statement_closing` and `precisia_balance_at`.
  - There is no opening balance (both opening columns must be 0).
  - D = S − P and D = E + U remain enforced.
  - Balance-basis runs keep the own-closing-balance rule.
- **Items:** the category `Out of Scope` and the tier `zero-padded`.
- **Rollback:** restores the 0115 bodies and vocabularies, and refuses while any document-basis run exists, because
  runs are immutable evidence.

### Service and UI

- **Running a reconciliation** needs the statement date only.
- **Decisions** (link or explain) refer to supplier documents only.
- **The reconciliation screen** reads "Document reconciliation" and shows:
  - Documents on Statement;
  - Documents in PRECISIA, with the amount not posted;
  - Document Difference;
  - Matched, Amount Differences, Missing in PRECISIA, Missing on Statement and Potential Duplicates;
  - Unexplained.
- **Payments** are listed under "Out of Scope — Payment" with no actions.
- **Earlier balance runs** are shown with their own figures and marked as superseded.
- **The review screen** marks payment lines "Payment — not reconciled" and does not count their unread values as
  blockers.

## Tests

- **SQL:** `supplier_statement_document_reconciliation.test.sql` (26 checks).
  - The SD-3C suite's T14 was adapted: its unread line is now an invoice, because an unread payment no longer blocks by
    design.
- **Engine:** `reconciliation-engine.test.ts` (30 tests), including property tests:
  - adding or removing payment rows (1, 3 or 12, interleaved, some unreadable, some reusing document numbers) never
    changes any document result or total, across 80 seeded statements;
  - D = E + U with residual 0;
  - every line and document is accounted for once.
- **Reader:** `layout-sd3g.test.ts`, plus a new corpus document, `monthly-negative-credits`. It is synthetic, in the UAT
  statement's layout, hash-pinned, and its answer key was typed by hand from the rendered page.
- **Validation, input builder, supplier matching, reconciliation service and UI** test additions.
