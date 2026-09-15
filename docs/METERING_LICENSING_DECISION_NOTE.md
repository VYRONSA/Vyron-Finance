# AI Metering and Licensing — Decision Note

Status: **for decision. Nothing in this note is implemented.** The AI safety change (migration 0099) deliberately leaves customer metering, quotas, free-trial policy, subscription enforcement and automation limits as they are. It adds only an internal provider-request metric and an internal daily safety fuse (see `AI_CLASSIFICATION_SAFETY.md`).

## 1. What happens today

These findings come from the code and a read-only production investigation on 2026-09-15.

| Area | Current behaviour |
|---|---|
| What counts as an "AI request" (`ai_requests`) | Recorded only when an AI **suggestion is saved** (`transaction-classification-service.ts`). No-confidence answers, provider failures and invalid answers are provider calls, but are not metered. |
| How usage is recorded | `fn_record_usage_event` (migration 0047) is security definer and first checks `user_can_access_company(company)`, which needs a signed-in user (`auth.uid()`). |
| Unattended paths | The scheduler (cron) runs with the service role, so there is no `auth.uid()` and `fn_record_usage_event` **raises**. Callers swallow the error (`.catch(() => {})`). As a result, AI suggestions saved by the sweep, and `automation_runs`, are **never metered** in unattended runs. |
| Plan limits (`plan_limits`, 0045) | `max_ai_requests_monthly`: free_trial 50, starter 200, professional 2,000, partner 5,000, enterprise and internal unlimited. `max_automation_runs_monthly` exists too. |
| Where the AI limit is checked | Only the manual bulk "Classify with AI" route (`hasFeature(ai_copilot)`, then `checkUsageLimit(max_ai_requests_monthly)`, which caps the batch). The automatic sweep and post-import classification do not check the AI feature or the AI limit. |
| Automation limit | Checked by the scheduler against `max_automation_runs_monthly`. Because `automation_runs` is never recorded in cron, the check never trips. |
| Subscription status | Feature grants follow the plan, not the subscription status. An expired trial (Northwood) still has `automation` granted. |
| Provider spend | No AI Gateway budget or spend limit is configured. Production made about 75,865 gateway requests between 2026-09-01 and 09-15 (about $15). |

## 2. What migration 0099 adds, and does not

- **Internal metric `ai_provider_requests`.** Every real provider request is counted, whatever the outcome. It is recorded by `fn_record_internal_usage_event` (service role only), so unattended runs are counted too. It is not a customer metric and no plan limit reads it.
- **Internal fuse.** 100 provider requests per company per UTC day. It is a safety cap, not a quota.
- **Not changed:** `fn_record_usage_event`, `ai_requests` metering, plan limits, trial and subscription enforcement, `automation_runs`.

## 3. Decisions needed

### D1. What is a billable AI request?

**Options:**
- (a) a saved suggestion — today
- (b) every provider request — equals `ai_provider_requests`
- (c) every transaction attempt that produced an answer (b minus failures)

**Trade-off:** (b) matches VYRON's real cost. Failures VYRON caused itself, such as the old re-ask loop, should not be charged to the customer — the new queue makes that far less likely. (a) is customer-friendly but lets unbounded free calls through, which is exactly the loop that happened.

**Suggested:** (c) for the customer quota, with (b) kept as the internal cost metric.

### D2. Do automatic paths (sweep, post-import) count against the plan quota?

**Today:** no check, and no working metering.

**Options:**
- (a) count and enforce: stop automatic classification when the quota is reached
- (b) count but do not enforce for automatic paths
- (c) exclude automatic paths

**Suggested:** (a), because the plan limit becomes the real ceiling. The internal fuse remains a safety net for plans with a high or unlimited quota.

### D3. Fix metering for unattended (service-role) callers

`fn_record_usage_event` cannot work in cron as written.

**Options:**
- (a) a separate service-role-only function for system-recorded customer metrics, mirroring `fn_record_internal_usage_event`
- (b) let `fn_record_usage_event` accept the service role (`auth.role() = 'service_role'`)

**Suggested:** (a). The user-facing function keeps its tenant check untouched, and system recording is a separately auditable privilege. Also stop silently swallowing metering errors: log them, or raise one de-duplicated alert.

### D4. Should expired trials and inactive subscriptions keep automation and AI?

**Today:** yes, because grants ignore subscription status.

**Decide:**
- whether expiry removes `automation` and `ai_copilot`
- whether there is a grace period
- what happens to tasks that were already scheduled — for example, suspend them with a reason, or pause them

### D5. How does the internal fuse relate to plan quotas?

The fuse is per day (100) and quotas are per month (for example, free trial 50).

**Decide:**
- whether the fuse should be derived from the plan (for example, the monthly quota divided by a burst factor)
- whether the fuse stays a fixed global safety net
- who may raise it for a specific company, and how that is audited

### D6. Provider spend controls

**Recommended regardless of D1–D5:** configure an AI Gateway budget or alert at the Vercel level. A second, independent safety net costs nothing to add.

### D7. Customer visibility

**Decide:**
- whether the Usage tab shows AI requests
- whether it shows the attempt history (`ai_classification_attempts` is already member-readable under RLS)
- whether a customer sees "needs human review" counts

### D8. Historical usage

The sweep made about 11,000 calls a day in early September and none of them were metered.

**Suggested:** no backfill. Any fix applies from its deployment date.

## 4. Suggested order

1. **D6:** gateway budget, an operational setting with no code change.
2. **D3:** make system metering work, keeping enforcement as it is.
3. **D1 and D2:** define the billable unit and whether automatic paths are enforced. Communicate this before enforcing.
4. **D4:** trial and subscription enforcement.
5. **D5 and D7:** tune the fuse and expose usage.

Each step needs its own approval and tests. None is part of the AI safety change.
