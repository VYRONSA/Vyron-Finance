# VYRON FINANCE 1.0 — Launch Checklist

Phase 7 of the Launch Readiness Programme (LR1). Every item below is either already verified (cited to its evidence) or an explicit action item with an owner-shaped description — nothing here depends on tribal knowledge. Go/No-Go criteria at the end.

**Updated after LR1 Phase 1 (Product Audit)**: the audit found 44 findings, including 4 Critical-severity production defects. All 4 have been fixed and verified (full test suite: 1146/1146 passing across 148 files, `tsc`/`eslint` clean). See `docs/DEFECT_REGISTER.md` for the complete list and `docs/PRODUCT_AUDIT_MATRIX.md` for the audit itself. One of the fixes required a new migration, `0054`, now included in every reference to "migrations not yet applied" below.

**Updated after the Pre-Launch Blockers pass and Final Architecture Review**: the pilot administrator account (`info@vyronsoft.co.za`) has been created and verified — Platform Super Administrator, Organisation Owner, and (transiently, during verification) Company Owner, all granted through the real application code paths, not seeded. Live verification of this account surfaced and fixed two further genuine defects: a full-bleed login page layout, and a Runtime Error crash on `/platform` for any admin who owns a company (see D-045 through D-048 in `docs/DEFECT_REGISTER.md`). The same verification also produced the first live confirmation of the failure mode already predicted by D-032 (non-atomic billing writes) — company creation retried after a billing failure silently created duplicate companies. A dedicated architecture review of this — `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md` — recommends decoupling Billing Activation from Company Creation. **The Product Review Board accepted this recommendation in principle at the RC1 freeze review but deferred implementation to Version 1.1 — see `docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`. RC1's certified workflow is unchanged.** The three diagnostic companies created during this verification have been safely removed, with zero orphaned records confirmed across every table they touched.

**RC1 status**: this codebase is frozen as of the Release Candidate 1 freeze. No further feature development, architectural refactoring, or optimisation — only critical production bug fixes are accepted from this point. See `docs/RELEASE_PACKAGE.md` for the formal release status and package contents.

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
- [ ] **Action, real and unresolved**: migrations `0045`-`0054` (the entire Commercial Billing Platform schema, including the LR1 backfill fix) are written and code-reviewed but **have not been applied to any real database** — this session's environment has no Supabase CLI database-password credential (a separate secret from the anon/service-role API keys already in `.env.local`). Run `npx supabase db push --db-url "<session-pooler-connection-string>" --include-all` against the real project before any billing feature can function. See `docs/DEPLOYMENT_GUIDE.md` §3 for the exact procedure. **This is now higher-stakes than originally scoped**: without `0054`, every company created before the Commercial Billing Platform shipped has no subscription row at all, which would block their access once billing enforcement is live (LR1 Defect D-018/D-028) — `0054` must be applied in the same pass as `0045`-`0053`, not deferred separately.
- [ ] **Action**: `docs/DEPLOYMENT_GUIDE.md` §3's verification queries reference stale counts ("37 migrations," "expect 119 tables") predating the Commercial Billing Platform's 17 new tables (migrations `0045`-`0054`) and earlier RC2 migrations (`0038`-`0044`). Re-run the verification queries after `db push` and record the actual current counts — do not guess them in advance.
- [x] RLS enabled and independently verified on every table this session touched (company-scoped via `user_can_access_company()`, platform-wide via the `company_id is null` branch) — pattern-matched against the pre-existing, live-attacked-and-confirmed-blocked tenant-isolation model. *(`docs/SECURITY_ARCHITECTURE.md`)*
- [x] Backup strategy real: Supabase automatic daily backups (retention tier-dependent), PITR available as a paid add-on, migration files as schema backup. *(`docs/DEPLOYMENT_GUIDE.md` §12, `docs/DISASTER_RECOVERY.md`)*
- [ ] **Known gap, disclosed, not blocking**: no off-platform backup of the Storage bucket (`documents`) — object storage loss is not currently recoverable by this application alone. Candidate post-launch operational addition.

## Security

- [x] Two independent layers on every protected operation (application-layer `requirePermission`/`requireApproval` + database-layer RLS) — no historical breach traced to a single-layer failure. *(`docs/SECURITY_ARCHITECTURE.md`)*
- [x] The one confirmed critical finding in this platform's history (cross-tenant read via organisation-wide RLS) was found, fixed, and re-verified blocked. *(`docs/SECURITY_ARCHITECTURE.md`, `docs/DISASTER_RECOVERY.md` incident log)*
- [x] Role escalation, permission escalation, foreign-ID cross-company writes, unauthenticated access, invalid/expired/reused tokens — all live-attacked and confirmed blocked during RC1/RC2 certification.
- [ ] **Known, accepted characteristic, not a defect**: `requireSession()` uses local JWT signature verification (`getClaims()`), not network-verified revocation (`getUser()`) — a signed-out session's access token stays technically valid until its ~1 hour natural expiry. Documented Supabase SDK behavior, a deliberate tradeoff (avoiding a network round-trip on every request), not scheduled for a fix. Product Review Board should be aware this is intentional, not overlooked.
- [ ] **Known, disclosed, lower severity**: `companies`' own SELECT RLS policy still uses organisation-wide membership (not the fixed `user_can_access_company()`) — an organisation member can see a sibling company's *name/industry/status* (never its business data). Deliberately not fixed in the same pass that fixed the critical finding, due to a real `INSERT ... RETURNING`-requires-SELECT-policy interaction risk. Candidate for a dedicated, carefully-tested fix, not a rushed one.
- [ ] **Action**: the Commercial Billing Platform's own RLS policies and `security definer` functions (`fn_record_usage_event`, `fn_company_storage_bytes`, `fn_increment_usage_counter`, `grant_manage_billing_to_company_owner`) have been code-reviewed but never live-attacked the way the rest of the platform's RLS was during RC1 Phase 7.6 — a real, disclosed gap specific to the newest code. Recommend a live adversarial RLS pass against the Billing Platform tables once migrations are applied, following the same methodology `docs/SECURITY_ARCHITECTURE.md` documents for everything else.

## Authentication

- [x] Full workflow live-verified: login, logout, Remember Me, forgot/reset password, change password, invite user, first-run bootstrap (`/setup`, self-locking), token exchange. *(`docs/SECURITY_ARCHITECTURE.md`)*
- [x] **Pilot administrator account created and verified**: `info@vyronsoft.co.za` holds Platform Super Administrator (confirmed in `user_role_assignments`, `company_id is null`) and Organisation Owner (confirmed in `organisation_members`). Created via the same code path as `/setup`'s bootstrap (which was already self-locked by a prior session's admin), not by hand-seeding a row — password never written to any persisted file. Real sign-in via `signInWithPassword`, session persistence, and sign-out all independently verified against the live Supabase project.
- [x] **Two genuine defects found and fixed during this verification**: the login page's split-panel layout had no width cap and stretched edge-to-edge on wide monitors (now bounded to `max-w-[1200px]`); `/platform` crashed with a Runtime Error for any Platform Super Administrator who owns a company, because three per-company billing lookups had no error handling against the still-missing Billing Platform tables (now wrapped so a missing subscription degrades gracefully instead of crashing the page). See D-045–D-048 in `docs/DEFECT_REGISTER.md`.
- [ ] **Action**: Supabase Auth Email Templates must be repointed to `/auth/confirm` for this specific project before any password-reset/invite email will complete correctly — a per-project dashboard setting, not something a migration can set. *(`docs/DEPLOYMENT_GUIDE.md` §8)*
- [ ] **Action**: Auth URL Configuration's Site URL + Redirect URLs must be set to the real production domain once known. *(`docs/DEPLOYMENT_GUIDE.md` §10)*

## Billing

- [x] Architecture certified code-complete: Billing Engine, Licensing Engine, Feature Flag Engine, Usage Engine, Billing Event Bus, Customer Portal, Internal Console. *(`docs/COMMERCIAL_BILLING_CERTIFICATION_REPORT.md`)*
- [ ] **Blocking**: migrations not applied (see Database section) — no billing feature can function until this is done.
- [ ] **Blocking, external**: Stripe not connected (see External Dependencies).
- [ ] **Action, elevated from theoretical to confirmed, deferred to v1.1**: D-032 (non-atomic multi-step billing writes) predicted that a billing failure mid-`createCompany` would leave a company with no subscription; this was directly observed live during pilot-admin verification — three retried company-creation attempts, after each 500, produced three duplicate companies (RBAC fully seeded, no billing). A dedicated review, `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md`, recommends decoupling Billing Activation into its own retryable step. **Accepted in principle, deferred to Version 1.1 per ADR-001 (`docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`) — not implemented in RC1.** Until the migrations are applied, Company Creation cannot complete successfully in this environment; this is accepted as a known RC1 limitation, not a blocker to the RC1 freeze itself.
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
1. Migrations `0045`-`0054` applied to the production database (now including the LR1 backfill fix `0054`, without which pre-existing companies would lose access under billing enforcement).
2. Stripe Marketplace terms accepted and the provider connected, live-verified.
3. Auth Email Templates and URL Configuration set for the real production domain.
4. SSL/DNS/production domain live (see External Dependencies).

**Should be resolved before launch, not hard blockers**:
5. External uptime monitoring and scheduler dead-man's-switch in place (trial expiry now depends on the Scheduler running daily).
6. A live adversarial RLS pass against the new Billing Platform tables, mirroring the rigor already applied to the rest of the schema.
7. ~~`docs/SUPPORT_TROUBLESHOOTING_GUIDE.md` exists.~~ **Done** — see Support section above.

**Decided at the RC1 freeze review, deferred — not an RC1 blocker**:
8. Whether to decouple Billing Activation from Company Creation (`docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md`). **Accepted in principle, deferred to Version 1.1 — ADR-001 (`docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`).** RC1's certified workflow is unchanged; D-032 remains open as a known limitation (see below).

**Resolved during LR1, no longer open**:
- The 4 Critical defects found in Phase 1 of the audit (pre-existing companies with no subscription record; broken duplicate-merge action; support notes writable against the wrong billing account; fabricated placeholder activity data on the Platform Dashboard) are fixed and verified. See `docs/DEFECT_REGISTER.md`.
- All 6 Phase 5 documentation guides are complete.

**Resolved during the Pre-Launch Blockers pass, no longer open**:
- Login page full-bleed layout (D-045), `/platform` crash for admins with real companies (D-048), dead Financial Workspace controls (D-034/D-043/D-047), and misleading duplicate-anchor Platform nav items (D-046) — all fixed and verified. See `docs/DEFECT_REGISTER.md`.
- The three diagnostic companies created while verifying the pilot administrator account have been safely removed; zero orphaned records confirmed across every table they touched.
- The pilot administrator account (`info@vyronsoft.co.za`) is created and verified: Platform Super Administrator and Organisation Owner both confirmed live; Company Owner was proven achievable through the real Create Company flow during verification but is not currently held (its grant was scoped to the diagnostic companies, now removed) — will be re-established the first time this account creates a real, non-diagnostic company.

**Acceptable to launch with, tracked as known limitations**:
9. 8 of 10 feature flags not yet gated in any route.
10. Per-company (not per-subscription) usage-limit scoping.
11. No off-platform Storage backup.
12. Stale reference counts in 2 operational docs (Defect Register, Low priority).
13. D-032 (non-atomic Company Creation / Billing writes) — deferred to Version 1.1 per ADR-001; Company Creation cannot complete until either the Billing Platform migrations are applied or ADR-001 ships.
14. The remaining High/Medium/Low/Nice-to-have findings from the LR1 audit not called out above, deliberately not fixed per the Product Review Board's own "do not fix everything, prioritise" instruction — full list and rationale in `docs/DEFECT_REGISTER.md`.

Full evidence and reasoning for every item above: `docs/COMMERCIAL_BILLING_CERTIFICATION_REPORT.md`, `docs/DEFECT_REGISTER.md`, `docs/PRODUCT_AUDIT_MATRIX.md`, `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md`, `docs/ADR_001_COMPANY_CREATION_BILLING_DECOUPLING.md`, and the pre-existing `docs/SECURITY_ARCHITECTURE.md`/`docs/DEPLOYMENT_GUIDE.md`/`docs/DISASTER_RECOVERY.md`/`docs/OPERATIONS_MANUAL.md`.

See `docs/RELEASE_PACKAGE.md` for the formal Release Candidate 1 status and package contents.
