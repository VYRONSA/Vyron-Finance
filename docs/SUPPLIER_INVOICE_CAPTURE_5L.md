# Phase 5L — VYRON AI Supplier Invoice Capture

Implementation. **Local only.** Nothing committed, pushed or deployed;
migrations applied to a local Docker Postgres and to nothing else; **no
external AI provider was called at any point.**

The governing principle was *reuse COST's thinking, not COST's
implementation*. What that meant in practice: the extraction prompt, the
arithmetic validators, the totals reconciliation and the duplicate layers
are adapted from VYRON COST. Its routes, persistence, approval path,
permissions, RLS and UI are not.

---

## 1. Architecture

```
Purchasing ▸ AI Invoice Capture
      │  upload (existing Document Platform: virus scan, versioning, retention)
      ▼
documents (+ content_sha256)  ──▶ file-hash duplicate check, BEFORE any AI
      ▼
supplier_invoice_captures  status=Queued        ← the request ends here
      ▼
automation runner  ·  task type SupplierInvoiceExtraction
      │  fn_ai_extraction_gate → circuit + scope budget + provider fuse
      ▼
ExtractionProvider (interface; default extracts nothing and says so)
      ▼
DETERMINISTIC VALIDATION        ← never model confidence
  line coherence · constant-money-column · totals reconciliation · boundary
      ▼
supplier resolution (7 tiers, fuzzy = proposal only)
      ▼
duplicate assessment (binding)  ·  GL/VAT suggestion (supplier default first)
      ▼
status=NeedsReview  ──▶  HUMAN REVIEW  ──▶  convert
      ▼
createPurchaseBill → DRAFT bill → existing approval → existing posting engine
```

Pure decision modules live in `src/server/supplier-invoice-capture/`;
orchestration in `supplier-invoice-capture-service.ts`; persistence in
`supplier-invoice-capture-repository.ts`. Every decision is made by a pure,
unit-tested function — the service only sequences them.

## 2. Migrations

Both idempotent (re-applied cleanly), tenant-scoped, with rollbacks.

| Migration | Purpose |
| --- | --- |
| `0107_ai_scope_budgets.sql` | Scope-specific AI budgets (Decision 1). Adds `scope` to `ai_provider_daily_usage`; `ai_provider_scope_budgets` + `ai_provider_company_budget_overrides`; `fn_ai_resolve_daily_cap` / `fn_ai_reserve_request` / `fn_ai_release_request`; rewrites the classification gate and attempt recorder to use them. |
| `0108_supplier_invoice_capture.sql` | `documents.content_sha256`; `supplier_invoice_captures` / `_lines` / `_events`; `supplier_line_mappings`; `ai_extraction_attempts`; `fn_ai_extraction_gate`; `fn_ai_extraction_record_attempt`; `fn_upsert_supplier_line_mapping`; the `SupplierInvoiceExtraction` task type. |

**0107 carried real risk** — it rewrites two functions the classification
sweep depends on. Two things contain it: the attempt recorder's body was
extracted from 0099 *programmatically* and modified in exactly one place
(so no other line can have drifted), and the existing suite
`ai_classification_safety.test.sql` passes **121/121** against the migrated
schema.

Rollback order matters and is stated in the scripts: 0108 before 0107,
because `fn_ai_extraction_record_attempt` calls `fn_ai_release_request`.

## 3. Document lifecycle

Eight states, with a CHECK constraint so drift is impossible:

`Uploaded → Queued → Extracting → NeedsReview → Converted`, with `Duplicate`,
`Failed` and `Cancelled` as the exits. `Extracting → Queued` on a retryable
deterministic failure; `→ Failed` once attempts are exhausted.

COST's equivalent had no CHECK constraint and already showed drift
(`approved` vs `archived`, leaving a partial index that could never match).

## 4. Upload

`POST /purchasing/invoice-capture`. PDF/JPG/PNG only, 20 MB cap, non-empty,
`Purchasing:Create` checked **before the body is parsed**. SHA-256 computed
and stored on the document; an exact re-upload is identified and blocked
**before any provider call**, so a duplicate never costs AI budget.

Storage is the existing Document Platform — one upload path, not a second
one. COST had no size cap at all.

## 5. Background processing

Extraction runs on the existing automation runner as
`SupplierInvoiceExtraction`. The upload request returns as soon as the work
is queued; closing the browser cannot abandon it. Task claiming, time
limits, retries, suspension and audit all come from the existing runner.

`claimCaptureForExtraction` is a conditional UPDATE on status, so two
runners cannot claim the same document.

Classified as **not** posting accounting in `taskPostsAccounting` — the
sweep creates no bill, no journal and no ledger entry.

## 6. AI safety integration

No second circuit breaker. `ai_provider_circuit_state` is keyed by `scope`
and 0107 seeds `supplier-invoice-extraction` — one row, no schema change.
`fn_ai_extraction_gate` mirrors the classification gate's structure
(circuit → reservation → probe claim) minus the per-item queue hold, which
`supplier_invoice_captures.status` already expresses.

Handled: timeout, 429, 401, 402, 403, 5xx, malformed response, and a
document that cannot be read. Auth-class failures open the circuit
immediately; a malformed answer is a document outcome, not an outage —
the same line 0099 draws. A failure that never reached the provider gives
its reservation back (**verified on the sandbox: 1 → 0 on both layers**).

## 7. Scope-specific usage budget

Two layers, both kept:

| Scope | Default | Meaning |
| --- | --- | --- |
| `transaction-classification` | 100/day | **Unchanged** — today's behaviour represented exactly, not approximated |
| `supplier-invoice-extraction` | 200/day | This feature's operational limit |
| `__provider__` | 500/day | Emergency fuse across every scope. Not an operational limit, and not removed |

A request reserves **both**; if either is exhausted the other is given back
in the same transaction, so the counters cannot drift. Per-company
overrides make it configurable. A caller may lower its own cap, never raise
it. An unbudgeted scope gets zero.

**This is not billing.** No pricing, plan, product or customer-quota change;
`fn_record_usage_event` is untouched.

## 8. Extraction schema

Strongly typed, in `types.ts`. Header and lines as the brief lists them,
plus per-field confidence.

**No magic strings.** Unreadable is `null`, and *why* it is null lives in
`missingFields` where it cannot be confused with data. `parseExtractionResponse`
maps `"UNKNOWN"`, `"Needs Review"`, `"N/A"` and friends to `null` even if a
model emits them — COST stored exactly those strings inside money and
VAT-number fields.

Confidence is captured and shown, and decides nothing.

## 9. Deterministic validation

The centre of the feature. Four independent signals, none of which consults
confidence:

1. **Constant money column** — a repeated `unitPrice`/`vatAmount` across ≥60%
   of ≥5 rows with ≥3 distinct line totals. This is COST's measured failure:
   a WEIGHT column printed between UNIT PRICE and V.A.T., read as money on
   11 of 12 rows at confidence 95. A column of zeros is exempt (that is a
   zero-rated invoice).
2. **Row coherence** — `qty × price − discount` must reconcile to the line
   total, VAT-inclusive *or* exclusive. Both bases accepted; neither assumed.
3. **Totals reconciliation** — computed independently and **compared**, never
   substituted. The brief's example behaves exactly as specified: extracted
   11,500 against reconciled 11,350 → `Review`, with both figures named.
4. **Invoice boundary** — a file carrying several invoice numbers is refused,
   never merged.

## 10. Supplier resolution

VAT → registration → supplier code → exact name → normalised name → learned
mapping → **fuzzy (proposal only)**. Matches against `alternativeNames` too.

A tier matching more than one supplier is **ambiguous, not resolved** — that
means duplicate master data, and picking one is how an invoice gets billed
to the wrong entity. COST's `.maybeSingle()` turned that case into a silent
null with an unread error.

There is no code path from a similarity score to a resolved `supplierId`.

## 11. Duplicate protection — binding

Three layers: file hash (**block**), supplier + invoice number against both
captures and **bills already on the ledger** (**block**), supplier + total
within 7 days (**possible**, shown not blocked).

`blocksConversion` is consulted by `assessConversion`, which refuses. There
is no `force` parameter anywhere in the feature. This sits on top of the
existing DB constraint `unique(company_id, supplier_name, invoice_number)`.

COST computed `action: "block"` and never read it; its approval raised a
duplicate alert *after* writing costs.

## 12. GL/VAT suggestions

`supplier default > learned mapping > historical bill > printed VAT rate >
AI`. AI **cannot** override a configured supplier default — enforced by the
ladder, not by convention. Every suggestion records its source and the UI
says which in plain words. A printed rate resolves only when exactly one
treatment has it (15% is shared by Standard Rated and Import VAT, so it
deliberately resolves to nothing).

## 13. Pack/UOM

Captured as printed; **never divided into a price**. `parsePackDescription`
accepts only unambiguous forms (`12 x 1L`) and refuses `1L x 12`, `box of
12` and bare numbers. `derivedUnitCostIsOutOfScope()` exists so a future
caller reaching for a unit-cost derivation finds the reason instead of
writing one. Item/inventory linking is explicitly deferred.

COST wrote the **case** price into a column called `true_unit_cost`.

## 14. Review UI

`Purchasing ▸ AI Invoice Capture`, beside Bills. Document preview via the
existing signed download route. Supplier picker with candidate chips; every
header field editable; a line grid with GL and VAT pickers, per-line
confidence and an include/exclude checkbox. Findings shown as "What to
check". Both totals shown side by side: *the invoice says* vs *the lines
add to*.

Provenance is explicit — extracted, suggested (with its source named), or
user-corrected.

## 15. Human approval gate

Non-negotiable and implemented as such. `assessConversion` refuses on: a
blocked duplicate, an `Incomplete` validation, no supplier, no invoice
number, no date, no lines, or any line missing a GL account, VAT code,
quantity or price. `Review` is **not** a block — deciding a disagreement is
what review is.

The Convert button is disabled with the reasons listed. There is no
"approve anyway", no bulk approve, no supervisor PIN, and the actor comes
from the session (`getPerformedByLabel()`); the route never passes one.

## 16. Bill integration

`convertCaptureToBill` calls the existing `createPurchaseBill` with the
multi-line path. **No header total, VAT treatment or subtotal crosses the
boundary** — `summarizeBillLines` rolls the confirmed lines up using the
same `computeLineAmounts` every other Finance document uses.

Idempotent: `assessConversion` refuses an already-converted capture, and
`supplier_invoice_captures_bill_unique` makes a concurrent second
conversion impossible at the database.

Gated twice: `Purchasing:Create`, then `requireApproval(…, "PurchaseApproval",
total)` against the reviewer's own role-based limit.

## 17. Traceability

`supplier_invoice_capture_events` records upload, queue, extraction start/
success/failure, validation, supplier resolution, duplicate evaluation,
field corrections, conversion and cancellation — with the field *names*
changed, never their values. Insert-and-read only: no update or delete
policy exists, so an audit row cannot be edited away through the API.

The capture carries `bill_id`; the review screen links to the bill.

## 18. Learning

Keyed `(company_id, supplier_id, description_normalised,
supplier_sku_normalised)` — **never a supplier name string**, and the SKU is
part of the key (COST left it out, so two SKUs sharing a description
collapsed, last write wins). Written only from a human-approved conversion.
`times_confirmed` increments atomically in SQL. Failures are recorded as an
audit event, never swallowed.

## 19. Inbox

Bounded (default 100, hard cap 500), filterable by status, searchable by
supplier or invoice number, showing supplier, number, date, amount, status,
a checks indicator, duplicate warning, uploaded date and the resulting bill.

## 20. Document preview

The existing signed-URL download route. No public URL. **No diagnostic
crops are persisted** — COST wrote page images of invoices to an
un-tenant-scoped `diagnostics/` prefix and never deleted them.

## 21. PII / logging

`redaction.ts` is the only sanctioned channel. `buildLogPayload` has a
closed allow-list and **drops** anything else, so a caller cannot widen what
is logged. `sanitizeProviderMessage` strips data URIs, long blobs, API keys,
bearer tokens and PEM blocks, collapses to one line and truncates at 300.
Operator messages are ours, keyed by category — a provider's own text is
never shown.

`ai_extraction_attempts` records metadata only. There is deliberately **no**
`raw_response` column for one to be added to without thinking.

## 22. Security

Every table: RLS enabled, real tenant predicate, `WITH CHECK`. **Verified
on the sandbox — no `using (true)` policy exists anywhere in the feature.**
Budget tables have RLS and *no* policies, reachable only through
security-definer functions, with all API roles revoked.

Routes: `Purchasing:View` to read, `Purchasing:Create` to upload and
convert, `Purchasing:Edit` to correct, plus an approval limit to convert.
403 is returned *before* the lookup, so it cannot be probed into a 404.

## 23. Test corpus

19 synthetic profiles in `test-corpus.ts` — clean PDF, scan, JPG, PNG,
multi-page, rotated, poor quality, **weight column**, mixed VAT, zero VAT,
discount, missing invoice number, missing VAT number, ambiguous supplier,
duplicate, repeated invoice number, UOM/pack, **arithmetic mismatch**, batch
scan. A test asserts every required profile is covered and that no
production tenant or supplier name appears.

## 24. Tests

Unit and integration: **205** in the capture domain, **17** route security,
**32** SQL budget assertions, **121** SQL classification-safety assertions
(pre-existing suite, unchanged behaviour proven).

## 25. Accounting reconciliation

`accounting-reconciliation.test.ts` proves *Extracted → Reviewed → Draft
bill* matches exactly across the corpus, using the real `computeBillLine`.
It also proves the engine recomputes VAT from the confirmed lines rather
than adopting the document's stated figure, and that **no module in this
feature writes to `ae_journals`, `ae_journal_lines`, `gl_transactions`,
`ae_imported_bills` or `ae_purchase_bill_lines`** — asserted by reading the
sources.

## 26–29. Typecheck / Lint / Build / Scan

Typecheck clean. Lint **0 errors** (3 warnings, all pre-existing). `next
build` exits 0. Secret scan clean — the only `service_role` matches are
`REVOKE` statements.

## 30. Live provider status

**LIVE PROVIDER CERTIFICATION BLOCKED BY CURRENT 402.**

The circuit was not closed, bypassed, disabled or faked, and no alternative
provider was substituted. The shipped default provider is
`UnavailableExtractionProvider`, which extracts nothing and says so.

## 31. Production safety

0 production changes · 0 production writes · 0 migrations applied to
production · 0 tasks resumed · 0 Rule Engine · 0 BankSync · 0 Import ·
**0 external AI calls**.

## 32. Remaining risks

1. **Extraction accuracy is unmeasured.** No labelled corpus of real
   documents exists. The corpus fixes *system behaviour given an answer*,
   not the model's accuracy.
2. **The gateway-backed provider is not wired in.** The interface, error
   mapping and prompt exist; binding them to the live gateway is the first
   step of certification.
3. **No browser verification.** Preview Mode disables mutations, so the
   upload/review/convert path cannot be exercised without a configured
   Supabase and AI provider. Covered by mounted-component and route tests
   instead.
4. **Supplier-invoice bill lines carry no UOM or item link**, so pack
   information stays document-only, by design.
5. **The default budgets (200/500) are estimates.** They are configurable
   and should be revisited against real volume.
6. **`documents.content_sha256` is null on everything uploaded before 5L**,
   so file-hash duplicate detection only protects documents captured from
   here on.

## 33. Deployment readiness

**NOT READY — BLOCKER.** The blocker is the live-provider certification the
brief itself defers: mocked tests passing is not evidence that a real model
reads real invoices correctly, and this phase deliberately did not find out.

Everything that can be verified without a provider has been. What remains
before production: fund the Gateway, wire the gateway-backed provider,
assemble a labelled corpus of real documents with human-verified ground
truth, and measure accuracy — then decide.
