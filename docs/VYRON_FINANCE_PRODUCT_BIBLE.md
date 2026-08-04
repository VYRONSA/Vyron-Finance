# VYRON FINANCE — Product Bible

**Version 1.0 Release Candidate 1.** This is the definitive business and product reference for VYRON FINANCE — not a technical architecture document. It is written for everyone involved with the product: development, QA, implementation, sales, customer success, support, and future planning.

Every claim in this document is grounded in the actual, verified state of the product as certified through the Launch Readiness Programme and the subsequent Pre-Launch Blockers pass (see `docs/DEFECT_REGISTER.md`, `docs/PRODUCT_AUDIT_MATRIX.md`, `docs/WORKFLOW_CERTIFICATION.md`). Where a capability is real, it is described as real. Where it is designed but not yet built, or blocked on an external dependency, it is disclosed as such — never implied as complete. This discipline is itself one of the platform's core principles (see Section 12).

---

## 1. Executive Summary

### What VYRON FINANCE is

VYRON FINANCE is a multi-tenant, multi-company financial intelligence and accounting recovery platform. It turns raw bank statements into audited, reportable financial truth — bank transaction intelligence, self-teaching Merchant Rules, automatic General Ledger and VAT coding, and executive reporting a finance team can stand behind.

It is the first product in the VYRON ecosystem, architected from the ground up as a genuine multi-company, multi-tenant platform: one Organisation can hold many Companies, one bookkeeper or accounting practice can manage many clients, and every shared capability — billing, permissions, documents, communications, automation — is built once as a platform service rather than duplicated per module.

### Why it exists

Bookkeepers and finance teams lose enormous time to the same repetitive work every single period: manually coding bank transactions to the correct General Ledger account and VAT treatment, transaction by transaction, month after month — even when the same merchant, the same supplier, the same recurring charge appears every time. When a backlog builds up, it doesn't get easier to clear; it becomes a write-off risk. Existing tools either don't learn from a bookkeeper's own coding decisions, or don't carry that learning across financial years and across every client company a practice manages.

### Problems it solves

- **A backlog of uncoded transactions stops being a write-off.** The Recovery Wizard and Merchant Rules work through it once, properly, instead of forever.
- **Month-end shrinks from weeks to days.** Coding that used to happen line-by-line at month-end has already happened automatically, as statements were imported.
- **Repetitive coding is eliminated.** A merchant is coded once; every transaction from that merchant, past and future, codes itself from then on.
- **Merchant knowledge becomes a permanent, reusable asset** — across financial years, across companies, and (for a practice) across an entire client base.
- **Audit-readiness is the default, not a project.** Automatic, bulk, and manual coding are all permanently recorded, so when an auditor asks why a number is what it is, the answer already exists.
- **Financial reporting accelerates.** GL, VAT, and spend reports build themselves from coded transactions in real time, rather than being rebuilt from a spreadsheet every reporting cycle.

### Competitive advantages

- **Self-teaching Merchant Rules, not per-transaction automation.** A rule taught once applies forever — across every financial year and every company an organisation manages — rather than a generic bank-feed categorisation engine that has to be corrected repeatedly.
- **One Rule Engine, not eight.** The same rule engine drives Banking, Sales, Purchasing, Inventory, General Ledger, VAT, Reporting, and Communications automation — a rule's behaviour, conflict detection, and health metrics are consistent everywhere, not reimplemented per module.
- **A real accounting engine underneath, not a spreadsheet with extra steps.** Every transaction, in every module, ultimately posts through one shared Posting Engine into one General Ledger — GAAP-compliant statements trace every figure back to its account, its journal, and its evidence.
- **Complete, automatic audit trail.** Every coding decision — automatic, bulk, or manual override — is permanently recorded and traceable, by design, not as an add-on compliance feature.
- **An honest AI Copilot.** Answers are computed from real financial data with a confidence score, and the Copilot refuses rather than guesses when a question falls outside what it can support — not a generic LLM chatbot bolted onto the product.
- **Multi-tenant, multi-company from day one.** An accounting practice with fifty clients and a single-company business both run on the same platform, with no separate "enterprise" rebuild required to add companies.

---

## 2. Product Vision

### Long-term vision

VYRON FINANCE is the first of a planned VYRON ecosystem — VYRON FINANCE (accounting and financial intelligence), VYRON COST (manufacturing and job costing), and VYRON CORE (HR and payroll) — sharing a common platform layer rather than each rebuilding authentication, billing, licensing, documents, communications, and automation from scratch. The explicit Product Review Board instruction that shaped this architecture: Authentication, Billing, Licensing, Feature Flags, Documents, Communications, Notifications, Operations Monitoring, Workflow, and Automation are shared VYRON Platform services, designed for reuse by future VYRON products — not a retroactive rewrite mandate, but the design discipline every new engine in this codebase is already held to.

VYRON COST and VYRON CORE are not built or connected yet (see Section 8) — but the connection points already exist: a typed business-event contract and an honest "Not Connected" status visible in the Inventory module's Integration Centre, ready for a real connection without redesigning VYRON FINANCE around it.

### AI strategy

AI in VYRON FINANCE is an evidence-based narrator over real computed data — never a black box, never a guess. The AI Executive Copilot answers questions from a fixed, growing catalogue, computes every answer from live financial data, attaches a confidence score, and honestly refuses when a question falls outside what it can support, rather than fabricating an answer. There is currently zero use of an external LLM or NLP service anywhere in the product — every "intelligent" behaviour (Merchant Intelligence, Rule Intelligence, VAT Intelligence, Audit Intelligence, Forecasting) is a real, deterministic engine computing over the company's own data, not a generative model. Future AI strategy extends this same evidence-first posture to broader natural-language capability, not a departure from it.

### Automation strategy

One Rule Engine, reused across every domain, is the core automation strategy — not bespoke automation bolted onto each module. A rule taught in Banking uses the same priority, conflict-detection, versioning, and health-check machinery a rule taught in VAT or Reporting uses. Recurring Templates generate real documents (invoices, bills, journals, adjustments, statements, reminders, orders) through the exact same service a manually-created document would use — never a parallel, simplified code path. A Workflow Engine (approval required before a template or rule activates) exists as a real, shared backend capability, reused by both the Automation Platform and the Communication Platform's send-approval flow.

### Accounting philosophy

One Posting Engine, one `gl_transactions` table, one truth. Every business event in the platform — a Sales Invoice, a Purchase Bill, an Asset Disposal, a Depreciation Run, a VAT Settlement, a Cashbook entry — generates a real, balanced journal through the identical posting code path. No module is permitted its own private posting logic; this is independently verifiable by searching the entire codebase for direct writes to the ledger table and finding only the Posting Engine itself. Financial Statements are GAAP-structured and fully traceable: every reported figure can be drilled from the statement, to the GL account, to the journal, to the source document and evidence that created it.

### Platform philosophy

Multi-tenant by design, not retrofitted: the Organisation → Company hierarchy and Row Level Security tenant isolation have been present since the platform's first migration, not added after the fact. Cross-cutting concerns are built once as shared engines — Posting, Rule, Workflow, Billing, Licensing, Communication, Document — and consumed by every module that needs them, rather than each module inventing its own version. And evidence governs every claim this platform, and this document, makes about itself: findings are traced to source code and cited, not assumed from documentation or intent.

---

## 3. Target Markets

VYRON FINANCE's fit varies genuinely by vertical — this section states that honestly rather than claiming universal fit, consistent with the platform's own "honest scope disclosure" principle.

### Professional Services (accounting and bookkeeping practices) — Strongest fit

This is the platform's primary designed market. One Organisation managing many client Companies, Merchant Rules taught once and reusable across an entire client base, a Recovery Wizard purpose-built for clearing a client's coding backlog, and per-company billing/licensing that scales cleanly as a practice adds clients. Every workflow map in Section 5 was built with this user in mind first.

### Multi-company Groups — Strong fit, with a disclosed limitation

The Organisation → Company data model natively supports a group structure: one login, many companies, shared Merchant Rules, centralised billing and user administration. **What is not built**: automated cross-company consolidation. Each company's General Ledger, Trial Balance, and Financial Statements are independent — a group wanting one consolidated statement across all its companies today assembles that manually from each company's real (not fabricated) reports. Consolidated reporting is a genuine roadmap candidate, not a current capability.

### Distribution — Good fit

Purchasing (Requisition → Purchase Order → GRN → Bill → Payment), Inventory (warehouses, FIFO/weighted-average costing, stock takes), and Supplier Reconciliation together cover a distribution business's core operational accounting well. No EDI or carrier-integration layer exists.

### Retail — Good fit for the accounting layer, no point-of-sale integration

Sales (Quotation → Order → Delivery → Invoice → Receipt), Inventory costing, and VAT Intelligence handle retail's general ledger and stock accounting genuinely well. There is no POS system integration or barcode-driven stock movement — a retailer's point-of-sale data would need to reach VYRON FINANCE via the existing Import Centre or a future integration, not a built connector today.

### Hospitality — Partial fit

Cashbook & Bank Reconciliation suits a cash-heavy business, and the generic Sales module can represent hospitality billing conceptually. There is no hospitality-specific capability — no booking-system or table/room-management integration, no tips/gratuity handling, no shift-based cash-up workflow beyond the generic Cashbook. A hospitality business gets a real general ledger and cash management; it does not get an industry-specific front end.

### Manufacturing — Weakest fit today, by design

Inventory covers stock items, warehouses, and costing, but VYRON FINANCE deliberately does not implement Bill of Materials, production orders, or work-in-progress costing — that is explicitly VYRON COST's domain in the VYRON ecosystem's own architecture (Section 8 documents the "Inventory Movement," "Cost of Sale," and "Manufacturing Journal" business events VYRON FINANCE is already built to receive from VYRON COST once that product exists and is connected). A manufacturer can run its general ledger, accounts payable/receivable, and basic inventory on VYRON FINANCE today; real manufacturing costing is a VYRON COST integration away, not a current VYRON FINANCE capability.

---

## 4. Module Catalogue

29 modules, each rated during the Launch Readiness Programme's page-by-page audit (`docs/PRODUCT_AUDIT_MATRIX.md`) — 24 Production Ready or Complete, 4 found broken and fixed, 2 rated Partial with disclosed gaps. Every module's Permissions column names the real `role_permissions` keys that gate it (Section 6 has the full role list).

### Core financial workspace

**Company Management** — *Purpose*: create, list, and administer the Companies (and their Organisation) a user can access. *Features*: Create Company wizard, company list/status, Settings → Company Details. *Workflow*: Section 5 covers Billing; company creation itself seeds GL, VAT, RBAC, and communication defaults in one step. *Integrations*: Commercial Billing Platform (every company starts a trial on creation). *Dependencies*: Organisation→Company tenancy model, Financial Year Service. *Permissions*: `SystemAdministration` (platform-scope) or Company Owner for administration; every company member for read.

**Bank Accounts** — *Purpose*: the register of every account the company banks with, its balance, and recovery status. *Features*: account cards, Create/Detail pages, "Needing Reconciliation" and "Import Health" tiles. *Workflow*: see Bank Import (Section 5). *Integrations*: Import Centre, Cashbook & Bank Reconciliation. *Dependencies*: none upward. *Permissions*: `BankAccounts:View/Create/Edit`.

**Import Centre** — *Purpose*: bring external data into the system as validated, permanent import records. *Features*: Bills/Credit Notes CSV upload, Bank Statement CSV/Excel/OFX/QIF upload via an extensible parser framework, automatic duplicate-skipping, Recent Imports table. *Workflow*: see Bank Import (Section 5). *Integrations*: feeds Transaction Explorer, Supplier Reconciliation, Purchasing, Matching. *Dependencies*: none upward. *Permissions*: `Import:Create`.

**Transaction Explorer** — *Purpose*: every imported bank transaction, searchable/filterable/actionable in one grid — the record every other module reads from. *Features*: filter bar, column chooser, bulk-action bar, transaction detail/recovery panel, transaction timeline. *Workflow*: filter → select → bulk-code/approve/generate journal. *Integrations*: Bank Accounts, Customers, Suppliers, Merchants, Import Centre. *Dependencies*: Import Centre as its data source. *Permissions*: `Banking:View/Edit/Post`.

**Supplier Reconciliation** — *Purpose*: import, match, allocate, and report on supplier payments end to end. *Features*: Allocation Status stacked bar, report generation/viewer. *Workflow*: import → match → allocate → report. *Integrations*: Import Centre, Matching Platform, Supplier Management, GL. *Dependencies*: the shared Posting Engine for anything it posts. *Permissions*: `Banking:View/Edit`, `Suppliers:View`.

**General Ledger** — *Purpose*: the accounting engine every module posts through. *Features*: Chart of Accounts, Journals, Posting Rules, Trial Balance, GL Inquiry, account drill-through. *Workflow*: see General Ledger (Section 5). *Integrations*: every posting module in the platform. *Dependencies*: none — it is the dependency. *Permissions*: `GeneralLedger:View/Create/Edit/Post`, `ApproveJournals` (amount-gated via `role_approval_limits`).

**Customer Management** — *Purpose*: customer master data underpinning Sales. *Features*: customer list, detail tabs (Overview, Contacts, Addresses, Financial, Sales History, Documents, Intelligence). *Workflow*: create → transact via Sales → view intelligence. *Integrations*: Document Platform, Sales Platform. *Dependencies*: none upward. *Permissions*: `Customers:View/Create/Edit`.

**Supplier Management** — *Purpose*: supplier master data underpinning Purchasing, Matching, and Reconciliation. *Features*: detail tabs (Overview, Contacts, Addresses, Age Analysis, Purchase History, Documents, Intelligence). *Workflow*: create → transact via Purchasing → reconcile. *Integrations*: Document Platform, Purchasing Platform, Supplier Reconciliation. *Dependencies*: none upward. *Permissions*: `Suppliers:View/Create/Edit`.

**Sales Platform** — *Purpose*: the full customer sales lifecycle. *Features*: Quotations, Sales Orders, Deliveries, Invoices, Receipts. *Workflow*: see Sales (Section 5). *Integrations*: Customer Management, VAT, GL, Inventory (delivery triggers stock movement). *Dependencies*: the shared Posting Engine. *Permissions*: `Sales:View/Create/Edit/Approve/Reject`, `ApproveSales` (amount-gated).

**Purchasing Platform** — *Purpose*: the full procure-to-pay lifecycle. *Features*: Requisitions, Purchase Orders, GRNs, Bills, Payments. *Workflow*: see Purchasing (Section 5). *Integrations*: Supplier Management, VAT, GL, Inventory. *Dependencies*: the shared Posting Engine. *Permissions*: `Purchasing:View/Create/Edit/Approve/Reject`, `ApprovePurchases` (amount-gated).

**Inventory Platform** — *Purpose*: stock control tied to the accounting core. *Features*: Stock Items, Warehouses, Transactions, Stock Takes, Intelligence, Integration Centre. *Workflow*: see Inventory (Section 5). *Integrations*: Purchasing (GRNs), Sales (deliveries), GL, VYRON COST (future). *Dependencies*: the shared Posting Engine. *Permissions*: `Inventory:View/Create/Edit/Delete`.

### Automation and compliance

**Banking Automation & Rule Intelligence** — *Purpose*: turn unknown bank transactions into either an automatic posting or a well-evidenced exception. *Features*: Rules, Analytics, and an exception queue with reason/evidence/recommended action per item. *Workflow*: rule matches → auto-code, or no match → exception raised for review. *Integrations*: the one shared Rule Engine, Import Centre parsers, GL. *Dependencies*: Chart of Accounts, VAT treatments. *Permissions*: `Banking:Edit`, `RunAutomation`.

**Automation Platform** — *Purpose*: recurring document generation and the automation/scheduler operational layer. *Features*: task/rule success-rate dashboard, scheduler health, retry queue, Recurring Templates for 7 document types. *Workflow*: template → scheduled generation → the same real domain service a manual document would use. *Integrations*: Sales, Purchasing, GL, Inventory. *Dependencies*: the shared Rule Engine and Workflow Engine. *Permissions*: `RunAutomation`.

**VAT Intelligence** — *Purpose*: one VAT Engine, consumed by Sales, Purchasing, and Banking, generating Returns from live GL data. *Features*: Dashboard, Transactions, Exceptions, Adjustments, Returns, Audit Trail, Intelligence, Reports. *Workflow*: see VAT (Section 5). *Integrations*: GL, Sales, Purchasing, Banking Automation. *Dependencies*: the shared Rule Engine. *Permissions*: `VAT:View/Edit`, `ManageVAT`.

**Financial Reporting & Executive Intelligence** — *Purpose*: statements, management reports, forecasting, and alerting from live GL data. *Features*: Financial Statements, Management Reports, Forecasting, Executive Alerts, Report Designer. *Workflow*: see Reporting (Section 5). *Integrations*: General Ledger, GAAP Statements engine. *Dependencies*: the shared Posting Engine's ledger. *Permissions*: `RunReports`, `GenerateFinancialStatements`.

**Auditor Workspace** — *Purpose*: automated evidence gathering, anomaly detection, and working-paper preparation, with professional judgement staying with the auditor. *Features*: Dashboard, Planning, Findings, Working Papers, Assistant, Queries — 18 real audit tests including Benford's Law and orphan-transaction detection. *Workflow*: see Audit (Section 5). *Integrations*: GL, Documents, Matching. *Dependencies*: an Audit Engagement (creation currently has no UI — see Section 5). *Permissions*: `AuditAccess`.

**Fixed Assets** — *Purpose*: the full asset lifecycle as real, journal-traceable Business Events. *Features*: Dashboard, Register, Depreciation, Findings. *Workflow*: see Assets (Section 5). *Integrations*: the shared Posting Engine, AI Copilot (asset narratives). *Dependencies*: Chart of Accounts. *Permissions*: `Assets:View/Create/Edit`, `ApproveAssets`, `RunDepreciation`.

**AI Executive Copilot** — *Purpose*: an evidence-backed consumer of the platform's existing intelligence layer. *Features*: Ask, Narratives, What-If, Briefing, Financial Health score. *Workflow*: fixed-catalogue question → live-data-computed, confidence-scored answer, or an honest refusal. *Integrations*: Financial Years, Fixed Assets, GL/reporting data. *Dependencies*: `hasFeature(companyId, "ai_copilot")` (Licensing/Feature Flag gate). *Permissions*: `AccessAICopilot`.

**GAAP Financial Statements & Disclosure Engine** — *Purpose*: standards-compliant statements with complete audit traceability. *Features*: Statements & Notes, Reporting Packages; Income Statement, Balance Sheet, Cash Flow, Statement of Changes in Equity, disclosure notes, a reporting-readiness score. *Workflow*: see Reporting (Section 5). *Integrations*: General Ledger, Auditor Workspace evidence. *Dependencies*: the shared Posting Engine's ledger. *Permissions*: `GenerateFinancialStatements`.

### Banking and matching

**Cashbook & Bank Reconciliation** — *Purpose*: manual cash capture and formal bank reconciliation, separate from the automated Transaction Explorer flow. *Features*: Capture, Receipts/Payments Cashbook, Batches, Reconciliation, Enquiry. *Workflow*: see Cashbook (Section 5). *Integrations*: Bank Accounts, GL. *Dependencies*: the shared Posting Engine. *Permissions*: `Cashbook:View/Create/Edit/Post`.

**Matching Platform** — *Purpose*: one Matching Engine, one Review Queue, one Confidence Engine for every unmatched item across the whole company. *Features*: Dashboard, Review Queue, Customer/Supplier/Merchant Matching, Duplicate Detection. *Workflow*: see Matching, folded into Bank Import (Section 5). *Integrations*: Transaction Explorer, Customer/Supplier Management, Banking Automation. *Dependencies*: Import Centre as its data source. *Permissions*: `Banking:Edit`.

### Cross-cutting platforms

**Document Platform** — *Purpose*: one company-scoped document store, embedded inside other modules rather than a standalone workspace. *Features*: version history (a new upload never deletes the old version), embedded panels across Customers, Suppliers, Fixed Assets, Recurring Templates, Communications, Supplier Matching. *Workflow*: attach → version → reference from the owning record. *Integrations*: consumed by Customer/Supplier Management, Fixed Assets, Automation, Communications. *Dependencies*: one private Storage bucket, path-prefixed per company. *Permissions*: scoped by the owning module's permissions.

**Communication Platform** — *Purpose*: one Communication Engine so every outbound message from every module lands in one auditable record. *Features*: Dashboard, Log, Templates, in-app notification bell, embeddable history panel. *Workflow*: Queue → Approve/Reject (via the shared Workflow Engine) → Send. *Integrations*: consumed by nearly every module as the send/notify path. *Dependencies*: Email and In-App channels are real; SMS/WhatsApp/Teams/Slack/Push are named for the future, not built; Email itself needs production SMTP (see Section 8/11). *Permissions*: module-scoped.

**Commercial Billing Platform — Customer Portal** — *Purpose*: a company's own view of its plan, usage, invoices, and payments. *Features*: Overview, Plan, Usage, Invoices & Payments, Billing Contact, Audit History. *Workflow*: see Billing (Section 5). *Integrations*: Licensing Engine, Usage Metering Engine, Stripe provider (pending). *Dependencies*: `ManageBilling` permission. *Permissions*: `ManageBilling` (Company Owner holds this by default).

**Commercial Billing Platform — Internal Console** — *Purpose*: VYRON staff's cross-tenant billing administration view. *Features*: Subscriptions, Payments & Invoices, Webhooks & Provider Health, Revenue Intelligence, Support & Audit. *Workflow*: see Billing (Section 5). *Integrations*: same engines as the Customer Portal, platform-wide scope. *Dependencies*: `ManageBilling` at platform scope. *Permissions*: `ManageBilling` (Platform Super Administrator, Platform Administrator).

**Platform Shell / Overview** — *Purpose*: the landing workspace listing every company a user can access, with per-company billing/lifecycle status, activity, and notifications. *Features*: company grid (Active/Needs Attention/Onboarding), per-company subscription snapshot, activity feed, notifications, the persistent navigation/search/help shell wrapping every route. *Workflow*: sign in → land here (Platform Super Administrator) or on the company Dashboard (a company-scoped user). *Integrations*: Company Management, Commercial Billing Platform. *Dependencies*: `listCompaniesForUser`. *Permissions*: any authenticated user (scoped to their own companies) or platform-scope roles for the full view.

**Authentication** — *Purpose*: identity and session management gating every company/platform route. *Features*: login, logout, forgot/reset password, Remember Me, first-run bootstrap (self-locking after first use), change password. *Workflow*: sign in → session established → every layout checks it. *Integrations*: Supabase Auth (GoTrue). *Dependencies*: none — the foundation everything else sits on. *Permissions*: none required to authenticate; every subsequent action is RBAC-gated.

### Company-level configuration

**Settings** — *Purpose*: per-company configuration. *Features*: Company Details, Financial Years, Branches, Departments, Cost Centres, Projects, Currencies, Tax Configuration, Roles & Permissions. *Workflow*: configure once at onboarding, adjust as needed. *Integrations*: every module reads its relevant configuration from here. *Dependencies*: none. *Permissions*: `SystemAdministration` or Company Owner for most tabs; Roles & Permissions specifically requires `ManageUsers`.

**Executive Dashboard** — *Purpose*: a company's own home page — "Recovery Health" — distinct from the cross-company Platform Overview. *Features*: financial-health hero, visual-intelligence charts, the guided Recovery Health checklist (Bank Statements Imported → Matching → Journals Generated → Journals Posted → VAT Exceptions Cleared). *Workflow*: the first screen a company-scoped user sees after selecting a company. *Integrations*: reads live from GL, Banking, Matching, VAT. *Dependencies*: a Financial Year should exist for period-based figures to be meaningful (not enforced by the product — see Section 5's honest disclosures). *Permissions*: any company member.

**Operations Centre** — *Purpose*: the internal command centre for running VYRON in production — engine, queue, integration, and security health. *Features*: live/calculated/not-available data labelling discipline throughout. *Workflow*: platform staff monitor here, not customer-facing. *Integrations*: reads across every engine's own health signals. *Dependencies*: none. *Permissions*: `SystemAdministration`.

---

## 5. Complete Workflow Maps

Every workflow below was traced end-to-end through the actual, real source code during the Launch Readiness Programme — every stage's real handler, real service call, and real posting through the shared Posting Engine, not assumed from documentation. See `docs/WORKFLOW_CERTIFICATION.md` for the full evidentiary trail.

### Sales
```
Quotation → Sales Order → Delivery → Sales Invoice → Customer Receipt
```
Each stage is a real, separate record — converting one stage to the next never loses the original document. **Approve & Post** on an Invoice builds and posts a real journal through the shared Posting Engine, then triggers the real inventory movement only once that journal is confirmed Posted. Partial delivery and backorder tracking are real. Receipt allocation validates against both the receipt's remaining amount and the invoice's real outstanding balance. **Result**: a real, balanced GL journal, correctly sequenced, every time.

### Purchasing
```
Requisition → Purchase Order → Goods Received Note → Purchase Bill → Supplier Payment
```
Mirrors Sales' rigor exactly, with one addition Sales doesn't have: a real internal spend-approval gate on Purchase Orders. Bill approval uses an amount-based approval limit, not a flat permission. Approving a Payment automatically sends a real Remittance Advice to the supplier. **Result**: a real, balanced GL journal. **Known gap**: this lifecycle's core services have no dedicated automated test suite, unlike Sales' equivalent — correctness rests on code-trace verification, not regression tests, today.

### Banking (Bank Import → Matching)
```
Upload (CSV/XLSX/OFX/QIF) → Parse → Idempotent Ingest → Exception Reporting
    → Review Queue → Auto Match / Manual Allocate → Split Transaction → Duplicate Detection → Merge
```
A re-uploaded file is always safe — already-imported transactions are automatically skipped. A new bank account is auto-created from the statement if it doesn't already exist. The Review Queue is the single place every unmatched item across the whole company appears, aggregated by a real database function, not an in-memory approximation. Duplicate Detection's "Suggested Merge" genuinely re-points every transaction from the merged record to the surviving one.

### Cashbook
```
Capture (Receipt / Payment / Transfer) → Submit → Approve & Post → (Reverse if needed)
```
Real validation at every stage; Batches follow the identical create → Approve & Post path. **Result**: a real journal, a real audit trail, every time.

### Inventory
```
Warehouse Setup → Stock Item → Transaction (Receipt / Issue / Transfer / Adjustment)
    → Draft → Submitted → Approved → Posted
```
Real FIFO layer consumption genuinely consumes the oldest layer first, and throws rather than allowing a silent negative on insufficient stock. Weighted-average costing rolls forward correctly on receipt. Stock Take finalisation creates a real, auto-posted Inventory Adjustment journal for every non-zero variance line.

### General Ledger
```
Draft Journal (manual entry, Transaction Explorer's Generate Journal, or any module's
    Posting-Rules-driven creation)
    → Submit → Approve → Post (the one shared posting step every module's journal passes through)
    → Trial Balance / GL Inquiry / Account Activity (live queries, never cached)
```
Reversal creates a real offsetting journal, auto-approved, through the same one posting path. **Result**: every journal in the system, regardless of origin, posts through the identical, single, tested code path.

### VAT
```
Transaction → VAT Return (computed live from real GL activity, never cached)
    → Recalculate / Review / Approve (posts a real settlement journal)
    → Submit (honestly disabled — no live SARS eFiling integration)
    → Adjustments (auto-raised over a real threshold) → VAT Intelligence scan
```
**Result**: a real settlement journal, a real exception trail, an honestly disclosed submission-method limitation rather than a fabricated one.

### Reporting (Financial Statements)
```
Trial Balance → Income Statement / Balance Sheet / Cash Flow / Statement of Changes in Equity
    → Disclosure Notes (11 real note builders, 3 honestly disclosed as pure placeholders)
    → Reporting Package (Management / Board / Accountant / Auditor, reusing the same
      statement engines — no second calculation)
    → Send (approval-gated, template-backed)
```
**Result**: every figure traces back to the same live GL data every other module reads — one source of truth, confirmed by tracing the actual import graph, not asserted.

### Audit
```
Planning (create an Audit Engagement) → Dashboard → Findings (18 real audit tests,
    including Benford's Law and orphan-transaction detection)
    → Working Papers → Assistant → Queries
```
**Known gap**: Planning — the very first stage — currently has no UI to create a new Audit Engagement. Any brand-new company without a pre-existing engagement hits a dead end on this tab until one exists; the rest of the module is real but unreachable until then.

### Assets
```
Acquire (posts a real Acquisition journal) → Capitalise / Improve / Transfer / Revalue /
    Impair / Dispose (Disposal gated by a real amount-based approval)
    → Depreciation Run (one consolidated journal per run, blocked on a closed Financial Period)
```
Every money-moving lifecycle event is a real Business Event through the shared Posting Engine.

### Billing
```
Company Created → subscribeCompanyToPlan (free trial, zero Stripe dependency, real local rows)
    → Scheduler-owned trial countdown / warning / expiry (a real automation task, daily cadence)
    → Cancel / Resume / Change Plan (provider-integrity-guarded — a priced-plan change
      without a connected provider is refused, never faked)
    → every mutation publishes to the real Billing Event Bus (the literal Audit Trail)
```
**Known gap**: the trial-provisioning and lifecycle-transition chains are real but not transactionally atomic — a mid-sequence failure can leave inconsistent state. This is tracked as an open finding (D-032) with an accepted-but-deferred architectural fix (ADR-001, Section 11).

---

## 6. User Roles

### Platform-scope roles (4)

Granted with `company_id is null` — apply across every organisation and company.

| Role | What it can do |
|---|---|
| **Platform Super Administrator** | Full control of every organisation, company, and platform setting — the only platform role holding `SystemAdministration` and `ManageBilling` |
| **Platform Administrator** | Administers organisations and companies (users, audit access, reporting, billing) but cannot touch platform-level system configuration |
| **Partner** | Designed for an external accounting partner with cross-company access on *assigned* companies only — seeded with zero platform-wide permission grants by design, so a Partner's real access always comes from explicit per-company role assignments, never a blanket platform grant |
| **Support Technician** | Read-only diagnostic access — audit access and reporting only, no write capability anywhere |

**Structural guarantee**: no platform-scope role holds any module CRUD or approval/posting permission — there is no grant row to exploit, not merely a policy statement.

### Company-scope roles (15)

Seeded automatically for every new company. Ten of the fifteen carry real, amount-based approval limits (`role_approval_limits`), across five categories: Journal, Supplier Payment, Customer Credit Note, Purchase Approval, and Asset Disposal.

| Role | Summary | Approval limits |
|---|---|---|
| **Read Only** | View access across every module, no write capability | none |
| **Bookkeeper** | Create/edit across Sales, Purchasing, Inventory, Banking, Cashbook, Matching | none |
| **Senior Bookkeeper** | Everything Bookkeeper has, plus posting and journal/payment approval | Journal & Supplier Payment, both capped |
| **Accounts Receivable Clerk** | Sales create/edit plus sales approval | Customer Credit Note, capped |
| **Accounts Payable Clerk** | Purchasing create/edit plus purchase approval | Purchase Approval, capped |
| **Inventory Manager** | Full inventory create/edit/delete | none |
| **Purchasing Manager** | Full purchasing lifecycle plus approval | Purchase Approval, higher cap |
| **Sales Manager** | Full sales lifecycle plus approval | Customer Credit Note, higher cap |
| **Branch Manager** | View-only across Sales, Purchasing, Inventory, Banking, General Ledger, Reports | none |
| **Auditor** | Audit access, reporting, AI Copilot, plus view across ten modules | none |
| **Accountant** | Broad create/edit/post/export across nine modules, VAT/depreciation/statements | all four applicable categories, capped |
| **Financial Manager** | Everything Accountant has, plus delete/reject/import, user management, financial year control | all five categories, higher cap |
| **Financial Director** | Every module, every action, almost every global permission | unlimited |
| **Managing Director** | Identical grant set to Financial Director | unlimited |
| **Company Owner** | Everything Financial Director has, plus `SystemAdministration` and `ManageBilling` | unlimited |

### Permission inheritance

Permission inheritance in VYRON FINANCE is deliberately **flat, not hierarchical**, with exactly one real exception: Senior Bookkeeper is the only role in the entire system that inherits from another role (Bookkeeper) via a `parent_role_id` link. Every other role's permission set — including the apparent progression from Bookkeeper through Accountant, Financial Manager, Director, to Owner — is independently and completely defined, not derived from a lower role. This is a deliberate design choice: it means editing one role's permissions can never silently change another role's behaviour, at the cost of some duplication in the seed data.

The resolution mechanism for "does this user have this permission in this company": look up the user's role assignment for that company (or platform scope) → resolve that role's permission grants → if the role has a parent, also include the parent's grants (currently only relevant for Senior Bookkeeper) → check membership. This is enforced identically at the application layer and, independently, at the database layer via Row Level Security — a genuine two-layer guarantee, not one check duplicated in two places.

### `organisation_members.role` — a separate, non-RBAC concept

Distinct from every role above, `organisation_members.role` (owner/admin/member) is not part of the RBAC permission system at all. It exists solely to bootstrap company access: whoever creates an Organisation becomes its `owner`; this governs who may create or rename companies within it, and ensures a user who receives an RBAC company-role assignment can actually see that company under Row Level Security. It grants no module permission, no approval authority, and no billing access on its own — every real feature permission comes from the RBAC roles above.

---

## 7. AI Capabilities

### AI Copilot

Answers a fixed, curated catalogue of financial questions, each computed live from the company's real GL and financial data — never a generative or guessed answer. Every answer carries a confidence indicator; a question outside the supported catalogue gets an honest refusal, not a fabricated response. Capabilities beyond direct Q&A: Narratives (plain-language summaries of what changed and why), What-If modelling, a daily Briefing, and a computed Financial Health score. Gated by the `ai_copilot` feature flag and the `AccessAICopilot` permission.

### Matching Engine

One Matching Engine, one Review Queue, and one Confidence Engine serve every unmatched item in the company — bank transactions, customer and supplier matching, duplicate detection, and cashbook allocation — rather than a separate matching mechanism per module. The Review Queue itself is a real, aggregated database view, not an in-memory approximation, so it stays accurate at scale.

### Intelligence Engines

- **Merchant Intelligence**: normalises and groups raw, inconsistent bank description text into recognised merchants, the foundation Merchant Rules are taught against.
- **Rule Intelligence**: priority ordering, conflict detection, version history, and health checks over every rule in the system — the single engine every domain's automation (Banking, Sales, Purchasing, Inventory, GL, VAT, Reporting, Communications) shares.
- **VAT Intelligence**: combines rule signals with a live VAT-domain scan to raise real, idempotent exceptions — never a duplicate alert for the same underlying issue.

### Forecasting

Real forward-looking projections computed from live GL history, surfaced in the Financial Reporting module's Forecasting tab, feeding the same Executive Alerts the rest of the platform uses.

### Audit Intelligence

Eighteen real, independently verifiable audit tests run inside the Auditor Workspace, including Benford's Law analysis and orphan-transaction detection — genuine statistical and structural checks over real transaction data, not a checklist of unimplemented placeholders.

### Financial Intelligence

The Executive Dashboard's "Recovery Health" scoring and the AI Copilot's Financial Health score both compute live from the same underlying GL, Banking, Matching, and VAT data every other module reads — one source of intelligence, not a separate calculation invented for the dashboard.

---

## 8. Integrations

Honest status for every integration named in this section — several are architected but deliberately not built yet, per explicit product direction, and are disclosed as such rather than implied complete.

### Stripe — designed, not built

The `BillingProvider` interface VYRON FINANCE's Billing Engine will call is fully specified in `docs/STRIPE_PROVIDER.md`, but the implementing code does not exist yet. There is no `stripe` package dependency, no provider file, and no webhook route in the codebase today. What is real: a `billing_provider_connections` table that honestly reports "Not Connected," and Billing Engine logic that is deliberately written to never require Stripe for free-trial, cancellation, or resumption flows, and to refuse (not fake) a priced-plan action when no provider is connected. This is blocked on the Vercel Marketplace Stripe integration's Terms of Service acceptance — a real-world action outside this codebase's control, not an engineering task.

### VYRON CORE / VYRON COST — architecture only, by explicit design

Both are sibling VYRON products, not third-party systems — neither is itself an accounting system; each will eventually supply validated business events for VYRON FINANCE to account for. The Product Review Board's own direction was explicit: build the connection architecture now, build no mock synchronisation, no fabricated API responses, and no live integration until a real VYRON COST or VYRON CORE API exists to call. What's real today: a typed business-event envelope, named event-type mappings (for VYRON COST: Inventory Movement, Cost of Sale, Manufacturing Journal, and others; for VYRON CORE: Approved Timesheet, Payroll Journal Import, Labour Cost Allocation, and others) that route into VYRON FINANCE's existing Posting Rules engine, and a per-company connection-status registry that honestly shows "Not Connected" everywhere it's surfaced (notably the Inventory module's Integration Centre). There is no HTTP client, webhook receiver, or sync job for either product yet.

### Microsoft 365 / Google Workspace — not started

Neither has any code in the platform today — no provider file, API client, connector, or even a documented interface design. Both are named in the product roadmap as third-party integrations not yet begun, distinct from the internal VYRON COST/CORE integrations above.

### Future APIs

Bank feed integrations (direct bank-to-platform statement delivery, rather than the current manual import model) are named in the roadmap as not started. Any future third-party integration in VYRON FINANCE will follow the same discipline already established here: a typed contract and an honest connection-status display before a single line of live integration code, never a fabricated "connected" state.

---

## 9. Security

Full detail: `docs/SECURITY_ARCHITECTURE.md`. This section summarises for a business audience.

### Multi-tenancy

Organisation → Company is the tenancy model, present since the platform's first migration. Every company-scoped table enforces isolation through Row Level Security tied to real company membership — a user cannot see another tenant's data by manipulating a request, because the database itself, not just the application, enforces the boundary.

### RBAC

Two tiers — 4 platform-scope roles and 15 company-scope roles (Section 6) — with a deliberately flat (not hierarchical) permission model, so editing one role can never silently change another's behaviour.

### RLS (Row Level Security)

Two independent layers protect every action in the platform: an application-layer permission check, and a database-layer RLS policy that would still block the action even if the application-layer check were somehow bypassed. This two-layer design has a real track record: the one confirmed critical finding in the platform's history (a cross-tenant read via an overly broad organisation-wide policy) was found, fixed, and re-verified blocked — and it was the database layer catching what the application layer alone had missed.

### Audit Trail

Every permission denial, every role or permission change, and every automation run is logged automatically — nothing needs to be manually enabled. The Commercial Billing Platform adds its own durable audit log, the Billing Event Bus, which records every significant billing action (subscription changes, payments, refunds, feature toggles) before anything else reacts to it.

### Document Security

One private Storage bucket, with every document path-prefixed by company and access-controlled by the same Row Level Security model as every other table.

### Communications

Every outbound message, from every module, lands in one auditable record — no module sends anything through a side channel invisible to the Communication Log.

### Billing Security

The newest area of the schema; its RLS policies and database functions have been code-reviewed and pattern-matched against the rest of the platform's proven model, but have not yet been through the same live adversarial attack testing the rest of the schema received during an earlier certification pass. This is disclosed explicitly in `docs/LAUNCH_CHECKLIST.md` as a recommended pre-launch action, not treated as already-proven.

---

## 10. Commercial Model

Full detail: `docs/BILLING_ARCHITECTURE.md`, `docs/LICENSING_ENGINE.md`, `docs/FEATURE_FLAGS.md`.

### Subscription Plans

Six data-driven plans — Free Trial, Starter, Professional, Enterprise, Partner, Internal — with pricing, entitlements, and feature access defined as catalogue data, never hardcoded in application code. Four billing cycles are supported: Monthly, Quarterly, Annual, and Custom.

### Licensing

One Licensing Engine enforces eight named limits per company: maximum users, companies, storage, documents, AI usage, automation, API calls, and integrations. Every limit check runs through the identical evaluation function regardless of which module is asking.

### Feature Flags

Ten named feature flags exist and are fully computable per company through the Feature Flag Engine. **Honest disclosure**: only two of the ten (`ai_copilot` and `automation`) currently have a real enforcement gate wired into an actual route; the remaining eight are computable but not yet enforced anywhere in the product. This is a tracked, deliberate launch-readiness item, not an oversight hidden from this document.

### Billing

A real Billing Engine drives an eight-state subscription lifecycle (Trial, Active, Past Due, Grace Period, Suspended, Cancelled, Expired, Archived) and a seven-state company lifecycle derived from it. Every subscription action — subscribe, cancel, resume, change plan — is provider-integrity-guarded: a priced-plan action without a connected payment provider is refused outright, never silently granted.

### Usage Metering

Two distinct metering strategies, chosen deliberately per metric to avoid the performance trap of scanning a growing table on every check: **live-counted** metrics (companies, users, customers, suppliers, inventory items, assets, documents, storage) are computed by querying the real owning table directly, always accurate, never stale; **event-metered** metrics (communications, automation runs, AI requests, API requests, bank imports, reports generated, forecasts, financial statements, scheduled jobs) accumulate in a pre-aggregated counter table via a single atomic database function, never a slow reduction over raw event history.

---

## 11. Roadmap

### Version 1.0 (this release — Release Candidate 1)

The complete accounting core, the Commercial Billing Platform, platform-wide RBAC, and the full documentation set described throughout this Bible — frozen at the Product Review Board's RC1 freeze review. Zero Critical defects open. Pending only external, non-engineering dependencies: Stripe Marketplace acceptance, live Stripe provisioning, production SMTP, production DNS/SSL, and production database migration execution. From the freeze forward, only critical production bug fixes are accepted onto this line (`v1.0.x`).

### Version 1.1 (pilot-feedback-driven enhancements)

Carries forward ADR-001 — decoupling Billing Activation from Company Creation, accepted in principle at the RC1 freeze but deliberately deferred rather than implemented under freeze (Section 12's "no architectural refactoring after freeze" discipline). Beyond that committed item, v1.1's scope is intentionally driven by real feedback from the first pilot customer's actual operational data, not pre-planned in detail here — the entire reason the Product Review Board chose to move to pilot onboarding now rather than speculate further.

### Version 2.0 (major platform evolution)

The candidates already visible from this Bible's own honest disclosures: a live Stripe connection and the remaining eight feature-flag gates; a real VYRON COST and/or VYRON CORE connection consuming the business-event contract that already exists; consolidated multi-company reporting for group customers; Microsoft 365 and Google Workspace integrations; direct bank feed integration; and an expanded AI Copilot question catalogue. None of these are committed — they are the platform's own documented gaps, which is exactly where v2.0 planning should start.

### Long-term vision

VYRON FINANCE as the first fully proven member of the VYRON ecosystem, with its shared platform services (Billing, Licensing, Feature Flags, Documents, Communications, Automation, Workflow) mature enough that VYRON COST and VYRON CORE can be built on top of the same foundation rather than each starting from zero — the explicit design intent behind every "one engine, not one per module" decision this Bible documents.

---

## 12. Product Principles

The principles that shaped every architectural decision in this platform — each stated here with the real evidence behind it, not as an aspiration.

**One Business Object.** Every module scopes to a single canonical `Company` entity — one table, one `company_id` foreign key pattern, enforced identically by Row Level Security everywhere it appears. When a business event needs to cross a product boundary (to VYRON COST or VYRON CORE), it travels through one typed envelope, not a bespoke shape per integration.

**One Posting Engine.** Every module's business event — Sales Invoice, Purchase Bill, Asset Disposal, Depreciation Run, VAT Settlement, Cashbook entry — posts through the identical shared posting function. Verified, not assumed: a full-codebase search finds only the Posting Engine itself writing to the ledger table.

**One Rule Engine.** The same rule engine, with the same priority, conflict-detection, and health-check machinery, drives automation across Banking, Sales, Purchasing, Inventory, General Ledger, VAT, Reporting, and Communications.

**One Workflow Engine.** The same approval-before-activation backend serves both the Automation Platform's template/rule activation and the Communication Platform's send-approval queue — a shared mechanism, not two parallel ones that happen to look similar.

**One Billing Engine.** No billing logic exists inside Customers, Companies, Authentication, Licensing, or User Management — every billing action, everywhere in the platform, flows through the one Billing Engine.

**One Licensing Engine.** All eight usage limits, for every company, resolve through the identical evaluation function — no module computes its own version of "is this company over its limit."

**One Communication Platform.** Every outbound message from every module lands in one auditable record, through one send path — never a module-specific side channel invisible to the Communication Log.

**One Document Platform.** A single private Storage bucket, path-prefixed by company, embedded into the modules that need it rather than duplicated as a separate document store per module.

**Evidence over assumptions.** This document, and every certification report it draws from, traces its claims to actual source code — file paths, line numbers, and direct code quotes — rather than trusting prior documentation or stated intent. Where this Bible's own claims came from a prior document, that document's own claims were independently re-verified against the real code before being repeated here.

**Honest scope disclosure.** Every unbuilt or partially-built capability in this document is stated as such, in the same breath as the real capabilities around it — Stripe, VYRON COST/CORE, Microsoft 365, Google Workspace, unenforced feature flags, the non-atomic billing write sequence, the missing Audit Engagement creation UI. Nothing in this platform's documentation implies a capability that doesn't exist.

**Multi-tenant by design.** The Organisation → Company hierarchy and Row Level Security tenant isolation have been present since the platform's very first migration — never retrofitted onto a single-tenant assumption.

---

*This document is the definitive product reference for VYRON FINANCE Version 1.0 Release Candidate 1. It should be kept current as the product evolves — particularly as Version 1.1's pilot-driven scope, and any Version 2.0 integration work, moves capabilities described here as "not built" into "real."*
