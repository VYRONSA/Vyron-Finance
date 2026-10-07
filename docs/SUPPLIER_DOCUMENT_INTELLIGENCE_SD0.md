# Supplier Document Intelligence — SD-0 Security Hardening

**Status:** reviewed and approved by the owner (2026-10-07). Committed on branch
`security/sd0-supplier-capture-hardening` (from `de8397b`). Not pushed, not
deployed, and nothing applied to production. Production must move **0109 → 0110 →
0111** in that order; 0111 is never to be applied on its own.

SD-0 is security hardening only. It does not change any accounting calculation,
supplier balance, posting rule or bill approval.

## 1. Production migration state (checked read-only, 2026-10-07)

`supabase_migrations.schema_migrations` on the production project ends at
**`0109_certification_boundaries`**. **0110 is not applied.** The only query run
against production was that one `SELECT`.

## 2. What was wrong

### 2.1 Security-definer functions from 0107–0110 were callable by anyone

On Supabase, a new function is executable by `anon` and `authenticated`. Two
mechanisms grant this: the default `PUBLIC` grant, and the project's default
privileges, which grant `anon` and `authenticated` explicitly. Migrations
0107–0110 created eleven `SECURITY DEFINER` functions and revoked neither. None of
them checks who is calling.

This was measured on a sandbox built from the repository with Supabase's
real default privileges. All eleven were executable by `anon`, meaning anyone
holding the public anon key, with no sign-in. 0099 shows the correct pattern
(`0099:558-567`).

| Function | Migration | What a caller could do |
|---|---|---|
| `fn_ai_reserve_request`, `fn_ai_release_request`, `fn_ai_resolve_daily_cap` | 0107 | Use up, or give back, any company's daily AI budget |
| `fn_ai_classification_release_reservation` | 0107 | Give back classification reservations |
| `fn_ai_extraction_record_attempt` | 0108 | Record fake provider failures that open the AI circuit, which is shared by **all tenants** |
| `fn_ai_extraction_gate` | 0108 | Reserve extraction budget for any company |
| `fn_ai_certification_open_run` / `_reserve_call` / `_close_run` | 0109 | Open, reserve against and close certification runs |
| `fn_ai_certification_read_evidence` / `_record_evidence` | 0110 | Read or write certification evidence (full extraction payloads). **Not in production**, because 0110 is not applied. |

Production has 0107–0109, so the first nine are exposed there today.

### 2.2 Capture tables were protected by company membership alone

The tables `supplier_invoice_captures`, `_lines` and `supplier_line_mappings`
used `for all using (user_can_access_company(company_id))`. Any member of a
company could therefore use the API to:
- rewrite a capture's status, bill link, validation result or duplicate verdict
  (for example, clear a duplicate block before conversion);
- seed or overwrite learned GL/VAT mappings.

They could do this with no Purchasing permission at all.

Two further gaps:
- **Capture events:** any member could insert events under any `performed_by`
  name.
- **Cross-company references:** the foreign keys allowed a capture to point at
  another company's document, supplier or bill.

## 3. What changed

### Migration `0111_supplier_capture_security_hardening.sql`

**1. Function lockdown.**
- The eleven functions now have `revoke execute ... from public, anon, authenticated`
  and `grant execute ... to service_role`.
- Each step runs only if the function exists. On a production-shaped 0109 database
  it applies cleanly and skips the two 0110 functions.
- `fn_upsert_supplier_line_mapping` is `SECURITY INVOKER`. It is revoked from
  `anon` and kept for `authenticated`, because it runs under the caller's own RLS.

**2. `fn_session_actor_label()`.** Returns the session's email, or else its auth
id. This is the same rule as `getPerformedByLabel()`.

**3. Capture table policies.**

| Action | Requires |
|---|---|
| Read (`SELECT`) | `Purchasing:View` |
| Upload (`INSERT`) | `Purchasing:Create` |
| Change (`UPDATE`) | `Edit`, `Reject` or `Approve`, then the guard trigger decides what each may change |
| Delete | Not allowed (no policy) |

**4. Guard trigger (signed-in roles only).**

| Permission | What it allows |
|---|---|
| `Purchasing:Create` | A new capture that is empty and in `Uploaded`. `uploaded_by` is taken from the session. The document must belong to the same company. |
| `Purchasing:Edit` | Invoice number, dates, order reference and supplier (recorded as a `manual` match, same company only), and only while the capture is `NeedsReview` |
| `Purchasing:Reject` | `→ Cancelled`, with no other edits in the same change, and never once converted |
| `Purchasing:Create` + `Purchasing:Approve` | `NeedsReview → Converted`, with a bill from the same company. Refused for a blocked duplicate or an incomplete capture. `converted_by` and `converted_at` come from the session and the database clock. |

The guard also enforces:
- Extraction, validation and duplicate results can never be changed by a client.
- A capture's identity columns cannot change.
- A capture that is `Converted` or `Cancelled` can no longer be changed.

**5. Capture lines.**
- Read needs `View`.
- Corrections need `Edit`, and only while the capture is `NeedsReview`.
- Corrections cannot change printed or suggested values.
- Clients cannot insert or delete lines.

**6. Learned mappings.** Reading needs `View`. Writing needs `Create` +
`Approve`, because mappings are learned only from a conversion.

**7. Extraction attempts.** Reading needs `View` instead of membership.

**8. Capture events.**
- Clients have no direct `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`; reading needs
  `View`.
- Event rows are immutable for everyone, including the service role and the
  database owner. A `DELETE` is allowed only as part of a foreign-key cascade, when
  the source document or company is deleted.
- `fn_supplier_invoice_capture_record_event(company, capture, type, detail)` is
  for signed-in users. It has **no actor parameter**; the actor comes from the
  session. It accepts only `Queued`, `FieldCorrected`, `Cancelled` and
  `ConvertedToBill`, each with the permission and capture state it implies.
- `fn_supplier_invoice_capture_record_system_event(..., performed_by)` is for
  the service role only.

Rollback: `supabase/rollbacks/0111_supplier_capture_security_hardening_down.sql`.
It deliberately restores the old, exposed grants, and says so.

### Application

**`supplier-invoice-capture-repository.ts`** now separates two kinds of write.

*Under the caller's session:*
- reviewer actions: `updateCaptureAsReviewer`, `updateCaptureLine`;
- `recordCaptureEvent`, which no longer takes `performedBy`.

*Through a service-role `systemClient()`:*
- system results: `updateCaptureAsSystem`, `claimCaptureForExtraction`,
  `replaceCaptureLines`, `recordSystemCaptureEvent`;
- the AI gate and attempt log.

This mirrors `ai-classification-safety-repository.ts`. Without it, a user's
"Run Task Now" would fail once the gate was locked down.

**`supplier-invoice-capture-service.ts`** uses session calls for upload ("Queued"),
corrections, rejection and conversion, and system calls for everything else.

**`invoice-capture/[captureId]/route.ts`:** `cancel` now requires
**`Purchasing:Reject`** (previously `Purchasing:Edit`).

## 4. Behaviour changes to be aware of

**Rejecting a capture now needs `Purchasing:Reject`.**
- Among the seeded roles, Purchasing Manager has it. Bookkeeper and Accounts
  Payable Clerk do not (they hold View/Create/Edit).
- Practical impact today is nil, because the capture feature is dormant in
  production. An administrator can grant `Purchasing:Reject` to a role.

**Extraction and system writes now need the service-role key.** This is
`SUPABASE_SERVICE_ROLE_KEY`, which production already uses for the automation
runner and AI classification. If it is missing, those writes refuse rather than
falling back.

**Migration order.** Deploy 0110 and 0111 together, in order (`supabase db push`
does this).
- If 0110 were applied *after* 0111, its two evidence functions would be exposed
  again. This was verified on a sandbox.
- 0111 is idempotent, so re-running it corrects that.

## 5. Not changed (deliberately, or out of SD-0 scope)

- **Deleting the source document still cascades** and removes its capture and
  that capture's events. This needs `Purchasing:Delete` on the document.
  Whether a captured invoice's document should be undeletable belongs to SD-1
  ("preserve original documents").
- **The conversion approval amount** still uses the extracted header total. This
  is listed as an SD-1 fix.
- **Other pre-existing executable-by-PUBLIC functions** outside 0107–0110 (for
  example `fn_post_bank_transactions`, noted 2026-09-17) are outside this scope.

## 6. Verification

The sandbox is `public.ecr.aws/supabase/postgres:17.6.1.155`, the same version as
production. Migrations were applied as `postgres`, as in production.

| Check | Result |
|---|---|
| `supabase/tests/supplier_capture_security_hardening.test.sql` (new) | **174 / 174 pass** |
| Same suite before 0111, and after the rollback | Fails at the first function check, as it should |
| Existing SQL suites after 0111 | ai_classification_safety 121, ai_scope_budgets 43, atomic_rule_engine_posting 191, certification_call_ceiling 31, certification_evidence 15, document_number_sequences 26, rule_engine_security_hardening 56, supplier_invoice_capture_accounting_safety 27 — **all pass, identical to the pre-0111 baseline** |
| 0111 on a 0109-only database | Applies; all AI functions locked; 0110 functions skipped |
| 0111 applied twice / rollback then re-apply | Idempotent / restores, then re-hardens |

Run the suite with:

```
psql -v ON_ERROR_STOP=1 -f supabase/tests/supplier_capture_security_hardening.test.sql
```

`rule_engine_security_hardening` needs its documented `-v migration=` (0102) and
`-v down=` arguments.
