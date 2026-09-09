# ADR-001 — Decouple Billing Activation from Company Creation

## Status

**Accepted in principle. Not approved for implementation in RC1. Scheduled for Version 1.1.**

Approved by the Product Review Board during the Release Candidate 1 freeze review. The certified RC1 workflow (`Create Company → Create Billing → Company Complete`) is unchanged and must not be modified before or during RC1.

## Context

A dedicated architecture review — `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md` — was commissioned to evaluate whether Billing should remain a hard, synchronous dependency of Company Creation. The review was prompted by a live-observed failure during pilot administrator account verification: `POST /api/companies`, retried after a billing-step failure, produced three duplicate, fully-RBAC'd companies with no subscription — the exact failure mode already predicted, in the abstract, by `docs/DEFECT_REGISTER.md` D-032 ("non-atomic multi-step billing writes... a company created with no billing subscription at all").

The review compared the current architecture against a proposed two-phase alternative (`Create Company → Company Operational → Billing Activation`) across reliability, failure recovery, customer onboarding, operational resilience, multi-tenant consistency, commercial requirements, and user experience, and recommended adopting the proposed architecture — implemented as a near-synchronous, retryable, monitored step rather than an indefinite deferral, preserving the "every company must eventually be billed" invariant via a scheduled sweep.

## Decision

The Board accepts the review's technical recommendation but defers its implementation to **Version 1.1**, for two reasons stated at the freeze review:

1. RC1's certified workflows (Phase 2 of the Launch Readiness Programme, `docs/WORKFLOW_CERTIFICATION.md`) must not be modified after certification without re-running certification — the Board's standing instruction is "no architectural refactoring" once frozen.
2. The current architecture's failure mode is triggered by an already-disclosed external dependency (Billing Platform migrations `0045`-`0054` not yet applied to production) rather than a defect reachable under normal RC1 operating conditions once that dependency is resolved. It is a real, logged, open finding (D-032) — not an RC1 release blocker.

**Until Version 1.1 ships this change, `company-service.ts::createCompany` remains a single synchronous chain, and D-032 remains open in `docs/DEFECT_REGISTER.md`.**

## Consequences

- Company Creation cannot complete successfully in any environment where the Billing Platform migrations are not yet applied — this is expected and disclosed (`docs/LAUNCH_CHECKLIST.md`), not a regression.
- A retry of a failed company-creation request is not idempotent and can produce duplicate companies until this ADR is implemented. Support and operations staff should be aware of this when assisting a customer through a failed signup (see `docs/SUPPORT_TROUBLESHOOTING_GUIDE.md`).
- Version 1.1 planning should carry forward `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md`'s migration path in full: split `createCompany`, add a `BillingActivationSweep` automation task mirroring the existing `SubscriptionLifecycleSweep` precedent, and update the Customer Portal / Platform Overview to represent the "Operational, billing pending" state honestly.
- No code, schema, or migration change accompanies this ADR. It is a decision record only.

## Related

- `docs/ARCHITECTURE_REVIEW_COMPANY_BILLING.md` — full evaluation, migration path, advantages/disadvantages, rollout strategy.
- `docs/DEFECT_REGISTER.md` D-032 — the underlying defect this ADR addresses (remains open).
- `docs/LAUNCH_CHECKLIST.md` — Billing section, Go/No-Go item 8.
