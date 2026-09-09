# VYRON FINANCE 1.0 — Launch Checklist

Phase 7 of the Launch Readiness Programme (LR1). Every item below is either already verified (cited to its evidence) or an explicit action item with an owner-shaped description — nothing here depends on tribal knowledge. Go/No-Go criteria at the end.

**Updated after LR1 Phase 1 (Product Audit)**: the audit found 44 findings, including 4 Critical-severity production defects. All 4 have been fixed and verified (full test suite: 1146/1146 passing across 148 files, `tsc`/`eslint` clean). See `docs/DEFECT_REGISTER.md` for the complete list and `docs/PRODUCT_AUDIT_MATRIX.md` for the audit itself. One of the fixes required a new migration, `0054`, now included in every reference to "migrations not yet applied" below.

**Updated after the Pre-Launch Blockers pass and Final Architecture Review**: the pilot administrator account (`info@vyronsoft.co.za`) has been created and verified — Platform Super Administrator, Organisation Owner, and (transiently, during verification) Company Owner, all granted through the real application code paths, not seeded. Live verification of this account surfaced and fixed two further genuine defects: a full-bleed login page layout, and a Runtime Error crash on `/platform` for any admin who owns a company (see D-045 through D-048 in `docs/DEFECT_REGISTER.md`). The same verification also produced the first live confirmation of the failure mode already predicted by D-032 (non-atomic billing writes) — company creation retried after a billing failure silently created duplicate companies. A dedicated architecture review of this — `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md` — recommends decoupling Billing Activation from Company Creation. **The Product Review Board accepted this recommendation in principle at the RC1 freeze review but deferred implementation to Version 1.1 — see `docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`. RC1's certified workflow is unchanged.** The three diagnostic companies created during this verification have been safely removed, with zero orphaned records confirmed across every table they touched.

**RC1 status**: this codebase is frozen as of the Release Candidate 1 freeze. No further feature development, architectural refactoring, or optimisation — only critical production bug fixes are accepted from this point. See `docs/RELEASE_PACKAGE.md` for the formal release status and package contents.

**Updated after Final Production Re-Certification (live verification against the real database)**: migrations `0045`-`0054` are now confirmed applied — all 19 Commercial Billing Platform tables exist, all 6 subscription plans are seeded, and every pre-existing company has a real subscription link (migration `0054`'s backfill ran correctly). This was independently re-verified live, not just checked for table existence: a real company was created end-to-end through `POST /api/companies` (`201`, a real trial subscription, a real `subscription_status_history` row, a real `TrialStarted` billing event, 26 chart-of-accounts rows — the full certified Sales/Billing chain, not a partial success); the AI Copilot licensing gate was called against that company and returned a real `200` answer (D-018/D-028, confirmed resolved, not just table-existence-inferred); and the Platform Overview was confirmed rendering that company's real plan tier and lifecycle state, not the degraded fallback the earlier resilience fix added. The diagnostic company created for this test has been safely removed, zero orphaned records confirmed. **This resolves Hard Blocker #1 below and downgrades D-032's practical severity — see the Billing section and Go/No-Go criteria for the updated status.**

## External Dependencies — real prerequisites, not to be bypassed

These six are outside this codebase's control entirely. No amount of further engineering work substitutes for them; each requires a real-world action by the account/business owner.

| Dependency | What it blocks | Status |
|---|---|---|
| Stripe Marketplace Terms acceptance | All paid-plan billing | Not accepted — requires the Vercel account owner's own browser action at a Vercel-hosted URL |
| Live Stripe provisioning | Payment collection, invoices, real webhooks | Blocked on the above |
| SMTP production configuration | Password reset, invite, and any future transactional email at production volume | Not configured — Supabase's built-in sender is dev-only rate-limited (confirmed live: 3rd rapid send hit the limit) |
| Production domain | Auth redirect URLs, real customer-facing URL | Not yet assigned |
| SSL | Secure transport for the production domain | Automatic once domain + DNS are correct (Vercel-managed), but has no domain to attach to yet |
| DNS | Domain resolution to the production deployment | Not yet configured — depends on the production domain being chosen |

## Infrastructure

- [x] Application has no hosting-specific coupling — no `vercel.json`/`vercel.ts`, deployable to any Node.js host. *(`docs/DISASTER_RECOVERY.md`, Failure mode 2)*
- [x] `next build` runs cleanly with no build-time database dependency. *(`docs/DEPLOYMENT_GUIDE.md` §9)*
- [ ] **Action**: confirm the production Vercel project's environment variables (3 required — see Database section) are set for the Production environment, not just Preview.
- [ ] **Action**: confirm Preview deployments point at a separate Supabase project from Production, per `DEPLOYMENT_GUIDE.md`'s own recommendation, so test data never touches production.

## Database

- [x] Schema is fully migration-defined, 54 migration files (`0001`-`0054`), forward-only discipline enforced throughout this platform's entire history — zero migrations edited after live application, confirmed corrective-migration precedent 6 times (`0035`, `0040`, `0042`, `0044`, `0051`/`0052`/`0053` are all corrective/additive, never edits; `0054`, added during LR1 to backfill pre-existing companies with a subscription, follows the same discipline). *(`docs/RELEASE_PROCESS.md`)*
- [x] **Resolved — migrations `0045`-`0054` are applied to the real production database.** Live-confirmed, not assumed: all 19 Commercial Billing Platform tables queried successfully, all 6 plans seeded (`free_trial`, `starter`, `professional`, `enterprise`, `partner`, `internal`), and every existing company has a `subscription_companies` link (`0054`'s backfill ran). Further confirmed by a full live company-creation test completing end-to-end (`201`, real trial subscription, real billing event) — see the note at the top of this document.
- [ ] **Action, still open**: `docs/DEPLOYMENT_GUIDE.md` §3's verification queries reference stale counts ("37 migrations," "expect 119 tables") predating the Commercial Billing Platform's 17 new tables (migrations `0045`-`0054`) and earlier RC2 migrations (`0038`-`0044`). Re-run the verification queries against the now-live database and record the actual current counts — do not guess them in advance. (Table existence has been spot-checked per-table this session; the exact total table count has not been separately re-verified.)
- [x] RLS enabled and independently verified on every table this session touched (company-scoped via `user_can_access_company()`, platform-wide via the `company_id is null` branch) — pattern-matched against the pre-existing, live-attacked-and-confirmed-blocked tenant-isolation model. *(`docs/SECURITY_ARCHITECTURE.md`)*
- [x] Backup strategy real: Supabase automatic daily backups (retention tier-dependent), PITR available as a paid add-on, migration files as schema backup. *(`docs/DEPLOYMENT_GUIDE.md` §12, `docs/DISASTER_RECOVERY.md`)*
- [ ] **Known gap, disclosed, not blocking**: no off-platform backup of the Storage bucket (`documents`) — object storage loss is not currently recoverable by this application alone. Candidate post-launch operational addition.

## Security

- [x] Two independent layers on every protected operation (application-layer `requirePermission`/`requireApproval` + database-layer RLS) — no historical breach traced to a single-layer failure. *(`docs/SECURITY_ARCHITECTURE.md`)*
- [x] The one confirmed critical finding in this platform's history (cross-tenant read via organisation-wide RLS) was found, fixed, and re-verified blocked. *(`docs/SECURITY_ARCHITECTURE.md`, `docs/DISASTER_RECOVERY.md` incident log)*
- [x] Role escalation, permission escalation, foreign-ID cross-company writes, unauthenticated access, invalid/expired/reused tokens — all live-attacked and confirmed blocked during RC1/RC2 certification.
- [ ] **Known, accepted characteristic, not a defect**: `requireSession()` uses local JWT signature verification (`getClaims()`), not network-verified revocation (`getUser()`) — a signed-out session's access token stays technically valid until its ~1 hour natural expiry. Documented Supabase SDK behavior, a deliberate tradeoff (avoiding a network round-trip on every request), not scheduled for a fix. Product Review Board should be aware this is intentional, not overlooked.
- [ ] **Known, disclosed, lower severity**: `companies`' own SELECT RLS policy still uses organisation-wide membership (not the fixed `user_can_access_company()`) — an organisation member can see a sibling company's *name/industry/status* (never its business data). Deliberately not fixed in the same pass that fixed the critical finding, due to a real `INSERT ... RETURNING`-requires-SELECT-policy interaction risk. Candidate for a dedicated, carefully-tested fix, not a rushed one.
- [ ] **Action, now actionable**: the Commercial Billing Platform's own RLS policies and `security definer` functions (`fn_record_usage_event`, `fn_company_storage_bytes`, `fn_increment_usage_counter`, `grant_manage_billing_to_company_owner`) have been code-reviewed but never live-attacked the way the rest of the platform's RLS was during RC1 Phase 7.6. This session's re-certification confirmed the tables exist and function correctly under normal use (real company creation, real billing lookups) — but that is functional verification, not adversarial security testing. A live adversarial RLS pass against the Billing Platform tables, following the same methodology `docs/SECURITY_ARCHITECTURE.md` documents for everything else, is now possible (the tables exist) and still not done.

## Authentication

- [x] Full workflow live-verified: login, logout, Remember Me, forgot/reset password, change password, invite user, first-run bootstrap (`/setup`, self-locking), token exchange. *(`docs/SECURITY_ARCHITECTURE.md`)*
- [x] **Pilot administrator account created and verified**: `info@vyronsoft.co.za` holds Platform Super Administrator (confirmed in `user_role_assignments`, `company_id is null`) and Organisation Owner (confirmed in `organisation_members`). Created via the same code path as `/setup`'s bootstrap (which was already self-locked by a prior session's admin), not by hand-seeding a row — password never written to any persisted file. Real sign-in via `signInWithPassword`, session persistence, and sign-out all independently verified against the live Supabase project.
- [x] **Two genuine defects found and fixed during this verification**: the login page's split-panel layout had no width cap and stretched edge-to-edge on wide monitors (now bounded to `max-w-[1200px]`); `/platform` crashed with a Runtime Error for any Platform Super Administrator who owns a company, because three per-company billing lookups had no error handling against the still-missing Billing Platform tables (now wrapped so a missing subscription degrades gracefully instead of crashing the page). See D-045–D-048 in `docs/DEFECT_REGISTER.md`.
- [ ] **Action**: Supabase Auth Email Templates must be repointed to `/auth/confirm` for this specific project before any password-reset/invite email will complete correctly — a per-project dashboard setting, not something a migration can set. *(`docs/DEPLOYMENT_GUIDE.md` §8)*
- [ ] **Action**: Auth URL Configuration's Site URL + Redirect URLs must be set to the real production domain once known. *(`docs/DEPLOYMENT_GUIDE.md` §10)*

## Billing

- [x] Architecture certified code-complete: Billing Engine, Licensing Engine, Feature Flag Engine, Usage Engine, Billing Event Bus, Customer Portal, Internal Console. *(`docs/COMMERCIAL_BILLING_CERTIFICATION_REPORT.md`)*
- [x] **Resolved — migrations applied, billing features function live.** See Database section. Company Creation now completes end-to-end (`201`, real trial subscription, real `TrialStarted` billing event); the AI Copilot licensing gate returns real `200` answers instead of `403` (D-018/D-028, confirmed resolved); the Platform Overview renders real plan/lifecycle data instead of the degraded fallback.
- [ ] **Blocking, external**: Stripe not connected (see External Dependencies) — the API keys are now registered on Vercel, but the actual `StripeProvider` implementation still does not exist (`docs/STRIPE_PROVIDER.md`), and the provider connection honestly still shows "Not Connected" live.
- [x] **D-032's live trigger condition is resolved; the architectural finding remains valid and still deferred to v1.1.** The duplicate-company failure mode was caused by `subscribeCompanyToPlan` failing against non-existent tables — with the tables now present, a real company-creation test completed cleanly with no retry needed. This does **not** mean the underlying non-atomic multi-step write sequence in `createCompany`/the Billing Engine has become atomic — a different failure (a transient network error, a future bug) could still leave a company without a subscription. ADR-001's decoupling (`docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`) remains the correct structural fix and is still deferred to Version 1.1, not revisited by this finding. D-032 stays open in `docs/DEFECT_REGISTER.md`, with its status note updated to reflect that its trigger condition is gone for now.
- [ ] **Action**: only `ai_copilot` and `automation` feature keys have a real gate wired into a route today; the other 8 are computable but unenforced anywhere. Decide before launch whether that's acceptable for v1.0 or needs the remaining gates wired first.

## Licensing

- [x] All 8 directive-named limits real, seeded per plan, enforced via one Licensing Engine. *(`docs/LICENSING_ENGINE.md`)*
- [ ] **Disclosed limitation**: usage limits are checked per-company, not per-subscription, for a subscription spanning multiple companies. Acceptable for launch (no customer can span multiple companies on one subscription without Enterprise/Partner tiers, which are low-volume by nature), but should be fixed before it causes a real customer-facing inconsistency.

## Stripe

- [ ] **Blocking, external**: Vercel Marketplace terms acceptance — requires the account owner's own browser action. Not attempted via API bypass, by design (see `docs/STRIPE_PROVIDER.md`).
- [ ] Once accepted: `vercel integration add stripe --non-interactive` retry, provider implementation, webhook route, live test-mode verification — full sequence in `docs/STRIPE_PROVIDER.md`.

## Storage

- [x] One private Storage bucket (`documents`), path-prefixed RLS, created automatically by migration `0027`. *(`docs/DEPLOYMENT_GUIDE.md` §4, `docs/SECURITY_ARCHITECTURE.md`)*
- [x] Storage-usage limit enforcement wired into the one real upload path (`document-service.ts::uploadDocument`).

## Backups

- [x] Database: Supabase automatic daily backups + optional PITR. *(`docs/DEPLOYMENT_GUIDE.md` §12)*
- [ ] **Action**: confirm the actual retention window for the production plan tier before launch — this varies by plan and was never independently verified beyond "check the dashboard for your tier."

## Monitoring

- [x] Application-level: Operations Centre surfaces `system_events`/`operations_alerts` computed live from tables the app already writes. *(`docs/OPERATIONS_MANUAL.md`)*
- [ ] **Action, disclosed gap**: no external uptime monitoring exists — recommend a standard third-party checker (Vercel's own, or Better Stack/UptimeRobot) before launch, pointed at a real authenticated page, not just the root domain.
- [ ] **Action, disclosed gap**: no scheduler "dead man's switch" — if the cron trigger invoking `run-due-tasks` stops firing entirely (not an individual task failing, which *is* handled), nothing currently detects the silence. Recommend an external cron-monitoring check before launch, since trial-expiry/grace-period enforcement now depends on this Scheduler running daily.

## Alerts

- [x] `operations_alerts` fires automatically on automation-task retry exhaustion and Billing Event Bus critical events (`SubscriptionCancelled`→suspended, `PaymentFailed`, etc.). *(`docs/COMMERCIAL_OPERATIONS.md`, `docs/OPERATIONS_MANUAL.md`)*
- [ ] **Action, disclosed gap**: no APM/tracing in production — recommend Vercel Web Analytics/Speed Insights at minimum before launch.

## Support

- [x] `docs/SUPPORT_TROUBLESHOOTING_GUIDE.md` (LR1 Phase 5 deliverable) is complete — covers the known-issue list, common customer-reported symptoms mapped to their real root cause (including the now-fixed D-018/D-026/D-029 defects), and clear escalation triggers.
- [x] Internal Billing Console's Support Notes tab is real and working — staff can already record account-level notes, and now (post-D-029 fix) against the correct explicitly-selected account.

## Documentation

- [x] 19 architecture/reference documents exist and are cross-linked (`docs/ENTERPRISE_ARCHITECTURE.md`'s own index).
- [x] **LR1 Phase 5 complete**: all 6 customer/operator-facing guides written — `USER_GUIDE.md`, `ADMINISTRATOR_GUIDE.md`, `IMPLEMENTATION_GUIDE.md`, `CUSTOMER_ONBOARDING_GUIDE.md`, `SUPPORT_TROUBLESHOOTING_GUIDE.md`, `RELEASE_NOTES_V1.md` — each written against the product as verified during the audit, not its intended architecture, with known limitations disclosed inline rather than omitted.
- [ ] **Action**: stale reference counts in `docs/DEPLOYMENT_GUIDE.md`/`docs/SECURITY_ARCHITECTURE.md` (migration/table/permission counts, all predating the Commercial Billing Platform) — logged as a Defect Register item, not fixed inline in this pass.

## Training

- [ ] **Action**: no formal internal-staff training material exists beyond the reference documentation itself. `docs/ADMINISTRATOR_GUIDE.md` (Phase 5) is the closest substitute; a live walkthrough session is recommended before any pilot customer's onboarding, not something a document alone substitutes for.

## Disaster Recovery

- [x] Full procedure set exists for 6 failure modes (total Supabase loss, total hosting loss, credential compromise, database corruption/bad migration, Storage loss, scheduler failure) with real recovery steps. *(`docs/DISASTER_RECOVERY.md`)*
- [x] Recovery-time reasoning documented (not measured against a real disaster, explicitly labeled as such).

---

## Go/No-Go Criteria

**Hard blockers — must be resolved before ANY commercial launch**:
1. ~~Migrations `0045`-`0054` applied to the production database.~~ **Resolved — live-confirmed via Final Production Re-Certification** (all 19 tables exist, all 6 plans seeded, `0054`'s backfill ran, a real end-to-end company creation succeeded). See the note at the top of this document.
2. Stripe Marketplace terms accepted and the provider connected, live-verified. **Partially progressed**: Marketplace terms accepted and API keys registered on Vercel (Production + Development); the actual `StripeProvider` implementation is still not built, so this remains open.
3. Auth Email Templates and URL Configuration set for the real production domain.
4. SSL/DNS/production domain live (see External Dependencies).

**Should be resolved before launch, not hard blockers**:
5. External uptime monitoring and scheduler dead-man's-switch in place (trial expiry now depends on the Scheduler running daily).
6. A live adversarial RLS pass against the new Billing Platform tables, mirroring the rigor already applied to the rest of the schema — now genuinely possible since the tables exist; still not done.
7. ~~`docs/SUPPORT_TROUBLESHOOTING_GUIDE.md` exists.~~ **Done** — see Support section above.
8. Register the three Supabase environment variables on Vercel for the **Preview** environment — Production and Development are done; Preview hit a CLI quirk (`vercel env add ... preview --value ... --yes` returned `action_required` despite following its own suggested non-interactive syntax) and was not forced through.

**Decided at the RC1 freeze review, deferred — not an RC1 blocker**:
9. Whether to decouple Billing Activation from Company Creation (`docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md`). **Accepted in principle, deferred to Version 1.1 — ADR-001 (`docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`).** RC1's certified workflow is unchanged. D-032's live trigger condition is now resolved (see Billing section), but the underlying architectural finding and the v1.1 deferral both stand — this was not a reason to revisit the freeze decision.

**Resolved during LR1, no longer open**:
- The 4 Critical defects found in Phase 1 of the audit (pre-existing companies with no subscription record; broken duplicate-merge action; support notes writable against the wrong billing account; fabricated placeholder activity data on the Platform Dashboard) are fixed and verified. See `docs/DEFECT_REGISTER.md`.
- All 6 Phase 5 documentation guides are complete.

**Resolved during the Pre-Launch Blockers pass, no longer open**:
- Login page full-bleed layout (D-045), `/platform` crash for admins with real companies (D-048), dead Financial Workspace controls (D-034/D-043/D-047), and misleading duplicate-anchor Platform nav items (D-046) — all fixed and verified. See `docs/DEFECT_REGISTER.md`.
- The three diagnostic companies created while verifying the pilot administrator account have been safely removed; zero orphaned records confirmed across every table they touched.
- The pilot administrator account (`info@vyronsoft.co.za`) is created and verified: Platform Super Administrator and Organisation Owner both confirmed live; Company Owner was proven achievable through the real Create Company flow during verification but is not currently held (its grant was scoped to the diagnostic companies, now removed) — will be re-established the first time this account creates a real, non-diagnostic company.

**Resolved during Final Production Re-Certification, no longer open**:
- Migrations `0045`-`0054` applied and functioning — confirmed by table existence, plan seeding, and a full live company-creation test (`201`, real trial subscription, real billing event, real chart of accounts), not by inference.
- D-018/D-028 (AI Copilot licensing gate) re-confirmed resolved with a real, current live test (`200`, not just historical evidence from the earlier fix).
- Platform Overview confirmed rendering real billing data (plan tier, lifecycle state) rather than the degraded-but-safe fallback the earlier resilience fix (D-048) added.
- The diagnostic company created for this re-certification has been safely removed; zero orphaned records confirmed.
- Supabase environment variables restored to `.env.local` (merged, not overwritten — a prior incident during Stripe provisioning had wiped them, see `docs/DEPLOYMENT_GUIDE.md`'s Environment Recovery section) and registered on Vercel for Production and Development.

**Acceptable to launch with, tracked as known limitations**:
10. 8 of 10 feature flags not yet gated in any route.
11. Per-company (not per-subscription) usage-limit scoping.
12. No off-platform Storage backup.
13. Stale reference counts in 2 operational docs (Defect Register, Low priority).
14. D-032's architectural finding (non-atomic Company Creation / Billing writes) — its live trigger condition (missing tables) is resolved, but the underlying non-atomic write sequence is unchanged and could still fail under a different transient error; deferred to Version 1.1 per ADR-001.
15. Preview-environment Supabase variables not registered on Vercel (CLI quirk, item 8 above) — Production and Development are correctly registered.
16. The remaining High/Medium/Low/Nice-to-have findings from the LR1 audit not called out above, deliberately not fixed per the Product Review Board's own "do not fix everything, prioritise" instruction — full list and rationale in `docs/DEFECT_REGISTER.md`.

Full evidence and reasoning for every item above: `docs/COMMERCIAL_BILLING_CERTIFICATION_REPORT.md`, `docs/DEFECT_REGISTER.md`, `docs/PRODUCT_AUDIT_MATRIX.md`, `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md`, `docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`, and the pre-existing `docs/SECURITY_ARCHITECTURE.md`/`docs/DEPLOYMENT_GUIDE.md`/`docs/DISASTER_RECOVERY.md`/`docs/OPERATIONS_MANUAL.md`.

See `docs/RELEASE_PACKAGE.md` for the formal Release Candidate 1 status and package contents.
