# VYRON FINANCE — Pilot Issue Register

A living record of every finding raised during Pilot Review rounds, tracked from discovery through live certification. This is distinct from `docs/DEFECT_REGISTER.md` (the pre-launch LR1 audit's D-XXX findings, closed before pilot testing began) — pilot findings use a separate `VR-XXX` sequence, opened by the Product Review Board's Pilot Review directives rather than a static code audit.

Maintain strict separation between pilot rounds: a round is certified and frozen (see `docs/PILOT_REVIEW_ROUND_1_COMPLETION_REPORT.md` and its eventual `v1.0.0-pilot1` tag) once its findings are Complete or explicitly Deferred. New findings after a round is frozen open under the next round, not retroactively inserted into a closed one — unless a genuine production defect is discovered in frozen work, per the Board's own instruction.

| Field | Meaning |
|---|---|
| Pilot ID | `VR-XXX`, assigned in discovery order, never reused |
| Priority | Critical / High / Medium / Low |
| Status | Open / In Progress / Complete / Deferred |
| Version Target | The release this must land in |
| Verification Method | Live / Unit Test / Integration Test |

---

## Pilot Review Round 1

### VR-001 — Opening Balances Centre: BankAccount-category postings never synced the bank account's own cached balance
- **Description**: `postOpeningBalances` correctly posted a BankAccount-category entry to the General Ledger (against the account's `glAccount` code), but never updated `ae_bank_accounts.opening_balance`/`current_balance` — the figures the Bank Accounts screen and reconciliation module actually display, which are cached separately from the GL rather than derived from it. The two would silently diverge: GL correct, Bank Accounts screen stale.
- **Priority**: High
- **Status**: In Progress — code-complete, pending live certification (Pilot Review Round 1, Phase B)
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05
- **Verified By**: Pending (Phase B live certification)
- **Verification Method**: Pending — will be Live (bank balance sync is explicitly on the Phase B checklist)
- **Commit Hash**: Pending (Commit 2)

### VR-002 — Company creation: a genuinely new user (no pre-existing platform-scope role) receives a 500 creating their first company
- **Description**: `createCompany`'s role-bootstrap step read the newly-seeded `company_owner` role via a plain client-side `SELECT` on `permission_roles`, then called `assign_company_role` — both independently require the caller to already have access to/a permission on a company that, by definition at that exact moment, has zero role assignments yet. A chicken-and-egg RLS problem, masked in every prior round of live verification because the test accounts used already held a platform-scope role that unconditionally satisfies both checks. A real first-time self-service signup — the product's actual onboarding path — would 500.
- **Priority**: Critical — blocks all new-customer self-service onboarding
- **Status**: In Progress — code fix + migration `0056` written; blocked on the migration being applied to the live database
- **Version Target**: 1.0 (Pilot Round 1)
- **Date Found**: 2026-08-05
- **Date Fixed**: 2026-08-05 (code); live certification pending migration application
- **Verified By**: Pending (Phase A live certification)
- **Verification Method**: Pending — will be Live (reproduced live with a fresh throwaway user holding no platform-scope role; same method will confirm the fix)
- **Commit Hash**: Pending (Commit 2)
