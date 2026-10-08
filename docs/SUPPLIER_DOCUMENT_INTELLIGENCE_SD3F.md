# Supplier Document Intelligence — SD-3F: Supplier Statement AI boundary

**Status:**
- Implemented on `security/sd0-supplier-capture-hardening`, on top of `9d7bca6` (SD-3E).
- Migration **0116**, with rollback `supabase/rollbacks/0116_supplier_statement_ai_boundary_down.sql`.
- **Not pushed, not deployed, not applied to production.** Production remains at 0109.
- **Live AI is OFF.** No provider is connected, and no AI budget has been spent.

## What it is

SD-3F is the controlled path by which a **scanned** supplier statement (scanned PDF, JPG or PNG) can later be read
automatically. Until now every scan went to manual entry. That was a temporary state, not the design (SD-3A §16.1),
and this boundary is how it ends.

**Distinction kept:**
- Scanned **supplier statements**: eligible for AI or OCR in future, through this boundary only.
- Scanned **supplier invoices / credit notes**: already eligible for automatic extraction through their own,
  separate switch (`VYRON_AI_INVOICE_EXTRACTION`).
- Neither is manual-only by design.

## The switch (OFF unless certified)

| `VYRON_AI_STATEMENT_EXTRACTION` | `AI_GATEWAY_API_KEY` | Result |
|---|---|---|
| absent / anything except `certification` | any | **Off**: `AiExtractionSkipped`, then manual entry. No gate call, no reservation, no request. |
| `certification` | absent / blank | **Off**: same, with the reason "key not configured". |
| `certification` | set | Gateway provider, still subject to the gate below. |

- The invoice switch does **not** enable statements.
- The gateway adapter checks the key **again** before any network activity (a second lock).
- The gateway module is loaded only when the switch is on, so the default path never imports a provider SDK.

## Order of checks for one scanned statement

1. **Switch** (above).
2. **Gate** — `fn_ai_statement_extraction_gate`, service role only:
   - The statement must belong to the company and be `Processing`.
   - The scope circuit must not be open; once its back-off has elapsed, exactly one probe is admitted.
   - Two-layer budget reservation: the scope `supplier-statement-extraction` allows 50 requests per company per day,
     and the provider-wide fuse is 500.
   - A refusal (`circuit_open`, `daily_cap` or `not_processing`) records `AiExtractionRefused` and sends the statement
     to manual entry with the reason. Nothing is sent.
3. **Transcription** — the provider returns **text only**:
   - Every amount, date and reference is the text as printed. The schema contains no number field a model could
     calculate into; the only numbers are `page` and `declaredTransactionRows`.
   - Answers are validated structurally; a number in a text field is a malformed response.
4. **Failure handling:**
   - Every failure records an attempt (metadata only) and sends the statement to manual entry.
   - A request that never reached the provider gives back its reservation.
   - Circuit signals use the shared rules:
     - auth / payment failures open the circuit immediately;
     - 3 consecutive timeouts open it;
     - 5 consecutive provider failures open it;
     - a failed probe doubles the back-off (maximum 24 h);
     - a success closes it;
     - a malformed answer is a document outcome, not an outage.
   - A provider that throws is contained and recorded as `unknown`.
5. **Deterministic reading** — `transcriptionToExtraction` lays the transcribed rows out as a grid and reads it with the
   **same tabular/layout reader and parsers** as a text PDF or spreadsheet:
   - an ambiguous or unreadable value stays **unresolved**;
   - brought-forward, carried-forward, totals and closing rows are identified by the same rules;
   - a line's type never comes from its sign;
   - page provenance and the row as transcribed are kept.
6. **Validation** — the same V1–V10 arithmetic validation as any statement, plus **V9**: the provider's
   `declaredTransactionRows` is compared with what was read.
   - Fewer rows read than declared → **Incomplete** (a truncated read).
   - More rows read than declared → **Review** (possibly a line read twice).
   - Nothing is silently repaired.
7. **Readiness** — unchanged: the supplier is only **proposed** by the deterministic matcher, and a person must confirm
   it. The statement must add up, and the database re-checks everything when it is marked Ready.

## What AI may never do

None of the following is representable in its output, and the AI modules import nothing that could do it. The tests
check both points.

- calculate or round accounting values;
- invent amounts, dates, references or balances;
- choose or confirm the supplier;
- reconcile, match or allocate;
- create journals, bills or payments;
- alter the supplier ledger;
- repair arithmetic.

## Evidence and provenance

- **Original document:** retained and unchanged (SD-3B). The viewer and its audit are unchanged.
- **Raw evidence:** `extraction_snapshot` keeps the header and lines as read, the method `ai`, and
  `ai: { provider, model, declaredTransactionRows, pagesSent }`. Each line keeps `raw_text` (the row as transcribed)
  and its page.
- **AI vs reviewer values:**
  - `supplier_statement_lines.extracted_by` is `reader`, `ai` or `reviewer`. The system sets it; a reviewer cannot
    change it.
  - A reviewer insert is always `reviewer`.
  - A reviewer correction of an AI line keeps `extracted_by = 'ai'` and sets `corrected`, so the UI shows
    **AI read + Corrected**.
- **Audit:**
  - `ai_statement_extraction_attempts` is append-only and holds **metadata only**: outcome, whether a request was
    made, model, error category, HTTP status, a sanitised message of at most 300 characters, usage, duration and pages.
    It holds no prompt, no response and no document content.
  - Statement events: `AiExtractionSkipped`, `AiExtractionRefused`, `AiExtracted`, `AiExtractionFailed`.
  - Reading the attempts needs Purchasing:View (RLS). Only the service role writes them, through the recorder function.

## User interface

- Lines read by AI carry an **AI read** badge (next to **Corrected** where applicable).
- The review page states that the statement was read by AI from the scan and should be compared with the original.
- The first reading warning says the same.
- The four AI events have plain labels in History.
- Text PDFs, CSV and XLSX never go near the AI boundary, even with the switch on.

## Files

- **Migration:** `supabase/migrations/0116_supplier_statement_ai_boundary.sql`, with its rollback.
- **SQL tests:** `supabase/tests/supplier_statement_ai_boundary.test.sql` (36 checks).
- **Server — new:**
  - `src/server/supplier-statements/ai/statement-ai-provider.ts` (interface, switch, transcription contract);
  - `src/server/supplier-statements/ai/gateway-statement-provider.ts`;
  - `src/server/supplier-statements/ai/transcription-to-extraction.ts`.
- **Server — modified:**
  - `src/server/supplier-statements/validation.ts` (V9);
  - `src/server/repositories/supplier-statement-repository.ts`;
  - `src/server/services/supplier-statement-service.ts` (the attempt runs inside processing; manual entry is the
    fallback).
- **UI:**
  - `statement-lines-editor.tsx`;
  - `statement-review.tsx`;
  - `statement-types.ts`;
  - `src/lib/supplier-documents/statement-stages.ts`.
- **Tests:**
  - `src/server/supplier-statements/ai/statement-ai.test.ts`;
  - additions to the service, validation and statement-screen tests.

## Not in SD-3F

- Turning AI on.
- Any certification run against a real provider.
- Email intake.
- New intelligence or findings.
- Xero source tracking.
