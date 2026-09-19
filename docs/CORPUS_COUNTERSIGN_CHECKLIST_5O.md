# Countersigning the Certification Corpus

**For the independent reviewer.** You do not need to know this codebase.

---

## Why you are being asked

VYRON is about to measure how accurately an AI reads supplier invoices. To
measure that, it needs 24 test invoices and an answer key for each — what the
invoice actually says.

Those answer keys were written by Claude. The AI being tested is also Claude.
So until someone else checks the keys, any accuracy score is partly the system
marking its own homework, and it would look equally convincing either way.

Your job is to read each invoice and confirm the answer key matches it.

**You are not judging the AI.** It has not run. You are judging whether the
answer key is a fair description of the page.

Roughly 5–10 minutes per document, 2–4 hours in total. It does not have to be
done in one sitting — your progress is saved in your browser.

---

## How to start

Open this file in a browser:

```
certification-corpus/review/countersign-pack.html
```

Each case shows the invoice on the left and its answer key on the right. Tick
each confirmation only once you have actually checked it.

Nothing is sent anywhere. The page loads local files and has no network code.

---

## The six confirmations, per case

1. **Supplier identity** — name, VAT number and registration number match the
   page, or are absent on both.
2. **Document identity** — document type, invoice number, invoice date and due
   date match.
3. **Line items** — every line's description, quantity, unit of measure, unit
   price, discount and VAT match.
4. **Totals** — printed subtotal, VAT and total match **exactly**, including
   where the page is wrong.
5. **Absence semantics** — each field marked absent/missing/ambiguous/
   not-applicable is genuinely that (see below).
6. **Expected outcomes** — the expected validation, supplier-resolution,
   duplicate and conversion results look right.

---

## Three traps worth knowing about in advance

### 1. One invoice is supposed to be wrong

`arithmetic-mismatch` prints VAT of **165.00** on a net of 1 000.00, where 15%
would be 150.00, and a total of 1 165.00 instead of 1 150.00.

**The answer key correctly records 165.00 and 1 165.00** — what the page says,
not what the arithmetic says. That is the whole point of the case: an AI that
"helpfully" corrects a supplier's invoice is dangerous, because the corrected
figure looks perfectly ordinary and would post without challenge.

Do not flag this as a discrepancy. Confirm the page really does print the wrong
figures and the key has not been tidied up.

### 2. An empty field is not automatically an error

Four different things look identical on a page — nothing there:

| Marked | Means | Where you will see it |
| --- | --- | --- |
| `correctly-absent` | Nothing should be there | `no-vat` — the supplier is not VAT-registered, so there is no VAT number to omit |
| `missing` | Something should be there | `missing-vat-number` — headed TAX INVOICE and charging VAT, so the number should be printed |
| `ambiguous` | Printed, but fits more than one thing | `ambiguous-supplier` — a name that matches two different companies |
| `not-applicable` | The concept does not arise | `foreign-currency` — a US supplier has no South African VAT number |

`no-vat` and `missing-vat-number` are the pair to look at most carefully. Both
have no supplier VAT number. One is correct and one is a defect.

A note on `no-vat`: the page **does** print a VAT number — the customer's, in
the "Bill to" block. That is correct and expected. What must be absent is the
**supplier's**.

### 3. Two invoices share an invoice number on purpose

`clean-pdf`, `duplicate` and `repeated-invoice-number` all carry **KW-10041**.

- `duplicate` is the same invoice from the same supplier — a genuine duplicate,
  expected to be **blocked**.
- `repeated-invoice-number` is a **different supplier** that happens to use the
  same number. Suppliers number their own invoices, so this is not a duplicate
  and must not be blocked.

---

## Case-by-case: what each one is for

| # | Case | Look particularly at |
| --- | --- | --- |
| 1 | `clean-pdf` | The baseline. Everything present and agreeing. |
| 2 | `multi-page` | 14 lines across two pages — check **all 14** are in the key. |
| 3 | `scan` | A scan with no selectable text. Read it by eye. |
| 4 | `jpg` | VAT of 191.48 — 15% of 1 276.50 is 191.475, rounded up. |
| 5 | `png` | "400x300x200" in the description is a carton size, not money. |
| 6 | `rotated` | Photographed askew. Everything should still be legible. |
| 7 | `poor-quality` | Faded and grainy. If you genuinely cannot read a value, say so. |
| 8 | `small-text` | Very small print; 3 lines. "10kg", "2.5kg" are product names, not quantities. |
| 9 | `many-lines` | 20 lines, prices rising 50.00 → 145.00 in 5.00 steps. |
| 10 | `mixed-vat` | Two VAT rates. VAT is 150.00 — on the first line only, **not** 15% of the whole. |
| 11 | `zero-vat` | Registered supplier charging 0%. VAT column present, reads 0.00. |
| 12 | `no-vat` | **Not** registered. Headed INVOICE, no VAT column at all. |
| 13 | `discount` | VAT of 135.00 is 15% of 900.00 (after discount), not of 1 000.00. |
| 14 | `uom-pack` | Priced per case at 180.00. No per-bottle price is printed — the key must not invent one. |
| 15 | `ambiguous-supplier` | "Karoo Wholesale **Supply (Pty) Ltd**" vs "Karoo Wholesale **Supplies**". Different companies. |
| 16 | `duplicate` | Same invoice as #1, marked COPY. Expected: blocked. |
| 17 | `repeated-invoice-number` | Same number, different supplier. Expected: **not** a duplicate. |
| 18 | `missing-vat-number` | VAT number genuinely missing from a tax invoice. |
| 19 | `missing-invoice-number` | No invoice number anywhere. The key must say nothing, not guess. |
| 20 | `arithmetic-mismatch` | **Supposed to be wrong.** See trap 1. |
| 21 | `credit-note` | Headed CREDIT NOTE. Amounts are positive — credit notes do not print negatives. |
| 22 | `debit-note` | Headed DEBIT NOTE. |
| 23 | `foreign-currency` | USD, stated several times. No rand figure anywhere. |
| 24 | `weight-column` | A **MASS (kg)** column sits between UNIT PRICE and V.A.T. 5.33 and 47.10 are kilograms. They must not appear as any money value. |

---

## If you disagree with a key

Write it in the discrepancy box instead of ticking. Say which field, what the
key claims, what the page shows, and why you read it differently.

**A discrepancy is a useful result, not a failure.** It blocks certification
until a person resolves it, which is correct — either the key is corrected, or
your objection is discussed and withdrawn.

If a key is corrected, the corpus changes, its fingerprint changes, and **every
signature including yours becomes void**. The corpus then has to be reviewed
again. That is deliberate: a sign-off that survived a later edit would carry
authority it had not earned.

---

## Finishing

When all 24 are done, enter your name and press **Export countersignature**.
Save what it gives you over:

```
certification-corpus/countersignatures.json
```

Then tell the VYRON owner. Nothing else happens automatically — live
certification still needs a separate decision and an authorised
non-production AI credential.

---

## What your signature does and does not mean

**It means:** a second person read these 24 documents and agreed the answer
keys describe them accurately.

**It does not mean:** the AI is accurate, the feature is ready, or anything may
be deployed. Those are later, separate questions, and this signature is only
the precondition for asking them honestly.
