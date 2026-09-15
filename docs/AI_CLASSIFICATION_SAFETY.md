# AI Classification Safety — Implementation Specification

Status: implemented locally on branch `ai-sweep-safety` (migration `0099_ai_classification_safety.sql`), revised after the pre-deployment review. **Not deployed.** Northwood task #6 and Metanoia task #11 stay paused after deployment until a controlled test is explicitly approved.

## 1. Why

The production investigation on 2026-09-15 found three linked problems in the `AiClassificationSweep`:

1. **Re-ask loop.** A "no confident suggestion" answer left a transaction exactly as eligible as before, and nothing recorded that it had been attempted. The scheduler rescheduled the sweep in 2 minutes whenever a full batch of 20 came back. The same 20 oldest transactions were therefore sent to the AI about 560 times a day, roughly 11,000 provider requests a day.
2. **Blind failures.** Every provider error was collapsed to an anonymous "failed". A batch kept sending all 20 requests into a provider that was already refusing them. Nothing recorded the HTTP status or message.
3. **Endless task failure.** `max_retries` only switched the retry delay from 5 minutes to 1 hour. The task never stopped, and every failure raised a new critical alert and notification (about 24 a day).

## 2. Scope

This change **does**:
- add a per-transaction queue
- add a shared provider circuit breaker
- add a per-company daily safety fuse
- add structured attempt logging with an internal provider-request metric
- add a Suspended task state
- add de-duplicated alerts

It **does not**:
- modify `ae_bank_transactions` or any other accounting data
- change `fn_record_usage_event`, customer AI quotas, free-trial policy, subscription enforcement or automation-run limits (see `METERING_LICENSING_DECISION_NOTE.md`)
- change the AI provider, `AI_GATEWAY_API_KEY` or `VYRON_AI_MODEL`
- resume, pause or change any existing automation task

## 3. Three kinds of failure, handled separately

| Type | Examples | Handled by | Effect on the task |
|---|---|---|---|
| **A. Provider** | 401/402/403, missing key, 404 model/route, timeout, 5xx, network, 429 | Circuit breaker + batch stop | None: the run succeeds and reports the stop. One de-duplicated provider alert. |
| **B. Classification outcome** | No confidence, malformed answer, suggestion not among the offered accounts, answer that could not be saved | Queue (cooldown, then human review) | None |
| **C. Scheduler infrastructure** | Safety store unreachable, gate unusable, queue read failed, attempt could not be recorded, every attempt failed on the database | Scheduler retries, then **Suspended** | Run fails, retries apply, then suspension and one critical alert |

## 4. Data model (migration 0099)

### `ai_classification_attempts`: one row per attempt

Each row records:
- `company_id`, `transaction_id`, `task_run_id`, `source` (`sweep` / `import` / `manual`)
- `attempted_at`, `duration_ms`
- `outcome`: `suggested`, `allocated`, `no_confidence`, `invalid_response`, `provider_error`, `evidence_error` or `write_error`
- `provider_request_made`: true only when a request actually reached the provider, or was in flight to it
- `provider`, `model`, `error_category`, `http_status`
- `provider_message`: sanitized, at most 300 characters
- `usage`: only the token and cost figures the provider actually returned
- `performed_by`

### `ai_classification_queue_state`: one row per attempted transaction

No row means the transaction has never been attempted. Each row holds `state`, `attempt_count`, `unusable_result_count`, `last_attempt_at`, `last_outcome` and `next_eligible_at`.

| Attempt outcome | New state |
|---|---|
| `suggested` / `allocated` | `resolved`: never re-selected automatically, even if the suggestion is later removed |
| First unusable result: `no_confidence`, `invalid_response` | `cooldown` for **7 days** |
| First unusable result: `write_error` | `cooldown` for 1 day |
| Second unusable result, of any of those kinds | `needs_human_review`: never selected automatically again |
| `evidence_error` (no request was made) | `cooldown` for 1 day (a human-review hold is kept) |
| `provider_error` | Unchanged hold, otherwise `active`. A provider outage is not the transaction's fault. |

A transaction re-enters AI classification only through an explicit action:
- the user's **"Classify with AI"** (source `manual`), which is the "Retry AI": the gate does not hold it, but the circuit breaker and daily fuse still apply
- `fn_ai_classification_reset_queue_state`, for re-entering the automatic sweep

Nothing re-enters automatically.

### `ai_provider_circuit_state`: one shared row per scope

The scope is `transaction-classification`. The row holds `state` (`closed`/`open`), `consecutive_timeouts`, `consecutive_provider_failures`, `opened_at`, `open_reason`, `last_error_*`, `next_probe_at`, `probe_backoff_seconds` and `probe_in_flight_until`.

### `ai_provider_daily_usage`: one row per company per UTC day

It holds `reserved_requests`. The gate increments it atomically **before** a request is sent. If the attempt turns out not to have reached the provider, the reservation is given back. So the count is always at least the number of requests actually made.

### Changes to existing tables

- `usage_period_counters` metric check now includes `ai_provider_requests`
- `automation_tasks`: status `Suspended`, plus `suspended_reason` and `suspended_at`
- `operations_alerts`: `dedupe_key`, `occurrence_count` and `last_occurred_at`, with a unique index on `(company_id, dedupe_key)` while the alert is not Resolved

## 5. Database functions

| Function | Security | Callable by | Purpose |
|---|---|---|---|
| `fn_ai_classification_gate(company, transaction, source, now, cap=100, scope)` | definer | service_role | Called before **every** provider request, for one transaction. Returns `allow`, `probe`, `held`, `circuit_open` or `daily_cap` — see below. |
| `fn_ai_classification_record_attempt(..., probe)` | definer | service_role | Records the attempt, the queue transition, the internal usage event (or gives back an unused reservation) and the circuit transition, in one transaction. Rejects a transaction from another company. |
| `fn_ai_classification_candidates(company, limit, now)` | definer | service_role | The next sweep batch (see §7). |
| `fn_ai_classification_reset_queue_state(company, tx)` | definer | service_role | Explicit Retry AI for the sweep |
| `fn_ai_provider_circuit_status(scope)` | definer | service_role | Read-only circuit view |
| `fn_record_internal_usage_event(...)` | definer | service_role | Internal metrics only (`ai_provider_requests`). Refuses customer metrics. |
| `fn_raise_deduplicated_alert(...)` / `fn_resolve_deduplicated_alert(...)` | invoker | authenticated, service_role | Upsert and resolve an alert by `dedupe_key`, under the existing `operations_alerts` RLS (own company only) |

What the gate checks for the transaction, in order:
1. **Ownership:** the transaction must belong to the company.
2. **Queue hold:** for automatic sources, `held` if the transaction is in cooldown, needs human review, or is resolved.
3. **Circuit:** `circuit_open` if the circuit is open and no probe is due.
4. **Daily fuse:** `daily_cap` if the conditional reservation fails.
5. **Probe:** if the circuit is open and a probe is due, the probe is claimed atomically.

The cap argument can only lower the fuse. The SQL enforces a maximum of 100.

The application calls the AI safety functions only with the service-role client (`ai-classification-safety-repository.ts`), whatever the caller's context. If the service role is not configured, or the gate answers with anything unrecognised, the repository throws, and the service sends nothing: it **fails closed**.

## 6. Per-transaction flow

`transaction-classification-service.ts::runClassificationBatch` is the only place a classification provider is called. The sweep, the post-import/bank-sync path and "Classify with AI" all reach it. For each transaction in the batch, in order:

1. **Gate.**
   - **held:** skip the transaction without recording it; the rest continue.
   - **circuit_open or daily_cap:** stop the batch; nothing more is sent.
   - **Gate call fails or returns an unknown decision:** stop with `safety_unavailable`, a type C failure.
   - **allow or probe:** these are the only decisions that proceed.
2. **Evidence.** Build the evidence. A failure is recorded as `evidence_error`, with **no provider request counted**, and the reservation is given back.
3. **One provider request.**
   - The SDK's own retries are disabled (`maxRetries: 0`), so one attempt is exactly one request.
   - **Missing key:** if `AI_GATEWAY_API_KEY` is missing or blank, the provider refuses before any network activity. Otherwise the Gateway SDK would fall back to a Vercel OIDC token and still send.
4. **Validate and write.** Validate the answer, and write a `Suggested` suggestion only when accounting confidence allows (Phase 28 unchanged).
5. **Record.** Record the attempt with the same timestamp as the gate, marking a probe as the probe. If recording fails, stop with `recording_failed`, a type C failure.
6. **Stop if needed.** Stop the batch on a 429 (`rate_limited`) or on any other provider-level failure (`provider_failure`). The remaining transactions are not sent.

### How each error is classified

`safety-policy.ts::classifyClassificationFailure` makes the decisions:

| Category | HTTP | Circuit signal | Stops batch | Counted as a provider request |
|---|---|---|---|---|
| unauthorized / payment-required / forbidden / configuration | 401 / 402 / 403 / 404 | auth: open now | yes | yes |
| missing-api-key | — | auth: open now | yes | no |
| timeout | 408 / abort | timeout | yes | yes |
| server-error | 5xx, 424 | provider_failure | yes | yes |
| network | — | provider_failure | yes | no |
| rate-limit | 429 | rate_limit (no change) | yes | yes |
| malformed-response / invalid-suggestion | — | success (the provider answered) | no | yes |
| unknown (not a provider error) | — | none | no | no |

## 7. Sweep selection and cadence

`fn_ai_classification_candidates` uses the same eligibility as `listAiClassificationEligibleTransactions` and `fn_apply_ai_classification`. It additionally excludes:
- `cooldown`, before `next_eligible_at`
- `needs_human_review`
- `resolved`

The order is:
1. never attempted
2. least recently attempted
3. oldest transaction date

The batch is 20. `hasMoreEligible` comes from asking for 21. The gate repeats the queue hold for every automatic request, so a transaction passed in by another path (for example post-import) cannot bypass it.

`scheduler-service.ts::nextTaskRunAt` sets when the sweep runs next:

| Last run | Next run |
|---|---|
| Rate-limited | Retry-After, bounded to 15 s – 5 min (unchanged) |
| At least one suggestion **saved** and more eligible | **2 minutes** |
| Anything else: no progress, no-confidence only, failures, circuit open, daily cap, nothing eligible | 1 hour |

Being "still eligible" alone never brings the sweep back in 2 minutes.

## 8. Circuit breaker

The circuit is shared by all companies, and every path uses it: sweep, import and manual.

When the circuit opens:
- **Opens immediately:** auth or configuration failures (401, 402, 403, 404, missing key).
- **Opens after 3** consecutive timeouts, or **after 5** consecutive 5xx or network failures. Counters are updated under a row lock, so they cannot regress. Any successful answer resets both.
- **429** alone never opens it.

While it is open:
- **No requests** are sent, from any company or any path.
- **First probe** is allowed 1 hour after opening. The gate claims it with a conditional `UPDATE`, so exactly one caller gets it even under concurrency. Every other caller gets `circuit_open`, and any reservation it made is given back. The claim lasts up to 10 minutes.
- **A failed probe** doubles the wait: 2 h, 4 h, 8 h, 16 h, then a **24 h maximum**. A successful probe closes the circuit and resets it.
- **Late failures:** a failure from a request that was already in flight when the circuit opened is not a probe. It updates only the last-error details and never escalates the backoff.
- **Probe that sent nothing:** if the probe never reached the provider (for example the evidence read failed), the claim is released so the next request can probe.

## 9. Internal daily safety fuse

The fuse is **100 provider requests per company per UTC day**. `usage_day` is `p_now` converted to UTC.
- It is an internal fuse, not the customer's contractual quota.
- It holds under concurrency, because each request reserves a slot with a conditional `UPDATE` before it is sent. The scheduler, "Classify with AI" and imports racing for the same company can never exceed 100 between them.
- When it is reached, the batch stops with `stoppedReason: "daily_cap"`.
- The run summary shows `requestsToday` and `dailyCap`.
- **One** de-duplicated warning alert is raised, never one per blocked transaction.

## 10. Task failure, suspension and alerts

The scheduler handles task failures and alerts:

- **First failure of a streak:** one warning notification, "failed — retrying". The next retry is in 5 minutes.
- **Only infrastructure failures consume retries.** Provider failures, an open circuit, the daily fuse, rate limits and no-confidence answers are successful runs, and they reset the retry count.
- **Retries exhausted** (`retry_count >= max_retries`): the task becomes **Suspended**, is made **inactive**, and gets a reason and timestamp.
  - `listDueTasks` only selects active Queued, Success and Failed tasks, so a Suspended task never runs.
  - ONE critical alert is raised with `dedupe_key = automation-task:<id>:failing`, and a notification is sent when the alert is created.
  - A stale-Running reclaim that exhausts retries does the same.
- **Repeats** update the same alert (`occurrence_count`, latest message) and send no new notification.
- **Escalation:** one notification when the alert reaches 24 occurrences.
- **Recovery:** a successful scheduled run after failures resolves the task's alert and sends one info notification.
- **Resume:** the Resume action works on Paused or Suspended tasks. It gives the task a fresh retry budget and clears the suspension. Nothing resumes automatically.
- **Run Now** (existing behaviour, unchanged):
  - It can still run a Paused, Disabled or Suspended task once.
  - That run goes through the same sweep, gate, circuit and fuse.
  - It no longer changes the task's status: the task stays stopped and needs Resume.
- **AI sweep alerts:**
  - A provider stop or open circuit raises `ai-classification:provider-unavailable` (critical).
  - The daily fuse raises `ai-classification:daily-cap` (warning).
  - Both are resolved by the next run in which the provider answers normally.

## 11. Error capture and secrets

`sanitizeProviderMessage` is applied before any provider or infrastructure message is stored, returned, put in a run summary, a suspension reason or an alert. It removes:
- the configured `AI_GATEWAY_API_KEY` value
- the transaction's own description, beneficiary and reference
- credentials in URLs
- whole `Authorization` values, whatever the scheme; `Bearer` and `Basic` tokens
- the values of `api_key`, `x-api-key`, `token`, `secret`, `password`, `cookie`, `session`, `signature` and OIDC-token fields
- `vck_`, `sk-`, `sb_secret_` and similar key shapes, JWTs, and long mixed alphanumeric tokens
- JSON request and response bodies; only a provider `"message"` value inside them survives
- long quoted strings

It then collapses whitespace and truncates the **final** text to 300 characters. The database also enforces the 300 limit.

For malformed answers and invalid suggestions, a **fixed** description is stored, never the model's raw answer. Raw provider payloads, request headers and prompts are never stored. `usage` holds only `inputTokens`, `outputTokens`, `totalTokens` and the gateway `cost`, and only when reported. A 429's Retry-After is bounded to 15 s – 5 min before it is stored or used.

The sweep run summary includes:
- `providerRequests`, `stoppedReason`, `errorCategory`, `httpStatus` and `providerMessage`
- `circuitState`, `requestsToday`, `dailyCap` and `heldByQueue`
- counts of invalid, provider and database failures

This is enough to diagnose a failure without reading source code.

## 12. Internal usage metric

`ai_provider_requests` counts every actual provider request:
- confident results
- no confidence
- provider failure after the request
- malformed and validation failures
- write races after an answer

It does not count failures before the request (evidence or database errors, missing key, network with no response).

It is recorded exactly once per request, inside `fn_ai_classification_record_attempt` through `fn_record_internal_usage_event`, which works for the unattended scheduler (service role). Customer `ai_requests` metering is unchanged.

## 13. Access control (RLS and privileges)

| Object | Company members | anon | service_role |
|---|---|---|---|
| `ai_classification_attempts` | read own company | nothing | read; **no direct writes** |
| `ai_classification_queue_state` | read own company | nothing | read; **no direct writes** |
| `ai_provider_circuit_state` | no access | no access | **no direct access** (functions only) |
| `ai_provider_daily_usage` | no access | no access | **no direct access** (functions only) |
| `fn_ai_*`, `fn_record_internal_usage_event` | no execute | no execute | execute |
| `fn_raise/resolve_deduplicated_alert` | execute, own company only (RLS) | no | execute |

Production's default privileges grant everything on new tables and functions to anon, authenticated and service_role. The migration therefore revokes explicitly and grants only what is listed above.

## 14. Accounting boundary

AI classification only ever suggests. The one write path is still `fn_apply_ai_classification` with target `Suggested`: High-confidence auto-allocation is still paused. That function sets only these fields, on an untouched Unallocated row, and writes one allocation-history row:
- `suggested_gl_account`
- `allocation_status`
- `allocation_method = 'Future AI'`
- `allocation_type = 'G'`
- `is_manual_override = false`

The safety functions contain no writes to accounting tables; the database tests check this. AI classification never:
- posts, reconciles or creates journals
- changes amounts, VAT or source data
- deletes transactions
- alters an existing allocation

## 15. Tests

All tests use synthetic or local data and fake providers. No AI provider request is made.

| File | What it covers |
|---|---|
| `src/server/ai/transaction-classification/safety-policy.test.ts` | Categorisation, sanitisation (including hostile inputs), Retry-After bounds, usage extraction |
| `src/server/services/transaction-classification-service.test.ts` | Gate whitelist, queue holds, stop rules, recording, probe marking, usage counting, secrets, manual path, queue order |
| `src/server/services/scheduler-service.test.ts` | Cadence, Suspended, de-duplicated alerts and notifications, recovery, resume, Run Now status preservation, retries consumed only by infrastructure failures |
| `src/server/ai/providers/gateway-provider.test.ts`, `.../gateway-classification-provider.test.ts` | HTTP status mapping, `RetryError`, `maxRetries: 0`, usage, missing-key refusal with no request |
| `src/server/services/automation-dashboard-summary-service.test.ts` | New run categories |
| `supabase/tests/ai_classification_safety.test.sql` | The database half, in one rolled-back transaction: queue transitions and gate holds, reservations and give-backs, fuse exactness (100 vs 101, cannot raise, UTC boundaries), circuit and probe rules, ordering and isolation, a 30-day simulation of the historical loop and Metanoia 101, tenant isolation in both directions, privileges, alert de-duplication, Suspended, the accounting boundary |
| `src/server/services/ai-classification-safety.scenario.test.ts` | End to end against a local stack: the real service and `nextTaskRunAt` on a simulated clock (historical loop, Metanoia 101, circuit), plus **real concurrency**: 150 parallel gate calls give exactly 100 allowed, for each of two companies at once; exactly one probe among 25 callers; a sweep and "Classify with AI" racing at 90/100 send exactly 10. Skipped unless `AI_SAFETY_LOCAL_SUPABASE_URL` (localhost only) and `AI_SAFETY_LOCAL_SERVICE_ROLE_KEY` are set. |

## 16. Deployment and first controlled test (for review, not done)

1. Apply migration 0099. It is additive and re-runnable, and changes no existing rows. Its constraint names were checked against production (read-only).
2. Deploy the application.
3. Confirm that tasks #6 and #11 are still inactive. Do not use "Run Now" on them.
4. With approval, resume task #6 once. If the provider is still failing, expect:
   - exactly one provider request, recorded with its HTTP status and sanitized message
   - the circuit opens, and one provider-unavailable alert is raised
   - the batch stops, and the sweep waits an hour before the probe
5. Fix the provider, then let the probe close the circuit. Watch `requestsToday` against the fuse of 100.

## 17. Known limitations and open decisions

- **Fixed constants.** The thresholds are constants: fuse 100, cooldown 7 days, circuit 3/5, probe from 1 h up to 24 h. They are not configurable, by design for now.
- **Retry-After ceiling.** A provider Retry-After longer than 5 minutes is shortened to 5 minutes (the existing ceiling). Each such retry is one request that stops at the next 429, and the daily fuse bounds it. Honouring longer values is a policy decision.
- **In-flight requests when the circuit opens.** Requests already past the gate when the circuit opens still complete; they cannot be recalled.
- **One transaction that always errors.** A transaction that always triggers a provider 5xx stays `active`. It is retried when reached, and five in a row open the global circuit. The fuse bounds it; a per-transaction provider-error limit is a policy decision.
- **Run Now.** It can still trigger a Paused or Suspended task once (with all safety controls). Blocking it is a product decision.
- **VYRON AI (copilot).** It uses the same gateway and key through `vyron-ai-engine.ts` and is not behind this gate. It is user-initiated and plan-limited. Whether it should share the circuit breaker is a decision.
- **No UI yet.** There is no UI yet for queue state, attempts, circuit status, or "Retry AI" into the sweep queue.
- **Customer metering.** Customer metering and licensing are unchanged. See `METERING_LICENSING_DECISION_NOTE.md`.
