# METANOIA-CORR-2026-10 — repair kit

Approved, one-off accounting correction for one company (`45b3d2a0-3973-4587-a043-0e05d8d9bff3`), executed in production on **2026-10-21 at 10:17:40 UTC** under owner authorisation `OWNER-APPROVAL-METANOIA-2026-10-21`. Release note: `docs/SALES_POSTING_INTEGRITY_0121.md`.

What it corrected:
- ten credit-note journals posted with inverted signs (imported from Xero with negative figures before migration 0121): each reversed by an exact mirror on its original date, the document re-signed to positive figures, and the correct DR Sales Returns / DR VAT Output / CR Debtors journal posted and linked;
- one duplicate sales-invoice journal (double approval race): reversed; the linked journal kept;
- two supplier credit notes stored negative: re-signed only (no approval, no journal).

One transaction; refuses unless an approver **and** an approval reference are set, the run marker is absent, and every affected row equals the embedded baseline; never deletes; checks its own result before committing. A counter-correction (recovery) script restores the exact prior state without deleting history.

## Files

| File | In git | Purpose |
|---|---|---|
| `2026-10-21_metanoia_sign_and_duplicate_correction.template.sql` | yes | Correction body (`__BASELINE__` placeholder) |
| `2026-10-21_metanoia_sign_and_duplicate_correction_recovery.template.sql` | yes | Recovery body |
| `build-metanoia-correction.mjs` | yes | Embeds a baseline JSON and writes the bodies, the run wrappers, the read-only baseline check and the local test fixture |
| `repair-test.LOCAL-ONLY.sh`, `repair-test-reset.LOCAL-ONLY.sh` | yes | Local tests on a disposable replica database (`repair_test`) — never production |
| generated `*.sql` (bodies, `repair-*.sql`, `*.LOCAL-ONLY.sql`) | **no** (`.gitignore`) | They embed a snapshot of production records |
| baseline JSON | **no** | Read-only capture of the affected production rows |

The generated files are not committed because they embed production records. The executed copies and the baseline are kept outside the repository with the release evidence. Regenerating from this folder with the same baseline reproduces them byte for byte (verified 2026-10-21).

## Executed fingerprints (sha256, first 16 hex)

| File | sha256 |
|---|---|
| Baseline JSON (captured 2026-10-21T09:12:38.485Z) | `109d5460489e61fe` (as embedded) |
| Correction body | `fae54b0454ad50bf` |
| Recovery body | `a38906e9a3446a84` |
| `repair-dryrun.sql` | `674165fe10720cb3` |
| `repair-apply.sql` (reviewed, before the approver lines were filled) | `db90b09d5c47bd10` |
| `repair-apply` as executed (approver + reference filled) | `9818fdb85657fd41` |
| `repair-recovery-dryrun.sql` / `repair-recovery-apply.sql` | `56d7fbbdc21d8687` / `d32393382fb44a45` |
| `repair-baseline-check.sql` | `9b29c8237ec8ce1f` |

## Re-running the tests (local only)

```bash
node build-metanoia-correction.mjs <baseline.json> .
bash repair-test-reset.LOCAL-ONLY.sh      # disposable DB repair_test in the local Supabase container
bash repair-test.LOCAL-ONLY.sh            # 43 checks; expect "43 passed, 0 failed"
```

The run marker (`METANOIA-CORR-2026-10:` in `automation_audit_log.reason`) is now set in production, so the correction can never run there again; any further correction needs a new run id and its own approval.
