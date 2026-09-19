# VYRON AI Supplier Invoice Capture — Independent Certification Corpus

24 synthetic supplier documents and 24 independently authored answer keys,
for certifying AI extraction accuracy once an authorised non-production
Gateway credential exists.

**Nothing here has been run against a provider.** No value in this directory
derives from any AI output.

## Layout

```
certification-corpus/
  authoring/document-content.mjs   what each page PRINTS (drives rendering only)
  documents/                       the 24 rendered files a provider receives
  ground-truth/<case>.json         the 24 independently typed answer keys
  manifest.json                    per-file SHA-256 + a single corpusSha256
```

## The independence rule

```
DOCUMENT  →  INDEPENDENT AUTHOR ANSWER KEY  →  AI EXTRACTION  →  SCORING
```

and never

```
DOCUMENT  →  AI EXTRACTION  →  GROUND TRUTH
```

The answer keys are plain JSON: they cannot import anything, cannot call
anything, and cannot have been produced by a model without someone doing it
deliberately and visibly. `document-content.mjs` and the ground truth are
authored **separately**, so a typo in either is caught by the agreement
tests rather than silently agreeing with itself.

The arithmetic answer key is worked out in `scripts/author-ground-truth.mjs`
with plain multiplication and addition written for that file alone. It does
**not** call Finance's `computeLineAmounts` — an answer key produced by
Finance could never catch Finance being wrong, which is half the point.

## Regenerating

```bash
node scripts/author-certification-corpus.mjs    # render the 24 documents
node scripts/author-ground-truth.mjs            # write the 24 answer keys
node scripts/build-certification-manifest.mjs   # re-hash everything
```

Rendering is **deterministic**: Chrome's PDF creation date and file ID are
overwritten with fixed values of identical byte length, so re-running
reproduces every file byte for byte. Verified across three consecutive runs.

Changing a document or an answer key changes `corpusSha256`, and
`requireVerifiedCorpus()` refuses to certify against a corpus that does not
match its manifest. That is deliberate: "we fixed a typo in the answer key"
and "we adjusted the answer key until it passed" must not look the same.

## Coverage

| Case | Format | What it is for |
| --- | --- | --- |
| `clean-pdf` | PDF | Baseline; every particular present |
| `multi-page` | PDF | 14 lines over 2 pages — catches silent truncation |
| `scan` | PDF (image-only) | No text layer; must be read, not parsed |
| `jpg` | JPG | Photographed; also the 191.475 → 191.48 rounding case |
| `png` | PNG | Screenshot; dimensions in the description are not money |
| `rotated` | PNG | ~6.5° askew on a grey surface |
| `poor-quality` | JPG | Low resolution, faded, heavy artefacts |
| `small-text` | PDF | ~6pt body text |
| `many-lines` | PDF | 20 lines, prices 50.00 → 145.00 |
| `mixed-vat` | PDF | 15% and 0% on one document; VAT is **not** a blended header rate |
| `zero-vat` | PDF | Registered supplier, everything zero-rated, VAT column prints 0.00 |
| `no-vat` | PDF | **Not** registered: no VAT number, no VAT column, headed INVOICE |
| `discount` | PDF | VAT charged after trade discount |
| `uom-pack` | PDF | Priced per case; no per-bottle price is printed and none may be invented |
| `ambiguous-supplier` | PDF | Near-twin legal entity, no VAT or registration number |
| `duplicate` | PDF | Same invoice identity as `clean-pdf`, different file |
| `repeated-invoice-number` | PDF | Same number, **different** supplier — not a duplicate |
| `missing-vat-number` | PDF | Registered supplier, number omitted — genuinely missing |
| `missing-invoice-number` | PDF | No serial number printed anywhere |
| `arithmetic-mismatch` | PDF | Prints VAT 165.00 where 15% is 150.00 — **stays wrong** |
| `credit-note` | PDF | Visibly a credit note; must not become a Bill |
| `debit-note` | PDF | Visibly a debit note; must not become a Bill |
| `foreign-currency` | PDF | USD, stated three times; no rate, no silent ZAR |
| `weight-column` | PDF | A MASS (kg) column between UNIT PRICE and V.A.T. — the VYRON COST production failure |

## Field-absence semantics

Not every empty field is an error, and conflating them is how a correct
reading gets scored as a mistake:

| Status | Meaning | Example |
| --- | --- | --- |
| `present` | Printed | Most fields |
| `correctly-absent` | Not printed, and rightly so | VAT number of a non-vendor (`no-vat`) |
| `missing` | Not printed, but should have been | VAT number on a tax invoice (`missing-vat-number`) |
| `ambiguous` | Printed, but identifies more than one thing | Supplier name (`ambiguous-supplier`) |
| `not-applicable` | The concept does not arise | ZA VAT on a foreign invoice (`foreign-currency`) |

## Security

All data is synthetic. Suppliers, VAT numbers, registration numbers,
invoice numbers and amounts are invented. No production tenant, customer,
supplier, credential or UUID appears anywhere — asserted by test.

The bill-to party is "Riverbend Test Trading (Pty) Ltd", deliberately not
the name of any company in this system.

## What this corpus does not do

It does not measure anything on its own. Accuracy figures exist only after
a provider has actually processed these documents, which has not happened.
See `docs/LIVE_AI_CERTIFICATION_RUNBOOK_5N.md`.
