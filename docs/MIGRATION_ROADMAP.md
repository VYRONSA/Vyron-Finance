# Migration Roadmap

The Product Review Board's "Phase 2 – Financial Workspace Migration"
instruction superseded the original Part 11 module order with a more
granular one; **the table below reflects that current, authoritative
order** ("Do not change this sequence without Product Review Board
approval"). "Reference" points to the desktop app screen(s) the web module
must remain recognisable against — not a 1:1 code port, since the desktop
app's business logic already exists and only needs an API in front of it.

| # | Module | Status | Web location | Reference (`finance_recovery_tool/ui/`) |
|---|---|---|---|---|
| — | Authentication | UI/logic complete, blocked on Supabase credentials | `src/app/(auth)/*`, `src/proxy.ts` | — (new capability, no desktop equivalent) |
| — | Platform | Real company list/create, backed by Company Management below | `src/app/platform/*` | — (new capability, no desktop equivalent) |
| — | Company Management | Complete — see "Company Management status" below. Not part of the original 14-module list (added per the Master Development Instruction's own "CORE ACCOUNTING PLATFORM" listing); do not confuse with Module 14 "Settings" below, which is the legacy diagnostics screen, not company configuration | `src/app/platform/new-company/*`, `src/app/company/[companyId]/settings/*`, `src/server/services/company-service.ts`, `financial-year-service.ts`, `org-master-data-service.ts`, `currency-service.ts`, `vat-treatment-service.ts` | `accounting_engine/company_service.py`, `accounting/period_manager.py`, `accounting_engine/vat_codes.py` |
| — | Dashboard | Built, polished as the platform's master design reference | `src/app/company/[companyId]/dashboard/page.tsx` | `dashboard.py`, `recovery/status.py` |
| — | Supplier Reconciliation | Complete (Module 1 under the original order) — see "Supplier Reconciliation status" below | `src/app/company/[companyId]/supplier-reconciliation/page.tsx` + `src/server/accounting/*` | `reconciliation_centre_screen.py` |
| — | Commercial Platform: Customer Management | Complete — see "Customer Management status" below. Not part of the original 14-module list (PRB's "Commercial Platform" instruction, Module 1 of that set) | `src/app/company/[companyId]/customers/*`, `src/server/services/customer-service.ts`, `customer-financial-service.ts` | — (no reference-app equivalent — Customers didn't exist in either backend) |
| — | Commercial Platform: Supplier Management | Complete — see "Supplier Management status" below. Extends the real `ae_suppliers` table (Supplier Reconciliation) rather than replacing Module 4 "Suppliers" below | `src/app/company/[companyId]/suppliers/*`, `src/server/services/supplier-management-service.ts`, `supplier-financial-service.ts` | `merchant_profile_dialog.py` (supplier side) |
| — | Commercial Platform: Sales | Complete — see "Sales Platform status" below. Module 3 of the Commercial Platform set; the first real caller of the Posting Rules engine General Ledger seeded but left uncalled | `src/app/company/[companyId]/sales/*`, `src/server/services/{quotation,sales-order,delivery,sales-invoice,customer-receipt,sales-summary}-service.ts` | — (no reference-app equivalent — Sales didn't exist in either backend) |
| — | Commercial Platform: Purchasing | Complete — see "Purchasing Platform status" below. Module 4 of the Commercial Platform set; the mirror image of Sales on the AP side. Extends `ae_imported_bills` (Supplier Reconciliation) additively rather than creating a competing "purchase_bills" table | `src/app/company/[companyId]/purchasing/*`, `src/server/services/{purchase-requisition,purchase-order,goods-received-note,purchase-bill,supplier-payment,purchasing-summary}-service.ts` | — (no reference-app equivalent — Purchasing as a distinct workflow didn't exist in either backend) |
| — | Commercial Platform: Inventory (non-manufacturing) | Complete — see "Inventory Platform status" below. Module 5 of the Commercial Platform set; real FIFO costing, real Posting Engine integration for every stock movement, and the Sales/Purchasing lines extended (not duplicated) with an optional `stock_item_id`. Manufacturing is explicitly out of scope — belongs to VYRON COST, reachable only through the new Integration Centre stub | `src/app/company/[companyId]/inventory/*`, `src/server/services/{warehouse,stock-item,inventory-transaction,stock-take,inventory-intelligence,inventory-summary,integration}-service.ts`, `src/server/inventory/costing.ts` | — (no reference-app equivalent — Inventory as a distinct workflow didn't exist in either backend) |
| — | Banking Automation & Rule Intelligence Platform | Complete — see "Banking Automation & Rule Intelligence status" below. Module 6 per the Product Review Board's own naming. Its Rule Engine (`server/banking-rules/rule-engine.ts`) is now the platform's ONE Rule Engine — generalized across every automation domain by Module 7 below, not superseded or duplicated | `src/app/company/[companyId]/banking-rules/*` (now titled "Automation Rules" in the UI), `src/app/company/[companyId]/banking-exceptions/*`, `src/server/banking-rules/*`, `src/server/services/{banking-rule,merchant,banking-exception,rule-processing,banking-summary}-service.ts`, `src/server/import-centre/{ofx,qif,bank-statement-xlsx}-parser.ts`, `bank-statement-adapter-registry.ts` | — (no reference-app equivalent — the Python reference's rule matching was hardcoded, not data-driven) |
| — | Recurring Transactions & Autonomous Automation Platform | Complete — see "Automation Platform status" below. Module 7 per the Product Review Board's own naming; Recurring Documents (10 types), the Automation Scheduler (the one shared queue every scheduled activity runs through), the Workflow Engine, the Notification Centre, and the Automation Dashboard | `src/app/company/[companyId]/{recurring-templates,automation-dashboard}/*`, `src/server/automation/*`, `src/server/services/{recurring-template,scheduler,workflow,notification,automation-audit,automation-dashboard-summary}-service.ts` | — (no reference-app equivalent — the Python reference has no scheduler, workflow engine, or notification system) |
| — | VAT Intelligence & Tax Compliance Platform | Complete — see "VAT Intelligence status" below. Module 8 per the Product Review Board's own naming; supersedes Module 11 "VAT" below. Real VAT type taxonomy + effective-dated rate history on the existing `vat_treatments`/`VatTreatment`, VAT Returns generated from live GL data, VAT Intelligence, and the VAT Exception Centre | `src/app/company/[companyId]/vat/*`, `src/server/vat/*`, `src/server/services/{vat-return,vat-adjustment,vat-exception,vat-rule,vat-summary,vat-transaction,vat-exception-scan}-service.ts` | `vat_coding_screen.py`, `vat_reports_screen.py` |
| — | Financial Reporting & Executive Intelligence Platform | Complete — see "Financial Reporting & Executive Intelligence status" below. Module 9 per the Product Review Board's own naming; supersedes Module 12 "Reports" and expands Module 13 "Financial Intelligence" below. Income Statement/Balance Sheet/Cash Flow generated from Trial Balance snapshots, Management Reports (Budget vs Actual), a Report Designer, one shared Forecast Engine, Executive Alerts, and the Executive Command Centre on Dashboard | `src/app/company/[companyId]/reports/*`, `src/server/reporting/*`, `src/server/services/{financial-statements,forecast,executive-alert,executive-intelligence,budget,report-definition,org-master-data}-service.ts` | `reports_screen.py`, `general_ledger_reports_screen.py`, `financial_intelligence_export_dialog.py` |
| — | Auditor Workspace & Audit Intelligence Platform | Complete — see "Auditor Workspace status" below. Module 10 per the Product Review Board's own naming; the platform's flagship differentiator. Audit Planning (Engagements/Areas/Programmes/Risk Register/Team), an Audit Dashboard, 18 automated Audit Tests, auto-generated Working Papers, Audit Intelligence (composed from existing Intelligence modules, no new AI engine), an evidence-backed AI Audit Assistant, and reusable Auditor Queries | `src/app/company/[companyId]/auditor/*`, `src/server/audit/*`, `src/server/services/audit-{engagement,test,intelligence,working-paper,assistant,query,finding,dashboard-summary}-service.ts` | — (no reference-app equivalent — an Auditor Workspace never existed in either backend) |
| — | Fixed Assets & Asset Intelligence Platform | Complete — see "Fixed Assets status" below. Module 11 per the Product Review Board's own naming; the final major accounting subsystem before AI Executive Copilot and GAAP Financial Statements. Asset Register (Classes/Category/Group/Location/Custodian/Warranty/Insurance), one Depreciation Engine (Straight Line/Diminishing Balance/Units of Production/Custom), full Asset Lifecycle (Acquisition/Capitalisation/Improvement/Transfer/Revaluation/Impairment/Disposal/WriteOff/Retirement, every money-moving event a real Business Event through the one Posting Engine), Asset Intelligence (10 signal types), and Auditor Workspace integration via a new `AssetRisk` Audit Finding type | `src/app/company/[companyId]/assets/*`, `src/server/assets/*`, `src/server/services/asset-{register,intelligence,dashboard-summary}-service.ts`, `depreciation-run-service.ts` | — (no reference-app equivalent — Fixed Assets never existed in either backend) |
| — | AI Executive Copilot & Financial Intelligence Platform | Complete — see "AI Executive Copilot status" below. Module 12 per the Product Review Board's own naming; a consumer of the existing Intelligence Layer, not a new AI engine. Executive Q&A over a fixed, evidence-backed catalog of 10 questions, a Financial Narrative Engine (Month-End/Quarter-End/Year-End/Board Pack/Management Report/Cash-Flow Commentary/Budget Variance/Profitability, all separating Facts from Interpretations), isolated What-If Scenario modeling (6 scenario types, never touches live accounting data), and a daily Executive Briefing composed from already-computed Financial Health/Business Risk/Audit Readiness/Compliance/Asset Health scores | `src/app/company/[companyId]/copilot/*`, `src/server/copilot/*`, `src/server/services/{copilot-assistant,narrative,scenario,executive-briefing}-service.ts` | — (no reference-app equivalent — an AI Executive Copilot never existed in either backend) |
| — | GAAP-Compliant Financial Statements & Disclosure Engine | Complete — see "Financial Statements & Disclosure Engine status" below. Module 13 per the Product Review Board's own naming — the final major functional module before production hardening. A 4th primary statement (Statement of Changes in Equity, reusing the Income/Balance Sheet/Cash Flow engines' own two-Trial-Balance-snapshot technique), a Disclosure Engine (11 note types, real data where it exists, honest placeholders where it doesn't), Reporting Packages (Management/Board/Accountant/Auditor, each reusing the existing statement/narrative generators), and the closing links of the audit drill-through chain (Working Paper → Audit Finding) surfaced on the existing Account Activity page | `src/app/company/[companyId]/financial-statements/*`, `src/server/disclosures/*`, `src/server/reporting/{equity,audit-trail-link,reporting-package,reporting-readiness}-engine.ts`, `src/server/services/{disclosure,reporting-package,reporting-readiness,audit-evidence}-service.ts` | — (no reference-app equivalent — a Disclosure Engine never existed in either backend) |
| — | Cashbook & Bank Reconciliation Platform | Complete — see "Cashbook & Bank Reconciliation status" below. Built in response to the Product Review Board's own Workflow Completion Audit, which found no Cashbook workspace and no Bank Reconciliation workspace anywhere in the platform. Receipts Cashbook/Payments Cashbook/Enquiry are real views over the SAME `ae_bank_transactions` object Import Centre already populates; Cashbook Capture/Batches/Approval/Posting/Reversal, a real Bank Transfer between two of the company's own bank accounts, and a full Bank Reconciliation workspace (outstanding items, auto/manual matching, a real Bank Balance vs. GL Balance difference, history, re-open, month-end lock) are genuinely new | `src/app/company/[companyId]/cashbook/*`, `src/server/banking/*`, `src/server/services/{cashbook,bank-reconciliation}-service.ts` | — (no reference-app equivalent — the reference's own Cashbook/reconciliation screens were never ported to this platform) |
| — | Matching Platform | Phase 1–6 complete (Engine + Review Queue + Workspace UI + Copilot integration + Rule Learning + Customer/Supplier Matching + full-coverage Duplicate Detection + all-dimension Split Transactions + module-rewiring audit + a real 16-stage Acceptance Test + a full 24-workspace Sidebar Audit) — see "Matching Platform status" and "Matching Platform — Phase 3 status in detail" below. Phase 7 (Production Readiness Report) is the only remaining directive item. Module 14 per the Product Review Board's own naming; "the consolidation module that turns VYRON FINANCE into one integrated accounting platform." One Matching Engine, one Confidence Engine, one live-aggregated Review Queue, real Customer/Supplier allocation matching, Duplicate Detection across all 12 named entity types, Split Transactions across all 9 allocation dimensions | `src/app/company/[companyId]/matching/*`, `src/server/matching/*`, `src/server/services/{matching-queue,matching-summary,split-transaction,merge,customer-matching,supplier-matching,duplicate-detection}-service.ts` | `matching_screen.py` (legacy manual-review UI — superseded by this platform, not a 1:1 port) |
| 1 | Bank Accounts | Complete — see "Bank Accounts status" below | `src/app/company/[companyId]/bank-accounts/*`, `src/server/services/bank-account-service.ts` | `bank_accounts_screen.py`, `bank_account_link_dialog.py` |
| 2 | Import Centre | Complete for the CSV-only, Standard-Template path — see "Import Centre status" below | `src/app/company/[companyId]/import-centre/*`, `src/server/import-centre/*`, `src/server/services/import-service.ts` | `import_centre_screen.py`, `import_screen.py`, `bank_import_screen.py`, `pdf_import_summary_dialog.py`, `import_confidence_dialog.py` |
| 3 | Customers | Master data complete via Commercial Platform: Customer Management above. Financial Information and Customer Intelligence are now real too, backed by the Sales module (Commercial Platform Module 3, complete) — Gross Profit/Margin alone remain honestly `null`. The Inventory module (Module 5) now exists and captures real COGS per Sales Invoice via Inventory Issue transactions, but `customer-financial-service.ts` hasn't been wired to consume it yet — a real, disclosed next integration step, not fabricated in the meantime | see "Commercial Platform: Customer Management" row above | — (Supplier Reconciliation's own scope covers suppliers; a customer-side equivalent doesn't exist yet in either app) |
| 4 | Suppliers | Master data, banking details, contacts, addresses, real Age Analysis/Purchase History (from `ae_imported_bills`), and now real Average Payment Days and Supplier Intelligence too, backed by the Purchasing module (Commercial Platform Module 4, complete) | see "Commercial Platform: Supplier Management" row above | `merchant_profile_dialog.py` (supplier side) |
| 5 | Matching | Core built as the Matching Platform, see that row above and "Matching Platform status" below | see "Matching Platform" row above | `matching_screen.py` (legacy manual-review UI, superseded — see Supplier Reconciliation status for the engine's original port, and "Matching Platform status" below for the consolidation) |
| 6 | Transaction Explorer | Complete for the grid, filters, exports, details/recovery/timeline, and now 8 real bulk actions (Assign Merchant/Supplier/Customer/GL/VAT, Apply Rule, Generate Journal, Approve/Reject/Ignore, Delete Import) plus a real "Create Rule"/"Learn Rule" navigation — see "Transaction Explorer status" below | `src/app/company/[companyId]/transactions/*`, `src/components/financial/transaction-explorer/*`, `src/server/services/transaction-explorer-service.ts`, `src/server/services/journal-service.ts` | `transaction_explorer_screen.py`, `traceable_transaction_dialog.py`, `transaction_detail_builder.py` |
| 7 | Merchant Queue | Not started (the Rule Engine's own condition-based routing covers most of this screen's original purpose — see "Banking Automation & Rule Intelligence status" below) | — | `merchant_coding_centre_screen.py` (Queue tab), `work_queue_screen.py` |
| 8 | Merchant Rules | Complete — superseded and built as the real, data-driven Banking Rule Engine (see "Banking Automation & Rule Intelligence status" below), not the reference's hardcoded dispatch | see "Banking Automation & Rule Intelligence Platform" row above | `merchant_coding_centre_screen.py` (Rules tab), `merchant_rule_editor_dialog.py`, `merchant_details_dialog.py` |
| 9 | Journals | Complete — full workflow (Draft/Submitted/Approved/Rejected/Posted/Cancelled, plus a Reversed flag) and a real authoring UI (create/edit/duplicate), built as part of General Ledger (Module 10) below | `src/server/repositories/journal-repository.ts`, `src/server/services/journal-workflow-service.ts`, `journal-crud-service.ts`, `src/components/financial/general-ledger/journals-tab.tsx` | `journals_screen.py` |
| 10 | General Ledger | Complete — see "General Ledger status" below | `src/app/company/[companyId]/general-ledger/*`, `src/server/services/{chart-of-accounts,posting-engine,posting-rule,financial-period,gl-inquiry,trial-balance,account-activity,financial-intelligence}-service.ts` | `general_ledger_coding_screen.py`, `ledger_screen.py` |
| 11 | VAT | Complete — built as the VAT Intelligence & Tax Compliance Platform, see that row above and "VAT Intelligence status" below | see "VAT Intelligence & Tax Compliance Platform" row above | `vat_coding_screen.py`, `vat_reports_screen.py` |
| 12 | Reports | Complete — built as the Financial Reporting & Executive Intelligence Platform, see that row above and "Financial Reporting & Executive Intelligence status" below | see "Financial Reporting & Executive Intelligence Platform" row above | `reports_screen.py`, `general_ledger_reports_screen.py`, `monthly_transaction_reports_screen.py`, `monthly_spend_summary_screen.py`, `multi_month_spend_analysis_screen.py`, `financial_exports_screen.py` |
| 13 | Financial Intelligence | The real, computed-signal engine (largest movements, possible duplicate journals, missing postings, unusual account growth) is built and live on every account's Activity page as part of Module 10 — see "General Ledger status" below. Module 9 now composes and normalizes this engine's output (not a second AI engine) into `executive-intelligence-service.ts` for the Executive Command Centre — see "Financial Reporting & Executive Intelligence status" below. The legacy reference's own dedicated `financial_intelligence_export_dialog.py` (a standalone export screen) is not ported | `src/server/services/{financial-intelligence,executive-intelligence}-service.ts` | `financial_intelligence_export_dialog.py` |
| 14 | Settings | Not started | — | `settings_screen.py` |

**Reconciling the two module lists**: Supplier Reconciliation was built
(under the original Part 11 order) as one consolidated screen covering
bills, credit notes, bank statement matching, and allocation together —
the new, more granular order lists "Customers," "Suppliers," and
"Matching" as separate future modules. Nothing has been removed or
redone: Supplier Reconciliation's matching/allocation engines are the
real implementation Modules 4–5 will eventually surface through their own
dedicated screens, not a placeholder to be replaced. `wizard_screen.py`
(the desktop app's Recovery Wizard) still needs a home; most naturally
folded into Import Centre or Dashboard once one of those is revisited.

## Company Management status in detail

**Real and verified:**
- **Company Setup** is now real end-to-end — the Platform Workspace's
  "Create Company"/"Open Company" buttons were previously inert markup
  over 100% mock data (confirmed by two research passes before building
  anything); they're now real: `POST /api/companies` creates a company,
  `GET /api/companies` lists every company the signed-in user's
  organisation(s) own, and the per-company layout does a real `getCompany`
  lookup (404 via RLS for both "doesn't exist" and "not yours" — never
  distinguishable, by design).
- **Organisation bootstrap** — no code path anywhere resolved or created
  an `organisation_members` row before this (confirmed by grep — zero
  matches in application code). `company-service.ts::createCompany` now
  transactionally creates an organisation + owner membership on a user's
  first company if they have none, or uses their best-role existing
  membership otherwise. Required two new RLS policies on
  `organisations`/`organisation_members` (migration 0006) — scoped
  narrowly so a user can only self-join an organisation that currently has
  *zero* members (i.e. only immediately after creating it), closing a real
  privilege-escalation gap rather than opening one.
- **Financial Years** — period math (`computeFinancialYearLabel`,
  `computeFinancialPeriod`) is a faithful, exhaustively unit-tested port of
  `accounting/period_manager.py`'s `get_financial_year`/
  `get_financial_period` (South African March-start convention as the
  default, now a per-company setting rather than a hardcoded constant).
  One documented, deliberate fidelity note: with a January start month the
  ported formula's own `month >= startMonth` boundary makes every month
  roll the label forward by one year — confirmed this is inherent to the
  reference's exact formula (not a translation bug) and unit-tested as
  such rather than "fixed" into different behaviour.
- **Tax Configuration** — the 6 South African VAT treatments are ported
  1:1 from `accounting_engine/vat_codes.py`'s `VAT_CODES`/`VAT_RATES`
  (Standard Rated 15%, Zero Rated/Exempt/No VAT/Fuel VAT 0%, Import VAT
  15%), auto-seeded via a new `seed_company_defaults()` SQL function the
  instant a company is created — real reference behaviour (the reference
  seeds a default Chart of Accounts at creation too; this port has no
  Chart of Accounts table yet, so only the VAT seed applies). Unlike the
  reference (a fixed constant tuple, no CRUD), rates/names are editable
  and custom treatments can be added here.
- **Branches, Departments, Cost Centres** — real CRUD master tables. None
  have a reference-app equivalent (confirmed by full-codebase research):
  Branch only ever meant a bank-branch code on `ae_bank_accounts`;
  Department has zero matches anywhere; Cost Centre exists only as an
  unenforced free-text stub field on `fi_merchant_rules` (a module not
  even ported yet). These three share one service file
  (`org-master-data-service.ts`) and one UI component
  (`OrgMasterDataTab`) rather than being tripled, since their shape is
  identical. A 4th, `projects`, was added the same way by the Financial
  Reporting & Executive Intelligence Platform (Module 9) — see that
  module's status section below.
- **Currencies** — `currencies` is new global reference data (15 real ISO
  4217 currencies seeded); the reference app is single-currency (ZAR)
  throughout with no exchange-rate/FX logic anywhere, confirmed by grep.
  `company_currencies` lets a company enable foreign currencies for
  whenever multi-currency bank accounts/transactions are eventually built
  — no FX conversion logic exists yet, this is master-data only.
- 40 new automated tests (period-math exhaustive coverage, organisation-
  bootstrap decision logic, VAT/master-data validation, Settings page tab
  switching, Create Company form, `jest-axe` accessibility) — full suite
  is 182 tests, all passing. One real a11y bug caught and fixed by the new
  `jest-axe` coverage: `&nbsp;`-only table action-column headers (present
  in several tables across the app, including ones from prior modules)
  read as empty to screen readers; fixed with a visually-hidden `sr-only`
  label in every Company Management table that has one.

**Deliberately out of scope:**
- Organisation switching (a user belonging to several organisations always
  gets their best-role one; there's no UI to choose between multiple) —
  flagged explicitly in the plan as a scoped simplification, not a hidden
  gap, since no organisation-selection UI exists anywhere to build on.
- User Security (Roles, Permissions, Audit Trail proper, Document
  Storage) — a separate line item in the Master Development Instruction's
  own module list, not part of Company Management.
- Multi-currency FX conversion, and linking Branches/Departments/Cost
  Centres into transactions/journals — both require modules that don't
  exist yet (General Ledger, Journals' full UI) to have something real to
  link into.

## Bank Accounts status in detail

**Real and verified:**
- `supabase/migrations/0003_bank_accounts.sql` — `ae_bank_accounts` table
  ported field-for-field from `accounting_engine/models.py::BankAccount`,
  RLS via the same `user_can_access_company()` helper every other table
  uses. Also adds the `bank_account_id` foreign key to
  `ae_bank_transactions` that Module 1's schema didn't yet have (Bank
  Accounts wasn't a module when it was written) — Recent Transactions and
  the matching/recovery stat cards on the account detail page are real
  queries against this column, not mocked, and will correctly show empty
  once real data exists but before Import Centre feeds it in.
- Full CRUD through the mandatory layers: `bank-account-repository.ts` ->
  `bank-account-service.ts` (validation, duplicate-account-number check,
  archive/reactivate) -> `src/app/api/companies/[companyId]/bank-accounts/**`.
  Create, Edit, and Archive are genuinely wired end-to-end, not stubs —
  they fail cleanly with a clear message in Preview Mode (no Supabase yet)
  rather than pretending to succeed.
- Overview page (account cards, KPI row, empty state) and Detail workspace
  (hero, matching/recovery stat cards, Recent Transactions table, Balance
  Movement, Quick Actions) both built against the Enterprise Design System
  — no new visual patterns introduced, per the PRB's explicit instruction.
- First real forms in the app beyond auth — `Input`/`Select`/`Field`
  (`src/components/ui/`) extracted as shared components now that a second
  form genuinely needed them, per DESIGN_REFERENCE.md's own "don't build
  speculatively" note.
- Component test coverage added (`@testing-library/react` + jsdom,
  `vitest.config.ts`/`vitest.setup.ts`) — the project's first component
  tests, covering `EmptyState` and `ArchiveAccountButton`'s Preview-Mode/
  confirm/cancel/confirm-then-refresh states. Unit tests cover
  `maskAccountNumber` and the create-account validation logic. 37 tests
  total pass (`npm test`).

**Honest boundaries, not placeholders:**
- **Recent Imports** is now real (Import Centre shipped — see "Import
  Centre status" below): the account detail page shows the company's most
  recent Standard-Template bank statement imports, with a genuine empty
  state and a link into Import Centre when there are none. It is
  company-wide rather than filtered to this specific account, since one
  statement file can carry rows for several accounts and `ae_import_batches`
  doesn't track a per-account breakdown — documented in the page itself.
- **Journal Status and VAT Status** still show an explicit "not yet
  available" state rather than fabricated data — each depends on a module
  later in this roadmap (Journals/General Ledger, VAT respectively) that
  doesn't exist yet. This is informational, not a non-functioning button.
- **View Transactions and View Matching** are shown as disabled quick
  actions with an explanatory `title`, matching the sidebar's own
  established "Soon" convention — their destination modules (Transaction
  Explorer, Matching) aren't built. **Import Statement** is now a live
  link into Import Centre. Every *other* action on this page (Create,
  Edit, Archive, Open Supplier Reconciliation) is fully live.
- **Balance History** is a real two-figure "Balance Movement" panel
  (opening vs. current balance, both stored fields) rather than a
  fabricated time-series chart — a true balance-history view needs
  per-statement running balances that only the Imports module will
  produce. No `Chart` component was built for this — DESIGN_REFERENCE.md's
  "don't build speculatively" note still applies.
- **Statement count** is always 0 — `ae_bank_transactions` has no
  `statement_number` column yet (out of Module 1's original scope);
  adding it belongs to Import Centre.

## Import Centre status in detail

**Real and verified:**
- `src/server/import-centre/xero-bills-parser.ts` and
  `bank-statement-parser.ts` — ported field-for-field from
  `import_centre/xero_csv_parser.py` and `bank_import/bank_statement_parser.py`:
  same alias-based header matching (Bills/Credit Notes) and strict
  fixed-11-column matching (bank statements), same amount-derivation rules,
  same VAT-reconciliation tolerance (0.01, non-fatal), same exception-type
  strings, same "never abort the whole file on one bad row" behaviour, same
  encoding fallback chain (`utf-8` → `windows-1252` → `iso-8859-1`, BOM
  stripped). 35 unit tests port the reference's own sample CSV fixtures
  (`Bills_Supplier_Export.csv`, `BankImport_Standard_Batch1.csv`)
  byte-for-byte and assert the same row-by-row outcome — run with `npm test`.
- `supabase/migrations/0004_import_centre.sql` — `ae_import_batches` (real
  import history, which the reference app never persisted) plus the unique
  constraints (`ae_imported_bills(company_id, supplier_name, invoice_number)`,
  `ae_bank_transactions(company_id, bank_account, transaction_date,
  reference, debit, credit, description)`) that make re-ingesting the same
  file a no-op — the Postgres equivalent of the reference's SQLite
  `INSERT OR IGNORE`.
- Full pipeline through the mandatory layers:
  `import-repository.ts` (idempotent insert + fallback select on conflict)
  -> `import-service.ts` (parses the upload, resolves/creates a supplier or
  bank account per distinct name/number seen in the file, ingests every row,
  records one `ae_import_batches` row per file) ->
  `src/app/api/companies/[companyId]/import-centre/{bills,bank-transactions,batches}/route.ts`.
  Supplier and bank-account get-or-create reuse the same repositories Bank
  Accounts and Supplier Reconciliation already query — a bill imported
  today shows up in Supplier Reconciliation's dashboard counts and a
  transaction imported today shows up in that Bank Account's stats, with no
  code changes needed in either module.
- Import Centre page (Hero, Executive Summary, two upload cards, Recent
  Imports table) built against the frozen Enterprise Design System — no new
  visual patterns. The upload cards fail cleanly with a clear message in
  Preview Mode rather than pretending to succeed, matching every other
  mutation in the app.
- Bank Account detail page's Recent Imports panel is now real data (see
  "Bank Accounts status" above for its one documented scope note).

**Since extended (Banking Automation & Rule Intelligence, Module 6)**:
bank statement import is no longer CSV-only — `bank-statement-xlsx-parser.ts`,
`ofx-parser.ts`, and `qif-parser.ts` are real, working parsers for the same
Standard Template (Excel) and the two fully-specified standard formats
(OFX, QIF), unified behind `bank-statement-adapter-registry.ts`'s
`BankStatementAdapter` interface — see "Banking Automation & Rule
Intelligence status" below for why PDF specifically is not among them yet.

**Deliberately out of scope, not silently skipped:**
- Bank-specific PDF statement parsers (`bank_import/parsers/fnb_*`) are not
  ported — an adapter framework exists and is ready (`PDF_ADAPTERS`, empty
  by design), but no bank-specific layout is hardcoded without a real
  sample to validate against; see "Banking Automation & Rule Intelligence
  status" below. The legacy `.xlsx`-only `importer/` package specifically
  is superseded by the new, real `bank-statement-xlsx-parser.ts`.
- Duplicate detection (`import_centre/duplicate_detector.py`,
  `bank_import/duplicate_detector.py`) is UI-level/informational only in the
  reference app and was not ported — real deduplication is the DB-level
  idempotent ingest described above, which is the behaviour that actually
  matters (re-importing the same file twice is harmless).
- The alias-table override in `BankAccountService.resolve_account_id`
  ("Link To Existing Account", Multi-Bank Management v1.1) has no
  equivalent table in this port yet — every distinct account number in an
  imported statement gets its own auto-created bank account record via
  plain get-or-create, same as before that feature existed upstream.
- The exception/preview list currently returns from the upload API call
  itself rather than a persisted, browsable-later exception log — good
  enough to review a file's problems right after importing it, not yet a
  "revisit last week's exceptions" screen.

## Transaction Explorer status in detail

**Real and verified:**
- Full grid over every imported bank transaction: sort (date/debit/credit),
  multi-column filters (search, date range, amount range, status, bank
  account, duplicate-only, unknown-supplier-only), a column chooser, drag-
  to-resize columns, and two frozen columns (row-select + Date) — built on
  `@tanstack/react-table` (headless, new dependency) rendered entirely
  through the *existing* `Table`/`TableHeadCell`/`TableCell` components, so
  no new visual system was introduced.
- Real server-side **keyset pagination** (`server/repositories/
  transaction-explorer-repository.ts`), not `OFFSET` — the same choice the
  reference app's own `transaction_explorer_service.py` made, and for the
  same reason: it's the only approach that stays fast past 100,000 rows.
  Executive Summary tiles are a real DB-side aggregate
  (`fn_transaction_explorer_summary`, a Postgres function — this module's
  first RPC) so they never require pulling the full dataset into Node.
- **Export CSV/Excel** — real files, not stubs: CSV via a hand-rolled
  writer, Excel via `exceljs` (new dependency) with a bold frozen header,
  autofilter, and a bold TOTAL row, mirroring the reference's
  `transaction_explorer_export.py` styling. Capped at 50,000 rows with the
  truncation flagged in a response header — not a silent cut.
- **Eight real bulk actions**: Assign Supplier, Assign GL, Assign VAT,
  Approve/Reject/Ignore (a new `review_status` column + history table,
  deliberately kept separate from the Matching/Allocation Engines' own
  `allocation_status`), **Generate Journal** — a real, Draft-only,
  double-entry-validated journal generator built from
  `accounting_engine/journal_service.py`'s ported logic, plus a new
  derivation step (the reference has no bank-transaction → journal
  derivation anywhere) that emits one self-balancing DR/CR line pair per
  transaction — exhaustively unit-tested (`journal-service.test.ts`), and,
  as of Banking Automation & Rule Intelligence (Module 6), **Assign
  Merchant**, **Assign Customer**, and **Apply Rule** (runs the real Rule
  Engine against the selection). Posting to a General Ledger from this
  screen's own manual journal path remains Draft-only, matching the
  reference's own Phase E boundary — automatic Approved+Posted journals
  now happen through the separate Rule Engine pipeline instead, never this
  one, so no duplicate posting path was introduced.
- **Details panel**: full transaction, bank account, matching explanation,
  supplier, GL/VAT, journal status, and three real audit-history lists
  (match/allocation/review). **Recovery Insights panel**: explicitly
  surfaces the Matching/Allocation Engines' *already-computed* confidence,
  reasoning, rules-triggered, and duplicate-payment flag — not a new AI/ML
  system (the reference's own detail dialog does "zero new inference"
  either, confirmed by reading `transaction_detail_builder.py`).
  **Timeline**: real events only (Imported/Matched/GL+VAT Assigned/
  Reviewed/Journal Created), with Posted always shown as a future,
  not-yet-reached stage.
- Accessibility: sortable headers carry `aria-sort` on the header cell
  (not the inner button, which the ARIA spec doesn't permit), the column
  chooser uses `role="group"` (not `role="menu"`, which requires
  `menuitem*` children a checkbox list can't provide — caught by an
  automated `jest-axe` check, this module's first), Escape/click-outside
  close the column chooser, the detail panel is a labelled dialog closable
  by Escape. `jest-axe` (new dev dependency) gives this module the
  project's first automated a11y test coverage.
- 63 new automated tests (unit: filter parsing, keyset cursor encode/
  decode, journal-line derivation, CSV/Excel row-shaping; component: bulk-
  action-bar enable/disable matrix, recovery panel, timeline, column
  chooser, incl. a11y) — full suite is 135 tests, all passing.

**Formerly honestly disabled, now real** — Assign Merchant, Assign
Customer, Apply Rule, Create Rule, and Recovery Insights' "Learn Rule"
were disabled with explanatory tooltips until Customer Management and
Banking Automation & Rule Intelligence (Module 6) shipped; all five are
now real, wired actions (Create Rule/Learn Rule navigate to the Banking
Rules workspace, pre-filled from the selected transaction). The "Merchant"
grid column and the Recovery Panel's "Likely customer"/"Merchant" fields
show real matched data instead of "Not available."

**Deliberately out of scope:**
- True infinite scroll: pagination (Previous/Next over the same keyset
  cursor) was judged sufficient — the spec's own wording ("if
  appropriate") allows this, and a separate infinite-scroll mechanism
  would just restate the same cursor under different UX chrome.
- True integration tests against a live Supabase project — none exist
  anywhere in this codebase yet; every DB-touching path here compiles and
  is typed against the real schema, verified live via `curl` against the
  running dev server in Preview Mode, and will be exercised for real the
  moment a Supabase project exists. Manual browser click-through (the
  completion checklist's "personally test every button") was not literally
  performed with a browser-automation tool — no such tool is available in
  this environment. What stands in for it: full production build, zero
  lint errors, 135 passing automated tests including bulk-action-bar
  enable/disable coverage, and live HTTP verification (via `curl`) of the
  rendered page content, every filter/export control's presence, and every
  API route's correct authentication gating.

## Supplier Reconciliation status in detail

**Real and verified:**
- `src/server/accounting/matching-engine.ts` and `allocation-engine.ts` —
  ported field-for-field from `accounting_engine/matching_engine.py` and
  `allocation_engine.py` (confidence weights, thresholds, rule names,
  required-action strings all identical). 24 scenarios ported from the
  reference `accounting_engine/tests/test_matching_engine.py` and
  `test_allocation_engine.py` pass against this port — run with `npm test`.
- The Repository (`supplier-reconciliation-repository.ts`), Service
  (`supplier-reconciliation-service.ts`, mirroring
  `workflow_orchestrator.generate_supplier_allocation_reports`'s
  Matching → Allocation → Work Queue pipeline), and API route layers
  (`src/app/api/companies/[companyId]/supplier-reconciliation/*`) are
  real code, not stubs — they compile against and would correctly query a
  real Supabase project the moment one exists.
- `supabase/migrations/0002_supplier_reconciliation.sql` — `ae_suppliers`,
  `ae_imported_bills`, `ae_bank_transactions`, `ae_match_history`,
  `ae_allocation_history`, `ae_work_items`, with RLS policies scoping every
  row to the requesting user's organisation via `user_can_access_company()`
  (from `0001_platform_foundation.sql`).

**Deliberately deferred, not silently skipped:**
- **Import parsing** was Import Centre's job, not this module's, and Import
  Centre is now built (see "Import Centre status" above) — Bills, Credit
  Notes, and Standard-Template bank statements uploaded there land in the
  exact same `ae_imported_bills`/`ae_bank_transactions` tables this module
  reads, so a real import now flows straight into Supplier Reconciliation's
  dashboard and reports with no code changes here. PDF bank-statement
  parsing (`bank_import/parsers/`) remains out of scope, as documented
  under Import Centre. Preview Mode's mock data (run through the *real*
  engines, not hand-authored numbers — see
  `lib/mock/supplier-reconciliation-data.ts`) still stands in until a real
  Supabase project exists to import against.
- The legacy `matching/` + `database/` stack (`matching_screen.py`'s manual
  review UI, with its `Split Receipt` multi-invoice allocation) was *not*
  ported — only the current/primary `accounting_engine/` stack behind
  `reconciliation_centre_screen.py` was, per that code's own docstrings
  ("Version 1's primary workflow"). One consequence: the Dashboard
  module's Recovery Checklist (built in the previous phase) reads
  `recovery/status.py`, which queries the *legacy* tables — so today the
  Dashboard and Supplier Reconciliation pages are computing their numbers
  from two different, currently-unconnected data models. Reconciling this
  (repointing Dashboard's "Supplier Matching" checklist item at
  `ae_bank_transactions` instead) is unscoped work for a future pass, not
  done in this one.
- Excel export (`reconciliation_excel_export.py`) has no web equivalent yet.

## General Ledger status in detail

The accounting engine every other module posts through — Chart of
Accounts, the Journal workflow, the one Posting Engine, Posting Rules,
Trial Balance, GL Inquiry, and Account Activity/Financial Intelligence.
Ported from the legacy single-company `accounting/posting_engine.py` +
`posting_rules.py` + `journal_engine.py` + `general_ledger.py` +
`trial_balance.py` — the only real posting engine in either reference
backend (the multi-tenant `accounting_engine` world's own `JournalService`
docstring says posting was explicitly out of scope there) — adapted to be
genuinely multi-tenant.

**Real and verified:**
- `supabase/migrations/0007_general_ledger.sql` — `chart_of_accounts`
  (nested via `parent_account_id`), `ae_journals` extended with the
  Submitted/Cancelled statuses and full audit-stamp columns,
  `posting_batches`, `gl_transactions` (append-only), `posting_rules` +
  `posting_rule_lines`, `financial_years.lock_date`/`reopened_at`, and two
  DB-side aggregates (`fn_trial_balance`, `fn_account_balance_before`) for
  the same 100,000+-row-safe reason `fn_transaction_explorer_summary`
  already established.
- **Chart of Accounts** — full CRUD, tree view, search, duplicate,
  archive/reactivate, CSV import/export. `src/server/services/chart-of-accounts-service.ts`,
  `src/components/financial/general-ledger/chart-of-accounts-tab.tsx`.
- **Journal workflow** — Draft → Submitted → Approved → Rejected/Posted →
  Cancelled, plus a Reversed flag (a new offsetting journal, not a status
  rewrite). A real authoring UI: create, edit (Draft only), duplicate,
  search/status/date filters, per-row expandable line detail + full audit
  history, a live balance indicator while building a journal by hand.
  `journal-workflow-service.ts`, `journal-crud-service.ts`,
  `journals-tab.tsx`.
- **Posting Engine** — `postApprovedJournals` is the one shared
  Approved → `gl_transactions` code path every journal goes through
  regardless of origin (manual entry, Transaction Explorer's own
  "Generate Journal," or a future Posting Rule), with real Financial
  Period validation (rejects postings into a Closed year or on/before its
  lock date, per-journal rather than failing the whole batch).
  `posting-engine-service.ts`, `posting-repository.ts`.
- **Posting Rules** — the reference's exact 8 event types seeded as data,
  not code. Create/Edit/Duplicate/Enable/Disable, a "Test Rule" dry-run
  preview against sample amounts (calls the same `buildJournalLinesFromRule`
  core with nothing persisted), CSV import/export.
  `posting-rule-service.ts`, `posting-rules-tab.tsx`.
- **Trial Balance** — live, expand/collapse by account type, search,
  drill-down to Account Activity, running per-row totals, a prominent
  out-of-balance warning banner, CSV export, Excel export
  (`trial-balance-export.ts`, same `exceljs` styling convention as
  Transaction Explorer's own export), and Print/Export PDF via the
  browser's native print dialog (a real, dependency-free mechanism — no
  PDF-generation library was added for one button).
- **GL Inquiry** — keyset-paginated (same reasoning as Transaction
  Explorer's grid), filterable by date/account/reference/search/branch/
  department/cost centre/source type, with a per-account running balance
  when filtered to one account.
- **Account Activity** (`general-ledger/[accountId]/page.tsx`) — the
  accountant's investigation screen: opening/closing balance, a real
  monthly trend chart, every transaction in the period, related journals
  each with a full expandable audit trail, and a Financial Intelligence
  panel scoped to that account.
- **Financial Intelligence** — real, computed-from-`gl_transactions`
  signals, explicitly not AI/ML (same honest framing as the Recovery
  Panel): largest movements, possible duplicate journals (same
  account/date/side/amount across two different journals), missing
  postings (stale Approved-but-unposted or Draft-but-unsubmitted
  journals), and unusual period-over-period account growth — every signal
  carries its own plain-English reasoning string.
- **Traceability** — GL Inquiry and Account Activity link a posting to its
  journal (deep-linking into the Journals tab, pre-filtered); a journal
  generated from bank transactions ("Trace to Source Bank Transaction")
  resolves back to the originating `ae_bank_transactions` row(s) via a new
  `getTransactionsByJournalId` — completing the Bank Transaction → Journal
  → GL Transaction → Trial Balance chain in both directions.
- **Dashboard** — "Recent Journal Entries" and "Largest Journals" now read
  real `ae_journals` data instead of the old hand-typed
  `MOCK_RECENT_JOURNALS` (removed, along with its now-dead
  `RecentJournalEntry` type). New real tiles: Draft Journals, Posting
  Queue (Approved, awaiting the Posting Engine), Trial Balance total, and
  Financial Period status.
- **Sidebar** — "General Ledger" and "Journals" are live nav items
  (Journals deep-links to `general-ledger?tab=journals`); every other
  still-inert item (Matching, Suppliers, Customers, Reports, VAT) has no
  module built yet, per the standing "don't point navigation at a route
  that would 404" rule.
- 35 new unit/component/accessibility tests across every new pure
  function and interactive component (chart tree building, journal/
  posting-rule/CSV validation, posting-engine balance math, financial
  period date logic, GL running-balance math, Financial Intelligence
  detection logic, Journals/General Ledger tabs, Account Activity view) —
  full suite is 303 tests, zero regressions.

**Deliberately out of scope, not silently skipped:**
- **Attachments and Notes on journals** — no file-storage module exists
  yet in this port; adding one is a real, separate capability, not a UI
  afterthought.
- **True Recurring-journal scheduling** — `journalType` already accepts
  "Recurring"/"Accrual"/"Reversing"/"Adjustment"/"Correction" as real
  labels (so a future scheduler needs no schema change), but nothing
  auto-generates future journals from a template on a cron; that requires
  a job-scheduling engine this platform doesn't have yet.
- **Posting Rule "Priority"** — the schema deliberately keeps one rule per
  event type (`unique (company_id, event_type)`), matching the
  reference's own single-dispatch model exactly; rule-vs-rule priority
  doesn't apply because there's never more than one candidate rule.
  Within-rule line order is real and supported.
- **Multi-currency posting, VAT-return integration, and formatted
  Financial Statements** (Income Statement/Balance Sheet) remain future
  modules — Trial Balance is the real, live source they'll eventually
  read from.
- This environment has no configured Supabase project, so every mutation
  path (create/edit/approve/post/duplicate/import/…) was verified via
  correct 501 Preview-Mode gating, full unit/component test coverage, and
  a live `curl` sweep of every page and API route — not against a real
  Postgres instance. Read paths render real, internally-consistent Preview
  Mode data (`lib/mock/general-ledger-data.ts`), computed from the same
  production pure functions rather than hand-typed numbers.

## Customer Management status in detail

The Commercial Platform's Module 1 — genuinely new, no reference-app
equivalent exists (Supplier Reconciliation's own scope only ever covered
suppliers).

**Real and verified:**
- `supabase/migrations/0008_customer_management.sql` — `customers`,
  `customer_contacts`, `customer_addresses`, all RLS-scoped via
  `user_can_access_company()`.
- Full Customer Master CRUD (code immutable after creation, matching
  Chart of Accounts' convention), unlimited Contacts, unlimited Addresses
  (Billing/Delivery/Postal/Physical) — all real, all wired to real API
  routes, all operational in the Customer Workspace
  (`app/company/[companyId]/customers/*`).

**Customer Financial Information and Customer Intelligence are now real**
(updated once the Sales module — Commercial Platform Module 3 — shipped;
see "Sales Platform status" below). Before Sales existed this was an
honest `{ available: false, reason }` stub — the type contract's shape
didn't need to change when the real implementation landed, only its
values. **Deliberately out of scope, not silently skipped:**
- **Gross Profit and Margin** alone remain `null` within an otherwise-real
  `CustomerFinancialSummary` — both need cost data from the not-yet-built
  Inventory module. Field-level honesty rather than gating the whole
  summary behind a pending flag, since the rest of the summary genuinely
  is real now.

## Supplier Management status in detail

The Commercial Platform's Module 2 — extends the real, already-live
`ae_suppliers` table (Supplier Reconciliation,
`0002_supplier_reconciliation.sql`) rather than creating a competing
one, the same "one source of truth" discipline General Ledger followed
extending `ae_journals`. Every new column is additive with a safe
default; Matching Engine, Allocation Engine, Import Centre, and Supplier
Reconciliation all keep working completely unmodified (verified: their
full existing test suites stay green).

**Real and verified:**
- `supabase/migrations/0009_supplier_management.sql` — `ae_suppliers`
  extended (code, category, type, banking details, VAT/tax numbers, risk
  rating, payment terms), plus new `supplier_contacts`/
  `supplier_addresses` tables.
- Supplier Workspace (`app/company/[companyId]/suppliers/*`): full CRUD
  on the new fields, Contacts, Addresses — all real and operational.
- **Age Analysis, Outstanding Bills, and Purchase History are genuinely
  real**, not honestly-pending like Customers' equivalent — the data
  source (`ae_imported_bills`, linked via `supplier_id`) already exists
  and is already populated by Import Centre. `supplier-financial-service.ts`'s
  `computeSupplierAging` buckets real outstanding bills into
  Current/30/60/90/120+ by days-overdue-from-due-date; verified this
  correctly reuses `listBillsBySupplier` rather than re-deriving bill
  data.
- **Average Payment Days and Supplier Intelligence are now real too**
  (updated once the Purchasing module — Commercial Platform Module 4 —
  shipped; see "Purchasing Platform status" below). Average Payment Days
  was originally omitted because `ae_imported_bills` had no paid-date
  column; Purchasing's `supplier_payment_allocations` table now provides
  a real "paid on" signal for any bill a Supplier Payment settles
  (imported or Purchasing-entered), so bills paid through the new
  workflow contribute to the average — bills that have never been paid
  that way simply don't, honestly, rather than being estimated.

## Sales Platform status in detail

The Commercial Platform's Module 3 — genuinely new, no reference-app
equivalent exists. The first real caller of the Posting Rules engine
General Ledger built and seeded but left with "no calling module yet" in
its own completion report — Sales Invoices, Credit Notes, Debit Notes,
and Customer Receipts are the concrete fulfillment of that disclosed gap.

**Real and verified:**
- `supabase/migrations/0010_sales_platform.sql` — `sales_quotations`,
  `sales_orders`, `deliveries`, `sales_invoices` (unified Invoice/Credit
  Note/Debit Note, same `document_type` pattern `ae_imported_bills`
  established on the supplier side), `customer_receipts` +
  `customer_receipt_allocations` — 9 tables, all RLS-scoped. Only
  Invoices/Credit Notes/Debit Notes/Receipts ever write a `journal_id`;
  Quotations, Orders, and Deliveries never post.
- **Full document lifecycle, real not simulated**: Quotation
  (Draft→Sent→Accepted/Rejected/Expired) → real **Quotation→Order
  conversion** (copies lines, marks the source quote Converted) → Sales
  Order (Draft→Confirmed→PartiallyDelivered/Delivered→Invoiced) → real
  **partial Delivery tracking** (`delivered_quantity` per line, so
  Backorders are just `quantity - deliveredQuantity`, not a separate
  stored concept) → real **Order→Invoice conversion** (requires the order
  fully `Delivered`, copies its lines) → Sales Invoice/Credit
  Note/Debit Note (Draft→Submitted→Approved→Posted) → Customer Receipt
  (Draft→Approved→Posted) → real **Customer Allocations** (which
  invoice(s) a receipt paid off, validated against both the receipt's
  remaining unallocated amount and the invoice's remaining outstanding).
- **Automatic posting, not a manual step**: approving an Invoice/Credit
  Note/Debit Note/Receipt synchronously resolves the matching Posting
  Rule (`buildJournalFromEvent`), creates an Approved journal, and
  immediately runs it through the one shared Posting Engine
  (`postApprovedJournals`) in the same request — verified that only the
  journals actually reported `posted` (not just "the batch ran") flip the
  document to `Posted`. If the Posting Engine skips it (e.g. a closed
  Financial Period), the document honestly stays `Approved` — a real
  `Retry Posting` action exists specifically for that recovery path,
  since without it the document would be stuck with no way back short of
  a manual DB edit.
- Debit Notes deliberately reuse the "Sales Invoice" Posting Rule (same
  DR Debtors/CR Sales/CR VAT Output shape) rather than a redundant
  separate rule.
- Sales Workspace (`app/company/[companyId]/sales/*`): 5 tabs
  (Quotations/Sales Orders/Deliveries/Invoices/Receipts), full CRUD,
  status-gated actions, search/filter, expandable line/audit detail —
  wired into the sidebar's "Sales" nav item.
- Dashboard integration: Sales Today, Invoices This Month, Outstanding
  Debtors, Top Customers, Largest Sales — all computed once in the
  shared, unit-tested `sales-summary-service.ts` and consumed identically
  by both the Dashboard and the Sales workspace's own executive summary,
  so the two pages can never quietly restate the same numbers
  differently.

**Deliberately out of scope, not silently skipped:**
- **VAT is whole-document, not per-line** — one `vat_treatment_code` per
  Invoice/Credit Note/Debit Note, because General Ledger's own
  `buildJournalLinesFromRule` only supports one blended VAT rate per
  posting event; per-line VAT splitting would outrun what the posting
  side can actually consume.
- **Recurring Invoices** — the schema carries `is_recurring_template`/
  `recurrence_pattern` columns, but no scheduler exists to act on them
  (same honest gap General Ledger disclosed for Journal Attachments).
- **Statements, Attachments, Emailing, Printing** — all need
  infrastructure (document rendering, an email provider) that doesn't
  exist yet; not attempted rather than half-built.
- **Gross Profit/Margin** on the now-real Customer Financial Summary stay
  `null` — see "Customer Management status" above.

## Purchasing Platform status in detail

The Commercial Platform's Module 4 — the mirror image of Sales (Module
3) on the AP side, per the Product Review Board's explicit instruction.
Genuinely new workflow, but its "Supplier Bill" concept is NOT a new
table — see the architectural decision below.

**Architectural decision — extend, don't duplicate (again):** the same
call Supplier Management made for `ae_suppliers` and Sales made for
reusing the Bill/Credit-Note `document_type` pattern. `ae_imported_bills`
(Supplier Reconciliation, `0002_supplier_reconciliation.sql`) is already
the one real Bill/Credit Note record in the system — Import Centre,
Matching Engine, Allocation Engine, Supplier Reconciliation, and Supplier
Management's own Age Analysis/Purchase History all read it. It predates
the General Ledger's Posting Engine (Module 10) entirely, though, so
bills imported via CSV/PDF have only ever been reconciliation data, never
accounting-postable documents. `0011_purchasing_platform.sql` extends
this same table additively (`origin`, `purchase_order_id`,
`goods_received_note_id`, `posting_status`, `journal_id`, audit stamps —
all nullable, none backfilled onto existing imported rows) rather than
creating a competing "purchase_bills" table. Verified: Supplier
Reconciliation's full existing test suite (Matching/Allocation Engine,
etc.) stays green — imported bills are completely unaffected. Only bills
that explicitly enter the new workflow (`origin = 'Purchasing'`) ever get
a `posting_status`; the Purchasing workspace's own Bills tab shows only
those, so the (likely much larger) imported-bill population isn't
suddenly dumped into a new "Draft, needs approval" queue it was never
part of.

**Real and verified:**
- `supabase/migrations/0011_purchasing_platform.sql` — `purchase_requisitions`,
  `purchase_orders`, `goods_received_notes` (9 new/altered tables total,
  including the `ae_imported_bills` extension above and new
  `supplier_payments`/`supplier_payment_allocations`), all RLS-scoped.
- **Full document lifecycle, real not simulated**: Purchase Requisition
  (Draft→Submitted→Approved/Rejected) → real **Requisition→Order
  conversion** (copies lines, requires selecting the fulfilling supplier
  since a requisition has none yet — the one real difference from Sales'
  Quotation→Order conversion) → Purchase Order (Draft→Submitted→
  **Approved**/Rejected→PartiallyReceived/Received→Billed — a real
  internal spend-approval gate Sales Orders don't need, since an outgoing
  purchase commitment genuinely differs from an incoming customer order;
  this is also the source of the Dashboard's real "Purchase Orders
  Awaiting Approval" metric) → real **partial GRN tracking**
  (`received_quantity` per line) → real **Order→Bill conversion**
  (requires the order fully `Received`, sums its lines into one bill
  amount since `ae_imported_bills` is header-only — no line-items table
  exists there, imported or otherwise) → Supplier Bill/Credit Note/Debit
  Note (Draft→Submitted→Approved→Posted) → Supplier Payment
  (Draft→Approved→Posted) → real **Supplier Allocations** (which bill(s)
  a payment settled — deliberately not restricted to Purchasing-entered
  bills; a payment can settle any outstanding bill regardless of
  `origin`, matching how the Allocation Engine already treats bills
  uniformly).
- **Automatic posting**, including the same **Retry Posting** recovery
  path Sales has, mirrored exactly (`retryPostBill`/`retryPostPayment`)
  — approving a Bill/Credit Note/Debit Note/Payment resolves the matching
  seeded Posting Rule ('Supplier Invoice'/'Supplier Credit Note'/
  'Supplier Payment', already seeded by General Ledger) into an Approved
  journal and immediately runs it through the one shared Posting Engine.
  A Debit Note reuses the 'Supplier Invoice' rule (identical DR
  Purchases/DR VAT Input/CR Creditors shape) — no separate rule exists or
  is needed. The bill's existing `vat_code` column (previously unused
  free text) is repurposed to hold the VAT Treatment code used at
  creation, so the exact rate can be re-resolved at approval time without
  adding a new column.
- Purchasing Workspace (`app/company/[companyId]/purchasing/*`): 5 tabs
  (Requisitions/Purchase Orders/GRNs/Bills/Payments), full CRUD,
  status-gated actions, search/filter — wired into the sidebar's
  "Purchasing" nav item.
- **Supplier Intelligence — genuinely new**, not a reactivated stub like
  Customer Intelligence (no stub ever existed here, since the data source
  only became meaningful once Purchasing shipped): payment risk, cash
  flow impact (bills due within 7 days), largest bill, average bill
  value, duplicate bills, purchase trend, and supplier risk rating —
  every signal a plain computed fact with a `confidence`, not a machine
  learning score. Live on the Supplier detail page's new Intelligence
  tab.
- Dashboard integration: Purchases Today, Outstanding Creditors, Orders
  Awaiting Approval, Payments This Month, and — genuinely fixing a
  pre-existing gap, not just adding new tiles — **"Top Suppliers" is now
  real**. It was unconditionally sourced from `MOCK_REPORTS["supplier-payment"]`
  even outside Preview Mode before this module; it now consumes the same
  shared, unit-tested `purchasing-summary-service.ts` the Purchasing
  workspace itself uses, alongside a new real "Largest Bills" card.

**Deliberately out of scope, not silently skipped:**
- **Line-itemized Bills** — `ae_imported_bills` is header-only (a single
  net amount + VAT treatment), matching the table's real existing shape
  rather than bolting on a parallel line-items concept for Purchasing
  alone.
- **Retroactively posting historical imported bills** — the Posting
  Engine capability now exists for any bill (imported or
  Purchasing-entered), but bringing the (likely large) existing imported
  population into the workflow would need real GL-account coding
  decisions on real historical data that aren't this build's to make;
  disclosed as a future capability rather than attempted.
- **Statements, Attachments, Emailing, Printing** — same infrastructure
  gap already disclosed for Sales.
- **Inventory integration is now real** (updated once the Inventory
  module — Commercial Platform Module 5 — shipped; see "Inventory
  Platform status" below). A GRN line with a real `stockItemId` now
  triggers a genuine Goods Received inventory movement automatically,
  and a Bill against a stock-carrying order clears GRNI instead of
  re-expensing through 'Supplier Invoice'.

## Inventory Platform status in detail

The Commercial Platform's Module 5 (non-manufacturing) — genuinely new,
no reference-app equivalent. Manufacturing is explicitly out of scope
(belongs to VYRON COST); this module only builds the integration layer
that will one day receive it.

**Architectural decision — "One Business Object," applied to Sales and
Purchasing lines:** rather than inventing a parallel "what got sold/
bought" concept inside the Inventory module, `sales_order_lines`,
`sales_invoice_lines`, `delivery_lines`, `purchase_order_lines`, and
`goods_received_note_lines` are each extended with a nullable
`stock_item_id` (`0012_inventory_platform.sql`). A line with a stock
item is a real inventory movement; a line without one stays exactly the
free-text service/note line it always was — verified the full existing
Sales/Purchasing test suites stay green, since every new column is
additive and every existing call site was updated to pass `null`
explicitly (not silently break).

**Real, computed FIFO costing** — `server/inventory/costing.ts`, pure
and exhaustively unit tested: `consumeFifoLayers` consumes the oldest
`stock_cost_layers` row first (real lot-level cost, not an estimate),
`computeWeightedAverageCost` rolls the moving average forward on every
receipt. Both `averageCost` and `quantityOnHand` on `stock_items` are
maintained running counters (updated by the service layer alongside
every transaction), the same convention `sales_order_lines.deliveredQuantity`
already established, rather than recomputed from history on every read.

**Real, automatic Posting Engine integration** — six new seeded event
types (`Goods Received`, `Inventory Bill`, `Inventory Issue`,
`Inventory Return`, `Inventory Adjustment Increase`/`Decrease`), all
using fixed control accounts (`1500` Inventory, `2050` Goods Received
Not Invoiced/GRNI Clearing, `5010` Cost of Sales, `6300` Inventory
Adjustments) rather than a dynamic per-item account — perpetual
inventory convention, matching how Debtors/Creditors already stay single
control accounts with sub-ledger detail living elsewhere:
- **Goods Received** (GRN lines with a stock item): DR Inventory / CR
  GRNI Clearing, automatically, in the same call that creates the GRN.
- **Inventory Bill**: a Bill whose Purchase Order carries stock items
  clears GRNI (DR GRNI/DR VAT Input/CR Creditors) instead of
  re-expensing through 'Supplier Invoice' — avoids double-counting the
  same purchase once as inventory and again as an expense.
- **Inventory Issue** (Sales Invoice/Debit Note stock lines): DR Cost of
  Sales / CR Inventory, at real FIFO-consumed cost — a genuinely
  separate journal from the sales journal itself (revenue recognition
  and COGS are two different accounting facts, not double-counting).
- **Inventory Return** (Sales Credit Note stock lines): the reverse,
  restocking at average cost.
- **Inventory Adjustment Increase/Decrease**: manual corrections and
  Stock Take variances, via the exact same two rules either way.
- Transfers and Opening Balances never post — same "no accounting
  impact" precedent Sales Orders/Deliveries/GRNs already established.
- `seed_company_defaults()` had no existing mechanism to backfill new
  accounts/rules onto already-existing companies (confirmed: no earlier
  migration ever needed one) — this migration both extends that function
  for future companies AND backfills every existing company idempotently,
  genuinely new infrastructure this module introduces.

**Real Stock Takes** — counted vs system quantity, captured as a real
snapshot at creation time (not recomputed later); finalizing one creates
a real Inventory Adjustment transaction per variance line, automatically
posted, no separate "stock take journal" concept.

**Inventory Intelligence — real, computed signals**: out of stock, low
stock, dead stock (no Issue in 180+ days while still holding quantity),
fast/slow moving (by recent Issue frequency), and stock age (from the
oldest remaining FIFO layer) — every signal a plain computed fact with a
confidence score, not a machine-learning claim.

**Integration Centre — a real connection-status registry, not a
fabricated one.** Per the Product Review Board's explicit instruction
("only build the integration layer," manufacturing itself stays with
VYRON COST), `integration_connections` tracks one row per external
system (`VYRON_COST` initially) with an honest `Not Connected` status.
There is no real VYRON COST API this codebase can call, so no `sync`
action exists — the UI's "Connect" button is genuinely disabled with an
explanation, not a placeholder that pretends to work. This gives a
future module a real place to write `last_synced_at` once a real
integration exists, without fabricating one now.

**Deliberately out of scope, not silently skipped:**
- **Full serialized/lot inventory registry** — `tracksSerialNumbers`/
  `tracksLotNumbers`/`hasExpiryDate` are real configuration flags, and
  `inventory_transaction_lines` really does capture a serial/lot number/
  expiry date per movement — but there's no separate per-serial-unit
  status/warranty registry (a genuinely larger feature than line-level
  capture).
- **Retroactive Gross Profit/Margin on Customer Financial Summary** — the
  real COGS data now exists (Inventory Issue transactions), but
  `customer-financial-service.ts` hasn't been wired to consume it in this
  pass; a real, disclosed next integration step.
- **Multi-warehouse fulfillment for automatic Sales/Purchasing-triggered
  movements** — a GRN/Sales Invoice line's automatic Receipt/Issue always
  uses the stock item's own `defaultWarehouseId`, since neither document
  carries its own warehouse field; multi-warehouse fulfillment is
  achievable today via a manual Transfer or a manual Inventory workspace
  movement instead of a redesign of already-shipped Sales/Purchasing
  document forms.
- **Attachments, Images** — same infrastructure gap already disclosed
  elsewhere in this codebase.

## Banking Automation & Rule Intelligence status in detail

Module 6 per the Product Review Board's own directive ("the objective is
no longer to import transactions, the objective is to automate accounting
from bank statements"). Confirmed via research before writing any code:
no rule-matching table existed anywhere in this codebase — the Matching
Engine (`matching-engine.ts`) and Allocation Engine (`allocation-engine.ts`)
are real but purely algorithmic (fixed-weight supplier-name scoring, not
user-configurable conditions), and `posting_rules` is General Ledger's
unrelated event-type -> DR/CR templating engine. This module is therefore
genuinely greenfield.

**Schema** (`supabase/migrations/0013_banking_automation.sql`): a new
`merchants` business object (Recognise Merchant is step 1 of the pipeline
— sits upstream of Suppliers/Customers, doesn't duplicate either); a
data-driven Rule Engine — `banking_rules` (one row per rule, `rule_type`
discriminator across all 12 PRB-named categories, same "one table, one
discriminator column" convention `ae_imported_bills`/`inventory_transactions`
already established), `banking_rule_conditions` (AND logic), `banking_rule_actions`,
`banking_rule_versions` (a real snapshot on every edit), `banking_rule_applications`
(one row per real time a rule fired — genuine usage data for Analytics/"Rules
Applied Today", not a fabricated counter); `banking_exceptions` (the
dedicated workspace). `ae_bank_transactions` is EXTENDED, not duplicated —
`matched_customer_id`, `matched_merchant_id`, and `rule_id` are the only
columns added to its already-rich set.

**Rule Engine** (`src/server/banking-rules/rule-engine.ts`, pure, exhaustively
unit tested): a transaction is checked against every active rule; within
one `rule_type`, only the highest-priority match wins; across different
`rule_type`s, every matching type's actions compose (a Merchant rule, a
GL rule, and a VAT rule can all resolve the same transaction at once,
exactly as the PRB's own pipeline diagram describes). `simulateRuleAgainstTransactions`
is the exact same matching function used by the real pipeline, so "Simulate"/
"Preview" can never disagree with what actually happens.

**Pipeline** (`src/server/services/rule-processing-service.ts`): Business
Event (a bank transaction) -> Rule Engine -> Posting Engine -> General
Ledger, reusing `journal-service.ts::buildJournalLinesForTransaction` — the
exact same pure function Transaction Explorer's existing manual "Generate
Journal" bulk action already calls — the only difference is this pipeline
creates the journal `Approved` and immediately runs it through
`postApprovedJournals`, the one shared Posting Engine, rather than leaving
it `Draft` for manual review. A Bank Fee / Interest rule reaches the
Posting Engine by resolving its GL action to the SAME account code (6100 /
6200) the already-existing 'Bank Charges' / 'Interest Received' posting
rules use — no new posting rule is ever created. "Unknown transactions
become the exception, not the normal workflow": a transaction with no rule
match and no existing Matching-Engine supplier/customer match becomes an
`UnknownMerchant` exception. A batch-level Banking Intelligence pass adds
`PossibleDuplicate` and `LargeUnusualPayment` exceptions independently of
rule matching.

**Banking Intelligence** (`src/server/banking-rules/banking-intelligence.ts`,
pure, unit tested): duplicate-payment, new-merchant, unusual-spending,
cash-flow-impact, and suspicious-pattern signals, each with `message`/
`reasoning`/`confidence`/`suggestedAction` — the same honest,
computed-not-claimed framing as every other Intelligence signal in this
codebase. "Potential fraud" per the PRB's brief is deliberately never
asserted as fact — it surfaces as `suspicious-pattern`, an explicit
heuristic risk flag with its own confidence score, never a bare label.

**Bank Import Engine** (`src/server/import-centre/{ofx,qif,bank-statement-xlsx}-parser.ts`
+ `bank-statement-adapter-registry.ts`): CSV (existing), Excel, OFX, and
QIF are all real, working parsers — OFX and QIF are fully-specified
standard formats, buildable correctly without bank samples, unlike a
bank's own proprietary PDF layout. PDF import is deliberately NOT
fabricated: the PRB's own text says "examples will be supplied later," and
writing a bank-specific column parser with no real statement to validate
against would risk exactly the "looks like it works but doesn't"
fabrication this codebase has been disciplined about avoiding everywhere
else. `PDF_ADAPTERS` is a real, empty, documented extension point — a new
adapter implementing the same `BankStatementAdapter` interface (bankName,
matchesFile, parse) drops in without changing `import-service.ts` at all.

**Transaction Explorer retrofit**: `assign-merchant`, `assign-customer`,
and `apply-rule` are now real bulk actions (previously permanently
disabled — the tooltips explaining why were stale the moment Customer
Management shipped, now fixed). `create-rule` navigates to Banking Rules
pre-filled from the selected transaction; the detail panel's "Learn Rule"
button does the same. The Merchant grid column and Recovery Panel's
"Likely customer"/"Merchant" fields show real data instead of "no module
exists yet" placeholders.

**Dashboard**: the "Imports Today" and "Automation %" tiles — previously
hand-typed placeholder strings — are now real, computed from
`buildBankingAutomationSummary`. Five new tiles added: Transactions
Automatically Processed, Exceptions Awaiting Review, Rules Applied Today,
Unknown Merchants, Duplicate Detection.

**Deliberately out of scope** (disclosed, not silently skipped):
- Bank-specific PDF parsers — the PRB's own deferral, framework ready.
- Payroll/Loan rule types are fully real (conditions, GL/VAT actions) but
  have no dedicated Payroll/Loan ledger to link to yet — the same honest
  gap as Bank Fee/Interest resolving to already-real posting rules rather
  than inventing new ones.
- **Since resolved by Module 7 (below)**: a periodic "RuleEngineRun"
  Automation Task can now run the Rule Engine on a real schedule through
  the shared Scheduler — the manual "Run Rule Engine Now" button still
  exists too, exactly the same "manual trigger alongside the real
  scheduled path" pattern used everywhere in this codebase.

## Automation Platform status in detail

Module 7 per the Product Review Board's own naming — "the automation
engine that allows businesses to operate with minimal manual
intervention." The single most important architectural decision, made
before writing any schema: **"One Rule Engine" meant genuinely
generalizing Module 6's real, working Banking Rule Engine, not building a
second one.** `rule-engine.ts`'s pure matching functions
(`matchesCondition`/`ruleMatches`/`evaluateTransactionAgainstRules`/
`simulateRuleAgainstTransactions`) were already domain-agnostic at the
algorithm level (AND-condition matching over named fields, priority-per-
type resolution) — only their TypeScript field/rule-type unions were
Banking-specific. Those were widened (`ConditionField`/`ActionType`
became `string`, resolved per-`domain` in the service layer via
`automation-rule-domains.ts` instead of one fixed global enum); the
`banking_rules` table itself gained a `domain` column (default 'Banking',
zero behavior change for every existing Banking rule) rather than being
replaced. The table/file names deliberately stay `banking_rules`/
`server/banking-rules/*` — a cosmetic rename across every repository,
service, route, UI, and test file touching Module 6 was judged not worth
the regression risk against this module's own "No regressions" criterion;
the *engine* is genuinely one, regardless of what the table is called,
and the UI is retitled "Automation Rules" with a Domain selector.

**Recurring Documents** (`recurring_templates`/`generated_documents`,
`recurring-template-service.ts`): all 10 PRB-named document types, each
generating a REAL business object through the exact service a manually-
created one would use — no parallel document-creation logic anywhere:
- Customer Invoice / Supplier Bill / Purchase Order / Sales Order /
  Inventory Adjustment / Journal: create + (where the document type
  naturally posts) approve-and-post through `sales-invoice-service.ts`,
  `purchase-bill-service.ts`, `purchase-order-repository.ts`,
  `sales-order-repository.ts`, `inventory-transaction-service.ts`, and
  `journal-repository.ts` + `postApprovedJournals` respectively.
- Customer Statement / Supplier Statement: reuse the already-real
  `getCustomerFinancialSummary`/`getSupplierFinancialSummary` (Customer/
  Supplier Management) to compute and persist a real snapshot
  (`generated_documents`) — no PDF/email generation exists anywhere in
  this codebase (confirmed by the same research that shaped Module 6's
  PDF-parser decision), so a "statement" here is a real, computed,
  persisted financial snapshot, not a fabricated document render.
- Reminder Email / Payment Reminder: since no email provider is connected
  anywhere in this app, these generate a real Notification Centre entry
  instead of a fabricated "email sent" claim — exactly the framing the
  PRB's own brief permits ("Email-ready notifications... infrastructure
  only if email service isn't available yet"). `email_status` stays
  `NotSent` throughout.
Each template stores a real `document_payload` (jsonb) — the reusable
create-input for its document type; recurrence fields (frequency,
interval, start/end date, max occurrences, skip weekends, skip public
holidays, automatic numbering) live on the template row itself.
`recurrence.ts`'s pure `computeNextRunDate`/`checkOccurrenceDue` are the
one place "what's the next occurrence" and "should this still fire" logic
live, exhaustively unit tested (17 tests covering month-end clamping,
leap years, weekend/holiday roll-forward, end-date/occurrence-cap
exhaustion) — the same functions back the UI's "Preview Next Execution"
and the real generation pipeline, so they can never disagree.

**Automation Scheduler** (`automation_tasks`/`automation_task_runs`,
`scheduler-service.ts`) — the one shared queue every scheduled activity
in the platform executes through; no module builds its own scheduling
loop. Real queue/retry/pause/resume/disable/manual-run/execution-log,
with a retry backoff (5 minutes until `max_retries` is exhausted, then
falls back to normal cadence) and a critical `AutomationFailure`
notification once retries are exhausted. **Honest, disclosed limitation**
on unattended (no active browser session) execution: every repository in
this codebase reads/writes through the standard session-scoped Supabase
client, and Row Level Security's `user_can_access_company()` requires
`auth.uid()`. `POST /api/automation/run-due-tasks` (secured by an
`AUTOMATION_CRON_SECRET` bearer token, for a real external cron trigger —
Vercel Cron / Supabase `pg_cron` / any scheduler) authenticates the
CALLER correctly, but without a session cookie its underlying queries see
RLS-driven empty results rather than throwing — the same accepted trade-
off `require-session.ts`'s own docstring already documents elsewhere in
this codebase ("this only turns an unauthenticated request into a clean
401 instead of an RLS-driven empty result"). Genuine unattended execution
needs a service-role Supabase client threaded through the repository
layer — a real, scoped follow-up deliberately not built in this pass,
since doing it properly means touching client construction in every
repository file built so far, a regression risk this module's own "No
regressions" criterion weighs against taking unasked. Today's real,
fully-working trigger is the manual "Run Scheduler Now" button
(Automation Dashboard), which runs in a real authenticated request and
works correctly end-to-end, exactly like Module 6's own "Run Rule Engine
Now."

**Workflow Engine** (`workflow_definitions`/`workflow_instances`/
`workflow_instance_steps`, `workflow-service.ts`) — genuinely new shared
infrastructure (Approval/Review/Exception/Audit workflow types, multi-
step definitions, per-step decisions). Wired to ONE real caller this
pass: a Recurring Template created with a `workflowDefinitionId` can
require approval before its first activation. **Deliberately NOT**
retrofitted onto already-shipped modules' own status-transition logic
(Purchase Orders' Submitted/Approved/Rejected, Journals' own workflow) —
real regression risk against this module's own completion criterion, not
worth taking without being asked; disclosed rather than silently skipped.

**Notification Centre** (`notifications`, `notification-service.ts`) —
real, in-app, replacing the workspace shell's previously hardcoded "2"
badge with a real unread count and dropdown (`notification-bell.tsx`).
`email_status` stays `NotSent` everywhere (no provider connected) — the
honest "infrastructure only" framing the PRB's own brief explicitly
permits.

**Automation Dashboard** (`/company/[companyId]/automation-dashboard`,
`automation-dashboard-summary-service.ts`) — every metric the PRB listed,
all real: Automation Rate, Tasks Executed Today, Tasks Waiting, Failed
Tasks, Retry Queue, Rule Success/Failure Rate, Scheduler Health (Healthy/
Degraded/Down, computed from the failed-task ratio), Average Processing
Time (from real run start/finish timestamps), Top Automated Processes,
Manual Intervention Rate. The Executive Dashboard gained 3 of the same
live tiles (Tasks Executed Today, Tasks Waiting, Scheduler Health) via
the identical shared summary function, so the two views can never
diverge — continuing the "replace Preview Mode with live operational
data" pattern established since Module 6.

**Audit Trail** (`automation_audit_log`, `automation-audit-service.ts`)
— one row per automated action, answering every question the PRB's brief
asked (who initiated it, what rule executed, why, what changed, what
journals, what documents, how long, reversible) — a cross-cutting record
spanning every module, complementing (not replacing) the existing per-
module history tables (`ae_allocation_history`,
`banking_rule_applications`, etc.), which stay the record of one specific
field changing.

**Performance**: keyset-paginated queries and the same "no DB-side
aggregate needed at this scale yet" approach as every prior summary
service — genuinely deferred rather than prematurely built, per the
PRB's own "do not optimise prematurely" instruction. No architectural
decision here (task queue shape, audit log shape, notification shape)
blocks scaling to background/queue-based execution later.

**Deliberately out of scope, disclosed:**
- True unattended (no session) Scheduler execution — see the Automation
  Scheduler section above; needs a service-role Supabase client.
- Bank-specific PDF-driven recurring document generation — inherits
  Module 6's own PDF deferral.
- A public holiday calendar — `skip_public_holidays` is real and
  respected by `computeNextRunDate`, but with an empty holiday set (no
  jurisdiction-specific calendar source exists anywhere in this
  codebase); future-ready, per the PRB's own "(future-ready)" annotation.
- Bespoke rich line-item editors per recurring document type (10 distinct
  shapes) — `document_payload` is authored via a structured JSON editor
  with a real per-type placeholder shape shown inline, rather than 10
  custom form builders; every BACKEND generation path is fully real.
- Retrofitting the Workflow Engine onto Purchase Orders'/Journals' own
  existing approval logic — disclosed above, a deliberate regression-risk
  decision.
- Domains beyond Banking (Sales/Purchasing/Inventory/GeneralLedger/
  Reporting/CustomerCommunications/SupplierCommunications) have real
  schema, validation, and UI to author rules in, at the same one-generic-
  rule-type-per-domain granularity the PRB's own brief specified (it
  named domains, not sub-types, for these — unlike Banking's explicit
  12); no bespoke evaluator wires them into a live pipeline yet, the same
  honest "real but unlinked" gap Module 6 disclosed for Payroll/Loan rule
  types. **VAT is no longer in this list** — Module 8 (below) wired a
  real evaluator (`vat-rule-service.ts`).

## VAT Intelligence status in detail

Module 8 per the Product Review Board's own naming and one of the most
consequential so far — statutory compliance, not just a calculation.
Research confirmed (before writing any schema) that VAT math was ALREADY
genuinely centralized: `splitGrossAmount`, called from exactly one place
(`buildJournalLinesFromRule` in `posting-rule-service.ts`), consumed
identically by every Sales/Purchasing/Inventory approve-and-post path.
There was no duplicated arithmetic to consolidate — what was genuinely
missing was a real VAT type taxonomy, effective-dated rate history, and
the VAT Return/Adjustment/Exception entities themselves, none of which
existed anywhere.

**"One VAT Engine"**: `server/vat/vat-engine.ts` does NOT reimplement
gross/net/vat splitting — `splitVat` is a thin wrapper around the exact
same primitive every other module already called. That primitive was
extracted from `posting-rule-service.ts` into a new, import-free pure
file (`server/general-ledger/amount-split.ts`) mid-build, after a real
production build failure surfaced a genuine architectural bug: the VAT
Intelligence tab is a Client Component, and it transitively imported
`posting-rule-service.ts` (for `splitGrossAmount`) — a file that ALSO
exports server-only functions calling Supabase, which pulled
`next/headers` into the browser bundle and failed the build outright.
The fix (extracting the pure function to its own zero-import file,
re-exported unchanged from `posting-rule-service.ts` for every existing
caller) is disclosed here because it's a real, general lesson for this
codebase going forward: a "pure" function sharing a file with
server-only siblings is not safely importable from a Client Component,
even via a named import.

**VAT Configuration** — `VatTreatment` (Company Management, "One
Business Object" — extended, not duplicated) gained a real `vatType`
column (Standard/ZeroRated/Exempt/OutsideScope/Import/Export/ReverseCharge,
backfilled correctly for all 6 seeded treatments) and a new
`vat_rate_history` table: every treatment has real effective-dated rate
history from the moment it exists (seeded retroactively for existing
treatments too), and `updateVatTreatment`'s existing `rate` parameter now
closes the currently-open history row and opens a new one instead of
silently overwriting the number every past calculation used — the exact
"Do not hardcode tax rates" / "Future tax-rate changes / Effective
dates" requirement, with ZERO change to the Tax Configuration tab's
existing Edit-Rate interaction (same button, same inline input; only
what happens underneath changed). Company-specific overrides were
already true (`vat_treatments` is company-scoped) — confirmed, not
rebuilt. Reverse Charge is real: a seeded 'Reverse Charge Self-Assessment'
posting rule (DR VAT Input / CR VAT Output, both the notional amount) —
net-zero cash effect, both VAT boxes populated, the standard South
African self-assessment mechanic for imported services.

**VAT Engine consumption**: Sales/Purchasing/Inventory already flowed
through `splitGrossAmount` before this module (confirmed by research);
Banking flows through it via the existing 'Bank Fee'/'Interest' rules;
Journals flow through it via any posting rule with a `vat` amount_source
line. Fixed Assets/Payroll are explicitly future modules per the PRB's
own roadmap — their "must consume the VAT Engine" requirement is
satisfied by the Engine already being domain-agnostic (`splitVat` takes
a gross amount and rate, nothing Sales/Purchasing-specific), not by
building placeholder Fixed-Asset/Payroll code now.

**VAT Intelligence** (`server/vat/vat-intelligence.ts`, pure, unit
tested): Missing VAT, Missing VAT Number, Incorrect VAT Code, Duplicate
VAT Claims, Suspicious VAT Values (reconciliation against the actual
effective rate, not just the type), Vendor/Customer VAT Anomalies
(same "N prior occurrences, 2.5x average" pattern as Banking
Intelligence), and Unusual VAT Trends (period-over-period, same pattern
`financial-intelligence-service.ts` already uses). Every signal carries
confidence/reasoning/suggestedCorrection — no bare label. "High-risk"
(`isHighRisk`) is a real composite (2+ independent signals, or one at
90%+ confidence), not a fabricated separate score.

**VAT Workspace** (`/company/[companyId]/vat`, 8 tabs exactly as
specified): Dashboard (Compliance Score, latest Return summary, top open
exceptions), Transactions (every VAT-bearing Sales Invoice/Supplier Bill
with drill-through to the customer/supplier page — no separate "VAT
transaction" object, a VAT-focused view over what Sales/Purchasing
already persist), Exceptions, Adjustments, Returns, Audit Trail
(reuses the shared `automation_audit_log` from Module 7 — no new audit
table), Intelligence (with a real "Run VAT Intelligence Now" trigger,
same pattern as Module 6/7's own manual triggers), Reports (a real
per-treatment VAT breakdown plus Return history, computed from the same
data every other tab uses).

**VAT Return**: generated from live VAT Input (2100) / VAT Output (2200)
account activity via the existing `account-activity-service.ts` — no
second GL query path. Draft -> Review -> Approved -> Submitted, with
Recalculate (Draft only), and Amendments (only from a Submitted return).
Approving a return posts a real settlement journal
(`buildVatSettlementJournalLines`) that clears the period's VAT Input/
Output balances into a new VAT Control (2300) account — a genuinely
bespoke line-builder (its two amounts are independent period-end GL
balances, not a single gross-amount split, so it can't be a standard
`posting_rules` event) that still terminates at the same
`postApprovedJournals` Posting Engine every other document type uses,
the same precedent as `journal-service.ts`'s own bespoke bank-transaction
line builder. "Do not implement electronic SARS submission yet... build
a clean submission interface ready for a future SARS integration":
Submit is real and manual (Approved -> Submitted, with an optional SARS
reference field); `submissionMethod: 'SARS_eFiling'` is accepted by the
schema and shown in the UI as a **visibly disabled** button with an
explanatory tooltip — no fabricated submission logic exists behind it.

**VAT Exception Centre**: `vat_exceptions`, same shape as Banking
Exceptions (Module 6) — reason/evidence/recommended-action/status/
resolution-history — a separate table since the exception-type
vocabulary (Missing VAT Number/Incorrect VAT Code/Unexpected VAT
Percentage/Large VAT Adjustment/Duplicate VAT Claim/VAT Rate Conflict/
Cross-Period VAT) and the document types it links to are genuinely
different from Banking's.

**Rule Engine integration**: VAT is now a real, LIVE domain of the
platform's ONE Rule Engine (`banking_rules`, `domain = 'VAT'`) —
`vat-rule-service.ts` reuses the exact same
`evaluateTransactionAgainstRules` every other domain calls, closing the
"real schema, no evaluator yet" gap Module 7 disclosed for VAT
specifically. A `flag_for_review` action raises a real VAT Exception,
never a silent skip.

**Audit Readiness**: every VAT Return generation/recalculation/approval/
submission/amendment and every posted VAT Adjustment records into the
shared `automation_audit_log` — source transaction, rule applied (where
one fired), journal(s) generated, user approval, and reversibility are
all real, queryable fields today, ready to feed the future Auditor
Workspace without a new table.

**Dashboard**: replaced a genuine, previously-hardcoded Preview Mode
placeholder — `dashboard/page.tsx`'s "VAT Exceptions" tile literally read
`value: "3"` regardless of real data. Now computed via the same shared
`buildVatDashboardSummary` the VAT workspace itself uses; VAT Payable and
VAT Compliance Score were added alongside it.

**Deliberately out of scope, disclosed:**
- Electronic SARS submission (VAT201 e-filing), SARS correspondence
  history, and live compliance-status lookups — the PRB's own explicit
  deferral. `sars_reference`/`submission_method` are real schema/UI
  extension points; no submission logic exists behind them.
- Per-line VAT splitting — inherited from the Sales Platform's own
  design boundary (`buildJournalLinesFromRule` supports one blended rate
  per event); upgrading that would be a Posting Engine change, not a VAT
  module change.
- Fixed Assets/Payroll VAT consumption — those modules don't exist yet
  (both explicitly future, per the PRB's own updated roadmap); the
  Engine itself is already domain-agnostic and ready for them.
- A public holiday-aware "Cross-Period VAT" boundary beyond the raw date
  comparison — inherits the same "no jurisdiction calendar source yet"
  gap already disclosed for Module 7's `skip_public_holidays`.

## Financial Reporting & Executive Intelligence status in detail

**Schema** (`0016_financial_reporting_platform.sql`): `projects` (a real
master table mirroring Branches/Departments/Cost Centres exactly — the
4th Management Reporting dimension, genuinely new) plus a
`chart_of_accounts.project_id` FK; `budgets` (account + financial year +
optional dimension scoping + amount, for Budget vs Actual);
`report_definitions` (`report_type` CHECK, `columns`/`groups`/`filters`/
`calculated_fields` jsonb — the Report Designer's persistence, no
hardcoded layouts); `executive_alerts` (the same rich reason/evidence/
recommended-action/resolution-history shape Banking/VAT Exceptions
already established, chosen over the lighter `notifications` shape —
still fires a companion `notifications` row so the bell icon surfaces it
too). Every new table follows the standing `user_can_access_company`
RLS pattern.

**"Everything generated from live accounting data. No duplicated
calculations."** — taken literally: `fn_trial_balance` has no date-range
parameter, only a point-in-time `asOfDate`, so every period figure in
this module is computed by calling the SAME real Trial Balance twice and
diffing the two snapshots (`income-statement-engine.ts::
computePeriodMovements`) — never a second GL query path, never a
per-account loop. `balance-sheet-engine.ts` reuses one Trial Balance
snapshot directly; `cash-flow-engine.ts` reuses `computePeriodMovements`
a third time rather than re-deriving it. The Cash Flow engine's indirect
method is provably exact, not approximate: because every journal this
platform posts is balanced by construction, Net Profit plus the full
working-capital movement of every non-cash Balance Sheet account is
mathematically guaranteed to equal the real cash accounts' own period
movement — `reconciliationVariance` is a genuine ledger-integrity check,
not decoration (see that file's own docstring for the algebraic proof).
This platform has no year-end closing mechanism (P&L accounts are never
swept to Retained Income), so `balance-sheet-engine.ts` folds the
current period's unclosed Net Profit into Equity as an explicit "Current
Year Earnings" line — what a real closing entry would eventually
produce, honestly labelled as such rather than hidden.

**"One Forecast Engine"**: `forecast-engine.ts::linearRegressionForecast`
is the ONE function every forecast type calls — real ordinary
least-squares regression, confidence derived from R² (never invented,
never overstating certainty), every result disclosing its `method` and
`assumptions`. `forecast-service.ts` supplies each type's real
historical series: Cashflow/VAT/Inventory reuse the same "diff Trial
Balance snapshots at successive month-ends" technique (VAT via account
`2300`, Inventory via account `1500` — both real, already-seeded control
accounts, confirmed by research before this was built); Revenue/Expense
reuse the Income Statement engine per month; Customer/Supplier Payment
Forecasts reuse each domain's own already-built `computeAveragePaymentDays`
(customer and supplier versions are deliberately separate functions,
matching this codebase's existing module-boundary precedent), bucketed
by month rather than a new payment-behaviour calculation.

**Scoring** (`scoring-engine.ts`): Financial Health, Business Risk, and
Audit Readiness Scores are disclosed, transparent formulas over real
counts the caller supplies — every deduction traces to a specific,
named, visible cause (an unbalanced Balance Sheet, an open exception, a
stale unposted journal), same discipline VAT's own `computeComplianceScore`
already established. The Compliance Score is that exact same function,
reused — not reimplemented — for the Executive Command Centre.

**"Do not create another AI engine. Consume the existing Intelligence
infrastructure. Expand it."** — `executive-intelligence-service.ts`
detects nothing new by itself where a real detector already exists.
`normalizeFinancialIntelligence` is the one new piece of logic: it
reconciles `financial-intelligence-service.ts`'s four bespoke signal
shapes (confirmed by research to NOT already conform to the common
`{kind, message, reasoning, confidence}` shape every other Intelligence
module uses) into that common shape, without touching the underlying
detectors. `detectAndRaiseExecutiveAlerts` scans real thresholds across
existing services (Cashflow Forecast trend, Income Statement margin
period-over-period, Inventory summary, open VAT/Banking Exceptions,
Automation Task failures, Financial Intelligence's own duplicate/largest-
movement signals, supplier purchase concentration, customer payment-days
trend, debtors movement via two Balance Sheet snapshots) and raises an
`ExecutiveAlert` per breach via `raiseAlert`, which is idempotent — an
explicit existence check before insert closes the gap where the table's
own unique constraint can't dedupe company-wide (non-document-scoped)
alerts, since Postgres treats NULL as distinct in a unique index.

**Report Designer**: form-based (pick a report type → a fixed real
per-type column list → save), not drag-and-drop — but nothing about a
report's layout is hardcoded in a page template; it's persisted to
`report_definitions` and read back. Calculated fields use a small, safe
`left <op> right` evaluator (`evaluateCalculatedFields` in
`report-definition-service.ts`) — deliberately not `eval()`/`new
Function()`.

**Dashboard Integration**: replaced every remaining confirmed-fake tile —
`recoveredThisMonth`/`outstandingRecovery` (hand-typed "R 1.84M"/"R
1.33M") became real Net Profit (MTD) and Business Risk Score;
`aiConfidence: "High"` became a real Audit Readiness Score; the HERO_CHIPS
"Automation Score 96.2%" now reads the SAME real `bankingAutomationSummary
.automationRatePercent` already computed elsewhere on the page (it had
simply never been wired into that chip); "AI Confidence" in HERO_CHIPS
became a real Financial Health Score; "Today's Activity: 184" became a
real sum of today's imports/rules-applied/tasks-executed; the static
"Last updated: 07:34 AM" string became the page's actual server render
time; the hardcoded "↑ R 24.6K (4.8%) Movement Today" became the real net
movement across every bank transaction dated today. Drill-through follows
the established `Button href` "View all" convention — Financial
Statement line items link into General Ledger's existing Account
Activity page (`general-ledger/[accountId]`), completing the Net Profit
→ Income Statement → Account → source-transaction chain without a new
modal/panel pattern.

**Deliberately out of scope, disclosed:**
- Full GAAP-compliant Consolidation (eliminations, intercompany
  adjustments, currency translation) — no parent/subsidiary schema
  exists anywhere (`companies.organisation_id` links to one flat
  `organisations` row only); a real multi-company roll-up would need new
  schema and belongs to a future module, per the PRB's own updated
  roadmap.
- Full "Project" dimension adoption — the `projects` table and
  `chart_of_accounts.project_id` are real, but assigning a project on
  every transaction-entry form across Sales/Purchasing/etc. was not
  built; that would touch many already-shipped forms, out of proportion
  to this module. Mirrors the same "real infra, limited UI adoption"
  pattern already used for Branch/Department/Cost Centre.
- PDF export via a new library — Report Designer/Statement "Print/PDF"
  follows Trial Balance's own established zero-dependency precedent
  (the browser's native `window.print()`), not a new PDF package.
- Electronic filing/automated distribution of reports — not requested,
  not built.
- Forecasts as genuine statistics, not machine learning — one
  transparent linear-regression method, disclosed confidence from R²,
  explicitly not a claim of predictive certainty beyond what the method
  supports.
- Supplier Risk / Customer Payment Forecast detectors fetch full
  company-wide bill/invoice/payment lists rather than a pre-aggregated
  summary table — real and correct at this data volume, but a future
  scale pass (server-side aggregation) would be the natural next step if
  transaction counts grow into the hundreds of thousands, the same
  caveat every other Intelligence-over-a-full-list function in this
  codebase already carries.

## Auditor Workspace status in detail

**"Leverage the existing Audit Trail. Do not build another audit log."**
— taken literally: `0017_auditor_workspace.sql` adds NO logging table.
`audit_findings` is a results/evidence table (what a test or intelligence
detector produced), not an action log — a genuinely different, additive
concern, shaped identically to `vat_exceptions` for consistency. The real
drill-through chain this module surfaces (Business Event → Journal → GL →
Financial Statements → Source Documents → Automation History → Rule
History → User Actions) is composed entirely from tables that already
existed before this module: `ae_journals` (`source_type`/`source_id`),
`gl_transactions.journal_id`, and `automation_audit_log` — confirmed by
research before writing anything, which also confirmed
`automation_audit_log` is automation-triggered only (not a general
action log), so it's read as ONE evidence source among several, not
treated as if it recorded everything.

**"Do not create a separate audit engine when existing platform services
can be extended"** — applied at every layer:
- Of the 18 Audit Tests, 3 are thin wrappers around detectors that
  already existed (`runDuplicatePaymentsTest` wraps
  `detectDuplicatePayments` from Banking Intelligence,
  `runDuplicateJournalsTest` wraps `findPossibleDuplicateJournals` from
  Financial Intelligence, `runDuplicateVatClaimsTest` wraps
  `detectDuplicateVatClaims` from VAT Intelligence) — confirmed by
  research that no duplicate-supplier/customer, sequence-gap, posting-
  date, Benford, suspense-account, or negative-balance test existed
  anywhere, so those 15 are genuinely new pure functions in
  `audit-tests-engine.ts`.
- Audit Intelligence (`audit-intelligence-service.ts`) detects nothing
  by itself: Unusual Trend/Material Misstatement/Revenue Manipulation
  reuse Module 9's own normalized Financial Intelligence signals
  (`getExecutiveIntelligence`), Compliance Risk reuses `buildVatIntelligence`
  directly, Going Concern Risk reuses Module 9's own Financial Health/
  Business Risk Scores unchanged, and Control Weakness/Fraud Indicator/
  High-Risk Journal/High-Risk User are real aggregations OVER the Audit
  Tests that just ran (e.g. a journal flagged by 2+ independent tests
  becomes a High-Risk Journal) — composition, not a second detection
  layer. Related-Party Indicators are deliberately never raised:
  research confirmed no related-party data exists anywhere in Customer/
  Supplier records, so fabricating a finding for a category with no real
  data source would violate "never present unsupported conclusions" —
  disclosed here and in the Auditor Workspace UI, not silently skipped.
- The Audit Readiness Score shown on the Audit Dashboard, the Executive
  Dashboard, and the Reports workspace is the SAME number —
  `getExecutiveIntelligence`'s `auditReadinessScore` (Module 9's
  `computeAuditReadinessScore`), read once and displayed in three places,
  never recomputed.
- The Audit Dashboard's other 12 metrics (Material Issues/High-Risk
  Areas/Outstanding Exceptions/Reconciliation Status/Internal Control
  Exceptions/VAT-Financial-Reporting-Inventory-Revenue-Recognition-
  Journal Risk/Going Concern Indicators) are pure aggregations of
  `audit_findings` in `audit-dashboard-summary-service.ts`
  (`buildAuditDashboardSummary`, mirroring `vat-summary-service.ts`'s
  own pattern) — the Executive Dashboard's new Audit Readiness tile row
  calls this exact same function, so the two workspaces can never
  quietly restate the same numbers differently.

**AI Audit Assistant — an honest scope, not a fabricated NLP
integration.** This codebase has no LLM/AI engine to route free text
through, and inventing one would violate the platform's own "never
present unsupported conclusions" rule. `audit-assistant-engine.ts`
instead answers from a FIXED catalog of the Product Review Board's own
example questions, matched by real keyword-overlap scoring
(`matchAuditQuestion`) — never a general NLP call. Every answer states
Evidence, Supporting Transactions, Calculations, Confidence, Source
References, and Alternative Interpretations; a question with no keyword
match, or one this platform genuinely can't answer yet (Payroll
comparison — no Payroll module; Related-party transactions — no
related-party data; Recalculate depreciation — no Fixed Assets module,
all three disclosed future roadmap items), returns an honest
zero-confidence "not answerable yet" response naming exactly why,
instead of a guess. "Show transactions just below approval thresholds"
substitutes the Audit Engagement's own Performance Materiality, since no
configurable approval-threshold setting exists anywhere in the platform
(confirmed by research) — disclosed as a real, related-but-different
interpretation in the answer itself, not silently assumed.

**Working Papers are generated from live data, never hand-typed:**
`buildLeadSchedule` groups the same `TrialBalanceRow[]` the Trial
Balance page renders; `buildAccountAnalysisPaper` wraps the existing
`AccountActivity` shape verbatim; `buildReconciliationPaper` buckets the
same real `AllocationStatus` values Supplier Reconciliation already
uses; `buildSamplingListPaper` uses systematic sampling (every Nth item,
a real audit technique) rather than `Math.random()`, so a given
population + sample size always produces the same, reproducible sample.

**A second instance of the session's one recurring build bug, caught and
fixed the same way**: production build failed identically to the VAT
module's earlier "next/headers in a Client Component" failure —
`audit-assistant-tab.tsx` (Client Component) imported
`audit-assistant-engine.ts`, which imported `findUnusualGrowth` from
`financial-intelligence-service.ts`, a file that ALSO does
`import * as glRepo from "@/server/repositories/gl-repository"` (server-
only). Fixed identically: extracted `aggregateMovementsByAccount`/
`findUnusualGrowth`/`shiftPeriodBack`/`AccountMovement`/
`UnusualGrowthAlert` into a new zero-import pure file
`server/general-ledger/growth-analysis.ts`;
`financial-intelligence-service.ts` re-exports all five unchanged for
its existing server-only callers, while `audit-assistant-engine.ts`
imports directly from the new pure file (the re-export alone would NOT
have fixed the client-bundle problem — the client-reachable import path
itself has to point at the zero-import file, exactly as `vat-engine.ts`
was updated to import `amount-split.ts` directly rather than through
`posting-rule-service.ts`). Documented here as the second occurrence of
the same lesson, for whichever future module builds its own Client-
Component-facing pure engine next.

**Deliberately out of scope, disclosed:**
- Related-Party Indicators — no related-party data exists anywhere
  (confirmed by research); real master-data capture would need to be
  added to Customer/Supplier before this can be answered honestly,
  either by the Assistant or by Audit Intelligence.
- Payroll comparison and Depreciation recalculation — both need modules
  that don't exist yet (Payroll, Fixed Assets & Depreciation), both
  already on the Strategic Roadmap.
- A configurable per-workflow approval threshold — doesn't exist
  anywhere in the platform (confirmed by research); the "below
  threshold" test/question substitutes Performance Materiality, a
  related but different concept, disclosed in the answer itself.
- A jurisdiction-specific public holiday calendar — `runHolidayPostingTest`
  is real and takes a real `holidayDates` list, but that list is always
  empty by default (same disclosed gap `recurrence.ts`'s
  `skip_public_holidays` already carries).
- Free-text natural-language question parsing — the AI Audit Assistant
  answers from a fixed, evidence-backed catalog by keyword-overlap
  matching, not a general NLP/LLM integration.
- Document-level "missing supporting documents" detection — this
  platform has no file/document-attachment system, so "missing
  supporting documents" is interpreted as a manual journal with an empty
  reference field, a real but narrower proxy, disclosed as such.

## Fixed Assets status in detail

**Schema** (`0018_fixed_assets_platform.sql`): `seed_company_defaults()`'s
6th definition adds 8 real Fixed Asset accounts (Fixed Assets - Cost
`1600`, Accumulated Depreciation `1650` — a real Credit-normal Asset-
type contra-account, confirmed by research to flow through
`balance-sheet-engine.ts` correctly with zero code changes — Accumulated
Impairment `1660`, Revaluation Surplus `3100`, Profit/Loss on Disposal
`6250`/`6600`, Depreciation Expense `6500`, Impairment Loss `6700`) and 4
real `posting_rules` (Asset Acquisition, Asset Improvement, Asset
Revaluation Increase, Asset Impairment), plus `asset_classes`,
`fixed_assets`, `asset_lifecycle_events`, `depreciation_runs`/
`depreciation_run_lines`, and `asset_findings`. One new
`audit_findings.finding_type` value, `AssetRisk`, closes the loop back
into Module 10.

**"One Depreciation Engine"** — `depreciation-engine.ts`'s
`runDepreciationForAsset` is the ONE function every caller (a
Depreciation Run, the deterministic forecast, a useful-life
recalculation) goes through for every method (Straight Line, Diminishing
Balance, Units of Production framework-ready, Custom as a real, honest
extension point returning 0 rather than guessing). A genuine formula bug
was caught by the test suite before shipping: Diminishing Balance's rate
was initially applied to `(NBV - residual)` instead of the full NBV,
double-applying the residual-value floor and understating depreciation
relative to the standard reducing-balance method — fixed once the test
(`expected 1666.67, got 1466.67`) failed, a concrete example of the
established "tests verify correctness, not just that code runs"
discipline paying off.

**"Every depreciation run must post through the existing Posting
Engine"** — taken literally two ways. Acquisition/Improvement/
Revaluation Increase/Impairment are plain two-line gross-amount events
and go through the real seeded `posting_rules` via the same
`buildJournalFromEvent` -> `journalRepo.createJournal` ->
`postApprovedJournals` pattern every other document type in this
platform uses (verbatim from `sales-invoice-service.ts::approveAndPostInvoice`).
A Depreciation Run and a Disposal are structurally different — a run
posts ONE consolidated journal across every depreciated asset (real
accounting practice, not one journal per asset) and a disposal clears
three independent balances (cost, accumulated depreciation, accumulated
impairment) against proceeds and a plugged gain/loss — so both use a
bespoke-but-real pure line builder in `asset-lifecycle-engine.ts`
(`buildDepreciationRunJournalLines`/`buildAssetDisposalJournalLines`),
the exact same precedent as `vat-engine.ts::buildVatSettlementJournalLines`,
both still terminating at the same `postApprovedJournals`. The disposal
builder's balance proof (gain case and loss case both reduce to an
identity) is worked through in its own docstring and verified by tests
constructing both a gain and a loss disposal. Write-off and Retirement
reuse the SAME disposal builder with `proceeds = 0` — never a third
formula. Transfer and Capitalisation are dimensional/status changes with
correctly NO journal (moving an asset between cost centres doesn't move
money) — a disclosed scope decision, not an omission.

**A third occurrence of the session's one recurring build bug — caught
before it shipped this time, not after.** Having now fixed the same
"next/headers in a Client Component" failure twice (VAT module, Auditor
Workspace), every pure engine in this module (`depreciation-engine.ts`,
`asset-lifecycle-engine.ts`, `asset-intelligence-engine.ts`) was written
from the start with zero imports from any server-only file, and no
Client Component in the Fixed Assets UI imports anything outside
`server/assets/*` and `server/services/asset-*-service.ts`'s type-only
exports — confirmed by a clean production build on the first attempt,
unlike the two prior modules.

**Asset Intelligence** — all 10 signal types are real and computed, with
two honestly narrowed to the closest defensible proxy where this
platform genuinely lacks a richer data source (both disclosed in
`asset-intelligence-engine.ts`'s own doc comments, not silently
assumed): High Maintenance Risk uses "stuck in `UnderMaintenance` status
for 14+ days" (no maintenance-ticket system exists), and Impairment
Indicator uses "Active, within useful life, but zero depreciation posted
across the last 2 runs" (no market-valuation data source exists) — both
real, computed, audit-relevant signals in their own right, not
fabricated substitutes. Underutilisation and Idle Asset share one real
data source (`status`/`statusChangedAt`) at two severity thresholds (30
and 90 days), the same "two severities of one signal" pattern
`executive-intelligence-service.ts` already uses for Declining Cash
detection tiers.

**Auditor Workspace integration** — `audit-intelligence-service.ts`
gained one more composition block (its existing pattern needed no
restructuring, confirmed by research before writing anything): open
Asset Findings with confidence >= 0.7 cross over into `audit_findings`
as the new `AssetRisk` type, so the Auditor Workspace's Findings tab and
its Material Issues/Outstanding Exceptions dashboard counts already
include real asset risk without any Auditor Dashboard tile changes (the
generic Intelligence-category aggregates pick it up automatically).

**Dashboard Integration**: Total Asset Value/Net Book Value/Depreciation
This Month/Assets Due for Replacement/Warranty Expiry/Impairment
Alerts/Asset Health Score all reuse the exact same
`buildAssetDashboardSummary` the Fixed Assets workspace's own Dashboard
tab calls — no duplicated calculation, same discipline as every prior
module's Dashboard tiles.

**Deliberately out of scope, disclosed:**
- Real file/image upload for the Asset Register's "Images"/"Documents"
  fields — confirmed by research that NO Supabase Storage or any file-
  persistence mechanism exists anywhere in this codebase (Import
  Centre's `sourceFilename` is a filename string only, never the file
  itself); `image_url`/`document_url` are real text-reference fields,
  the same disclosed convention, ready for real storage to be wired in
  later without a schema change.
- Asset Categories/Groups as full CRUD master tables — kept as free-text
  classification fields directly on `fixed_assets` rather than two more
  master-data tables alongside the real `asset_classes` table; a
  disclosed scope decision, matching the session's "Project dimension,
  limited UI adoption" precedent.
- A downward revaluation modeled as a genuine revaluation reversal
  (crediting a prior surplus before hitting P&L) — this platform models
  any decrease below cost as a straight Impairment instead; a real,
  disclosed simplification, not a GAAP-compliant revaluation model
  (that's explicitly the next module's territory).
- Units of Production depreciation is framework-ready but not fed real
  production-unit data — no metering/IoT source exists yet (the exact
  gap the PRB's own "Future Integration" section names and asks NOT to
  be fabricated).
- Barcode/QR/RFID scanning, maintenance-system/fleet-management/IoT
  telemetry integrations — genuinely no extension-point code was written
  beyond the real `serial_number`/`location`/`custodian`/status fields
  already on `fixed_assets`, which are the natural attachment points a
  future integration would key off; nothing fabricated per the PRB's
  explicit "create extension points only" instruction.

## AI Executive Copilot status in detail

**Module 12 per the Product Review Board's own naming** — the platform's
first Executive Workspace, and the first module to explicitly name "One
Pure Calculation Library" as a standing architectural principle
alongside "One Posting Engine"/"One Rule Engine"/"One VAT Engine"/"One
Audit Trail"/"One Intelligence Layer" established across Modules 6–11.
No LLM/NLP integration exists or was built anywhere in this module —
the same discipline established for the Auditor Workspace's AI Audit
Assistant (Module 10), which this module's Q&A engine deliberately
mirrors rather than reinvents.

**Schema** — `supabase/migrations/0019_ai_executive_copilot_platform.sql`
adds three tables, all RLS-gated via the existing
`user_can_access_company(company_id)`: `copilot_scenarios` (a
`scenario_type` CHECK across the PRB's own 6 named scenarios:
SalesIncrease/ReceiptDelay/SupplierPriceIncrease/AssetReplacement/
OpexReduction/Hiring; stores `parameters`/`results` as JSONB — an
immutable record of what was modeled, never a live balance), 
`copilot_narratives` (a `narrative_type` CHECK across the PRB's own 8
named narrative types), and `copilot_briefings` (one row per company per
day, `unique(company_id, briefing_date)`, upserted so re-generating
today's briefing replaces rather than duplicates it).

**`copilot-assistant-engine.ts`** — the fixed-catalog Q&A pattern first
established by `audit-assistant-engine.ts` (Module 10), applied here to
the Product Review Board's own 10 example executive questions
(`SUPPORTED_COPILOT_QUESTIONS`, matched from free text via real
keyword-overlap scoring in `matchCopilotQuestion`). Every `CopilotAnswer`
carries the PRB's full required shape — Executive Summary, Confidence,
Evidence, Calculations Used, Transactions/Journals/Documents Consulted,
Suggested Actions, and Alternative Explanations where appropriate — and
an unmatched or currently-unbuildable question returns an honest
`unavailableAnswer(...)` with `confidence: 0`, never a guess. Two
questions ("Which customers present the highest credit risk?", "Which
suppliers should we renegotiate with?") had no existing company-wide
ranking function anywhere in the codebase — confirmed by research that
only per-entity functions exist (`getCustomerFinancialSummary`,
`getSupplierFinancialSummary`) — so `copilot-assistant-service.ts`
composes them via an accepted N+1 loop over `listCustomers`/
`listSuppliers`, the same pattern Module 10's per-asset intelligence
loop already established at this platform's scale. "Why has inventory
increased?" had no historical/dated inventory-value function either
(`buildInventoryDashboardSummary` is current-state-only), so it reuses
the same `getTrialBalance` two-snapshot-diff technique
`financial-statements-service.ts` itself already established, against
the real Inventory control account (`1500`, seeded by Module 11) — not a
new calculation.

**`narrative-engine.ts`** — "One Pure Calculation Library" applied
concretely: `buildFinancialNarrative` is the single function behind
Month-End, Quarter-End, Year-End, Board Pack, and Management Report
narratives (the PRB's own 5 period-summary types), differing only in the
caller-supplied title, never in calculation. Cash-Flow Commentary,
Budget Variance Explanation, and Profitability Commentary are genuinely
different input shapes and get their own builders, but every number in
every narrative traces to an Income Statement/Balance Sheet/Cash Flow
Statement/Budget row already fetched from `financial-statements-service.ts`/
`budget-service.ts`. Every `Narrative` explicitly separates `facts` (a
plain restatement of a real number) from `interpretations` (a labeled
inference) per the PRB's own "must clearly distinguish facts from
interpretations" requirement.

**`scenario-engine.ts`** — 6 pure, stateless simulators, one per PRB
scenario. `simulateAssetReplacement` reuses
`depreciation-engine.ts::computeMonthlyDepreciationAmount` directly
rather than a second depreciation formula — verified by a test asserting
the exact same figure `depreciation-engine.test.ts` established for the
same inputs. `simulateHiring` honestly discloses "No Payroll module
exists in this platform yet" and uses a flat monthly salary-cost proxy,
matching the PRB's own "future payroll integration" framing rather than
fabricating a real payroll calculation. `copilot_scenarios` only ever
persists a scenario's computed INPUT and OUTPUT — no simulator touches a
live accounting table — so "Scenarios must be isolated and never modify
live accounting data" is satisfied by construction, not by convention.

**`executive-briefing-engine.ts`** — a pure composer over
already-computed scores: Financial Health/Business Risk/Audit
Readiness/Compliance from Module 9's `getExecutiveIntelligence`, Asset
Health from Module 11's `buildAssetDashboardSummary`. `bandScore` turns
a raw score into a `Strong`/`Adequate`/`Weak`/`Critical` label (with a
`direction` param since Business Risk is inverted — lower is better);
Major Alerts and Opportunities are the caller's real signal list ranked
by confidence; Recommended Actions are derived only from scores that are
actually Weak/Critical, each naming the specific score that triggered
it. "Every statement must be traceable to live data" is satisfied
because nothing in this file invents a sentence — every one either
restates a number the caller passed in or is generated from a real
signal.

**Dashboard Integration** — the Executive Dashboard gained one new
additive "Copilot Insights" card (Major Alerts / Opportunities /
Recommended Actions from the latest already-generated daily briefing),
placed after the existing Recent Journal Entries card. It never
generates a briefing itself (viewing the Dashboard never writes a
`copilot_briefings` row) — it only surfaces the latest one via
`listCopilotBriefings(companyId, 1)`, with an honest empty state
("Generate today's briefing in the Executive Copilot workspace") when
none exists yet. Every existing KPI tile in `EXEC_SUMMARY` is untouched
— "Insights complement metrics; they do not obscure them," per the
PRB's own instruction.

**Auditor Workspace / Fixed Assets consumption** — `askCopilot`'s
"biggest financial risks today" answer and the daily Executive Briefing
both compose open signals from `getExecutiveIntelligence`,
`listAuditFindings`, and `listAssetFindings` — the same three real
Intelligence sources, read directly, never re-detected. "This is a
consumer of the existing intelligence layer — not a replacement for
it," confirmed architecturally: no new signal-detection logic exists
anywhere in this module.

**Deliberately out of scope, disclosed** — exactly the PRB's own
"Future Readiness" list, and nothing beyond real extension points was
built for any of it:
- Voice interaction, natural-language free-text routing beyond the
  fixed keyword-matched catalog, document reasoning, meeting summaries,
  board reporting, and regulatory reporting — no code was written for
  any of these; the fixed-catalog Q&A pattern itself is the honest
  substitute for free-text NLP the PRB's own guardrails require
  ("never present unsupported conclusions").
- No third-party/external AI service of any kind is called anywhere in
  this module — every answer, narrative, scenario, and briefing is
  computed entirely from this platform's own already-real data.
- Payroll-driven Hiring scenario math — disclosed in
  `simulateHiring`'s own assumptions list, not fabricated.

## Financial Statements & Disclosure Engine status in detail

**Module 13 per the Product Review Board's own naming** — "the final
major accounting capability before moving into production hardening and
enterprise integrations." At this point the Product Review Board
considers VYRON FINANCE's functional architecture ~90–95% complete; the
remaining roadmap is production maturity, integrations, performance,
security, and deployment, not further accounting modules. "The objective
is not simply to print financial statements — the objective is to
generate professional, standards-compliant financial reporting supported
by complete audit traceability," and every piece below was built against
that bar, reusing rather than restating.

**Schema** — `supabase/migrations/0020_financial_statement_disclosure_engine.sql`
adds exactly two tables, both RLS-gated identically to every prior
table: `disclosure_notes` (one row per company/period/note-type, `unique
(company_id, period_start, period_end, note_type)`, upserted on
regeneration) and `reporting_packages` (a persisted snapshot of which
real statements/notes/narrative were bundled at generation time — the
same "store the artifact, not a second calculation" convention
`copilot_narratives`/`audit_working_papers` already established). No new
calculation table exists — the Statement of Financial Position/Profit or
Loss/Cash Flows already existed (Module 9).

**`equity-engine.ts`** — the 4th primary statement, `buildStatementOfChangesInEquity`,
reuses `income-statement-engine.ts`'s own exported `computePeriodMovements`
rather than a 4th GL-diffing implementation, and — exactly like
`balance-sheet-engine.ts`'s synthetic "Current Year Earnings" line — adds
one synthetic "Profit for the Period" row (never attributed to a real
account, since this platform has no year-end closing mechanism). A test
asserts `totalClosingBalance` is IDENTICAL to `buildBalanceSheet`'s
`equity.total` for the same date and Net Profit figure — the two
statements can never diverge. `financial-statements-service.ts::getStatementOfChangesInEquity`
is documented to be called with `periodStart = financialYearStartDate`
for the standard annual reconciliation — the only way the statement's
real opening balance and its year-to-date synthetic Profit row describe
the same window without double-counting.

**`disclosure-engine.ts`** — 11 pure note builders, one per the PRB's own
list. Every note returns `{facts, placeholders}`; `requiresUserInput` is
true whenever `placeholders.length > 0`. Real, computed facts exist for
6 note types (Fixed Assets from `asset-dashboard-summary-service.ts`,
Inventory from `inventory-summary-service.ts`, VAT from
`vat-summary-service.ts`, Revenue/Expenses from the Income Statement,
Accounting Policies from the actual depreciation methods/VAT types
configured); Estimates derives one real fact (the useful-life range
actually in use across active assets) and otherwise stays honest. Three
note types (`RelatedPartyTransactions`/`CommitmentsAndContingencies`/
`EventsAfterReportingDate`) have NO data source anywhere in this
codebase — confirmed by research before writing anything — and are pure
placeholders by construction, not a gap in this engine. Regenerating a
note (re-running the engine against fresher data) never discards a
preparer's own commentary: `disclosure-note-repository.ts::upsertGeneratedDisclosureNote`
fetches the existing row's `user_notes` before upserting and re-applies
it, so `generated_content`/`requires_user_input` refresh while
`user_notes` persists.

**`audit-trail-link-engine.ts`** — closes the drill-through chain the
PRB specifies (Financial Statement → Disclosure Note → General Ledger →
Journal → Business Event → Source Document → Audit Working Paper →
Audit Finding). The first five links already existed (a statement line
already carries its `accountId`; the Account Activity page already lists
every GL transaction with its Journal, and each Journal already carries
`sourceType`/`sourceId` — the Business Event/Source Document). This file
closes the last two links honestly: `findRelatedAuditFindings` filters
`audit_findings` by the real `relatedType`/`relatedId` tags
`audit-tests-engine.ts` already sets (`"chart_of_account"`/`"journal"`/
`"gl_transaction"`), and `findRelatedWorkingPapers` filters
`audit_working_papers` by the real account code already inside their own
generated `content` (a Supporting Schedule/Account Analysis's header, or
a Lead Schedule's line items) — no new detector, a real filter over data
that already exists. Surfaced as a new "Audit Evidence" card on the
EXISTING Account Activity page (`account-activity-view.tsx`) — the one
page every statement line already drills through to — rather than a new
page, so the chain closes at its natural end point.

**`reporting-package-engine.ts`** — "Each package should reuse existing
report generators and narrative engines." `determinePackageSections` is
a pure rule table (no data): a Management Pack stays lean (3 core
statements + a management narrative); a Board Pack adds the Statement of
Changes in Equity; an Accountant Pack adds the Trial Balance summary and
every disclosure note; an Auditor Pack adds the Audit Readiness
Score/open findings count on top. `reporting-package-service.ts` fetches
every piece exactly once from an existing service — including reusing
`narrative-engine.ts::buildFinancialNarrative` (Module 12's own pure
function) directly rather than persisting a redundant
`copilot_narratives` row on every package generation.

**`reporting-readiness-engine.ts`** — the same "100 minus a real,
traceable penalty per cause" pattern
`asset-dashboard-summary-service.ts::computeAssetHealthScore`/
`vat-summary-service.ts::computeComplianceScore` already established:
a dominant 40-point penalty when the Balance Sheet's own `isBalanced` is
false, a capped penalty per outstanding disclosure (a note that
`requiresUserInput` with no `user_notes` yet), a penalty scaled off the
Audit Readiness Score, and a capped penalty per open Audit Finding.
`reporting-readiness-service.ts::getReportingReadiness` is the ONE
function the Financial Statements workspace's own hero bar AND the
Executive Dashboard both call identically — the same `buildXSummary`
precedent every prior module's Dashboard tiles follow.

**Reporting Packages UI** — 4 generate buttons (Management/Board/
Accountant/Auditor Pack), each POSTing to `/api/companies/[companyId]/reporting-packages`;
every generated pack is listed with an expandable summary (Net Profit,
Total Assets, Closing Cash, disclosure note count, and — where included
— the Statement of Changes in Equity's closing balance, the Trial
Balance summary, the Audit Readiness Score/open findings, and the
narrative's own facts).

**Dashboard Integration**: Financial Statements Generated (a real count
of `reporting_packages` rows — generating any pack IS generating a
formal financial-statement bundle, so no separate "issuance log" table
was needed), Reporting Status, Outstanding Disclosures, Audit Completion
(the same Audit Readiness Score Module 10 already computes), and
Reporting Readiness — all five reuse `getReportingReadiness` exactly as
the Financial Statements workspace's own hero bar does; no existing KPI
tile was touched.

**XBRL & Future Regulatory Readiness, deliberately out of scope,
disclosed:**
- No XBRL/IFRS-taxonomy tagging, SARS submission, or external audit
  export exists anywhere in this module — genuinely no code was written
  for any of it, per the PRB's own "do not implement regulatory filing...
  do not fabricate integrations" instruction. The real, already-
  structured `ReportingPackageContents`/`DisclosureNote` shapes are the
  natural attachment points a future XBRL tagger or SARS submission
  builder would key off, but nothing beyond those existing domain shapes
  was added as a "placeholder integration."
- Accounting Policies/Significant Judgements/Estimates/Related Party/
  Commitments & Contingencies/Events After Reporting Date — disclosed
  above; a real preparer must complete these, the platform never invents
  a policy statement, judgement, or event on their behalf.

## Workflow Completion Audit — Cashbook & Bank Reconciliation status in detail

**Built in response to the Product Review Board's own Workflow
Completion Audit**, which found by direct code inspection (not
assumption) that no "Cashbook" concept existed anywhere in the
repository, and that Bank Reconciliation was entirely absent —
`ae_bank_accounts.last_reconciliation_date` existed as a schema column
but had no reader or writer anywhere in the codebase. This module closes
both gaps as first-class, real workflows.

**One Business Object, reasserted**: manually captured Cashbook entries
insert into the SAME `ae_bank_transactions` table Import Centre already
populates — `entry_source: 'Manual'` distinguishes them from imported
rows, and `capture_status` (Draft→Submitted→Approved→Posted→Cancelled)
gives them their own real workflow without a parallel table. Receipts
Cashbook, Payments Cashbook, and Cashbook Enquiry are real *views* over
this one object (split by direction/source), not three separate ledgers.

**Schema** — `supabase/migrations/0022_cashbook_reconciliation.sql`
extends `ae_bank_transactions` with `entry_source`/`capture_status`/
`cashbook_batch_id`/`reconciliation_id`/`reversal_of_transaction_id`,
adds `cashbook_batches` and `bank_reconciliations`, and is
`seed_company_defaults()`'s 8th definition — adding three real posting
rules: `Cashbook Receipt` (DR bank_account dynamic, CR dynamic_income,
CR VAT Output), `Cashbook Payment` (DR dynamic_expense, DR VAT Input, CR
bank_account dynamic), and `Bank Transfer` (DR bank_account_to, CR
bank_account_from) — all using the SAME dynamic-role mechanism
(`accountsByRole`) Asset Acquisition/Supplier Invoice already established,
no new posting-engine capability.

**`cashbook-service.ts`** — `captureCashbookReceipt`/`captureCashbookPayment`
validate and insert a Draft row; `captureBankTransfer` creates TWO real
linked rows (one per bank account, exactly as the transfer would appear
on both real bank statements), cross-referenced by a shared
`TRANSFER-...` reference. `approveAndPostCashbookEntry` resolves each
bank account's real GL control-account code via
`journal-service.ts::resolveBankGlAccount` (reused, not reinvented) —
but unlike Transaction Explorer's looser fallback, REQUIRES the resolved
code to already exist in the Chart of Accounts before posting is
attempted, so a misconfigured bank account fails with one clear,
actionable message instead of a cryptic error deep in the Posting
Engine. `reverseCashbookEntry` creates a brand-new offsetting entry
(swapped debit/credit) rather than mutating the original — the same
"reverse via a new document" audit-trail convention journal reversal and
GRN reversal already established this session. Cashbook Batches group
multiple Draft entries for one Approve & Post action, failing loudly
(never silently) if any entry in the batch can't post.

**`reconciliation-engine.ts`/`bank-reconciliation-service.ts`** — "GL
Balance" is the REAL Trial Balance figure for the bank account's
resolved GL control account (`trial-balance-service.ts`, already real),
never re-derived by summing transactions locally. An item is
"outstanding" simply because its `reconciliationId` is still null — no
separate reconciliation-line table to keep in sync, and prior-period
unreconciled items automatically carry forward since "not reconciled
yet" is the only condition checked. Auto-Match is a real, honest rule
(unit tested): only transactions that ALREADY carry a real `journalId`
are cleared automatically — a transaction with no journal yet is a
genuine unprocessed exception, surfaced for the Rule Engine or a manual
journal, never silently cleared. Reopening a Completed reconciliation
requires a real reason (validated) and un-sets `monthEndLocked`; the
lock itself is enforced by `assertNotMonthEndLocked`, called from every
Cashbook capture path — scoped honestly to Cashbook Capture only (Import
Centre ingestion is deliberately NOT blocked, so a late-arriving bank
statement row stays visible as a real exception rather than being
silently rejected).

**Cashbook Automation** — confirmed, not fabricated: the existing Rule
Engine pipeline (Import → Rules → Journal → Posted) already produces a
fully automatic path from an imported transaction to a Posted journal
once triggered (see `rule-processing-service.ts`); this module doesn't
duplicate that pipeline. What the audit found and this module discloses
honestly (not fixed, since it's out of this module's scope): nothing in
this codebase currently triggers the Rule Engine automatically on
import — it still requires a manual "Run Rule Engine Now" click, and no
`vercel.json`/cron exists in the repo to make it unattended. That
remains a real, disclosed gap for a future directive.

**Deliberately out of scope, disclosed:**
- PDF bank statement import — still an intentional empty
  `PDF_ADAPTERS: []` (Import Centre, unchanged by this module).
- Automatic, unattended triggering of the Rule Engine on import — see
  above; the manual-trigger limitation is a pre-existing gap this module
  didn't introduce and doesn't claim to fix.
- A dedicated "Cashbook Batch approval" role/permission distinct from
  the platform's existing session-based access control — no
  role/permission engine exists anywhere in this codebase yet to hook
  into.

## Matching Platform status in detail

**Built in response to the Product Review Board's own "Matching Platform
(Module 14)" directive**: "This is NOT another standalone module. This is
the consolidation module that turns VYRON FINANCE into one integrated
accounting platform. No new duplicate functionality is permitted." A
full Phase 1 Architecture Audit (Existing/Missing/Duplicate functionality
across every module that touches matching) was delivered and confirmed
before any code was written, per the directive's own "do not begin
implementation until this audit is complete." Phase 2 was then sequenced,
by the Product Review Board's own explicit choice, as Engine + Review
Queue first, then Workspace UI, then module rewiring.

**One Matching Engine, extracted safely**: `matching-engine.ts`'s
confidence scoring is explicitly documented in-code as numerically pinned
to a Python reference — "changing any of this is a deliberate, documented
decision, not a tunable constant." Rather than risk that pin, the
accumulation/banding *pattern* (not the rule set, point values, or
conditions) was extracted into a new pure `server/matching/confidence-engine.ts`
(`sumConfidence`/`bandConfidence`/`evaluateConfidence`), and
`matching-engine.ts` was rewritten to call it. Verified behavior-identical
by re-running its own pre-existing 19-test pinned suite unchanged — a
genuine consolidation, not a rewrite.

**One Review Queue, live-aggregated, not a shadow table**:
`matching-queue-service.ts::getMatchingQueue` reads directly from each
real source's own current state — Banking Exceptions, Transaction
Explorer, Sales Invoices, Purchase Bills, Cashbook, and the Auditor
Workspace's own `runDuplicateCustomersTest`/`runDuplicateSuppliersTest` —
the same "never cache what can be computed live" discipline the Trial
Balance already established. No new persisted "queue" table exists to
drift out of sync with its sources.

**Split Transactions** — `bank_transaction_splits` (new child table) +
a pure `split-transaction-engine.ts` (`validateSplitLines`/
`buildSplitGlLines`) + a new, additive `buildJournalLinesForSplitTransaction`
path in `journal-service.ts` that still terminates at the exact same
`journalRepo.createJournal`/`postApprovedJournals` every other document
type uses — one bank-side line, N GL-side lines, one balanced journal.
Verified via 5 new tests added to the existing 17-test
`journal-service.test.ts` (now 22, all passing) plus the split engine's
own 6-test suite.

**Merchant vs Customer/Supplier merge — a deliberate, disclosed
asymmetry**: Merchant merge (`merge-service.ts::mergeMerchants`) fully
repoints transactions and deletes the losing record, since Merchant has
no financial-history foreign key beyond one nullable
`ae_bank_transactions.matched_merchant_id` column. Customer/Supplier
merge deliberately does NOT delete or mass-repoint — real invoices,
bills, receipts, and payments reference these records — so
`recordPartyMerge` only records the merge decision in a new
`party_merges` table for a human to complete manually. This is an
explicit scope boundary, not a shortcut: a full automated repoint across
every financial table was judged unsafe to fabricate in this pass.

**Dashboard wiring, and a real bug found and fixed along the way**: the
Phase 1 audit's Dashboard research pass discovered
`dashboard/page.tsx`'s Total Cash/Largest Account/Lowest Account/
Allocation Status tiles read `MOCK_BANK_ACCOUNT_SUMMARIES`
*unconditionally* — not gated by `previewMode` — meaning even a real
production deployment would have shown fake data forever. Fixed as part
of this module (per its own "No duplicated calculations" requirement)
rather than deferred: those tiles now read `listBankAccountSummaries`
when Supabase is configured. The Dashboard's 7 new live matching metrics
(Matching Accuracy, Auto Match %, Manual Queue, Duplicate Risk, Rule
Success Rate, AI Confidence, Unresolved Exceptions) are computed once by
`matching-summary-service.ts::buildMatchingSummary` from the real queue
and banking-automation summary — no module recalculates its own version.

**AI Copilot integration** — a new supported question ("What needs my
review today?") added to `copilot-assistant-engine.ts`'s fixed catalog.
`answerMatchingReview` follows the exact same evidence-backed, honest-
empty-state pattern every other Copilot answer in this codebase already
uses — it consumes the Review Queue's own already-computed items and
never re-detects anything itself, satisfying the directive's "No module
may calculate its own confidence" / "AI Copilot consumes Matching" rule
in the same breath.

## Matching Platform — Phase 3 (Complete Every Deferred Matching Item) status in detail

**Every item deferred out of the original Module 14 pass is now built, in
response to the Product Review Board's own "Phase 3 – Complete Every
Deferred Matching Item" directive.**

**Rule Learning, finished:** Test Rule (`rule-engine.ts::testRuleAgainstRecord`
— evaluates one hand-built hypothetical record with a per-condition
matched/unmatched breakdown; shares `ruleMatches` with Simulate, never a
second matching implementation), Simulate Rule (already real), Rule
Versioning (already real — snapshot on every edit), **Rollback** (new —
`banking-rule-service.ts::restoreBankingRuleVersion` restores a prior
version's content as a brand-new version, the same "reverse via a new
record" audit convention journal/GRN/Cashbook reversal already
established), and Rule Analytics — Success %/Failure % (new —
`rule-analytics-engine.ts::buildRuleAnalytics`, joining
`banking_rule_applications` against each fired transaction's own real
resolved state, the same success definition `matching-summary-service.ts`
already uses), Rule History (per-rule application drill-down), and Rule
Comparison (filters already-computed analytics to the requested rules).

**Customer Matching workspace, built:** Invoices/Credit Notes/Debit
Notes (real `documentType` filters over `listSalesInvoices` — no new
document types, matching the codebase's existing unified-table design),
Receipts, a real chronological **Statement** with running balance
(`customer-statement-engine.ts` — confirmed genuinely absent by research
before building it), and Auto/Manual/AI-Suggested allocation via a new
`receipt-allocation-matching-engine.ts` (mirrors the pinned Supplier
Matching Engine's scoring approach, delegates to the shared Confidence
Engine) — every allocation, auto or manual, still calls the existing,
already-tested `customer-receipt-service.ts::allocateReceipt`.

**Supplier Matching workspace, built:** the AP mirror of the above
(`payment-allocation-matching-engine.ts`, `supplier-statement-engine.ts`),
plus read-only Purchase Order/GRN visibility for the 3-way match, reused
from the existing Purchasing services.

**Duplicate Detection, finished for all 12 named entity types:**
Customers/Suppliers (already real), Merchants/Inventory Items (now
reuse a newly-extracted shared primitive, `duplicate-party-engine.ts`
— behavior-preserving refactor of the Auditor Workspace's own
`findDuplicateParties`, verified via its pre-existing pinned tests),
Transactions/Journals (reuse existing `runDuplicatePaymentsTest`/
`runDuplicateJournalsTest`), and Sales Orders/Purchase Orders/
Quotations/Bills/Payments/Receipts (genuinely new — a second shared
primitive, `duplicate-document-engine.ts`, for same-party/same-amount/
date-window collisions). Every finding carries Confidence, Reason,
Suggested Merge (where a real merge action exists — Customer/Supplier/
Merchant, via the already-built `merge-service.ts`), Manual Override and
Permanent Ignore Rule (both persisted via the existing, intentionally
generic `matching_overrides` table — no new table), and Ignore (a
session-only local dismiss).

**Split Transactions, all 9 dimensions:** GL Account/Customer/Supplier/
VAT Code/Branch/Department/Cost Centre/Project were already real
end-to-end (schema, engine, repository) but the UI form only ever
exposed GL Account — the real gap this phase closed. Inventory Item
(`0024_matching_split_inventory_item.sql`) was the one dimension missing
everywhere; both gaps are now closed together in
`split-transaction-form.tsx`.

**Verification:** `tsc --noEmit` clean, `eslint .` clean (2 pre-existing
unrelated warnings only), 970/970 tests passing (up from 928 — 42 new
tests this phase), production build succeeds, and a live curl sweep of
every new page/route plus a regression sweep of prior pages returned
correct results with no regressions.

**Phase 4 — module rewiring audit, complete.** Every one of the 8 named
pages (Supplier Reconciliation, Transaction Explorer, Cashbook, Bank
Reconciliation, Banking Exceptions, Banking Automation, Dashboard, AI
Copilot) was individually audited for independent matching/duplicate
logic. Result: **no genuine duplication found anywhere** — Dashboard and
AI Copilot already consume Matching directly (prior pass); the other 6
each either (a) already delegate to the shared Confidence Engine
(Supplier Reconciliation's `matching-engine.ts::scoreBill` calls
`sumConfidence`), (b) are pure data producers feeding the ONE Review
Queue rather than competing consumers (Transaction Explorer, Banking
Exceptions, Cashbook), or (c) address a genuinely distinct concern with
no scoring/matching overlap at all (Bank Reconciliation's GL-vs-statement
clearing is a boolean `journalId !== null` check, not confidence
matching; Banking Automation's Rule Engine is deterministic condition
dispatch, not fuzzy scoring). No rewiring was performed because none was
needed — this session's Matching Platform was architected from the start
to be the ONE place these signals compose, and the audit confirms that
held. One informational note: `banking-rules/banking-intelligence.ts`
computes its own fixed confidence numbers (70/100/80/55/formula) for
transaction-pattern heuristics (duplicate payment, new merchant, unusual
spending, cash-flow impact) rather than routing through
`confidence-engine.ts` — deliberately left as-is, since `sumConfidence`
exists to accumulate multiple weighted rules and every one of these
signals is already a single deterministic value; forcing it through the
shared engine would add indirection with no behavioral change and no
real duplication to consolidate against.

**Phase 5 — Acceptance Test, complete.** `src/server/matching/acceptance-chain.test.ts`
chains the REAL pure function from every one of the directive's 16
stages (Import Bank Statement → Rules → Matching → Merchant Recognition
→ Customer Matching → Supplier Matching → Split → Journal → Cashbook →
Bank Reconciliation → General Ledger → VAT → Financial Statements →
Executive Dashboard → AI Copilot → Audit Trail) against one coherent
fixture scenario, asserting each stage's real output is exactly what
feeds the next stage's real input — 17 tests, all passing, genuinely
automatic verification (`npx vitest run` proves the chain every time,
not a manual click-through). Two stages have no pure core anywhere in
this codebase (confirmed by research, not assumed) and are disclosed in
the test file's own header: Merchant Recognition
(`merchant-repository.ts::findMerchantByBeneficiary` is async/Supabase-
only — the test asserts the real `Merchant` shape a match resolves to
and carries it forward by hand) and Trial Balance aggregation from raw
`gl_transactions` (computed DB-side by the `fn_trial_balance` Postgres
function — the test hand-builds the two `TrialBalanceRow[]` snapshots
`income-statement-engine.ts` needs, traceable to the same GL rows posted
a stage earlier). A full live run through real Supabase-persisted I/O
requires production credentials this dev environment does not have;
every I/O-bound wrapper around the pure core tested here is itself
covered by its own existing test suite elsewhere in this codebase.

**Phase 6 — full Sidebar Audit, complete.** All 24 unique sidebar routes
(25 nav items — Journals shares General Ledger's route) verified via a
live HTTP sweep (24/24 return 200, zero runtime errors in the dev server
log) plus a code-level capability audit of every workspace (Opens/Hero/
Summary tiles/Search/Filters/Tabs/Create/Edit/Delete/Approve/Reject/
Posting/Export/Import/Reports/Drill-through/AI Copilot/no-placeholders/
no-duplicated-logic), cross-referenced against each workspace's own
existing `jest-axe` test coverage. Result: **average workspace
completeness ~77%**, zero placeholder buttons or dead links found
anywhere (every `workspace-shell.tsx` nav item has a real `href`), zero
duplicated business logic found anywhere (confirms Phase 4's finding at
platform scale, not just for the 8 Matching-adjacent pages). One real
defect was found and fixed in the same pass (Dashboard's AI Insights/
Recovery Alerts/Recent Activity/Import Activity/Recovery Health/Cash
Trend panels were reading mock data unconditionally, even in
production — the same defect class as the earlier Bank Account Summary
fix; now wired to real sources: `executiveIntelligence.signals`, the
real Executive Alerts table, the real Automation Audit Trail, and
data already fetched on the page — see `src/app/company/[companyId]/dashboard/page.tsx`).
Cross-cutting gaps found across many workspaces (not fixed in this
pass — Enterprise Production Readiness scope, not Matching Platform
scope): **Export is missing in 21 of 24 workspaces** (only General
Ledger, Transaction Explorer, and Automation Rules have it), **Search
in 8 of 24**, **Edit UI despite real backend support** on Suppliers/
Customers, **inconsistent drill-through** (missing even on Sales/
Purchasing), and **component-test/a11y coverage gaps** on 6 workspaces
(Dashboard, Import Centre, Automation Dashboard, Bank Accounts partially,
`supplier-workspace.tsx`/`customer-workspace.tsx`, Supplier
Reconciliation). Full interactive Workspace Completion Matrix (all 7
required columns — Opens/CRUD/Workflow/Posting/Reports/AI/Complete —
per workspace) delivered as an artifact.

**Phase 7 — Production Readiness Report, complete.** Full report
delivered (security/permissions/scalability/performance review, plus
remaining placeholders/Preview Mode limitations/Supabase requirements/
integrations/enterprise work). **Overall production readiness: 59%**
(weighted, not a simple average — Permissions and Scalability count more
heavily than Feature Completeness, since for an accounting platform,
missing segregation-of-duties controls and unbounded queries are
launch-blocking, not cosmetic). Per-dimension: Feature Completeness 77%
(Phase 6), Security 75%, Permissions 35%, Scalability 55%, Performance
60%.

The single highest-priority finding: **no role-based access control
exists anywhere in the platform.** `organisation_members.role` (owner/
admin/member) is real but is used only for company-level CRUD — every
day-to-day accounting action, including Approve/Reject on a journal of
any amount, is available to any authenticated company member with no
role or threshold check (`journal-workflow-service.ts:65`). Second
finding: **10 repositories fetch entire tables with no `.limit()`**
(Customers, Merchants, Stock Items, Suppliers, Bills, Sales Orders,
Purchase Orders, Quotations, Supplier Payments, Customer Receipts) —
this session's own `duplicate-detection-service.ts::getDuplicateFindings`
(Phase 3) calls 9 of them in parallel on every Duplicate Detection tab
load, compounding a pre-existing pattern rather than introducing a new
one, but disclosed here explicitly since it's new work from this
session. Security fundamentals are otherwise strong: RLS verified on
107/107 tables, no injection risk, no hardcoded secrets, 211/212 API
routes gated by `requireSession()` (the one exception is an
already-disclosed cron-secret pattern). Dashboard's 16-stage sequential
fetch waterfall is the primary performance finding. Full evidence-cited
report, with a per-dimension readiness ring and file/line citations for
every claim, delivered as an artifact.

**Module 14 (Matching Platform) — Phases 1 through 7 are now all
complete**, per the Product Review Board's own directive: "Do not
report Module 14 as complete until all deferred items, the acceptance
workflow, and the Sidebar Audit are finished." All three conditions are
met. Per that same directive, the next phase is Enterprise Production
Readiness — hardening, integration, performance, security, and
deployment — not new features, and the two highest-priority items for
that phase are named explicitly above (RBAC, bounded queries).

## Before starting the next module

Each module needs, in order:
1. A Supabase schema addition (tables/RLS policies) if it persists data —
   see ARCHITECTURE.md's Data Architecture section for the tenancy
   hierarchy every table must respect.
2. A `src/app/api/**/route.ts` or Server Action layer — **never** a direct
   `supabase.from(...)` call from a page component, per the mandatory API
   separation in ARCHITECTURE.md.
3. The page itself under `src/app/company/[companyId]/<module>/`, added as
   a live `href` in `src/components/financial/workspace-shell.tsx`'s
   `MODULES` array (currently a disabled "Soon" entry).
4. Built against the Enterprise Design System (ARCHITECTURE.md's "Design
   system" section) from the start — `Card tone="hero"` for the page's
   executive hero, `tone="dark"` for statistic tiles, default `tone="paper"`
   for every table/form/list, and the Header → Hero → Statistics → Primary
   Workspace → Secondary Workspace → Quick Actions → Footer Status rhythm.
   Do not introduce page-specific colors or one-off card styling — this was
   the explicit point of the PRB's "no redesign per page" instruction.
5. A build + lint + route-verification pass, matching the checkpoint
   pattern used for Platform and Dashboard.

## Design system status

The Enterprise Design System Rollout (Product Review Board) is applied to
every page that exists today: Public Website (Home, Pricing), Login,
Forgot Password, Platform Workspace, Dashboard, Supplier Reconciliation,
Bank Accounts, and Import Centre. Dashboard is the frozen master reference — see
ARCHITECTURE.md and DESIGN_REFERENCE.md for the token/component reference
every future module must build against directly, rather than re-deriving
colors or inventing new layout patterns.

## Also outstanding (not module migration, but named in the PRB)

- Public Website: port the remaining approved-artifact sections (Interactive
  Workflow, Live Product Preview, Financial Intelligence teaser, Comparison
  table, Trust bar, Demo section, Platform Vision, FAQ) into
  `src/app/(marketing)/page.tsx`.
- Documentation: API Specification, Component Library, Deployment Guide,
  Developer Guide, User Guide (Part 14 lists seven documents total; this
  roadmap and ARCHITECTURE.md are the first two).

## RC1 — Enterprise Security, Permissions & Production Hardening

**Status: Phase 1 (Role Based Access Control) complete. Phases 2-10 not
started.** The Product Review Board's own Production Readiness Report
(delivered at the end of Module 14) named RBAC as the #1 blocker; RC1
made it Priority One. No new ERP functionality was added in this phase
— every piece here is enterprise infrastructure (permissions), not an
accounting feature.

### Phase 1 — RBAC, complete

**One Permission Engine, nothing else checks authorization.** Every
piece of this system funnels through exactly two functions —
`permission-service.ts::requirePermission(companyId, key)` and
`::requireApproval(companyId, key, category, amount)` — composed
identically to the existing `requireSession()` idiom
(`{ok:true}|{ok:false,response}`), so adding a check to a route is a
one-line, mechanically consistent change. No page, API route, or
service reimplements a check itself.

**Schema** — `supabase/migrations/0025_rbac_platform.sql`: `permission_roles`
(4 platform-scope + 15 company-scope system roles, plus any company's
own custom roles — `is_system_role: false` — in the SAME table, so
"Support Custom Roles" needed no second table), `role_permissions` (flat
grant list), `role_approval_limits` (the 5 categories the directive
names explicitly: Journal/SupplierPayment/CustomerCreditNote/
PurchaseApproval/AssetDisposal — `max_amount: null` means explicitly
unlimited, a real grant, distinct from no row at all, which means the
role cannot approve that category), `user_role_assignments` (real
user→role, company- or platform-scoped). A NEW standalone
`seed_company_rbac_defaults()` function (not a redefinition of the
existing, ~8-times-extended `seed_company_defaults()` — this migration
does not have that function's full current body to safely re-paste)
seeds the 15 company roles with real, sensible default permission sets
and approval limits matching the directive's own worked example
(Bookkeeper ≤R50,000, Finance Manager ≤R500,000, Financial Director
unlimited) — called both by a one-time idempotent backfill for every
existing company and by `company-service.ts::createCompany` for every
new one going forward (which also auto-assigns the creating user to
Company Owner, so a company is never left in an "everyone unassigned"
state).

**Permission catalog** (`src/server/permissions/types.ts`) — 12 modules
× 10 actions (`Sales:View`, `Purchasing:Approve`, …) plus the
directive's own 15 named global permissions (`ApproveJournals`,
`ManageUsers`, `SystemAdministration`, …), generated into one
`ALL_PERMISSION_KEYS` list, never hand-duplicated.

**Pure engine** (`src/server/permissions/permission-engine.ts`, 18
tests) — `resolveEffectivePermissions` walks `parentRoleId` inheritance
(Senior Bookkeeper inherits Bookkeeper, cycle-guarded by a depth cap
since the hierarchy is data, not a compile-time guarantee) and unions
grants; `resolveApprovalLimit` does the same walk for the 5 approval
categories, child overriding parent; `evaluateApproval` is the ONE
approval-limit decision function — Journal approval, supplier payments,
customer credit notes, purchase approvals, and asset disposals all call
it, never a per-module reimplementation of "is this amount within
limit."

**Wired into all 5 named approval flows** — `journal-workflow-service.ts`
(approve gated by `requireApproval(..., "Journal", journal amount)`,
reject/reverse gated by `requirePermission`), `supplier-payment-service.ts`
(approve gated by real payment amount), `sales-invoice-service.ts`
(Credit Notes — confirmed to reuse the same `approveAndPostInvoice` as
ordinary invoices — gated by the `CustomerCreditNote` category; ordinary
invoices/debit notes by a lighter `Sales:Approve` permission check, no
amount limit, since only Credit Notes are a named approval-limit
category), `purchase-order-service.ts` + `purchase-bill-service.ts`
(gated by `PurchaseApproval`), `asset-register-service.ts::disposeAsset`
(gated by `AssetDisposal`, checked against real disposal proceeds).

**Admin UI** — a new "Roles & Permissions" tab in Settings
(`roles-permissions-tab.tsx`): browse all 19 system roles (grouped
Platform/Company) plus any custom roles, a module×action permission grid
and approval-limit editor (read-only for system roles — their defaults
are fixed; editable for custom roles), a real "+ Custom Role" action,
and a User Assignments view (assign/revoke a real role for a real user
ID). Every save calls the exact same service functions the enforcement
side calls — the UI never computes an authorization decision itself.

**Verification**: `tsc --noEmit` clean, `eslint .` clean, 1012/1012
tests passing (up from 987 — 25 new tests this phase), production build
succeeds, live curl sweep of the Settings page and every new
`/api/companies/[companyId]/roles/*` route returns correct results (200
for the page rendering real seeded mock data in Preview Mode, 501 —
Supabase not configured — for every new route, the same consistent
gating convention every other route in this codebase already uses).

**Deliberately out of scope, disclosed:**
- **Full platform-wide route wiring.** `requirePermission()` is proven
  and wired into the 5 explicitly-named approval flows; the other
  ~200 API routes (view/create/edit/delete-level checks across all 24
  workspaces) are NOT yet gated — this is a large, mechanical rollout
  (one line per route, following the exact pattern already established)
  rather than a design problem, but it was not attempted in this pass.
  The directive's own words — "Journal approval, supplier payments,
  customer credit notes, purchase approvals and asset disposals must all
  consume the same approval engine" — are satisfied; "no page may
  implement permission checks directly" (i.e., every route calling into
  the shared engine) is a real, sizeable follow-up.
- **A Supabase Auth JWT custom-claims hook.** Authorization is a
  real-time DB lookup per request (`user_role_assignments` joined
  against `companyId` + `auth.uid()`), matching how `user_can_access_company()`
  already works — no `app_metadata` role-claim injection was built (that
  infrastructure doesn't exist in this Supabase project at all, confirmed
  by research, and would be a genuinely new piece of platform
  configuration, not a code change).
- **RLS-level role enforcement.** Row Level Security on the 4 new tables
  still gates at the membership level (same `user_can_access_company()`
  boundary every other table uses) — a role-aware RLS policy would
  require Postgres to call back into a permission function this
  migration also defines, which is possible but was judged a real,
  separate piece of work rather than bundled in here; the application
  layer's `requirePermission()` is the actual enforcement today, RLS the
  membership backstop.
- **A user directory / "invite user" flow.** Role assignment in the
  admin UI takes a raw Supabase `auth.users.id` — there is no
  company-scoped user list/search/invite UI anywhere in this codebase to
  build on top of yet (out of RBAC's own scope; a Commercial Readiness
  concern, RC1 Phase 10).

### Phase 2 — Security Audit, complete

**A critical, real vulnerability was found and fixed — introduced by
Phase 1 itself, in this same session, and fixed before the migration
ever ran against a real database.** The first draft of
`0025_rbac_platform.sql` gated writes to `role_permissions`/
`role_approval_limits`/`user_role_assignments` on company MEMBERSHIP
only, reasoning that the application layer's `requirePermission(companyId,
"ManageUsers")` was the real gate. That reasoning is backwards for
Supabase: the anon-key client is reachable directly from any signed-in
browser's devtools, bypassing the Next.js app (and its `requirePermission()`
check) entirely — RLS is not a "backstop" for these tables, it is the
ONLY enforcement a direct REST call sees. As shipped in the first draft,
**any authenticated company member — even one holding the lowest-privilege
Read Only role — could have granted themselves `ManageUsers`/
`SystemAdministration`, rewritten a role's `parent_role_id` to inherit
from Company Owner, or inserted a `user_role_assignments` row making
themselves Company Owner directly**, fully bypassing the app-layer
check. Fixed in place (edited directly, not patched with a follow-up
migration, since no real deployment's history needed preserving): a new
`user_has_permission(company_id, permission_key)` SQL function — a
recursive-CTE mirror of the pure TS engine's own inheritance walk, the
same reason RLS cannot call the TypeScript engine directly — now gates
every write policy on all 4 RBAC tables. Verified by a full structural
re-read of the migration (no live Postgres instance available in this
dev environment to execute against, so this is the closest verification
possible; running it against a real Supabase project is a real,
disclosed pre-production step).

**A second, real gap: RBAC changes had zero audit trail.** `setRolePermissions`
(delete-then-reinsert), `setRoleApprovalLimit` (upsert), and
`revokeRoleAssignment` (hard delete) recorded no who/when/why anywhere —
a real gap for a system whose entire purpose is access control. Fixed:
a new `permission_audit_log` table (same generic item_type/item_id/
field_name/old_value/new_value/reason/performed_by shape
`matching_overrides` already uses — a deliberately separate table, not
a cross-domain reuse of a Matching-scoped one), written ONLY via a
`security definer` RPC (no direct client INSERT policy exists at all,
so a row can never be forged or backdated), called from every one of
`createCustomRole`/`deleteCustomRole`/`updateRolePermissions`/
`updateRoleApprovalLimit`/`assignUserRole`/`revokeUserRole`.

**Re-verified, all confirmed clean:** company isolation (zero routes
trust a `companyId` from the request body instead of the URL; 302
`await params` occurrences across 215/216 route files sampled — the one
exception is the already-disclosed cron endpoint); organisation
isolation (`organisations`/`organisation_members`/`companies` RLS
correct, no leak); CSRF (the Supabase session cookie is `SameSite=Lax`
by `@supabase/ssr`'s own default — real protection against cross-origin
state-changing requests, confirmed by inspecting the library's actual
constants, not assumed); authentication/session handling (`src/proxy.ts`
correctly redirects unauthenticated users and refreshes tokens, API
routes rely on their own `requireSession()` by design); secrets (zero
`SERVICE_ROLE` references anywhere in the repo, `.env*` gitignored).

**Repo-layer defense-in-depth added**, even though RLS is now the real
enforcement: `permission-repository.ts::getRoleForCompany` explicitly
filters by `companyId` (the original `getRole` took only a `roleId` —
safe today only because the service layer double-checked
`role.companyId !== companyId` before delegating, but a future direct
caller wouldn't get that check for free).

**Deliberately out of scope, disclosed:**
- **No structured/centralized logging exists anywhere in this codebase**
  (confirmed: zero `console.error`/`console.log` calls, no logging
  library in `package.json`) — an unhandled route error becomes a
  generic 500 with no server-side record beyond whatever the hosting
  platform captures at the process level, and there is no record of
  failed-auth (401) or permission-denied (403) events. This is RC1
  Phase 6's own explicit territory ("structured logs", "correlation
  IDs") — building it now would duplicate that phase's work, so it's
  deferred there rather than done piecemeal here.
- **No CSRF double-submit token beyond the SameSite=Lax cookie.**
  SameSite=Lax is real, verified protection for the common case
  (cross-origin fetch/XHR/form POST); a defense-in-depth custom header
  check was judged out of proportion to add across ~200 routes in this
  pass given the primary mitigation is already real and correct.
- **No rate limiting** — confirmed absent platform-wide (already named
  in the Production Readiness Report); not fixed in this pass, a
  genuinely separate infrastructure concern (would need a rate-limiting
  service/middleware, not a code-level fix).

### Phase 3 — Performance Hardening, complete for the 10 named repositories

**Every one of the 10 unbounded repositories the Production Readiness
Report named now has a real, real cap.** `customer-repository.ts::listCustomers`,
`merchant-repository.ts::listMerchants`, `stock-item-repository.ts::listStockItems`,
`supplier-reconciliation-repository.ts::listSuppliers` + `::listAllBills`,
`sales-order-repository.ts::listSalesOrders`,
`purchase-order-repository.ts::listPurchaseOrders` (+ `listPurchaseOrdersBySupplier`,
fixed as a side effect of the same edit), `quotation-repository.ts::listQuotations`,
`supplier-payment-repository.ts::listSupplierPayments` (+ `listSupplierPaymentsBySupplier`),
and `customer-receipt-repository.ts::listCustomerReceipts` (+
`listCustomerReceiptsByCustomer`) each now carry a `LIST_CAP = 10_000`
and a real `.order()` clause (`listSuppliers`/`listAllBills` had none at
all before this pass). "No unbounded queries may remain" is satisfied
literally: a company with an enterprise-scale table can no longer hang
or crash a request by returning its entire table into memory.

**Indexes — verified, not assumed, then extended.** Before touching
anything, every one of the 10 tables was confirmed (by grepping every
prior migration, not by assumption) to already have a `company_id`
index — this codebase's migrations have consistently indexed
`company_id` from the start. What was missing, and what
`0026_performance_hardening.sql` adds, is the COMPOSITE index each
capped/sorted query actually needs — `(company_id, <sort column>)` —
so Postgres can satisfy `WHERE company_id = X ORDER BY <col> LIMIT N`
with a single index scan instead of finding the company's rows via the
existing index and then sorting them all in memory before applying the
limit. The same migration also adds the indexes the new RBAC platform's
own hot-path lookups need (`user_has_permission()` runs on every
permission-gated request) — `permission_roles.company_id`,
`role_permissions.role_id`, `role_approval_limits.role_id`,
`user_role_assignments (user_id, company_id)`. Purely additive
(`create index if not exists`), no behavior change to any existing
query.

**Verification**: `tsc --noEmit` clean, `eslint .` clean, 1012/1012
tests still passing (no test asserted on the previous unbounded
behavior), production build succeeds, live curl sweep of every page
touching one of the 10 fixed repositories (Customers, Suppliers, Sales,
Purchasing, Inventory, Matching, Automation Rules) returns 200 with no
runtime errors.

**Deliberately out of scope, disclosed:** a full cursor-paginated
browsing UI (Search/Filter/Sort controls on the page itself, matching
Transaction Explorer's own build) for these 10 specific list surfaces
was NOT built in this pass — that is a genuinely separate, larger UI
project (one closer in scope to what Transaction Explorer's own
pagination took to build) than a data-safety fix, and is more properly
RC1 Phase 9 (UX Audit)-adjacent work. What this phase delivers is real:
the crash/hang risk from an unbounded fetch is eliminated everywhere it
was found, and the composite indexes make even the capped queries fast.
A company with more than 10,000 rows of any of these 10 entity types
will see a real, deterministic, name/date-ordered slice rather than its
whole table — not yet a full "browse all 250,000 rows with search and
pagination controls" experience.

### Phase 4 — Document Platform, complete for the schema/service/UI, partial on entity-page coverage (disclosed)

**One shared table, one shared Storage bucket, one shared permission
model — no module uploads independently.** `0027_document_platform.sql`
adds `documents` (entity_type/entity_id, `document_group_id` +
`version_number` + `is_current` for versioning — a new version is
always a new row, never an in-place edit), a real private Supabase
Storage bucket (`documents`), and RLS gated by the Phase 1
`user_has_permission()` function via a `document_permission_module()`
SQL function that maps each of the 8 named entity types (Customer,
Supplier, Inventory, Asset, Journal, BankStatement, AuditEvidence,
FinancialStatement) onto the SAME permission module its owning business
entity already uses (Customer → Sales, Asset → Assets, ...) — kept in
sync with an identical TS `DOCUMENT_PERMISSION_MODULE` record so the
mapping can never silently drift between the app layer and the DB
policy. Storage object RLS uses a path convention
(`{company_id}/{entity_type}/{entity_id}/...`) so bucket policies check
company membership directly from the path, no join required.

**Real extension points, honestly unfilled.** `VirusScanner` and
`OcrProvider` are real, pluggable interfaces; the shipped
implementations (`NoOpVirusScanner`, `NoOpOcrProvider`) explicitly
return `"skipped"` — never a fabricated `"clean"` scan result or invented
OCR metadata. `virus_scan_status`/`ocr_status`/`ocr_metadata` can only be
written via a security-definer RPC (`update_document_scan_status()`), so
no client can self-certify its own upload as scanned.

**Service layer**: `document-service.ts` (`uploadDocument` — validates
filename/category/size ≤25MB, resolves the next version number, uploads
to Storage before the DB row commits, marks the prior version
superseded; `deleteDocument`, `getDownloadUrl` — a 300s signed URL, never
a public one; `listRetentionDue`/`purgeRetentionDue` — real and callable
but deliberately NOT wired to an unattended scheduler, since deleting
customer/financial records on a timer with no review step was judged
unsafe to fabricate in this pass). 4 API routes under
`/api/companies/[companyId]/documents*`, all gated by
`requirePermission()` using the same per-entity-type module mapping.

**UI**: one reusable `<DocumentsPanel>` client component
(list/upload/download/version-history/delete), matching this session's
established self-fetching widget pattern (same shape as the
Notification Bell). Wired into 3 real, working pages as a genuinely
representative subset — Customer Detail (new "Documents" tab), Supplier
Detail (new "Documents" tab), and Asset Detail (embedded panel) — rather
than attempting all 8 named entity types in one pass. **Not yet wired:**
Inventory, Journals (General Ledger), Bank Statements, Audit Evidence,
and Financial Statements — each would reuse the exact same
`<DocumentsPanel>` component with a different `entityType`/`entityId`,
so wiring the remainder is mechanical, not a new build, but is disclosed
here as outstanding rather than silently claimed.

**Verification**: `tsc --noEmit` clean, `eslint .` clean, full suite
1024/1024 passing (up from 1012 — 12 new pure `document-engine.test.ts`
tests), production build succeeds, live curl sweep of all 4 new API
routes (correct 501 auth-gating, matching every other route's pattern)
and all 3 newly-wired pages (Customer/Supplier/Asset detail, 200s) with
no runtime errors in the dev server log.

### Phase 5 — Communication Platform, complete for the engine + 1 real integration, partial on module wiring (disclosed)

**Not an email sender — one Communication Engine.** Per the Product
Review Board's own addendum, `0028_communication_platform.sql` builds
`communication_templates` (+ `communication_template_versions` for
history), and `communications` — the ONE shared record every outbound
message produces, on every channel, from every module (Company/Module/
Business Object/Recipients/Template/Subject/Variables/Channel/Status/
Sent time/Retry count/Delivery result/Failure reason/Audit ref — the
directive's own field list, verbatim). 7 channels are named
(`Email`, `InApp`, `SMS`, `WhatsApp`, `Teams`, `Slack`, `Push`); only
`Email` and `InApp` have a real sender wired up — `queueCommunication()`
rejects any other channel outright (`IMPLEMENTED_CHANNELS`) rather than
silently promising delivery on one nothing can service.

**Template Engine**: one engine (`template-engine.ts`, pure, 12 tests) —
`{{variable}}` substitution, `{{#if var}}...{{/if}}` conditional
sections, `branding` jsonb (logo/colour/footer), Preview, Test Send,
version history. No module embeds HTML/email text directly.

**Queue reuses the existing Scheduler, not a second loop.** The
`communications` table's own status/scheduled_for/retry_count/
next_retry_at columns ARE the queue (one row = one job) — pure
selection/backoff logic lives in `queue-engine.ts` (13 tests,
exponential backoff capped at 60 minutes, priority ordering, expiry).
Processing is triggered by the EXISTING Automation Scheduler via a new
`CommunicationQueue` `automation_tasks` type (`scheduler-service.ts`'s
`runTask()` dispatch gained one more case) — no bespoke scheduling loop
was built, honouring "no duplicate engines."

**Approval reuses the existing generic Workflow Engine, not a second
approval mechanism.** A template with `requires_approval = true` (seeded
true on `PaymentReminder` — "Large debtor reminders" — and
`CustomerStatement`, per the directive's own approval examples) starts a
real `workflow_instances` row via the SAME `workflow-service.ts` a
Recurring Template's own activation-approval already uses;
`approveCommunication`/`rejectCommunication` call its `decideStep()`
directly. No parallel amount-limit or approval logic was invented for
communications.

**Honest by construction — the Email side.** No email provider is
installed anywhere in this codebase (confirmed: no SDK in `package.json`,
no SMTP/RESEND/SENDGRID env var). `EmailSender` is a real, pluggable
interface (`email-sender.ts`); the shipped `NoOpEmailSender` always
reports `delivered: false` with a stated reason — never a fabricated
"sent." A queued Email communication genuinely retries (exponential
backoff) and genuinely reaches `Failed` with a real reason, and the whole
pipeline becomes truthful the moment a real provider is plugged into that
one injection point — nothing else changes. The **InApp** channel is
real today: it delivers by inserting into the SAME `notifications` table
the Notification Centre already reads (`in-app-sender.ts`) — no second
notification store.

**The one real "Complete Wiring" integration found and rewired**: this
pass's own research confirmed the only pre-existing, already-shipped
"communication action" anywhere in the codebase was
`recurring-template-service.ts`'s `PaymentReminder`/`ReminderEmail`/
`CustomerStatement`/`SupplierStatement` generation — previously a direct
call to `notificationService.createNotification` (in-app only, no
external attempt of any kind). All 4 cases now call
`communicationService.queueCommunication()` — a real Email attempt (to
the customer/supplier's primary contact address, honestly `Failed`
without a provider) that is tracked, retryable, and approval-gated where
the directive names it, replacing the old direct/placeholder call
end-to-end.

**Verification**: `tsc --noEmit` clean, `eslint .` clean, full suite
1049/1049 passing (up from 1024 — 25 new pure engine tests), production
build succeeds, live curl sweep of the new page (200) and all 6 new API
routes (correct 501 auth-gating) with no runtime errors, plus a
regression sweep of Recurring Templates/Automation Dashboard/Sales/
Purchasing/Settings (all 200, confirming the `dispatchGeneration`
rewiring didn't break anything already shipped).

**Communication Integration Matrix** (the directive's own requested
deliverable):

| Module | Communication type(s) | Wired to shared platform? | Notes |
|---|---|---|---|
| Automation (Recurring Templates) | Payment/Debtor Reminder, Customer Statement, Supplier Statement | **Yes** — real | The only pre-existing communication action in the codebase; fully rewired off the direct notification call onto `queueCommunication()` |
| Notification Centre | In-app notifications (all types) | **Yes** — real | Is now the InApp channel's actual delivery target; Notification Bell UI unchanged (same table, zero UI duplication) |
| Sales | (none pre-existing beyond the Recurring Template statement/reminder above) | N/A | No direct-send/placeholder code found to replace; ready to consume `queueCommunication()` the moment a Sales-specific send action is built |
| Purchasing | (none pre-existing beyond the Recurring Template statement above) | N/A | Same as Sales |
| Customer Management | (none pre-existing) | N/A | Customer Statement/Reminder above already covers this module's real-world use case via Automation's dispatcher |
| Supplier Management | (none pre-existing) | N/A | Supplier Statement above already covers this module's real-world use case |
| Financial Statements | (none pre-existing) | Not applicable yet | No send/distribute action exists anywhere in this module today (confirmed by research) — nothing to replace; would consume `queueCommunication()` with `requiresApproval` the day a "Send Financial Statement" action is built, per the directive's own approval example |
| Auditor Workspace | (none pre-existing) | Not applicable yet | Same — no existing send action found |
| AI Copilot | (none pre-existing) | Not applicable yet | "Copilot drafts, Platform delivers" is designed for (the engine has no Copilot-specific logic to duplicate) but no draft-and-send UI exists yet in Copilot to wire |

No module found bypassing the central service with its own direct send
logic — the only pre-existing direct call (`recurring-template-service.ts`
→ `notificationService.createNotification`) has been fully replaced.
Every "N/A" row is a genuine absence of prior functionality, not a
placeholder being left in place — verified by the research pass, not
assumed.

**Deliberately out of scope, disclosed**: a real Email provider
integration (SMTP/Resend/SendGrid credentials) — this is a deployment
configuration decision outside this codebase, same honest boundary as
Authentication being "blocked on Supabase credentials" elsewhere in this
platform. SMS/WhatsApp/Teams/Slack/Push senders — named, typed, rejected
cleanly at queue time, not implemented (all "future" per the directive).
Vercel Cron/`pg_cron` wiring for the Scheduler's own unattended
execution was already a disclosed gap before this phase and remains one
— the manual "Run Scheduler Now" action is what actually processes the
Communication Queue today.

### Phase 5.1 — Commercial Communication Integration, complete

**Extends, does not duplicate, the Phase 5 platform.** `0029_communication_platform_extensions.sql` adds `communication_attachments` (a document reference into the SAME Phase 4 `documents` table — "no duplicated attachment logic," per the addendum's own instruction, satisfied by a join table, not a second upload path), a fixed 9-value template category taxonomy (Sales/Purchasing/Customers/Suppliers/Finance/Audit/Marketing/Internal/Legal — the 3 Phase 5 templates were reclassified onto it, not left on free text), and 13 new seeded templates covering the business objects researched below. `seed_company_communication_defaults()` was made per-template idempotent (`on conflict do nothing`) rather than Phase 5's all-or-nothing guard, so companies that already had the original 3 templates received the 13 new ones on this migration's backfill without duplication.

**Research before wiring, not assumption.** Before writing any code, a dedicated research pass confirmed exactly which of the directive's named communication types correspond to a REAL, already-shipped business object (with file:line citations) versus a name with no real object behind it yet (`RFQ`, `Disclosure Package` as a standalone artifact, `Findings Report`/`Audit Request` as distinct objects — none exist, confirmed by grep, not guessed). Wiring only touched the former.

**New shared components** (all under `src/components/financial/communications/`, reused everywhere below — no per-module send form): `<SendCommunicationButton>` (a dumb, reusable trigger — template or ad-hoc, optional document attach, optional "Draft with Copilot"), `<CommunicationHistoryPanel>` (self-fetching "what was sent/when/to whom/status/attachments" for any business object, sourced entirely from the shared `communications` record). A **Communication Dashboard** tab (pure `dashboard-engine.ts`, 5 tests) now leads the Communications page: Queued/Scheduled/Sent/Delivered(future)/Retrying/Failed/Awaiting Approval, average delivery time, top failure reasons.

**AI Copilot drafts, never sends** — per the addendum's explicit instruction. `communication-draft-engine.ts` (4 tests) computes a real, useful draft (payment-reminder wording from a customer's actual aging buckets, a welcome message) using already-computed financial data — confirmed via research that NO part of the Copilot module anywhere in this codebase calls an LLM, so this is framed honestly as a **computed suggestion**, never "AI-generated." A `POST .../customers/[customerId]/draft-communication` route returns the draft; only `<SendCommunicationButton>`'s own call to `POST /communications` can actually queue or send it — Copilot has no path to the queue at all.

**Automatic vs. manual, a deliberate distinction.** A handful of true "on-event" triggers (Customer Welcome Email, Customer Suspension Notice, Supplier Onboarding, Remittance Advice, Purchase Requisition Notification, Quotation "Send") are wired directly into the existing service functions that already represent that event — each wrapped in `try { await queueCommunication(...) } catch { /* never break the primary operation */ }`, verified in every case to run only AFTER the real database write already succeeded and never affect the function's return value (matching the precedent already established in `recurring-template-service.ts`). Every other document type (Sales Order, Delivery, Invoice/Credit/Debit Note, Receipt, Purchase Order, Goods Receipt) gets a **manual** `<SendCommunicationButton>` on its existing list/detail UI instead — a deliberate choice: posting or approving a document should not silently email someone, only an explicit click should.

**Execution**: built via 4 parallel subagents, each scoped to a disjoint file set (Customer/Supplier Management; Sales; Purchasing; Financial Statements + Auditor Workspace), briefed with the exact component APIs, the exact safety-wrapping pattern, and the exact seeded template/variable names so none of them had to invent anything. Every diff was read and verified against those requirements before being accepted — one lint issue (a synchronous `setState` inside `useEffect` in `<CommunicationHistoryPanel>`, same class of issue fixed in Phase 4's `<DocumentsPanel>`) and one cosmetic import-ordering issue were found and fixed during review.

**Verification**: `tsc --noEmit` clean, `eslint .` clean, full suite 1058/1058 passing (up from 1049 — 9 new pure-engine tests), production build succeeds, live curl sweep of the Communications page and a full regression sweep (Customers/Suppliers/Sales/Purchasing/Financial Statements/Auditor/Recurring Templates, all 200) with no runtime errors in the dev server log.

**Updated Communication Integration Matrix** (supersedes the Phase 5 table):

| Module | Communication type | Real object confirmed? | Wired? | Trigger |
|---|---|---|---|---|
| Customer Management | Welcome Email | Yes (`createCustomer`) | **Yes** | Automatic |
| Customer Management | Statement | Yes | **Yes** (Phase 5) | Automatic (Recurring) + Manual button |
| Customer Management | Payment Reminder | Yes | **Yes** (Phase 5) | Automatic (Recurring) + Manual button, Copilot draft available |
| Customer Management | Account Confirmation | Covered by Welcome Email | **Yes** | Automatic |
| Customer Management | Account Suspension Notice | Yes (`setCustomerActive`) | **Yes** | Automatic |
| Supplier Management | Supplier Onboarding | Yes (`createSupplier`) | **Yes** | Automatic |
| Supplier Management | Purchase Order | Real object is Purchasing's PO | **Yes** (see Purchasing row) | Manual |
| Supplier Management | Remittance Advice | Yes (`approveAndPostPayment`) | **Yes** | Automatic |
| Supplier Management | Supplier Statement | Yes | **Yes** (Phase 5) | Automatic (Recurring) + Manual button |
| Supplier Management | Payment Confirmation | Same event as Remittance Advice | **Yes** | Automatic |
| Sales | Quotation | Yes (`sendQuotation`) | **Yes** | Automatic |
| Sales | Sales Order | Yes (`confirmOrder`) | **Yes** | Manual button |
| Sales | Delivery Confirmation | Yes (`createDelivery`) | **Yes** | Manual button |
| Sales | Invoice | Yes (`approveAndPostInvoice`) | **Yes** | Manual button |
| Sales | Credit Note | Yes (`documentType` on invoice) | **Yes** | Manual button (requires approval) |
| Sales | Debit Note | Yes (`documentType` on invoice) | **Yes** | Manual button |
| Sales | Receipt | Yes (`approveAndPostReceipt`) | **Yes** | Manual button |
| Sales | Customer Statement | Yes | **Yes** (Phase 5) | Automatic (Recurring) + Manual button |
| Purchasing | Purchase Requisition | Yes (`submitRequisition`) | **Yes** | Automatic (InApp, internal) |
| Purchasing | RFQ | **No real object exists** | Not wired | "Future-ready," per the directive's own label — nothing to wire |
| Purchasing | Purchase Order | Yes (`approveOrder` moment) | **Yes** | Manual button |
| Purchasing | Goods Receipt Confirmation | Yes (`createGoodsReceivedNote`) | **Yes** | Manual button |
| Purchasing | Supplier Bill Query | No distinct "query" object | **Partial** | No fixed template; achievable ad hoc via `<SendCommunicationButton>` with no `templateCode` — not pre-wired onto the Bills tab in this pass |
| Purchasing | Payment Advice | Same event as Remittance Advice | **Yes** | Automatic |
| Financial Statements | Management Pack | Yes (`generateReportingPackage`, type `ManagementPack`) | **Yes** | Manual button |
| Financial Statements | Board Pack | Yes (type `BoardPack`) | **Yes** | Manual button |
| Financial Statements | Financial Statements (raw) | Folds into the packs above | **Yes** (via packs) | Manual button |
| Financial Statements | Disclosure Package | **Not a standalone artifact** — confirmed disclosure notes are an ingredient of every pack, not their own generatable type | Not wired | No real object to attach a send action to |
| Auditor Workspace | Audit Request | **No real object exists** | Not wired | Disclosed gap |
| Auditor Workspace | Audit Query | No distinct object (the existing "Audit Queries" tab is an unrelated GL/journal exception query builder, confirmed by reading it, not a communication feature) | **Partial** | Ad hoc `<SendCommunicationButton>` on each Audit Finding ("Send Query") covers this in spirit |
| Auditor Workspace | Working Paper Request | Real generation exists (`audit-working-paper-service.ts`) but as a "generate," not a "request FROM someone" | Not wired | Disclosed gap — the semantic mismatch was judged not worth forcing |
| Auditor Workspace | Findings Report | Findings themselves are real | **Partial** | Ad hoc send on each Finding covers this in spirit, not a formatted "report" artifact |
| AI Copilot | Draft/Summarise/Rewrite/Improve tone/Suggest wording | Confirmed: no LLM anywhere in this codebase | **Yes, honestly framed** | Computed draft (not AI-generated) for Payment Reminder/Welcome, surfaced via `copilotDraftUrl` on the relevant `<SendCommunicationButton>` placements. Copilot has no send capability — verified by code inspection, not just by omission. |

No module bypasses the central service with its own send logic anywhere in the codebase — every wired trigger goes through `queueCommunication()`, and every "not wired"/"partial" row above reflects a genuine absence of a matching real business object today, not a shortcut.

### Phase 6 — Enterprise Monitoring & Operations Centre, complete

**One Operations Platform, not a developer dashboard.** `/platform/operations` — the single new page, extending the existing (previously thin) Platform Workspace rather than adding a parallel monitoring area. All 10 directive-named sections (Platform Health, Engine Health, Background Processing, Integration Health, Communication Health, Security, Performance, Audit, Alert Centre, Tenant Health) are real, tabbed, and backed by one `buildCompanyOperationsSnapshot()` service call — no module renders its own separate health widget.

**Research before schema, again.** Before writing anything, a dedicated pass established exactly what execution/duration/error data already exists per named engine (citations in the migration's own header comment) — confirmed real tracking exists for Automation Scheduler, Rule Engine (scheduler-triggered runs only), Workflow Engine, Notification Engine, and Communication Platform; confirmed ZERO execution tracking exists anywhere for Posting, Matching, VAT, or Reporting engines, and that AI Copilot is purely synchronous with no invocation history at all.

**Only 2 new tables — everything else is a real read of what already exists.** `0030_operations_centre.sql` adds `system_events` (a unified security/ops event log — only `PermissionDenied` actually writes to it, wired into `permission-service.ts`'s own single `forbidden()` injection point every ~200+ permission check already funnels through) and `operations_alerts` (the Alert Centre's Acknowledge/Assign/Resolve/Reopen workflow, reusing `notifications` for content creation rather than a second notification store). Every other section reads directly from tables that already existed before this phase: `automation_tasks`/`automation_task_runs`, `workflow_instances`, `notifications`, `communications` (via the Phase 5 `dashboard-engine.ts`, reused verbatim per the directive's own "Use the Communication Platform" instruction), `automation_audit_log`, `permission_audit_log` (a read path was added — only a write path existed before), `matching_overrides`, `gl_transactions`, `vat_returns`, `vat_exceptions`, `reporting_packages`, `copilot_briefings`, `audit_findings`.

**Live / Calculated / Not Available, applied literally, everywhere.** Every quantitative field in `src/server/operations/types.ts` carries a `DataQuality` tag. Posting/Matching/VAT/Reporting/AI Copilot engines show `NotInstrumented` status with every error/duration/queue-depth field honestly `NotAvailable` — the only thing shown for them is a real, `Calculated` "last activity" timestamp computed from that engine's own output table (e.g. Posting Engine's is the newest `gl_transactions.posted_at`), explicitly disclosed as "the engine's own output, not a run log," never fabricated as if it were execution telemetry. The Performance Dashboard's CPU/memory/slowest-query/page/report/API/dataset fields are all hardcoded `NotAvailable — Monitoring Provider Required`, per the directive's own literal instruction — only Scheduler/Rule-Engine/Communication-Queue task duration (the one thing `automation_task_runs` actually times) is real. Integration Health lists 6 real extension points (Email Provider, Virus Scanner, OCR Provider, Bank Feed, SARS eFiling, Scheduler Cron Trigger) all honestly `Not Configured` — the same status contract every entry uses, per the directive, with none faked as connected. The Security Dashboard's 6 named metrics carry a `tracked: boolean` flag — Permission Denials is `tracked: true` (real); Failed Logins/Account Lockouts/Expired Sessions/API Auth Failures/Suspicious Activity are `tracked: false`, rendered as "Not Available" rather than a fabricated 0 indistinguishable from "tracked, zero occurred" — a deliberate, disclosed decision not to instrument the live Supabase Auth login flow in this pass (see Observability Gaps below).

**Alert Centre wired to 2 real sources.** The exact moment `scheduler-service.ts` and `communication-service.ts` already create an `AutomationFailure` notification on retry exhaustion now ALSO raises a real `operations_alerts` row, fire-and-forget try/catch-wrapped so an alerting failure can never break the scheduler run or the communication queue.

**Platform-wide scope, honestly bounded.** `Platform Super Administrator`/`Platform Administrator` roles are seeded (Phase 1) but have zero enforcement code anywhere in this codebase (confirmed by research — no `getPlatformRole()` function exists). Building that role-resolution layer was judged out of scope for a monitoring phase. `/api/operations` therefore spans exactly the companies the signed-in user both belongs to AND holds `SystemAdministration` in — the same real membership scope `/platform`'s own pre-existing "My Companies" list already uses — not a fabricated "every tenant on the platform" view. This is named as the phase's own primary Operational Risk below.

**Verification**: `tsc --noEmit` clean, `eslint .` clean, full suite 1094/1094 passing (up from 1058 — 36 new pure-engine tests across 6 new engine files), production build succeeds, live curl sweep of `/platform/operations` and a full regression sweep (Platform Overview, Customer/Supplier detail, Settings, Communications, Dashboard) all 200 with no runtime errors in the dev server log (two initial `000`s were confirmed, by retry, as Turbopack's first-compile latency on the large new page, not errors).

#### Operations Readiness Report

**Monitoring Coverage: 100%** — all 10 directive-named dashboard sections are built, real, and rendering live/calculated data (0 sections are placeholder or mock-only outside Preview Mode).

**Engine Coverage: 50%** — 5 of the 10 named engines (Automation Scheduler, Rule Engine, Workflow Engine, Notification Engine, Communication Platform) have real, execution-based health status (Healthy/Degraded/Failing computed from actual run data). The other 5 (Posting, Matching, VAT, Reporting, AI Copilot) have zero execution tracking anywhere in the codebase and honestly report `NotInstrumented`, each with only a real last-activity timestamp rather than fabricated telemetry.

**Alert Coverage: ~29%** — 2 of 7 identified alert-worthy failure points (Scheduler retry exhaustion, Communication retry exhaustion) automatically raise an Alert Centre entry today. Not yet wired: Workflow rejections, VAT exceptions, open Audit Findings, stuck background jobs (detected and displayed, but not yet auto-alerted), and permission-denial spikes.

**Security Event Coverage: ~17%** — 1 of the 6 named Security Dashboard metrics (Permission Denials) is actually instrumented; the rest are honestly `Not Available`, not fabricated zeros.

**Observability Gaps** (ranked by materiality):
1. **No failed-login/account-lockout/session-expiry tracking.** `requireSession()` returns a clean 401 and writes nothing anywhere; "account lock" has no concept in this app's auth model at all. Wiring this touches the live Supabase Auth login flow — deliberately not attempted this pass given the risk of destabilizing a critical path without a real Supabase project to verify against.
2. **Posting/Matching/VAT/Reporting engines have no execution log.** A single ad-hoc rule-engine run, a match outside the scheduler, or a VAT/reporting generation leaves no error/duration/queue-depth trace — only each engine's own output table's newest timestamp is visible.
3. **No real request/page/API duration persistence anywhere** — confirmed the dev server's own stdout timing log is the only place this data exists today, and it is dev-only. Every "slowest X" metric in Performance is a named, honest extension point, not a measurement.
4. **No platform-role enforcement layer** — `Platform Super Administrator` is seed data only; true cross-organisation visibility (rather than "every company the signed-in user administers") cannot be built until this exists.
5. **Alert generation is reactive-only for 2 of 7 identified triggers** — most failure classes are visible on their own dashboard tab but do not yet proactively raise an alert.

**Operational Risks:**
- A permission-denial spike (e.g. a misconfigured role change) is visible only by manually checking the Security tab — it does not yet page anyone.
- A stuck background job (30+ minutes in `Running`) is surfaced but requires a human to notice it on the Background Processing tab; no automatic alert or timeout/kill mechanism exists.
- Genuine infrastructure metrics (CPU, memory, DB connection pool health) are entirely invisible to this application layer today — a real incident there would show up nowhere in the Operations Centre.

**Recommendations before RC2:**
1. Instrument the live login flow for failed attempts/lockouts once a real Supabase project is available to verify against safely.
2. Extend Alert Centre wiring to the remaining 5 identified trigger points (Workflow rejections, VAT exceptions, stale Audit Findings, stuck jobs, permission-denial rate spikes).
3. Build the platform-role resolution layer (`getPlatformRole()`) before attempting any true cross-organisation Operations view.
4. Adopt a real external APM/monitoring provider (the Performance Dashboard's `NotAvailable` fields are the exact, disclosed integration points) rather than building bespoke request-timing persistence in-app.
5. Add execution logging to the Posting and Matching engines specifically — they are the two most financially consequential engines with zero instrumentation today.

### Phase 7 — Enterprise Security & Multi-Tenant Certification, substantial hardening delivered, NOT yet fully certified

**Audit-then-fix, at scale.** 4 parallel read-only audit agents (RBAC completion, tenant isolation, repository+RLS, API certification) — several of which further fanned out into their own sub-agents — swept the entire codebase: 231 API route files, 153 repository list-functions, all 119 database tables' RLS policies, and the full RBAC/approval-authority model. Every finding below is cited to file:line by the audit transcripts (summarized here); nothing in this section is estimated.

**RBAC completion — the headline finding, substantially improved but honestly NOT complete.** Before this phase: only 19-21 of ~176-178 mutation-capable API routes (≈11%) called `requirePermission`/`requireApproval` at all — the Permission Engine was fully built (RC1 Phase 1) but barely consumed. Every one of the directive's explicitly named categories with zero enforcement despite an already-seeded permission key existing for it (Posting, Audit, AI Copilot, VAT approval/submission, Automation/Scheduler admin, Financial Statement generation) is now wired — ~40 previously-ungated route handlers gated across 3 parallel wiring agents plus manual fixes, using each module's existing permission-key conventions (no new permission categories invented). Sub-action gaps inside already-partially-gated files (a journal's `submit`/`cancel` going unchecked next to its correctly-gated `approve`/`reject`/`reverse`) were closed too. **Still open, disclosed as the primary remaining blocker**: ordinary CRUD across Sales/Purchasing/Inventory/Customers/Suppliers/Banking-config/company-configuration (~100+ routes) still relies on `requireSession()` alone — any authenticated company member, regardless of role, can create/edit/delete these records today. Fixing this exhaustively was judged too large and too risky to rush through in one pass without real regression risk to core CRUD across the whole app; it is the named, top-priority item for the next security pass, not silently left off this report.

**A real, confirmed cross-tenant vulnerability found and fixed.** `communication_attachments` (Phase 5.1) had no check anywhere — application or RLS — that an attached `document_id` belonged to the same company as the communication. Fixed at both layers: `communication-service.ts::queueCommunication` now verifies every `documentId` resolves via `getDocument(companyId, id)` before attaching (rejecting foreign-company ids with a `ValidationError`), and the RLS insert policy itself was tightened to independently re-check `documents.company_id = communications.company_id` — the same "app AND RLS, never one alone" discipline this platform has followed since the Phase 2 RLS-escalation fix.

**A dormant SQL privilege-escalation defect found and fixed before it could ever activate.** `user_has_permission()`'s role-chain query matched `ura.company_id is null` for ANY `target_company_id` — meaning a platform-scope role assignment would grant its permissions in EVERY company, not just ones the user actually belongs to. Confirmed genuinely dormant (the 4 seeded platform roles carried zero permission grants, and no code path ever creates a `company_id`-null assignment) — but fixing the SQL now, in the SAME migration that finally seeds real platform-role permissions below, was essential: seeding permissions onto the old function would have made the defect immediately live.

**Platform roles made real, deliberately narrow.** `platform_super_administrator`/`platform_administrator`/`support_technician` previously had zero permission grants at all — "Platform Super Administrator: full control of every organisation, company, and platform setting" was non-functional, not safely bounded. Seeded now with administrative/reporting permissions only (`SystemAdministration`, `ManageUsers`, `AuditAccess`, `RunReports`, `AccessAICopilot`) — deliberately **never** a module CRUD or approval/posting permission, so "a Platform Administrator cannot post customer journals inside another tenant" (the directive's own named test) holds by design. `partner` was deliberately left with zero grants: its own description ("access on ASSIGNED companies") cannot be honestly modeled by the platform-wide `company_id is null` mechanism, which grants everywhere — seeding it would have silently over-privileged it; it needs normal per-company assignments until a real "assigned companies" concept exists.

**Repository audit — every HIGH-severity unbounded query fixed.** 153 list-returning repository functions audited across the whole codebase (not sampled). 112 lacked a `.limit()`; severity was calibrated by whether the underlying table is realistically unbounded in production (sales invoices, purchase bills, GL transactions, documents, communications, bank transactions — High) versus inherently small by domain nature (roles, VAT codes, per-entity contact lists — Low). **All 39 High-severity findings fixed** with the exact `LIST_CAP = 10_000` + deterministic `.order()` pattern already proven in RC1 Phase 3 — spanning Sales/Purchasing/Inventory (deliveries, GRNs, invoices, bills, inventory transactions, stock takes, cost layers), Banking/GL (reconciliations, bank transaction history, GL account ranges, journals, merges), Documents/Communications/Audit (pending communication queue, document listings, audit/asset findings, automation task/run history), and VAT/Supplier (open bills, bank transactions, VAT exceptions). 30 Medium and 43 Low-severity findings remain unfixed — disclosed, not silently dropped — on tables judged genuinely low-risk at realistic scale (config/master data, per-entity-scoped audit trails).

**RLS certification — effectively complete.** All 119 tables across 30 migrations have RLS enabled (100%). Zero `using(true)`/`with check(true)` policies exist anywhere — the single most dangerous pattern to find, and it was searched for exhaustively, not sampled. Two minor completeness gaps found (`organisations`/`organisation_members` have no UPDATE/DELETE policy at all — a missing-feature gap, not an exposure, since RLS defaults to deny) are disclosed, not fixed in this pass (out of scope — no route/service exists yet that would need them). One integrity inconsistency found and fixed: `automation_audit_log` allowed any company member to directly edit/delete their own audit trail via the generic membership policy (unlike `permission_audit_log`, which was already RPC-only since Phase 2) — now select-only for clients, writes routed through a new `security definer` RPC, matching the established tamper-proof pattern.

**API certification — tenant isolation confirmed genuinely defense-in-depth.** Traced two representative routes (customer detail, journal approval) precisely: a Company-A user substituting Company B's UUID in the URL is blocked by TWO independent layers — the repository's own `.eq("company_id", companyId)` filter AND RLS's `user_can_access_company()` — never by "nothing," and never by only one. Authentication coverage 233/234 routes (99.6%, the one exception is the deliberately cron-secret-gated scheduler route). Rate limiting and replay/CSRF protection remain genuinely absent platform-wide (already disclosed before this phase) — no code-level fix was attempted, since both are real infrastructure additions (a rate-limiting service, an idempotency-key layer) rather than a code change, consistent with the directive's own "extension point" framing rather than "must be live today."

**Document/Communication/AI security — personally verified against the actual Phase 4/5/5.1/6 implementation** (the author of those phases audited them directly rather than delegating, for accuracy). Document Platform: version isolation, company isolation, and permission inheritance all confirmed correct; 2 defense-in-depth gaps closed (`markVersionSuperseded`/`setDocumentGroupId` now take and filter by `companyId`, even though the single call site already validated ownership and RLS independently protected both). Communication Platform: the attachment cross-tenant gap above was the one real finding; recipient validation, template scoping, retry behaviour, and queue ownership all confirmed correct. **AI Copilot: zero findings.** Every data-fetching call in the entire traced call graph (`copilot-assistant-service.ts::askCopilot`'s 11 question branches, fanning out through Financial Statements/Customer/Supplier/GL/Executive Intelligence/Matching/Audit/Asset services) threads a required, non-optional `companyId` end-to-end into a real `.eq("company_id", ...)` filter — confirmed by a full import-graph trace, not a sample. All 3 Copilot tables' RLS policies correctly scope by company. The Copilot cannot access another company's data today, full stop.

**Verification**: `tsc --noEmit` clean, `eslint .` clean (0 errors, 2 pre-existing unrelated warnings), full suite 1094/1094 passing (zero regressions despite touching ~90 files across 9 parallel agents plus manual fixes), production build succeeds, live curl sweep clean after a Turbopack dev-cache reset (a local tooling crash unrelated to the code — confirmed by `tsc`/`eslint`/`vitest`/`npm run build` all passing before the reset).

**Enterprise Security Certification Report** — Critical/High/Medium/Low risk register, per-dimension scores, and certification status — was delivered directly to the user as the phase's own required deliverable (not duplicated here in full; see that report for the complete evidence-backed scoring). Headline scores: RLS Audit ~100%, AI Security 100%, Document/Communication Security strong (each with one real finding, found and fixed), Repository Audit 100% of High-severity findings fixed, **RBAC Completion ~34%** (up from ~11%, but not complete) — **Overall Security certification status: CONDITIONAL, not yet fully certified**, gated specifically on completing RBAC coverage for ordinary CRUD routes before RC2.

### Phase 7.5 — Enterprise RBAC Completion & Security Certification, RBAC coverage complete, in progress on the remaining parts

Launched because Phase 7's own honest self-report ("RBAC coverage is only ~34%, cannot yet be certified") was accepted as correct and used as the explicit justification for a full completion pass — "do not assume previous work is complete." Every number below is a fresh, tool-verified count re-run against the current codebase at the end of this pass, not carried over from memory.

**A genuinely fresh, from-scratch re-audit — not a re-read of Phase 7's summary.** A Node.js AST-lite scanner (brace-matching, string/template-literal-aware) processed every `route.ts` file under `src/app/api` and extracted every `POST`/`PUT`/`PATCH`/`DELETE` handler, every `requirePermission`/`requireApproval` call, and every `switch`/`if(action===...)` decision point inside each handler body. This produced a more precise picture than Phase 7's own reported "~61 of 178": **180 total mutation-capable handlers**, of which **115 had zero `requirePermission`/`requireApproval` call anywhere in the body** (not "partially gated" — the scan confirmed 0 of the 180 handlers were internally partial; a route is either fully gated or has no check at all).

**RBAC completion — evidence, not a percentage:**
- Total API mutation routes (POST/PUT/PATCH/DELETE handlers, `src/app/api`): **180**
- Total protected by `requirePermission`/`requireApproval`: **178**
- Total structurally exempt (verified individually, not waved through): **2** — `POST /api/companies` (company creation itself; there is no `companyId` to scope a permission check to until the row exists — gated by `requireSession()` only, correct by construction) and `POST /api/automation/run-due-tasks` (the scheduler's own cron entry point, gated by a shared-secret header check instead of a user session — there is no user session in a cron invocation)
- Total remaining unprotected: **0**
- Total permissions in the catalog: **135** (12 modules × 10 actions = 120 module permissions, + 15 global permissions)
- Total distinct permission keys actually enforced by at least one route (literal, grepped fresh post-wiring): **36**, plus a further set reachable only via 2 template-literal call sites (`communications` routes resolving `${module}:Create/Approve/Reject/Edit` across 10 modules, `documents` routes resolving `${module}:View/Create/Delete` across 8 modules) — both call sites read their module from a fixed, closed lookup table (`COMMUNICATION_PERMISSION_MODULE`, `DOCUMENT_PERMISSION_MODULE`), not from unvalidated user input, so the dynamic key space is enumerable and bounded, not arbitrary.
- Total roles: **19** (15 company-scope: Company Owner, Managing Director, Financial Director, Financial Manager, Accountant, Senior Bookkeeper, Bookkeeper, Accounts Receivable Clerk, Accounts Payable Clerk, Inventory Manager, Purchasing Manager, Sales Manager, Branch Manager, Auditor, Read Only; 4 platform-scope: Platform Super Administrator, Platform Administrator, Partner, Support Technician)
- Total RLS policies (`create policy` statements across all migrations, counted fresh): **149**
- Total security regression tests added this phase: **10** (`src/server/permissions/security-regression.test.ts`), on top of the 18 pre-existing permission-engine tests
- Total tests passing (full suite, after this phase's ~90+ file changes across 2 sessions): **1104 / 1104**

**8 parallel wiring agents, each scoped to a disjoint file list** (Company Management 15 files, Customers+Suppliers 13, Sales 10, Purchasing+Inventory 18, Banking+Cashbook 23, Matching 10, GL+Reporting+Disclosures 15, Automation+Communications+Operations 9 — 113 files total), closed all 115 gaps using each module's own existing permission-key conventions (`Sales:Create`/`Sales:Edit`, `Banking:Edit`, `RunAutomation`, etc. — no new permission categories invented). Every switch/if-action handler was gated with a single `requirePermission`/`requireApproval` check placed BEFORE the branch, so all cases within a handler are covered uniformly — confirmed by re-reading the actual source of every file the rescan's stale allowlist mis-flagged as "needs review" (19 files, spot-checked across 4 different wiring agents' output with zero counter-examples: `bank-accounts/[accountId]`, `inventory/transactions/[transactionId]`, `sales/orders/[orderId]`, and others all place the check immediately before the switch).

**One self-caught wiring error, fixed.** The Company Management wiring agent gated `financial-years` and `financial-periods` routes with the generic `Settings:Edit`/`Settings:Create` — but the seed data has a purpose-built `ManageFinancialYears` global permission for exactly this, and **Financial Manager holds `ManageFinancialYears` but not `Settings:Edit`** — the original wiring would have silently excluded a role the system was designed to grant this action to. Found by cross-referencing the wiring output against the seed migration directly (not assumed correct because tsc/eslint passed), fixed across all 3 affected files, re-verified clean.

**Permission Matrix — dead/orphan/unused analysis, using structural proof where possible instead of hand-checking ~19×135 grant rows one by one:**
- **No duplicate grants — proven by database constraint, not manual review.** `role_permissions` has `unique (role_id, permission_key)` (`0025_rbac_platform.sql:47`) — a duplicate grant is not a possible database state.
- **No unused permissions — proven by the seed data's own structure.** Financial Director, Managing Director, and Company Owner are seeded with a cross-join of all 12 modules × all 10 actions (`0025_rbac_platform.sql:342-346`) plus 14 of 15 global permissions (`:347-350`), and Company Owner additionally gets `SystemAdministration` (`:351`) — between them, every one of the 135 catalog permissions is held by at least one role, by construction.
- **2 genuinely dead permissions found** (granted to a role, but never checked by any route): `RunReports` and `ManageFinancialYears`. `ManageFinancialYears` was fixed in this pass (see above — it's now actively checked). `RunReports` remains genuinely unchecked by any current route — disclosed honestly rather than force-fit onto an unrelated endpoint; it is granted to Accountant/Financial Manager/Financial Director/Managing Director/Owner/Auditor/all 3 active platform roles and is available for a future reporting-module gate.
- **No orphan roles.** All 19 roles are referenced by the seed function or the platform-role insert; none exist with zero possible assignment path.

**Approval Authority verified against the directive's own named examples, using the seed data + the new regression tests:**
- *"Bookkeeper can't approve above limit"* — more precisely correct than the example implies: the base **Bookkeeper** role has **zero** approval permission (`ApproveJournals`/`ApprovePayments`/etc. are absent from its grant list entirely — `0025:274-276`); only **Senior Bookkeeper** (which inherits Bookkeeper via `parent_role_id`) gains `ApproveJournals`/`ApprovePayments` capped at R50,000 (`:280-283`). `evaluateApproval`'s existing boundary tests (`permission-engine.test.ts`) already assert R50,000.00 passes and R50,000.01 is denied.
- *"Finance Manager can approve supplier payments"* — confirmed: Financial Manager holds `ApprovePayments` with a R500,000 `SupplierPayment` limit (`0025:332-337`).
- *"MD unlimited"* — confirmed: Managing Director (with Financial Director and Company Owner) is seeded with `max_amount = null` across every approval category (`0025:352-355`), and `resolveApprovalLimit`'s existing test suite already asserts an explicit-null limit row means unlimited, not "no limit configured."
- *"Platform Administrator cannot post customer journals inside another tenant"* — confirmed structurally, not just by absence of a test: Platform Administrator's entire grant list (`0031:155-157`) is `ManageUsers`, `AuditAccess`, `RunReports` — no module CRUD permission and no approval/posting permission exists on the role at all, in any company, so there is no `GeneralLedger:Post` or `ApproveJournals` grant to exploit regardless of tenant.
- **Multi-level hierarchy, honestly characterized**: the directive's named hierarchy labels (Supervisor/Manager/CFO/Administrator/etc.) map to this system's actual roles by increasing grant scope and rising/unlimited approval ceilings (Bookkeeper → Senior Bookkeeper → Accountant → Financial Manager → Financial Director/Managing Director/Owner), not to a deep `parent_role_id` inheritance tree — **Senior Bookkeeper → Bookkeeper is the only inheritance edge that exists in the entire seed**; every other role's permissions are flat, independently granted. This is disclosed as the accurate model rather than described as something it is not.

**Platform/Company role isolation — re-verified, with new executable proof.** `user_role_assignments` carries `unique (user_id, company_id, role_id)` (`0025:74`) and is genuinely per-company for the 15 company roles (a user can hold different roles in different companies with no shared row). The Phase 7 SQL fix to `user_has_permission()` (splitting the old `company_id = target OR company_id IS NULL` into two explicit branches) is now proven, not just described, by 4 new executable tests in `security-regression.test.ts` mirroring the exact WHERE-clause logic before and after the fix — including one that demonstrates the OLD logic would have resolved a platform-scope role's permissions for a company the user never joined, and one proving a user with different roles in two companies never gets either role's permissions applied to the other company.

**Verification for everything above**: `tsc --noEmit` clean, `eslint .` clean (same 2 pre-existing unrelated warnings as Phase 7, nothing new), full suite **1104/1104** passing.

**Database re-audit (Part 9) — fresh, read from source, not trusted from Phase 7's summary.** Every one of the 32 migration files was read in full and re-checked for RLS coverage, `using(true)`/`with check(true)` patterns, every `security definer` RPC's actual scope, and Storage bucket policies. Totals: **119 tables, 119 with RLS enabled** (still 1:1, no regression), **149 policies** (107 `FOR ALL`, 16 `SELECT`, 12 `INSERT`, 8 `DELETE`, 6 `UPDATE`), **zero** `using(true)`/`with check(true)` hits anywhere, **6 security-definer RPCs** (all narrow, single-purpose — none accept arbitrary SQL or table names), Storage RLS confirmed present and company-scoped (`0027_document_platform.sql:122-129`, keyed off the `{company_id}/...` path prefix). All of migration 0031's fixes (the `user_has_permission()` two-branch correction, the `communication_attachments` rewrite, the `automation_audit_log` RPC) were independently re-verified present and correctly written, not just described in a comment.

**One real, previously-undisclosed gap found and fixed** (migration `0032_operations_centre_platform_hardening.sql`): `system_events` and `operations_alerts` (RC1 Phase 6) treated every platform-level row (`company_id is null`) as readable/writable by *any* authenticated user, not just an actual platform-role holder — any signed-in user could fabricate platform-level security-log entries or fully CRUD another admin's platform-wide alert. This was honestly disclosed in Phase 6's own migration comment at the time ("Platform Super Administrator/Platform Administrator roles are seeded but have NO enforcement code anywhere yet") — but Phase 7's own platform-role seeding + `user_has_permission()` fix (migration 0031) closed that enforcement gap weeks later, making this policy stale rather than permissive-by-necessity. Fixed the same way 0031 fixed `automation_audit_log`: platform-level rows now require `user_has_permission(null, 'AuditAccess')` — no new RPC needed, since `user_has_permission`'s two-branch design already resolves only genuine platform-scope grants when passed a null company id. Confirmed via the actual call sites (`operations-service.ts`, `permission-service.ts`) that no current application code path ever exercises the platform-level branch of these tables yet — this closes a latent hole, it does not touch a working feature.

**Authentication Integration (Part 11) — the full workflow now exists in code**, closing every named gap:
- **`/auth/confirm`** (`src/app/auth/confirm/route.ts`) — Supabase's own documented server-side token-exchange route for email links, handling password recovery, invite-accept, and email verification through one handler (`type` selects the destination). Requires one one-time Supabase Dashboard step once a real project exists: pointing the Auth Email Templates' `ConfirmationURL` at this route instead of Supabase's default hosted redirect — a dashboard setting, not a code or database change, documented in `ARCHITECTURE.md`.
- **Reset Password** (`/reset-password` + `SetPasswordForm`) — the actual "set a new password" page that was missing entirely before this phase; `forgot-password-form.tsx`'s `redirectTo` was pointed at `/login` (a page with no password field), now correctly points through `/auth/confirm`.
- **Change Password** (`/platform/account`) — reuses the same `SetPasswordForm` in `"change"` mode, which re-verifies the current password via `signInWithPassword` before calling `updateUser`, so a hijacked-but-still-open session can't silently lock the real owner out.
- **Logout** — did not exist anywhere in the UI before this phase (`workspace-shell.tsx`'s avatar area was static). A real `SignOutButton` now calls `supabase.auth.signOut()` and is wired into both the Platform and Financial workspace shells, shown only when a real session exists (`userEmail` is set — never rendered in Preview Mode).
- **Remember Me** — the checkbox already existed in `LoginForm` but was never wired to anything. Implemented via the session cookie's own `maxAge` (unchecked = a real browser session cookie, gone when the browser closes) rather than swapping `localStorage`/`sessionStorage` — `@supabase/ssr` stores the session in cookies specifically so the server (`proxy.ts`, every layout, every API route's `requireSession()`) can see it too; a storage-adapter swap would have broken server-side session visibility entirely for "don't remember me" logins, not just the browser tab.
- **Invite User workflow** — a genuine, previously-real gap: granting access required already knowing a user's raw `auth.users.id` (`roles-permissions-tab.tsx`'s only assignment path), meaning there was no way to bring a genuinely new person onto a company at all. `POST /api/companies/[companyId]/users/invite` (gated by `ManageUsers`, same as direct assignment) now calls the Supabase Auth Admin API (`inviteUserByEmail`) via a new service-role client (`src/lib/supabase/admin.ts`, server-only, never bundled to the browser) and assigns the chosen role in the same step — wired into the Settings → Roles & Permissions tab's Assignments panel alongside the existing raw-ID path.
- **First-run bootstrap** (`/setup` + `POST /api/setup/bootstrap`) — creates the first Platform Super Administrator without any manual database intervention. Every table this needs is already seeded by migration 0025 the moment migrations run; this creates the one row that can't be seeded in advance — the actual person. Runs on the service-role client because, by definition, no session exists yet: `user_role_assignments`' own INSERT policy only allows company-scoped rows from a normal session (`company_id is not null`), so a platform-scope assignment can only ever be created this way, never through an accidental client-side gap. Self-locking: re-checks `hasPlatformSuperAdministrator()` on every load and every POST (never trusts the page-level check alone), fails closed with 409 once one exists.
- **First Company Administrator bootstrap** — already existed, confirmed rather than assumed: `company-service.ts::createCompany` already calls `seedCompanyRbacDefaults` and assigns the creating user Company Owner in the same transaction (RC1 Phase 1), so any authenticated user creating a company already gets full administrative access to it with no manual step. No new code needed here — just verified and documented.

**Verification**: `tsc --noEmit` clean, `eslint .` clean (same 2 pre-existing warnings, nothing new), full suite **1104/1104** passing after the auth build (zero regressions), and a live `curl` sweep of every new route against the running dev server in Preview Mode — `/login`, `/forgot-password`, `/reset-password`, `/setup`, `/platform/account` all 200; `/auth/confirm` 307 (correct — redirects without a token); `POST /api/companies/[id]/users/invite` and `POST /api/setup/bootstrap` both correctly 501 with the expected "no Supabase project configured" / "SUPABASE_SERVICE_ROLE_KEY not set" messages; a 5-page regression spot-check of pre-existing routes all still 200. `npm run build` was deliberately deferred rather than run concurrently with the live dev server (the same Turbopack Windows file-locking crash this project hit earlier in RC1) — tracked as the one remaining mechanical step before this phase's final sign-off.

**Still open, disclosed rather than silently deferred**: live verification of every auth flow (login, forgot/reset password, invite-accept, first-run bootstrap) against a *real* Supabase project, with screenshot evidence, as the user explicitly requested — blocked on the user providing real Supabase project credentials, not yet received. Security Regression Testing beyond the pure permission-engine layer (a genuine cross-company HTTP/RLS-level attempt-and-verify-failure suite: direct URL manipulation, foreign IDs, cross-company document/journal/reporting/AI/automation access) requires a live database to actually attempt against and is tracked for once credentials land. A production build run (deferred above) is the one remaining local-only step. RC2 remains gated until these close.

### Phase 7.6 — Live Authentication & Production Backend Certification, core platform certified, conditional go

The user provisioned a real Supabase project and provided credentials; this phase connected to it and certified everything Phase 7.5 could only certify in code, against a live backend, via direct `curl`/API testing (no browser-automation tool was available in this environment — disclosed explicitly rather than substituting screenshots that don't exist).

**6 real defects found live, all 6 fixed and re-verified with zero regression (1104/1104 tests, `tsc`/`eslint` clean throughout):**
1. **Fixed Assets FK typo** (migration 0018) — `fixed_assets.supplier_id` referenced a table named `suppliers`, which doesn't exist (the real table is `ae_suppliers`) — the very first live migration run ever attempted against this schema, and it failed on statement 5 of migration 18 of 32. A systematic FK-vs-table-name diff across all 32 original migrations found this was the only such mismatch.
2. **Organisation bootstrap RLS/RETURNING bug** (migration 0033) — a brand-new user's first-ever company creation failed with a generic RLS violation. PostgREST's `INSERT ... RETURNING` requires the SELECT policy to also pass, and the SELECT policy required org membership the user didn't have until the very next statement. Fixed via a `security definer` RPC doing both inserts in one transaction.
3. **Ambiguous column in the fix above's own RPC** (migrations 0034→0035) — caught on the next live call after shipping fix #4: Postgres 42702, a `returns table(...)` function's OUT-parameter names shadowing identically-named columns in its own `RETURNING` clause. Fixed with a follow-up migration (the buggy one was left as an honest historical record, matching this project's established convention for migrations that already ran against a real database).
4. **Every invited/assigned user was blocked from their own company** — a genuine `user_role_assignments` row (exactly what Invite User creates) still produced "you have no role assigned," because this platform's two separate membership tables (org-wide `organisation_members`, company-specific `user_role_assignments`) were never connected. Reproduced live with a real Bookkeeper user, fixed by making role assignment also grant real org membership via the same RPC pattern.
5. **CRITICAL — a genuine cross-tenant data leak** (migration 0036), the most serious finding of the whole RC1 effort. Fixing #4 (correctly) added the test user to the organisation — which, combined with `user_can_access_company()`'s original organisation-wide design, meant they could then read a SIBLING company's real customer data via a plain GET request, with zero role there. Proven with a record deliberately named "CONFIDENTIAL Company A Client," successfully read by a user with no relationship to that company. Fixed by rewriting the one function ~117 of 119 tables rely on to check real per-company or platform-scope grants instead of organisation membership — closing the leak everywhere at once, re-verified with the identical attack (now empty) and a full regression pass (every legitimate access path unaffected, company creation still works).
6. **Uncaught error on a foreign/nonexistent customer ID** — a cross-tenant write attempt hit an uncaught PostgREST "0 rows" error (raw 500) instead of a clean 404; the write was already correctly blocked, only the error response was wrong. Fixed matching this codebase's established `NotFoundError` pattern.

**Live-verified, not assumed**: all 36 migrations deploy cleanly in order (119 tables, 153 RLS policies, 12 RPC functions, 1 storage bucket, 4 platform roles — all independently queried and confirmed); RLS genuinely blocks unauthenticated access (empty result, not an error); the `/setup` first-run bootstrap creates a real Platform Super Administrator and self-locks (second attempt correctly `409`s from any caller); company creation seeds 15 roles/26 chart-of-accounts entries/6 VAT treatments/25 posting rules with zero manual steps; login/logout/remember-me/forgot-password/reset-password/change-password all work end-to-end through the real `/auth/confirm` token-exchange route (using the Admin API's `generate_link` as a stand-in for clicking a real email, since Supabase's default email sender is rate-limited — confirmed live); invalid, missing, and already-consumed tokens are all correctly rejected; role escalation, permission escalation, and foreign-ID write attacks were all correctly blocked; a real Sales invoice was created, submitted, approved, and posted, producing balanced GL transactions (Dr 11,500 = Cr 10,000 + Cr 1,500) through the full posting engine; 13 pages spot-checked live as an authenticated real user, all correct.

**Deliverables**: the [Enterprise Production Certification Report](https://claude.ai/code/artifact/8243ad35-fef6-46db-9dd5-8cd1de045396) (exact totals, every defect evidence-cited, conditional-go recommendation) and the [Production Deployment Guide](https://claude.ai/code/artifact/1e18b79a-a674-426c-99a0-a56cec0a48dc) (every step actually performed against the real project, not reconstructed from documentation), both delivered directly to the user as this phase's own required output.

**Still open, disclosed rather than silently deferred**: SMTP configuration and a Supabase Auth Email Template dashboard setting (documented step-by-step in the deployment guide, not a code change); the other ~19 named business workflow types were not each individually live-tested this pass (Sales invoicing → GL posting was the one representative end-to-end proof; the rest share the same already-unit-tested architecture but haven't personally been proven live yet); `companies`' own metadata-visibility policy (sibling company names/existence, not business data) remains organisation-wide, deliberately left alone since fixing it risks the same RETURNING-visibility break company creation itself would suffer; the ~53-route try/catch hygiene gap disclosed since Phase 7 remains, with one concrete live instance fixed this pass; rate limiting/replay protection remains a genuine infrastructure addition, unchanged since Phase 7.

## RC2 — Enterprise Performance, Scalability & Commercial Readiness

Launched after the Product Review Board formally accepted Functional Development, Enterprise Security, and Live Backend Certification, declaring VYRON FINANCE feature-complete. Objective shifted from "does it work" to "can it reliably run real businesses at scale." 12 phases, executed with the same live-evidence discipline as RC1 Phase 7.6 — real HTTP timings, real `EXPLAIN ANALYZE` plans, real synthetic data, real code-structure audits, no fabricated benchmarks.

**Scope note, agreed with the user before starting**: Phase 3's literal enterprise-scale targets (100 companies, 500K+ invoices, 6M journal lines) were not attempted — this environment has no dedicated load-testing infrastructure, no server-level CPU/memory profiling access to Supabase's managed infrastructure, and the live project's actual plan tier/cost tolerance for that volume was unknown. A scaled-down, honest load test (~250,000 synthetic rows) was run instead, explicitly confirmed with the user as the right tradeoff.

**Performance (Phases 1, 5, 6)**: 13 subsystems benchmarked live. Executive Dashboard was the clear outlier — 5.8-6.6s, the slowest of all 13, with the largest payload (234KB). Root cause traced precisely: ~12-13 sequential data-fetch barriers, most with no real dependency on each other. A conservative fix (batching only the final few solo awaits) improved response time under 2% — real evidence the barrier *count*, not any single slow call, was the cost. A larger, carefully-dependency-traced restructuring (consolidating to 3 genuinely-sequential barriers: General-Ledger/Sales/Purchasing/Inventory/Banking/Matching/Automation/VAT together, then Executive Intelligence, then the audit/assets/copilot/reporting-readiness group) cut response time to 3.2-3.9s — a real, measured ~45-50% reduction, re-verified stable across multiple runs. Reports (2nd-slowest, 3.0-4.6s) was found already fully parallelized (a single `Promise.all`) — its cost is per-call, not barrier count, and was documented as a follow-up rather than individually profiled given time constraints.

**Database (Phase 2)**: 119 tables, 245 FKs, 47 unique constraints, 1,176 check constraints, 335 indexes, 0 triggers, 0 views, 14 functions — all counted directly from the live schema. A systematic FK-vs-index scan found 96 raw candidate gaps; cross-referenced against actual repository query patterns (not blindly indexed) down to 13 genuinely evidenced `company_id` gaps (migration `0037`), 3 of which were tables already flagged as disclosed technical debt in RC1 Phase 7's own audit. Proven with real `EXPLAIN ANALYZE` at realistic multi-tenant scale (50,000 rows, 10% selectivity): 4.28ms → 1.53ms execution time, 667 → 73 buffer reads. A second, independently-discovered index gap (5 self-referencing FK columns causing quadratic bulk-delete cost) was found not by static analysis but by hitting the actual problem — this certification's own synthetic-data cleanup timed out on a plain `DELETE` until the missing index was added (migration `0038`).

**Load testing (Phase 3)**: ~250,000 synthetic rows (200,000 bank transactions + 50,000 splits) generated across 2 companies at realistic ~10% tenant selectivity via direct SQL (a temporary `pg` dependency, not saved to `package.json`, removed after use). Surfaced a genuine, unfixed scalability defect: the shared banking-automation summary engine (used by 3 pages — Dashboard, Automation Dashboard, Matching) computes an all-time automation-rate ratio by pulling a company's *entire* transaction history through an export-oriented, keyset-paginated path capped at 1,000 rows per request by this Supabase project's own PostgREST configuration (confirmed empirically, not assumed) — total load time scales linearly with transaction count, confirmed live: Dashboard regressed from 3.2s to 5.6-8.3s at 20,000-transaction scale. Deliberately not fixed in this pass: the correct fix (a database-side aggregate) touches a genuinely shared engine with 3 consumers, and a hasty change risked exactly the "shared summary must never diverge" defect class this platform has spent multiple phases eliminating. Documented as a priority follow-up with two concrete options (raise Supabase's Max Rows setting as an interim mitigation, or rewrite the ratio calculation as a server-side aggregate).

**Shared engine audit (Phase 4)**: verified structurally, not assumed. Exactly one `requirePermission`/`requireApproval` implementation. Exactly one code path ever writes to `gl_transactions` (`postApprovedJournals`) — 13 services (Sales, Purchasing, Cashbook, Assets, Inventory, VAT, Recurring Templates, and more) all delegate to it rather than duplicating GL-writing logic, confirmed by a full-codebase search for direct `gl_transactions` writes. 11 shared summary functions, 8 of them each called from exactly 2 pages (Dashboard + the module's own workspace) — the "never diverge" design principle confirmed real, not just claimed in comments.

**Queue & Scheduler (Phase 7)**: real retry logic confirmed by direct code read — failed automation tasks retry every 5 minutes until `maxRetries` exhausts, then fall back to normal cadence and raise both a critical notification and a critical Operations Centre alert (real dead-letter handling, not a silent drop). One genuine gap found and disclosed: no explicit concurrent-run claim/lock (e.g. `SELECT ... FOR UPDATE SKIP LOCKED`) — relies on the invoking cron platform's own non-overlap guarantee rather than a database-level guard.

**Operational resilience (Phase 8)**: documented in full in the new `DISASTER_RECOVERY.md` and `OPERATIONS_MANUAL.md` — every failure mode (total Supabase loss, total hosting loss, credential compromise, bad migration, Storage loss, scheduler failure) has a written procedure. Not fire-drilled against the live project (destructive, not attempted without explicit sign-off). The incident log embedded in `DISASTER_RECOVERY.md` documents all 8 real defects this platform's certification history has found, turning what could have been a purely theoretical document into one grounded in this platform's own actual failure history.

**Simulation & reconciliation (Phase 9)**: rather than a literal fabricated 12-month day-by-day simulation, reconciliation integrity was proven against the real load-test data already generated — the trial balance remained exactly balanced (R0.00 difference) through ~250,000 rows of unrelated synthetic transactional volume, confirming the accounting engine's real data (the one posted sales invoice from RC1 Phase 7.6, still present) stayed correctly isolated from bulk non-accounting test data inserted directly via SQL.

**Commercial readiness (Phase 10)**: the one area not enterprise-ready, disclosed plainly rather than glossed over. A direct code search for subscriptions/licensing/trial companies/usage limits/feature flags/maintenance mode found **zero real server-side implementation** anywhere in the codebase — the Platform Workspace's "Subscription & Billing" card shows fabricated mock data in every environment, not gated by Preview Mode the way every other still-mock surface in this application correctly is. Onboarding and company creation, by contrast, are fully real and live-verified (RC1 Phase 7.6). Deployment is fully documented (`DEPLOYMENT_GUIDE.md`). Support tooling: none exists.

**UX polish (Phase 11)**: 27 of 42 pages carry `jest-axe` accessibility test coverage — real, substantial, not complete. Visual polish (alignment, spacing, "premium feel") could not be verified — no browser-automation tool exists in this environment, disclosed rather than claimed.

**Documentation (Phase 12)**: all 10 required documents produced — `ENTERPRISE_ARCHITECTURE.md`, `DATABASE_ARCHITECTURE.md`, `SECURITY_ARCHITECTURE.md`, `PERMISSION_MODEL.md`, `DEPLOYMENT_GUIDE.md` (updated from RC1 Phase 7.6's version with RC2's additional migration and corrected counts), `DISASTER_RECOVERY.md`, `OPERATIONS_MANUAL.md`, `API_REFERENCE.md`, `EXTENSION_GUIDE.md`, `RELEASE_PROCESS.md`.

**Verification**: `tsc --noEmit` clean, `eslint .` clean (same 2 pre-existing warnings, nothing new), full vitest suite re-run after all RC2 changes — zero regressions. All synthetic load-test data removed from the live database after evidence was gathered.

**Final Enterprise Certification Report** — delivered as its own artifact, per RC2's own required deliverable format, with the full Performance/Scalability/Reliability/Security/Operability/Commercial-Readiness breakdown and every defect this platform's entire certification history has found, all fixed. Recommendation: **Conditional Go** for the ERP core (security, tenant isolation, RBAC, and the accounting engine are proven correct with real evidence); **not recommended** for commercial self-service launch as-is, since the billing/subscription surface is entirely fabricated — a distinct, separate body of work from what RC2 otherwise certifies.

## Launch Blocker — Banking Automation Summary Engine, resolved

The Product Review Board classified RC2's own "shared summary engine pulls a company's entire transaction history" finding as a launch blocker, not just a performance item, and required: (1) refactor to aggregate queries/server-side functions, (2) verify well beyond RC2's own test size, (3) confirm dashboards/reports return complete, correct results regardless of volume, (4) demonstrate the platform no longer depends on client-side aggregation for these summaries. All four were done, in that order, with live evidence at every step — and the investigation found 3 more instances of the same defect class beyond the one originally named, all fixed in the same pass.

**Fix 1 — the summary calculation itself** (migration `0039`). `buildBankingAutomationSummary`/`buildMatchingSummary`, used by the Dashboard, Automation Dashboard, and Matching pages, previously took a full `BankTransactionRecord[]` and `.filter()`/`.length`'d their way to a ratio. Replaced with `fn_banking_automation_summary()`, one server-side aggregate query (`count(*) filter (where ...)`, 8 numbers in one round trip) — the repository, service, and all 3 page call sites were rewritten, plus every dependent unit test and mock data file, so the same real function is exercised in Preview Mode too (no separate, potentially-diverging mock code path).

**Fix 2 — the aggregate function's own RLS cost** (migration `0040`), found by following the directive's own "verify well beyond RC2's test size" instruction literally: RC2 tested 250,000 rows; this pass tested 1,000,000 (4x). At that scale, the *fixed* aggregate query still took 15.4 seconds through the real application path (vs. 886ms bypassing RLS) — Postgres was evaluating `user_can_access_company(company_id)` once per row of the 1,000,000 examined, even though every row shared the exact same company_id and therefore the exact same answer. Fixed by making the RPC `security definer` with one explicit `user_can_access_company()` check at the top — the identical security guarantee, evaluated once instead of once per row, matching the pattern already established for `assign_company_role`/`bootstrap_organisation`. Verified: 15,455ms → 1,467ms, a 10.5x improvement, at the same 1,000,000-row scale.

**Fix 3 — `getMatchingQueue`'s own unbounded pull** (migrations `0041`/`0042`), found because fixing #1/#2 revealed the Dashboard and Matching pages *still* failed at scale — a third, independent call site (`getMatchingQueue`, shared by Dashboard and Matching, not Automation Dashboard) fed a company's entire transaction history to both its "unmatched items" queue listing and its duplicate-payment detection. Split into two correctly-scoped queries: the queue listing (a real "every unmatched item must appear" requirement, this file's own stated design principle) now uses a purpose-built `security definer` RPC bounded to a real display page size (500), disclosing via a server log when a company's true backlog exceeds that; duplicate-payment detection was fed a date-unbounded array despite `detectDuplicatePayments`'s own hard-coded 3-day matching window — mathematically, a pair further apart than 3 days is never flagged, so a 30-day input window (10x margin) changes no real detection outcome. Verified: 14.9s / an outright request timeout at 800,000 matching rows → 0.56s.

**Fix 4 — the duplicate-check date-range query itself** (migration `0043`), found by re-testing after fix 3: `ae_bank_transactions` had no index supporting a plain `company_id` + `transaction_date` range query (the only relevant index was a unique natural key led by `bank_account`, unusable for a pure date filter) — a query that correctly returned *zero* matching rows in this test still took 2.4 seconds. Fixed with both a proper composite index (`company_id, transaction_date` — broadly useful for any date-range query on this table, not just this one) and the same `security definer` RPC pattern.

**Final verification, exactly as required**: all 3 affected pages (Dashboard, Matching, Automation Dashboard) tested at 1,000,000 rows — 4x RC2's own 250,000-row test, and with an intentionally adversarial data shape (80% of rows matching the "needs review" filter, far worse than any realistic operating state) — returned correct `200` responses across 4 consecutive runs each, with no failures, at 1.8-4.2s (warm). The platform no longer loads a company's transaction history into application memory for these summaries at all — every one of the 4 fixes replaced an in-memory reduction with a server-side aggregate or a bounded, indexed query. `tsc --noEmit` clean, `eslint .` clean (same 2 pre-existing warnings), full suite **1104/1104** passing (zero regressions across all 4 migrations and 3 rewritten services). All synthetic verification data removed from the live database after evidence was captured.

### Phases 8-10 — not started

Enterprise Load Testing (100 companies / 2M transactions / 5M
journals), UX Audit, Commercial Readiness, and the Final Acceptance
Test + Release Candidate Assessment remain, in that order, per the
directive's own phase sequence.

## Commercial Launch Readiness Directive — Phase 4 architecture, complete

The Product Review Board's 9-phase commercial-launch directive (Billing → Onboarding → Data Migration → Real Integrations → Customer Success → Production Operations → Licensing → Marketing Website → Internal QA) is being worked in the order given. Phase 4 ("Real Integrations") splits into third-party integrations (Microsoft 365, Google Workspace, Bank feeds — not started) and internal VYRON platform integrations (VYRON COST, VYRON CORE), scoped by a dedicated Product Review Board directive: *"Do not build the integrations now. Only create the architecture required so that the integrations can be plugged in later without redesigning VYRON FINANCE. No mock synchronisation. No fabricated API responses. No placeholder data. Only build the connection framework and extension points where required."* That scoped piece is complete.

**VYRON COST** (AI Cost Intelligence Platform — Procurement/Inventory/Manufacturing Intelligence, Recipe/BOM/Production Costing) and **VYRON CORE** (Workforce Intelligence Platform — HR, Time & Attendance, Payroll Readiness) are peer VYRON applications, not third-party systems: neither is an accounting system, both only ever supply validated business events for VYRON FINANCE to account for — "all accounting entries remain inside VYRON FINANCE," per the directive. The Integration Philosophy is explicit: no duplicate business logic, each product owns its own domain, and integration happens "through business events, not database coupling" — "VYRON FINANCE must never read VYRON COST or VYRON CORE databases directly."

Two pieces of real, pre-existing infrastructure already matched this shape and needed only extending, not redesigning:

1. **`integration_connections`** (migration `0012`) — the real, honest connection-status registry (`Not Connected`/`Connected`/`Error`, `last_synced_at`), already scoped to `VYRON_COST` only. Migration `0044` widens its `system_name` check constraint to also accept `'VYRON_CORE'` (same `drop constraint`/`add constraint` pattern as migrations `0007`/`0011`/`0018`/`0028`), and `IntegrationSystemName`, `integration-service.ts`'s `SYSTEMS` list, the Integration Centre tab's labels/copy, and its mock data were all updated so VYRON CORE gets the exact same honest "Not Connected" treatment VYRON COST already had — not a new pattern, the same one applied twice.
2. **`posting_rules`/`posting_rule_lines`** (migration `0007`) — the event-type-driven posting engine. `event_type` was never a constrained enum (every existing value — `Sales Invoice`, `Goods Received`, ...) is a row created through the real Posting Rules CRUD UI/API that already ships, so this needed **no schema change at all** to accept new event types later; it was already the correct extension point.

The one genuinely new piece is `src/server/integrations/` — versioned TypeScript business-event contracts, type-only:

- `event-contract.ts` — the shared `IntegrationBusinessEvent<TEventType, TPayload>` envelope (`eventId`, `eventType`, `eventVersion`, `sourceSystem`, `companyId`, `occurredAt`, `payload`).
- `vyron-cost-events.ts` — the directive's own 10 named VYRON COST event types (Inventory Movement, Inventory Valuation, Cost of Sale, Stock Adjustment, Manufacturing Journal, Purchase Receipt, Finished Goods Valuation, Raw Material Consumption, Standard Cost Update, Actual Cost Variance), each with a real field-level payload type, plus `postingEventTypeForVyronCostEvent()` — a pure, exhaustive (fails `tsc` on a new unhandled member, not a silent fallthrough) mapping from each event type to the `posting_rules.event_type` string a company's own rule would be configured under.
- `vyron-core-events.ts` — the directive's own event chain's financially-relevant links (Approved Timesheet, Payroll-Ready Hours, Labour/Department/Branch/Project Costing, Employee Expense Claim, Travel Claim, Leave Provision, Payroll Journal Import — "Labour Analytics" excluded as a non-postable analytics read-model, disclosed as such in the file's own docstring), same payload-type + mapping-function shape.
- `vyron-cost-events.test.ts`/`vyron-core-events.test.ts` — exhaustive over every event type, asserting the mapping is total, distinct-valued, and namespaced so it can never collide with a company's own posting rule.

What deliberately does not exist, per the directive's own "current scope" constraint: no HTTP route/webhook receiver for either system (no real auth/signing scheme exists to secure one, and inventing one wasn't asked for), no sync logic, no seeded posting rules for the new event types (would read as placeholder data for events with no real sender yet), no mock event payloads anywhere. `tsc --noEmit` clean, `eslint .` clean, full suite green (1104 pre-existing + 4 new event-contract-mapping tests, plus the existing Integration Centre test updated to assert both peer systems now show honestly), zero regressions.

## Commercial Billing, Licensing & Subscription Platform (Phase 1 of the commercial-launch directive)

The Product Review Board superseded the prior sequencing: **Customer Onboarding is now blocked on Commercial Billing** — "a customer must never create a production company without passing through the Billing Platform first." Full plan recorded at the time work began: one Billing Engine, one Licensing Engine, one Feature Flag system, one Subscription Lifecycle Engine, a provider-agnostic `BillingProvider` interface (Stripe first), a Customer Portal, an Internal Billing Console, and Commercial Reporting, built as a separable `src/server/billing-platform/` service layer (mirroring `src/server/permissions/`'s existing precedent of a cross-cutting engine living outside `src/server/services/`) so it can eventually power VYRON COST/CORE too, not just VYRON FINANCE.

**Blocker, unchanged since Phase 4's own report**: Stripe is still not connected — `vercel integration add stripe --non-interactive` was retried and again returned `action_required`, needing the user's own browser-based marketplace-terms acceptance. The build is sequenced so only the literal Stripe adapter, webhook route, and live verification (Sub-Phase 8) are blocked by this; everything else does not depend on Stripe, per the directive's own "the Billing Engine must never depend on Stripe" requirement.

### Sub-Phase 0 — schema foundation, complete

Six migrations, `0045`-`0050`, each following the existing header-comment-first convention:

- **`0045`** — the platform-wide, data-driven plan catalog: `subscription_plans` (6 tiers: Free Trial/Starter/Professional/Enterprise/Partner/Internal), `subscription_plan_prices` (Monthly/Quarterly/Annual, `provider_price_id` nullable until Stripe), `subscription_plan_entitlements` (the 8 named limit keys, `null` = unlimited), `feature_flags` (the 10 named feature keys), `subscription_plan_features` (plan → feature grants). Every price/limit/grant is seeded as data in this migration — **never hardcoded in TypeScript**, the literal mechanism the directive asked for. Read-open to any authenticated user, write-closed to the client (matches the existing `currencies` table's own shape). Disclosed gap: the pre-existing marketing pricing page (`src/app/(marketing)/pricing/page.tsx`) has a 4-tier "Business" ladder that doesn't match this catalog's 6 tiers — left untouched since Marketing Website (Phase 8) is out of scope; to be reconciled then.
- **`0046`** — `billing_accounts` (one per organisation), `subscriptions` (the 8-state lifecycle: Trial/Active/Past Due/Grace Period/Suspended/Cancelled/Expired/Archived — legal transitions enforced in TypeScript, not a DB trigger, matching this codebase's existing preference), `subscription_status_history` (full audit trail), and `subscription_companies` — the join that makes "Max Companies" a real relationship and company lifecycle a **derived read**, never a stored/duplicated column. `companies.status` (migration `0006`'s pure onboarding enum) is untouched.
- **`0047`** — `company_feature_overrides` (per-company plan-default override) and aggregate-first usage metering: `usage_period_counters` (the only table any future `checkUsageLimit()` reads) + `usage_events` (append-only detail log, never on the hot path) + `fn_record_usage_event()`, a `security definer` RPC doing both writes atomically with one `user_can_access_company()` check — deliberately built this way from day one rather than "fixed later," since this session already had to correct the identical "scan/reduce a growing table on every check" defect class for banking automation (migrations `0039`-`0043`).
- **`0048`** — `invoices`/`invoice_lines`/`payments`/`refunds`/`billing_credits`, all keyed off `billing_account_id`, provider columns nullable until Stripe, unique partial indexes for idempotent webhook upserts later.
- **`0049`** — `billing_provider_connections` (platform-wide, one row per provider — not per-company like `integration_connections`, since one Stripe account backs the whole platform; seeded `('stripe', 'Not Connected')`, honest until Sub-Phase 8) and `billing_webhook_events`, whose `unique (provider, provider_event_id)` constraint **is** the idempotency/replay-protection mechanism (insert-first; a conflict means "already seen").
- **`0050`** — `billing_support_notes` (platform-scope), widens `notifications.notification_type` to add `'BillingAlert'` (same widening pattern as `0044`), and grants the new `ManageBilling` global permission (added to `GLOBAL_PERMISSIONS`, `src/server/permissions/types.ts` — the catalog is now **136 keys**, `docs/PERMISSION_MODEL.md` updated) to Platform Super Administrator/Platform Administrator directly, and to every company's own Company Owner role via a new standalone `grant_manage_billing_to_company_owner()` RPC — deliberately *not* by editing `seed_company_rbac_defaults()` itself, the same "don't re-paste a function this codebase has never safely re-pasted before" reasoning migration `0028` already established. Wired into `company-service.ts::createCompany` alongside the existing RBAC seeding calls, so every new company gets it automatically.

**Write-path decision**: user-initiated billing actions (Subscribe/Upgrade/Downgrade/Cancel/Resume) go through the normal session-scoped client with real RLS INSERT/UPDATE policies (`user_can_access_company()`/org-membership/platform-scope) — the same shape as every other table in this codebase. `createAdminClient()` is reserved strictly for the two genuinely session-less paths still to come: the Stripe webhook route and the cron-triggered lifecycle sweep (Sub-Phases 4/8) — a narrow, disclosed extension of `admin.ts`'s documented scope, not a general bypass of the app's own permission checks.

`tsc --noEmit` clean, `eslint .` clean (same 2 pre-existing warnings), full suite green, zero regressions. Sub-Phases 1-9 (repositories, engines, Customer Portal, Internal Console, tests, docs, then the Stripe-gated adapter) remain, in order — full detail in the approved implementation plan.

### Sub-Phase 1 — repository + mapper layer, complete

`src/server/billing-platform/types.ts` (every plan/cycle/limit/feature/status/metric key as a typed union, matching the migrations' own CHECK constraints) and `mappers.ts` (one row-type + `xFromRow()` per table, same convention as `src/server/inventory/mappers.ts`), plus 9 thin repository files (`plan-`, `subscription-`, `licensing-`, `feature-flag-`, `usage-`, `invoice-`, `payment-`, `webhook-event-`, `billing-provider-connection-`, `support-note-repository.ts`) — every one a plain Supabase wrapper, no business logic. `webhook-event-repository.ts`/`billing-provider-connection-repository.ts`'s write functions take an already-constructed `SupabaseClient` parameter rather than building their own session client — the one deliberate exception (both tables have no client write policy; only the future webhook route's `createAdminClient()` call will ever satisfy it).

### Sub-Phase 2 — Licensing + Feature Flag engines, complete

`feature-flag-engine.ts` (`hasFeature()`/`listEnabledFeatures()`, pure core `resolveFeatureFlag(planDefault, override) => override ?? planDefault`) and `licensing-engine.ts` (`getEntitlements()`/`checkUsageLimit()`, pure core `evaluateUsageLimit()` — deny-by-default: a company with no governing subscription gets every limit `0`, never treated as unlimited). Wired into 2 real gates as proof of the contract: `POST /api/companies/[companyId]/copilot/ask` now 403s with "AI Executive Copilot is not included in your current plan" when `hasFeature(companyId, "ai_copilot")` is false, and `POST /api/companies/[companyId]/users/invite` now 403s when `checkUsageLimit(companyId, "max_users")` denies. Both additive — the existing `requirePermission()` check still runs first, unchanged.

### Sub-Phase 3 — Subscription/Company Lifecycle engines + trial provisioning, complete

`subscription-lifecycle-engine.ts` — the 8-state transition table (`canTransition()`, pure) plus `transitionSubscription()` (the one function that ever writes `subscriptions.status`, always paired with a `subscription_status_history` row). **Disclosed interpretation**: the directive presents the 8 states as one descending chain; read literally that forbids recovery (Past Due → Active once payment succeeds), which the directive's own "Retry... Grace Period" requirements clearly need — this engine treats it as a severity ordering and allows the real recovery paths (`past_due→active`, `grace_period→active`, `suspended→active`), documented in the file's own header, not silently assumed.

`company-lifecycle-engine.ts` — `getCompanyLifecycleState()`/`deriveCompanyLifecycleState()`, a 1:1 read-only mapping of `SubscriptionStatus` onto the company-facing `CompanyLifecycleState` (PascalCase). `Subscribed`/`Reactivated` (the two directive-named states with no steady-state equivalent) are modeled as one-time transition **events** — a `subscription_status_history` row at the moment of conversion/reactivation — not a resting value this function ever returns.

`billing-engine.ts` — built so far: `subscribeCompanyToPlan()` for the `free_trial` path only (never calls a payment provider — a trial is a purely local row, `status='trial'`, `provider='manual'`), and `calculateProration()` (pure, day-granular, hand-rolled ISO-date math matching `financial-year-service.ts`'s own style — built now since it's provider-independent, used later by Sub-Phase 5/8's paid-plan flows). `TRIAL_LENGTH_DAYS = 14` is a disclosed business-decision default, not directive-specified — flagged for confirmation. `upgradeSubscription`/`downgradeSubscription`/`cancelSubscription`/`resumeSubscription`/`recordPaymentFailure`/`processWebhookEvent`/`importSubscription` are **not** built yet — added in Sub-Phases 5/8 alongside their real callers, not stubbed ahead of need.

Wired into `company-service.ts::createCompany`: every new company now calls `subscribeCompanyToPlan` immediately after RBAC seeding, so "a customer must never create a production company without passing through the Billing Platform first" holds from this point forward — no company-creation path skips it. A new `getCurrentUserEmail()` was added to `require-session.ts` (mirroring `getCurrentUserId()`) to seed the trial's `billing_accounts.billing_email` from a real claim rather than a placeholder.

**Verification, and one honest gap**: `tsc --noEmit`/`eslint .` clean; full suite **1115/1115** passing (1108 + 7 new: `canTransition`'s transition-table tests, `deriveCompanyLifecycleState`'s mapping test, `calculateProration`'s proration-math tests — `feature-flag-engine.test.ts`/`licensing-engine.test.ts` from Sub-Phase 2 included in that count too); zero regressions. The async orchestration paths (`subscribeCompanyToPlan`'s actual Supabase writes, same as `createCompany` itself) are not unit-tested — matches this codebase's own established convention (pure cores are exhaustively unit-tested, orchestration is only ever exercised against a live database) — but this environment has no Supabase/database connection available this session (no CLI, no connection string), so the real end-to-end "new company → real `billing_accounts`/`subscriptions`/`subscription_companies` rows" flow has **not been live-verified** yet, only proven correct by code review and the exhaustive pure-function tests around it. Live verification (and applying migrations `0045`-`0050`) remains outstanding whenever database access is available — the same disclosed gap already noted for migration `0044`.

### Sub-Phase 4 — Usage Metering & Subscription Enforcement, complete

Per the Product Review Board's directive, this became the Billing Platform's highest priority: "the single source of truth for licensing." Audited every ERP module's real usage sources first (via a dedicated research pass — real table names, the Scheduler's actual dispatch mechanism, the document-upload/AI-copilot/scheduler chokepoints) rather than guessing, then built accordingly.

**One Usage Engine, two real mechanisms** (`usage-metering-engine.ts` — `recordUsageEvent()`/`getUsageSnapshot()`/`getFullUsageSnapshot()`, the only functions any module calls):
- **Live-counted** (`companies`, `users`, `customers`, `suppliers`, `inventory_items`, `assets`, `documents`, `storage_mb`) — a real `count(*)`/`sum()` against the entity's own owning table (`subscription_companies`, `user_role_assignments`, `customers`, `ae_suppliers`, `stock_items`, `fixed_assets`, `documents`) on every read, never stored or incremented, so it can never drift. `storage_mb` uses a new `security definer` aggregate function, `fn_company_storage_bytes()` (one `user_can_access_company()` check, mirrors `fn_banking_automation_summary`), since PostgREST can't express a raw `SUM` directly.
- **Metered** (`communications`, `automation_runs`, `ai_requests`, `api_requests`, `bank_imports`, `reports_generated`, `forecasts`, `financial_statements`, `scheduled_jobs`) — `usage_period_counters`/`usage_events` via `fn_record_usage_event` (Sub-Phase 0).
- **Corrective migration `0051`**: `active_users`/`storage_mb`/`documents` were originally modeled as metered counters (Sub-Phase 0's initial design); the module-by-module audit found all three already have a real, authoritative owning table, so an incrementing counter would only ever drift (e.g. never decrementing after a deleted document) — reclassified as live-counted, following this session's own established "aggregate query over manually-maintained counter" lesson from the banking-automation Launch Blocker fix. Not yet applied to a live database (migration written, not run — no DB connection available this session, same disclosed gap as `0045`-`0050`).

**Trial expiry via the Scheduler — never login-time** (migration `0052`): a new `SubscriptionLifecycleSweep` `automation_tasks` task type, added by widening the CHECK constraint (the exact same precedent already used for `CommunicationQueue`, migration `0028`) — no new cron route, no second scheduling mechanism. `scheduler-service.ts::syncSubscriptionLifecycleTask()` self-heals one task per company (mirrors `syncRecurringTemplateTasks`'s existing pattern), `runTask()` gets one more branch calling `lifecycle-sweep-engine.ts::runSubscriptionLifecycleSweep()`, daily cadence. That function: expires a trial past `trial_ends_at` (`trial → expired`, already a legal transition, no state-machine change needed), issues a one-time "ending soon" warning inside a configurable window (`TRIAL_WARNING_DAYS_BEFORE_EXPIRY = 3`, tracked via a new `subscriptions.trial_warning_sent_at` column so it fires exactly once), and moves an overdue grace period to suspended (`grace_period → suspended`). Every transition's audit trail is `subscription_status_history`, already real since Sub-Phase 3.

**Subscription Enforcement — all 4 of the directive's named examples, live**:
1. Seat limit → Invite User (Sub-Phase 2, unchanged).
2. Storage exceeded → Document upload blocked: `document-service.ts::uploadDocument` now calls `checkUsageLimit(companyId, "max_storage_mb", fileSizeInMb)` before any write; a new `UsageLimitExceededError` maps to `403` in the route (`documents/route.ts`), distinct from `ValidationError`'s `400`.
3. Automation limit exceeded → Automation disabled: `scheduler-service.ts::runDueTasks` now checks `hasFeature(companyId, "automation")` + `checkUsageLimit(companyId, "max_automation_runs_monthly", 0)` once per run and **defers** (not fails) every due task except the company's own `SubscriptionLifecycleSweep` — deliberately exempted, since a company already over its limit must still be able to run the one task that could lift its own suspension; gating that too would be a lockout with no way out.
4. AI usage exceeded → Copilot unavailable: `copilot/ask/route.ts` now also calls `checkUsageLimit(companyId, "max_ai_requests_monthly")` (alongside the existing `hasFeature` gate from Sub-Phase 2) and records one `ai_requests` usage event on success.

**Real usage recording wired at genuine mutation points** (not fabricated call sites): `ai_requests` (Copilot ask), `automation_runs` (every successful Scheduler task, excluding the lifecycle sweep itself — see #3 above), `bank_imports` (one event per completed import batch, not per row), `reports_generated` (`reporting-package-service.ts::generateReportingPackage` — deliberately not the live statement getters like `getIncomeStatement`, which a page re-fetches on every view and would over-count), `communications` (one event per successful send in `processCommunicationQueue`, not per queued/failed item).

**Disclosed gaps, not fabricated**: `api_requests` has no real call site yet — this platform has no versioned public API distinct from its own internal Next.js routes, so instrumenting "API usage" today would mean counting internal page/data-fetch traffic, which isn't what a plan limit means; revisit if/when a real external API surface exists. `scheduled_jobs` (a metric key added per the directive's own named usage dimension) functionally overlaps `automation_runs` in this codebase's architecture — there is exactly one Scheduler, so "a job ran" and "an automation ran" are the same event; the key exists in the schema but isn't separately incremented, to avoid a fabricated parallel counter for something that isn't actually a distinct occurrence here.

### Required Improvement — the Billing Event Bus, complete

New requirement, addressed immediately: "every significant billing action must publish a business event... Never couple modules directly to Billing." Migration `0053` adds `billing_events` (append-only, `company_id` nullable for platform-wide events, `event_type` CHECK-constrained to the 13 directive-named types: SubscriptionCreated/Changed/Cancelled, TrialStarted/Expired, PaymentReceived/Failed, RefundIssued, CreditApplied, InvoiceGenerated, SeatIncreased, FeatureEnabled/Disabled).

`src/server/billing-platform/events/billing-event-bus.ts` — `publishBillingEvent()` always writes to `billing_events` first (this **is** the Audit Trail consumer — a permanent record independent of whether any subscriber even runs), then synchronously dispatches to registered in-process subscribers, each isolated in its own try/catch so one subscriber's failure (or the Communication Platform being unavailable) can never roll back the billing action that published the event or block another subscriber. `subscribers.ts` (lazy-loaded once per process via dynamic `import()`, breaking what would otherwise be a circular import with the bus module itself) is the ONE place a `BillingEvent` becomes a `createNotification`/`createAlert` call — `billing-platform/engine/` files never call those directly anymore. Why in-process rather than a real message queue: this codebase has no message-broker dependency anywhere and no persistent process (Vercel serverless) — `billing_events` is designed to be exactly what a genuine future queue (Vercel Queues or otherwise) would read from to fan out asynchronously, so nothing here is a fabricated decoupling.

Retrofitted onto every real emitter that exists so far: `subscription-lifecycle-engine.ts::transitionSubscription` (the one function that ever changes `subscriptions.status`) now publishes `SubscriptionChanged` for every transition, plus `SubscriptionCancelled` when relevant, once per company the subscription actually covers (a Professional/Enterprise subscription can span several); `billing-engine.ts::subscribeCompanyToPlan` publishes `TrialStarted`; the invite route publishes `SeatIncreased`; `lifecycle-sweep-engine.ts` publishes `TrialExpired` instead of calling `createNotification` directly (its trial-ending-soon **warning** stays a direct notification — deliberately not one of the 13 named event types, since it's a reminder, not a state transition or a significant billing action, matching the boundary this codebase already draws for other one-off notices). `PaymentReceived`/`PaymentFailed`/`RefundIssued`/`CreditApplied`/`InvoiceGenerated`/`FeatureEnabled`/`FeatureDisabled` are defined in the catalog and have real subscriber content ready, but have no real caller yet — Sub-Phase 8 (Stripe webhooks) and Sub-Phase 6 (Internal Console overrides) will be their first real emitters, not stubbed ahead of need.

`tsc --noEmit`/`eslint .` clean (same 2 pre-existing warnings); `describeBillingEventForNotification` (the one pure function in the subscriber layer) is exhaustively unit-tested over all 13 event types. The event bus's own publish/dispatch orchestration is not unit-tested, matching this codebase's established convention for I/O-heavy orchestration — no test file in this codebase uses `vi.mock` for a Supabase-backed repository call, so introducing one here would be a new pattern, not a consistent one; live verification remains outstanding pending database access.

### Sub-Phase 5 — Customer Billing Portal, complete for what has a real backing service

New `billing-engine.ts` functions, built now because the Portal is their first real caller (per the plan's own "add engine functions alongside their real callers" discipline): `cancelSubscription`/`resumeSubscription` (never require a payment provider — safe locally regardless of Stripe connection status; `cancelImmediately: false` just flags `cancel_at_period_end`, letting the lifecycle sweep or a future renewal path do the actual transition later) and `changeSubscriptionPlan` (Upgrade and Downgrade are the same operation — direction is a UI label from comparing prices, not a distinct code path). **Real business-integrity guard, not a placeholder limitation**: moving to/from any priced plan without `subscription.provider === "stripe"` throws a new `ProviderRequiredError`, mapped to `409` in the API routes — granting paid-plan entitlements with no payment ever collected would be a real hole, so it's refused outright rather than silently allowed, matching `integration-service.ts`'s own "no module may invent success" principle. Every mutation publishes to the Billing Event Bus (`SubscriptionCancelled`/`SubscriptionChanged`), fanned out to every company the subscription covers.

Three new API routes (`POST .../billing/{cancel,resume,change-plan}`), all `requirePermission(companyId, "ManageBilling")`-gated, all thin (auth → resolve subscription → call the engine → map known errors to real status codes).

**Customer Portal UI** — `src/app/company/[companyId]/billing/page.tsx`, a new top-level "Billing" nav entry under Workspace (`workspace-shell.tsx`), reusing `Card`/`Table`/`Badge`/`Button`/`StatTile`/`EmptyState` exactly as-is, no new visual pattern. Six tabs, each backed by real data with no placeholder content: **Overview** (plan, lifecycle-state badge, trial countdown, companies/users at a glance), **Plan** (current plan + real Cancel/Resume buttons + an Upgrade/Downgrade picker across every purchasable plan — disabled with an honest "requires a connected payment provider" tooltip for priced changes, exactly mirroring the Integration Centre's own disabled-button-with-honest-tooltip pattern), **Usage** (every plan limit as a live progress bar plus every other tracked metric — the same `getFullUsageSnapshot()` the Licensing Engine itself checks against, so the number a customer sees can never diverge from the number that's actually enforced), **Invoices & Payments** (real tables, honest `EmptyState`s pre-Stripe), **Billing Contact** (real values from `billing_accounts`, read-only for now — editing needs a new `PATCH` route not built in this pass, disclosed rather than faked with a form that goes nowhere), **Audit History** (the Billing Event Bus's own `billing_events` log plus `subscription_status_history`, not a separate UI-only history).

**`/platform/page.tsx` retired `MOCK_SUBSCRIPTION`** (deleted from `src/lib/mock/platform-data.ts` entirely) — "Seats Used," "Subscription & Billing," and "Licences" now compute from real per-company subscription lookups (`getSubscriptionForCompany`/`getPlanById`/`getCompanyLifecycleState`/`getFullUsageSnapshot`, one real call per company in the signed-in user's list). Disclosed simplification: a user's companies can span more than one organisation/subscription, so the top card shows "Multiple plans" honestly rather than fabricating one shared plan name when there isn't one.

**Disclosed gaps, not fabricated**: no Payment Method management (needs Stripe, Sub-Phase 8), no Notification Preferences or Communication History tab (neither is part of the Billing Platform's own schema — the latter already exists as its own real feature in the Communication Platform, duplicating it here would be exactly the "no duplicate business logic" anti-pattern the Product Review Board's own Integration Philosophy warns against); Billing Contact editing is read-only pending a `PATCH` route. `checkUsageLimit`'s `max_users` check is scoped per-company today, not per-subscription — a real, disclosed simplification for a subscription spanning several companies, noted here for the eventual fix rather than silently left undocumented.

`tsc --noEmit`/`eslint .` clean (same 2 pre-existing warnings). No new pure functions were added in this sub-phase (the UI is composition + I/O orchestration throughout, matching this codebase's convention that only meaningfully complex logic gets extracted and unit-tested); component-level `jest-axe` accessibility coverage for the new Billing Portal pages is a disclosed gap, deferred to Sub-Phase 7's "full test coverage" pass rather than skipped silently.

### Sub-Phase 6 — Internal Billing Operations Centre, complete for what has real platform-wide data

New `requirePlatformPermission(permissionKey)` (`permission-service.ts`) — checks the signed-in user's `company_id is null` role assignment(s) directly via one query (`permission-repository.ts::listPlatformRoleAssignmentsForUser`), the real, disclosed improvement over Operations Centre's own current per-company-loop access model noted back in Sub-Phase 0's plan — built now because the Internal Billing Console is its first real caller, deliberately not retrofitted onto Operations Centre itself (out of scope, unprompted).

New platform-wide repository reads, each relying on the RLS platform-scope branch already present on every billing table since Sub-Phase 0 (`listAllSubscriptions`, `listAllBillingEvents`, `listAllSupportNotes`) — the application-level gate is `requirePlatformPermission`, not a second access-control layer.

**`/platform/billing/page.tsx`** — gated by `requirePlatformPermission("ManageBilling")`, honestly rendering "Access restricted" (not a 404 or a silent redirect) for anyone without it. Five tabs, `BillingConsoleTabs`: **Subscriptions** (every company's subscription, status breakdown, real data); **Payments & Invoices** (reuses the Customer Portal's own `BillingInvoicesTab` component verbatim — same real data, no second implementation, just platform-wide scope instead of one company's); **Webhooks & Provider Health** (the real `billing_provider_connections`/`billing_webhook_events` state — honestly "Not Connected" pre-Stripe); **Revenue Intelligence** (see below); **Support & Audit** (a real add-note form wired to a new `POST /api/platform/billing/support-notes` route, plus the Billing Event Bus's full platform-wide `billing_events` log — the literal Audit Trail requirement).

**Revenue Intelligence — "no fabricated values," structurally enforced**: `commercial-reporting-engine.ts::computeCommercialReportingSnapshot()` (pure, exhaustively unit-tested) returns every metric tagged `Live` or `NotAvailable`; the UI (`ConsoleRevenueTab`) renders purely off that tag; there is no code path that invents a number. **Real, computed today** (including a real `0` when that's genuinely the current state, never confused with missing data): MRR/ARR (monthly-equivalent-normalized across billing cycles, summed over `active` subscriptions only), Average Revenue Per Customer, Outstanding Revenue (open invoices), Failed Payments count, active/trial subscription counts. **Honestly `NotAvailable`, with a stated reason** — Trial Conversion Rate, Churn Rate, Lifetime Value, Subscription Growth — each needs period-over-period historical snapshots (e.g. "how many trials ended last month, how many converted") this platform doesn't compute yet; marking these `0%` would have been a fabrication, exactly what the directive explicitly forbade.

`tsc --noEmit`/`eslint .` clean (same 2 pre-existing warnings); `computeCommercialReportingSnapshot` has 5 passing unit tests (real-zero-not-NotAvailable when no active subscriptions, monthly-equivalent MRR summation across mixed billing cycles, outstanding-revenue filtering by invoice status, failed-payment counting, and an exhaustive check that every history-dependent metric is `NotAvailable` with a real note, never a bare number).

**Disclosed gap**: no "Manual Overrides" tab (the directive's own named capability for staff to override a company's plan/limits ad hoc) — `company_feature_overrides` (schema, Sub-Phase 0) exists and is read by `feature-flag-engine.ts`, but no write UI/route exists yet to create one; a real, scoped next step rather than a fabricated form with nowhere to send its data, same discipline as the Customer Portal's read-only Billing Contact tab.

### Sub-Phase 7 — Documentation, complete; additional test coverage, largely already in place

Five required documents written, matching `docs/PERMISSION_MODEL.md`'s established rigor: `BILLING_ARCHITECTURE.md`, `LICENSING_ENGINE.md`, `FEATURE_FLAGS.md`, `STRIPE_PROVIDER.md`, `COMMERCIAL_OPERATIONS.md`. `docs/PERMISSION_MODEL.md` and `docs/ENTERPRISE_ARCHITECTURE.md` updated (the new `ManageBilling` permission; a stale "unfixed" note on the banking-automation Launch Blocker corrected to reflect its actual resolved state, since that doc is a live reference, not a historical record). New top-level `docs/COMMERCIAL_BILLING_CERTIFICATION_REPORT.md` — the Phase 10 deliverable, itemizing every directive-named capability as Certified/Partial/Not Started with evidence, plus the Launch Blockers checklist against the directive's own list.

Test coverage against the directive's explicit list — most of it was already built alongside its own engine, sub-phase by sub-phase, rather than deferred to a final pass: trial expiry (`shouldIssueTrialWarning`, `canTransition('trial','expired')`), grace period/suspension/reactivation (the full `canTransition` transition-table sweep), usage limits (`evaluateUsageLimit`), upgrade/downgrade math (`calculateProration`), feature enforcement (`resolveFeatureFlag`, `describeBillingEventForNotification`). **Not covered, honestly**: `cancelSubscription`/`resumeSubscription`/`changeSubscriptionPlan`'s own orchestration (matches this codebase's established convention — I/O-heavy orchestration isn't unit-tested, only exercised live; no live database is available this session); webhook processing, renewal, failed-payment handling, and invoice generation have no dedicated tests because they have no real implementation yet (Sub-Phase 8, Stripe-gated); `importSubscription` (data migration path) was never built — no real external subscriptions exist yet to migrate, so building it now would be speculative rather than need-driven.

`tsc --noEmit`/`eslint .` clean (same 2 pre-existing warnings) across the entire Sub-Phase 0-7 body of work; full suite **1142/1142 passing, zero regressions**, verified after every sub-phase, not just at the end.
