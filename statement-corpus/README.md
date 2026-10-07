# Supplier statement certification corpus (SD-3C)

This corpus certifies the supplier-statement reader **before** the reconciliation engine (SD-3D) depends
on it. All data is synthetic: every supplier, customer, account number, VAT number and amount is
invented.

| Path | What it is |
|---|---|
| `authoring/statement-content.mjs` | What each document prints. Used for rendering only. |
| `documents/` | The rendered files, produced by `node scripts/author-statement-corpus.mjs` (local Chrome/Edge). |
| `manifest.json` | SHA-256 of every document, so the corpus cannot change unnoticed. |
| `ground-truth/*.json` | The answer keys, **typed by hand from the rendered pages**. They are independent of the authoring file and of the reader. |

The answer keys record:
- every expected line, with its reference exactly as printed;
- every value expected to be **unreadable** (left unresolved, raw text kept);
- the excluded rows (brought/carried forward, totals, closing balance);
- the expected validation verdict.

`src/server/supplier-statements/statement-corpus.test.ts` runs the **production** read path
(`readStatementFile`) and validation over every document, and compares the results with the answer keys.

## Coverage

| Requirement | Case(s) |
|---|---|
| Multiple supplier layouts | `karoo-point`, `highveld-comma-crdr`, `multipage-*`, `ambiguous-unreadable`, `repeated-line`, `arithmetic-errors`, `reverse-convention`, `layout-variation` |
| Native text PDFs | all `.pdf` except `scanned` and `encrypted` |
| Multi-page; repeated headings; tables spanning pages | `multipage-repeated` (3 pages, heading on every page), `multipage-continuation` (page 2 has no heading) |
| Wrapped descriptions | `multipage-repeated` |
| Brought forward / carried forward; page totals; sub-totals | `multipage-repeated` |
| Leading-zero references | `karoo-point`, `multipage-repeated`, `repeated-line`, `arithmetic-errors`, CSV, XLSX |
| Spaces, decimal commas, decimal points | `karoo-point`, `highveld-comma-crdr`, `multipage-repeated`, `csv-semicolon` |
| Parentheses, CR, DR, trailing minus | `multipage-continuation`, `highveld-comma-crdr` |
| Ambiguous values; unreadable rows | `ambiguous-unreadable` |
| Running, opening, closing balances | most cases; opening and closing in summary boxes in `highveld-comma-crdr` |
| Duplicate / repeated lines | `repeated-line` |
| Arithmetic errors (running-balance break, closing mismatch) | `arithmetic-errors` |
| Reversed debit/credit convention (proposed, never applied) | `reverse-convention` |
| Printed ageing (matching and mismatching) | `karoo-point`, `layout-variation` |
| Encrypted / password-protected PDF | `encrypted` |
| Scanned / image statements (manual entry in SD-3C) | `scanned` (image-only PDF), `scan-jpg`, `scan-png` |
| CSV / XLSX (secondary) | `csv-semicolon` (`;`, decimal comma), `xlsx-typed` (typed numbers and dates) |

## Adding a case

1. Add the case to `authoring/statement-content.mjs`.
2. Run `node scripts/author-statement-corpus.mjs`.
3. **Look at the rendered page.**
4. Type its answer key into `ground-truth/<key>.json` from the page, not from any output of the reader.
