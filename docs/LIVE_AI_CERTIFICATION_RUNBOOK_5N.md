# Live AI Certification Runbook — VYRON AI Supplier Invoice Capture

**Status: not yet executed.** Live certification is blocked until an authorised
**non-production** AI Gateway credential is supplied. This document is the
procedure for when one is.

This runbook is deterministic on purpose. Every step has a stated pass
condition and a stated stop condition, so the run either proceeds for a
reason or halts for a reason, and a person reading the record afterwards can
tell which happened.

---

## 0. Before anything

| Requirement | Why |
| --- | --- |
| An authorised **non-production** `AI_GATEWAY_API_KEY`, supplied separately | `web/.env.local` holds the **production** credential and is forbidden for certification. Do not copy it, do not read it, do not "just use it for one call". |
| A **sandbox or test company**, never a production tenant | Certification writes captures, attempts and Draft bills. |
| **Synthetic or explicitly authorised** documents only | The certification report necessarily contains document values. |
| The **certification corpus**, authored in Phase 5O — see §2 | 24 synthetic documents and 24 independent answer keys, pinned by `corpusSha256`. Verify its integrity before sending anything. |

**Do not begin** if any of these is missing. A partial run produces a number,
and a number is what people remember.

---

## 1. Confirm the safety boundary is intact

Run the offline suites first. They take under a minute and they are the
evidence that the thing you are about to point at a provider is the thing that
was reviewed.

```bash
npx vitest run src/server/supplier-invoice-capture/
npx vitest run src/server/services/ai-classification-safety.scenario.test.ts
psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_invoice_capture_accounting_safety.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/ai_scope_budgets.test.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/certification_call_ceiling.test.sql
./supabase/tests/certification_call_ceiling.concurrency.sh
```

**Stop** on any failure. Do not proceed to a provider with a red suite.

Confirm by inspection, not by memory:

- `decideExtractionProvider({})` returns `unavailable`.
- The scope in use is `supplier-invoice-extraction`, **not**
  `transaction-classification`.
- The classification circuit's state is recorded **before** you start, so any
  later change to it can be attributed.

---

## 2. The certification corpus — **authored in Phase 5O**

24 synthetic documents and 24 independently authored answer keys now exist
in `certification-corpus/`. See `certification-corpus/README.md`.

This section previously said the corpus did not exist and had to be written.
It has been. What remains:

- **Verify integrity before sending anything.** `requireVerifiedCorpus()`
  re-hashes every file against `manifest.json` and throws on any
  discrepancy. Record the `corpusSha256` in the certification report so the
  result can be tied to a provable set of bytes.
- **Countersign the answer keys.** Every record's `verifiedBy` says the keys
  were authored by Claude and are *not yet countersigned by a second
  reader*. A certification result is only as good as its answer key, so a
  second person should read the 24 documents against the 24 JSON files
  before the numbers are treated as authoritative. This is the one
  outstanding item on the corpus.
- **Do not edit a document or an answer key to make a run pass.** Any change
  alters `corpusSha256` and the runner refuses, which is the point.

## 3. Confirm budget and circuit state **before** enabling anything

```sql
select scope, reserved_requests, usage_day from ai_provider_daily_usage
 where company_id = :company;
select * from ai_provider_circuit_state where company_id = :company;
```

Record all of it. If the `supplier-invoice-extraction` circuit is already
**open**, find out why before certifying — an open circuit is a previous
failure that has not been explained.

Confirm the classification scope is independent: its counter and circuit must
be unaffected by everything that follows. This is asserted by
`ai_scope_budgets.test.sql` and must also be observed in the live run.

---

## 4. Open a certification run with a finite ceiling

```sql
select fn_ai_certification_open_run(:company, 'gateway certification 1', 30, 'owner');
```

The ceiling is **separate from and additional to** the 200/day operational
budget. Both apply; whichever binds first refuses.

**Do not raise the 200/day budget to accommodate certification.** That would
leave production more exposed afterwards, and a temporary allowance nobody
remembers to lower is how a safety limit stops being one.

Size the ceiling to the corpus: roughly `documents × (1 + expected retries)`,
plus a small margin. For 24 documents, 30 is reasonable.

---

## 5. Enable the provider — in the certification environment only

```
VYRON_AI_INVOICE_EXTRACTION=certification
AI_GATEWAY_API_KEY=<the authorised non-production credential>
```

Both are required. Either alone leaves the provider unavailable, which is the
fail-closed default and is asserted by `provider-selection.test.ts`.

**Never set these in production.** Production has a credential and has never
had the switch; that is what keeps it capturing documents for a person to
type.

### A known gap: nothing schedules the extraction task

`syncSupplierInvoiceExtractionTask()` exists in `scheduler-service.ts` but
**is not called anywhere**. No company is ever given the standing
`SupplierInvoiceExtraction` task, so the sweep never runs on its own.

This is fail-closed and is being left alone deliberately — it is why deploying
this feature activates nothing. For certification, the task must be created
**deliberately**, for the sandbox company only, or the sweep driven directly.
Decide which, and record the choice.

---

## 6. One controlled probe

Send **one** document. Not the corpus. One.

| Outcome | Action |
| --- | --- |
| **401** | **STOP.** Record. The credential is wrong or revoked. |
| **402** | **STOP.** Record. This is the condition that blocked 5M. Do not retry, do not switch providers, do not "try the other account". |
| **403** | **STOP.** Record. |
| **429** | **STOP.** Record the `Retry-After` value. **Do not continue automatically** — a rate limit on request one says something about the account, not about this document. |
| **timeout** | **STOP** after confirming the circuit handled it. |
| **5xx** | **STOP** after confirming the circuit handled it. |
| **malformed structured output** | **STOP.** Record the safe failure. The answer was rejected by `parseExtractionResponse` before reaching any accounting logic — confirm that is what the record shows. |
| **success** | Proceed to §7. |

After the probe, whatever happened, re-read the circuit and both counters and
confirm they moved exactly as expected — including that **classification is
untouched**.

---

## 7. The corpus run

Only if the probe succeeded.

Every call goes through the existing `ai_extraction_attempts` instrumentation.
Nothing is recorded by hand.

Measure, per the brief:

- calls per document
- latency per call
- success / failure by category
- field outcomes: exact / normalised / incorrect / missing / hallucinated / correctly-absent
- **critical-field accuracy, reported separately** from important and optional
- supplier resolution outcomes (and that no fuzzy match returned `resolved`)
- duplicate detection outcomes
- arithmetic validation outcomes
- review outcomes, including how many documents a person had to correct

Use `buildCertificationReport` / `formatCertificationReport`. Do not
hand-assemble a summary.

---

## 8. Reporting the result

**There is no threshold in this runbook, and none is to be invented.**

The harness reports numbers. A human decides whether those numbers justify
proceeding — and "95% is fine" is not a finding, it is a preference wearing a
number's clothes.

Report:

- the measured figures, in full;
- every critical-field failure, individually, with expected and actual;
- the corpus coverage actually achieved (how many of the 24 profiles ran);
- the certification run's `calls_used` against its ceiling;
- whether the classification scope stayed independent.

**A certification failure is an acceptable outcome.** Do not adjust the corpus,
the scoring or the ceiling to obtain a pass.

---

## 9. Close the run

```sql
select fn_ai_certification_close_run(:run_id);
```

Unset `VYRON_AI_INVOICE_EXTRACTION`. Confirm `decideExtractionProvider({})`
returns `unavailable` again.

The run's `calls_used` is **not** reset — what a run spent outlives the run.

---

## What this runbook never authorises

- Closing, disabling or bypassing the AI circuit.
- Faking provider success, or substituting another provider to get a pass.
- Using production credentials, production companies or production invoices.
- Raising the operational daily budget for a certification run.
- Passing `document_type` into accounting conversion to make credit notes
  convert.
- Applying an exchange rate, anywhere, for any reason.
- Deploying, committing or pushing anything on the strength of a green run.
