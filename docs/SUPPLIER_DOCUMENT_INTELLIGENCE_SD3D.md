# Supplier Document Intelligence — SD-3D: supplier-statement reconciliation (read-only engine)

**Status:**
- Implemented on `security/sd0-supplier-capture-hardening`, on top of `8b90d69` (SD-3C).
- **Not pushed, not deployed, and not applied to production**, which remains at 0109.
- Production order: 0109 → 0110 → 0111 → 0112 → 0113 → 0114 → **0115**.

**Scope.** The reconciliation engine, persisted runs, reviewer decisions and API. **No UI** (SD-3E),
**no statement AI** (SD-3F), **no email intake**.

## Accounting rules (owner) and how each is enforced

| # | Rule | Enforcement |
|---|---|---|
| 1 | The supplier ledger is authoritative | **P** is the supplier ledger's balance at the statement date. The engine input is built with `party-ledger.ts`'s exact rules and **checked against `balancesAt(buildSupplierLedger(...))` to the cent**; on any disagreement the run is refused (`LedgerMismatchError`). |
| 2 | The ledger is never modified | Accounting tables are SELECT-only (service role, one company and one supplier). Tests check that no reconciliation module imports a posting, allocation or payment service, and that writes go only to reconciliation tables and the statement's status. |
| 3 | No journals, bills, payments, allocations or GL adjustments | No 0115 function writes an accounting table (SQL-checked). The end-to-end **accounting fingerprint** over journals, GL, bills, payments, allocations, bank transactions, opening balances and suppliers is unchanged after every run and decision. |
| 4 | Never match on amount alone | Matching needs a reference (T1/T2) or, for payments, amount **and** date **and** reference evidence (P1). |
| 5 | Amount + date only suggests | Reference containment (S1) and amount + date (S2) produce `suggestions` and never a match. |
| 6 | Multiple candidates stay ambiguous | More than one candidate in a tier → **Potential Duplicate / multiple-precisia**, with all candidates listed and none chosen. |
| 7 | Bank-paid supplier transactions are read directly | Posted bank `S` rows are ledger records and are matched like payments. The supplier-payment subledger is untouched. |
| 8 | Double supplier payment and bank transaction: flag only | **Potential Duplicate / double-recorded-payment**, unexplained until a person decides. Never netted, allocated or repaired. |
| 9 | Legacy unflagged bank postings stay unexplained | They are not ledger entries and are not read, so their effect remains in the difference. |
| 10 | Imported/Xero bills without a journal: **Imported — Not Posted** | See below. Never labelled "captured". |
| 11 | No balancing adjustment | There is no adjustment category (the CHECK constraint), and `D = Explained + Unexplained` is enforced by the database. Unexplained is shown as it is. |
| 12 | Every run is reproducible | Each run stores its **complete input snapshot**: statement, lines, ledger records, unposted records and decisions, plus their **SHA-256** and the engine version. `?verify=1` replays it and compares every result. Runs are immutable. |

### Missing in PRECISIA: how unposted bills are told apart

| Sub-status | Meaning |
|---|---|
| `not-captured` | No record anywhere. |
| `captured-draft` | It went through Supplier Document Capture: a capture still in the workflow, or the draft a capture was converted to (`capture.bill_id`). |
| `imported-not-posted` | Any other unposted bill. The item records the source: "Import Centre bill #…, no journal" or "Purchasing … bill #…, no journal (Xero-migrated or entered by hand)". |

**Open point.** The data has no marker that separates a Xero-migrated draft from one entered by hand: the
Xero import creates ordinary Purchasing drafts. Both are therefore *Imported — Not Posted*, never
*Captured*. Telling them apart would need a source marker on the Xero import, which is out of SD-3D's scope.

## The engine (`src/server/supplier-statements/reconciliation-engine.ts`, pure)

**Figures:**
- **S** = statement closing balance;
- **P** = ledger balance at the statement date;
- **D** = S − P;
- **Explained** = items with an identified cause, or a reviewer explanation;
- **Unexplained** = D − Explained;
- **residual** = D − Σ item effects. It is 0 for any validated statement; otherwise it is the statement's own arithmetic gap, which is reported and never forced.
- All figures are in integer cents.

**Window.** It starts at the statement period start, else the earliest line date. Ledger records before it
form the PRECISIA opening balance; the opening balance difference is itemised.

**Matching order (SD-3A §6.1):**
1. **T0** manual link;
2. **T1** exact reference with a compatible document type;
3. **T2** normalised reference (case and punctuation only; leading zeros kept), exactly one candidate;
4. **P1** payment: exact amount, ±7 days and a shared reference token.

S1 and S2 produce suggestions only. Each record matches at most one line. An **unknown** credit is tried as a
credit note **and** as a payment; its sign never decides which.

**Categories and sub-statuses:**

| Category | Sub-statuses |
|---|---|
| Matched | exact / normalised / manual / payment-evidence |
| Amount Difference | difference / vat-hint |
| Missing in PRECISIA | not-captured / captured-draft / imported-not-posted |
| Missing on Statement | in-period / timing / payment / payment-timing / opening-balance-entry |
| Potential Duplicate | statement-repeat / multiple-precisia / double-recorded-payment |
| Credit Note | matched / amount-difference / not-captured / captured-draft / imported-not-posted / missing-on-statement |
| Payment | matched / suggested / unmatched / timing |
| Unclassified | interest / adjustment / other / unknown-credit / manual-link-unavailable |
| Opening Balance Difference | opening |

**Explained by default:** Matched, Amount Difference, Missing in PRECISIA, Missing on Statement, Credit
Note, Payment.

**Unexplained until a reviewer explains them:** Opening Balance Difference, Unclassified, Potential Duplicate.

## Migration 0115 — `0115_supplier_statement_reconciliation.sql` (+ rollback)

| Object | Notes |
|---|---|
| `supplier_statement_reconciliations` | Immutable run. CHECKs: `D = S − P`; `D = Explained + Unexplained`; the window ends on the statement date. Stores `input_snapshot` and `input_fingerprint`. An **insert guard** (any role): the statement must be Ready or Reconciled, the supplier the **confirmed** one, the currency the base currency, and the closing balance and date the statement's own. |
| `supplier_statement_reconciliation_items` | Immutable. The category CHECK has **no adjustment category**. Its company must be the run's. |
| `supplier_statement_resolutions` | Append-only reviewer decisions: `manual-link`, `explained`, `revoke`. A reason is required, and the shape is checked. A line carrying decisions cannot be deleted. |
| `fn_supplier_statement_record_resolution` | Session actor (no actor parameter). Requires Purchasing:Edit and a Ready or Reconciled statement with a confirmed supplier. The line must belong to the statement; the referenced record must belong to **this company and this confirmed supplier**. A revoke must target a live decision of the same statement. |
| `Reconciled` status | Set by the server only. A reconciled statement can be reopened for review; it is not edited in place. New event types: ReconciliationRun, ResolutionRecorded, ResolutionRevoked. |
| Grants | anon: nothing. authenticated: SELECT only, plus execute on the decision writer. service_role: SELECT + INSERT on runs and items (no UPDATE or DELETE); SELECT only on decisions. Trigger functions: no execute for any role. |

## API (permission checked before anything is looked up)

| Route | Permission | Purpose |
|---|---|---|
| `GET …/supplier-statements/[id]/reconciliations` | View | Runs, decisions, and a `stale` flag when decisions are newer than the last run |
| `POST …/supplier-statements/[id]/reconciliations` | Edit | Run or rerun. Refusals return 409. |
| `GET …/reconciliations/[runId]` | View | Run and items; `?verify=1` replays the run |
| `POST …/supplier-statements/[id]/resolutions` | Edit | Manual link, explanation or revoke. A reason is required; no actor is taken from the body. |

## Tests and results

| Check | Result |
|---|---|
| `supabase/tests/supplier_statement_reconciliation.test.sql` | **53/53**: grants; run guards (ready, confirmed supplier, currency, own figures, both identities); immutability; the decision writer (session actor, permission, state, company, supplier, line, reason, revoke rules, no direct insert); status; RLS; accounting untouched; no 0115 function writes accounting |
| All SQL suites | **946/946** (13 suites) |
| 0115 rollback, then re-apply | Clean; the rollback restores 0114's guard and event writer verbatim |
| Engine | 27 tests: every category and sub-status; hierarchy; amount never alone; ambiguity; leading zeros; double-recorded payment; timing; manual link and revoke; explanations; **property tests**: a ledger-generated statement reconciles fully, and D = Explained + Unexplained with residual 0 on 60 random inputs |
| Input builder | Ledger rules equal `party-ledger`; legacy unflagged bank rows are excluded; captured vs imported classification |
| Service | Persistence of the snapshot and fingerprint; preconditions; exact replay and tamper detection; boundaries |
| Routes | Permission before anything else; refusals as 409; no actor from the body |
| Full app test suite (clean run) | **5,894 passed, 0 failed, 0 timeouts, 50 skipped** (the same 50 as before) |
| Typecheck, lint, `next build` | 0 errors; 0 lint errors (the 3 pre-existing warnings in unrelated files); build exit 0 |
| **End to end + accounting safety** (local Supabase stack, production build, real records for the supplier) | **31/31**. Covers: S 4 260.06, P 2 945.50, D 1 314.56 = Explained 714.56 + Unexplained 600.00; exact (leading zeros), normalised, bank-paid payment by evidence; credit-note difference; imported-not-posted; double-recorded payment flagged and not netted; timing; the legacy unflagged posting not read; Σ effects = D; **exact replay**; view-only and cross-company refused; a link to another supplier's bill refused; explain → rerun (Unexplained 0, 600 by the reviewer) → revoke → rerun (600 again); history kept; run 1 still reproduces; a stored run cannot be altered; reopen and Ready again; **accounting fingerprint unchanged after every run and decision**. |
