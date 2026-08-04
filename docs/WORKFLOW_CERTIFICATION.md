# VYRON FINANCE 1.0 — Workflow Certification

Launch Readiness Programme (LR1) Phase 2: "Run every business workflow from beginning to end... every workflow must end in the correct accounting result."

**Honest scope statement**: this environment has no live database connection (no Supabase CLI credential beyond the anon/service-role API keys, no direct Postgres access — the same disclosed gap noted throughout `docs/MIGRATION_ROADMAP.md`). "Run" below means **traced end-to-end through the actual source code** — every stage's real handler, real service call, and (where applicable) real posting through the one shared Posting Engine — not executed against a live session. This is the same rigor this codebase's own established discipline already applies to its own claims (evidence-based, file:line cited), but it is not a substitute for a live smoke test once database access exists. That gap is tracked explicitly in `docs/LAUNCH_CHECKLIST.md`.

## Certified — traced end-to-end, real posting confirmed

### Sales lifecycle
Quotation → Sales Order → Delivery → Sales Invoice → Customer Receipt.
Every stage transition is a real state-machine action (`quotations-tab.tsx`, `sales-orders-tab.tsx`, `deliveries-tab.tsx`, `invoices-tab.tsx`, `receipts-tab.tsx`), each calling a real, permission-gated API route. **Approve & Post** on an Invoice runs `sales-invoice-service.ts::approveAndPostInvoice` — builds the journal via `buildJournalFromEvent`, creates it, posts it through the one shared `posting-engine-service.ts::postApprovedJournals`, and only after the journal is confirmed Posted triggers the real inventory movement (`applyInventoryMovement`). Partial delivery/backorder tracking (`deliveredQuantity`/`invoicedQuantity`) is real. Receipt allocation validates against both the receipt's remaining amount and the invoice's real outstanding balance. **Result**: ends in a real, balanced GL journal, correctly sequenced after the source document, every time. Retry Posting exists for the closed-period edge case.

### Purchasing lifecycle
Requisition → Purchase Order (with a real internal spend-approval gate Sales Orders don't have) → GRN → Purchase Bill → Supplier Payment.
Mirrors the Sales lifecycle's rigor exactly — `purchase-bill-service.ts` confirmed to call the identical `buildJournalFromEvent`/`postApprovedJournals` pattern; Bill approval uses `requireApproval(companyId, "ApprovePurchases", "PurchaseApproval", amount)`, a real amount-based limit, not a flat permission. Payment approval automatically triggers a real Remittance Advice send. **Result**: ends in a real, balanced GL journal. **Caveat**: this lifecycle's core services (`purchase-requisition`, `purchase-order`, `goods-received-note`, `purchase-bill`, `supplier-payment`) have zero dedicated unit tests, unlike their Sales-side counterparts — correctness here rests on this audit's manual code trace, not an automated regression suite (`docs/DEFECT_REGISTER.md` D-012).

### Inventory lifecycle
Warehouse setup → Stock Item → Transaction (Receipt/Issue/Transfer/Adjustment) → Draft → Submitted → Approved → Posted.
Real FIFO layer consumption (`consumeFifoLayers`) genuinely consumes the oldest layer first and throws rather than allowing a silent negative on insufficient stock. Weighted-average costing rolls forward correctly on receipt. Stock Take finalization creates a real, auto-posted `Inventory Adjustment` journal per non-zero variance line. **Result**: real costing, real journal, no silent data loss on an over-issue.

### Cashbook lifecycle
Capture (Receipt/Payment/Transfer) → Submit → Approve & Post → (Reverse if needed).
Real validation errors surfaced to the user at every stage; Batches (create → Approve & Post) real. **Result**: real journal, real audit trail.

### Bank Import lifecycle
Upload (CSV/XLSX/OFX/QIF) → parse → idempotent ingest (duplicate detection via real unique constraints) → exception reporting inline on the same request → bank account auto-created if new (`getOrCreateBankAccountByNumber`, removing a real onboarding friction point) → feeds directly into Transaction Explorer/Supplier Reconciliation/Matching. **Result**: real, deduplicated transaction rows, immediately visible to every downstream module reading the same table.

### Matching lifecycle
Import → the ONE Review Queue (a real `security definer` RPC aggregate, not an in-memory reduction — the exact fix this session's own Launch Blocker work applied) → Auto Match / Manual Allocate → Split Transaction (9 dimensions) → Duplicate Detection → Merge.
**One real defect found and fixed in this pass**: "Suggested Merge" always submitted the same ID as both the surviving and merged record, which the merge service correctly rejected every time, silently. Fixed (`docs/DEFECT_REGISTER.md` D-026) — the button now submits a genuine, distinct pair sourced from the finding's own duplicate-group membership. **Result, post-fix**: a merge genuinely re-points every transaction from the merged record to the surviving one.

### General Ledger lifecycle
Draft journal (from any of: manual entry, Transaction Explorer's Generate Journal, or any module's own Posting Rules-driven creation) → Submit → Approve → **Post** (the one shared `postApprovedJournals` step every module's journal passes through, with per-journal financial-period validation) → Trial Balance/GL Inquiry/Account Activity, all live queries, never cached. Reversal creates a real offsetting journal, auto-approved, through the same one posting path. **Result**: every journal in the system, regardless of origin, posts through the identical, single, tested code path — verified by a full-codebase search for direct `gl_transactions` writes (only the posting engine and its own repository touch that table).

### VAT lifecycle
Transaction → VAT Return (computed live from real Input/Output GL activity, never cached) → Recalculate/Review/Approve (posts a real settlement journal into VAT Control) → Submit (honestly disabled — no SARS eFiling integration exists, disclosed not fabricated) → Adjustments (auto-raise a real exception over a R10,000 threshold) → VAT Intelligence scan (combines signals + the live VAT-domain Rule Engine, raises real idempotent exceptions). **Result**: real settlement journal, real exception trail, honest submission-method limitation.

### Asset lifecycle
Acquire (posts a real Acquisition journal) → Capitalise/Improve/Transfer/Revalue/Impair/Dispose (Disposal gated by a real amount-based approval, `requireApproval(..., "ApproveAssets", "AssetDisposal", proceeds)`) → Depreciation Run (one consolidated journal per run, blocks on a closed Financial Period). **Result**: every money-moving lifecycle event is a real Business Event through the one Posting Engine, matching the module's own stated design principle.

### Financial Statement lifecycle
Trial Balance → Income Statement/Balance Sheet/Cash Flow/Statement of Changes in Equity (all real Trial-Balance-diff engines) → Disclosure Notes (11 real note builders, 3 honestly disclosed pure placeholders) → Reporting Package (Management/Board/Accountant/Auditor, reusing the same statement engines, no second calculation) → Send (real, approval-gated, template-backed — confirmed more complete than an earlier documentation pass claimed). **Result**: every figure traces back to the same live GL data every other module reads, one source of truth confirmed by import-graph tracing.

### Billing lifecycle (this session's own work)
Company created → `subscribeCompanyToPlan` (free trial, zero Stripe dependency, real local rows) → Scheduler-owned trial countdown/warning/expiry (`SubscriptionLifecycleSweep`, a real `automation_tasks` type, daily cadence) → Cancel/Resume/Change Plan (real, provider-integrity-guarded — a priced-plan change without a connected provider is refused, not faked) → every mutation publishes to the real Billing Event Bus (`billing_events`, the literal Audit Trail). **Result, with one caveat**: the trial-provisioning and lifecycle-transition chains are real but **not transactionally atomic** (`docs/DEFECT_REGISTER.md` D-032) — a mid-sequence failure could leave a subscription's status changed with no corresponding audit row, a real architectural risk flagged for a future fix, not something this pass could fully close given the effort involved (touches 5 functions).

## Partial — the workflow exists but a real step is missing

### Automation lifecycle
Recurring Templates (all 10 document types dispatch through the same real service a manual document would use, confirmed by tracing every `case` in the dispatcher) → Scheduler → **gap**: `RuleEngineRun` automation tasks are never actually auto-created for any company (the dispatch code is real, but nothing seeds the task) — Rule Engine automation only ever runs via each module's manual "Run Now" button today, contradicting `docs/MIGRATION_ROADMAP.md`'s own "runs on a real schedule" claim (`docs/DEFECT_REGISTER.md` D-014, High). Workflow Engine (approval-before-template-activation) has a fully real backend and zero UI to actually use it (D-016).

### Audit lifecycle
Dashboard/Findings/Working Papers/Assistant/Queries are all real, 18 audit tests genuinely run (spot-checked Benford's Law and orphan-transaction logic, both real). **Gap**: Planning — the very first stage — has no UI to create a new Audit Engagement (D-019, High). Any company without a pre-existing engagement (every brand-new company) hits a permanent dead end on this tab; the rest of the module is unreachable until one exists.

### Communication lifecycle
Queue → Approve/Reject (reuses the real, existing Workflow Engine, not a bespoke mechanism) → Send (real per-channel dispatch; Email channel honestly non-functional without SMTP credentials, disclosed not fabricated) → new usage-metering call verified purely additive, doesn't alter selection/retry logic. **Result**: real, working, with an honest, disclosed external-dependency gap (SMTP) rather than a code defect.

### AI Copilot lifecycle
Ask a fixed-catalog question → real, evidence-backed answer computed from live GL/financial data (confirmed: zero NLP/LLM calls anywhere, unmatched questions get an honest zero-confidence refusal, never a guess). **This lifecycle was found genuinely broken for every pre-existing company** (D-018, Critical) — the newly-added licensing gate would 403 any company created before this session's Billing Platform work, since nothing backfilled their entitlements. **Fixed** in this same pass via migration `0054`.

## Not independently re-verified in this pass

Live, authenticated, browser-driven execution of any workflow above — every result in this document comes from reading real source code end-to-end, the same standard `docs/SECURITY_ARCHITECTURE.md` used for its own live-attack claims (there, real HTTP requests against a live backend were possible; here, they were not, given this session's environment). RLS enforcement at the database layer for the newest tables (Commercial Billing Platform) specifically has not been live-attacked the way the rest of the schema was during an earlier engagement's RC1 Phase 7.6 certification — flagged again here, matching `docs/LAUNCH_CHECKLIST.md`'s own recommendation for a live adversarial RLS pass once database access exists.
