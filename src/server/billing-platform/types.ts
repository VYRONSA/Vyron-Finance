/**
 * Domain types for the Commercial Billing, Licensing & Subscription
 * Platform. See `supabase/migrations/0045`-`0050` and
 * `docs/BILLING_ARCHITECTURE.md`. This is the one place every named key
 * (plan tier, billing cycle, lifecycle status, limit, feature) is
 * defined — engines, repositories, and UI all import from here rather
 * than re-typing string literals.
 */

export const PLAN_KEYS = ["free_trial", "starter", "professional", "enterprise", "partner", "internal"] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const BILLING_CYCLES = ["monthly", "quarterly", "annual", "custom"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const LIMIT_KEYS = [
  "max_users", "max_companies", "max_storage_mb", "max_documents",
  "max_ai_requests_monthly", "max_automation_runs_monthly",
  "max_api_calls_monthly", "max_integrations",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const FEATURE_KEYS = [
  "ai_copilot", "auditor_workspace", "automation", "fixed_assets", "inventory",
  "manufacturing_integration", "advanced_reporting", "document_platform",
  "communication_platform", "operations_centre",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const SUBSCRIPTION_STATUSES = [
  "trial", "active", "past_due", "grace_period", "suspended", "cancelled", "expired", "archived",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** The directive's own named Company Lifecycle, mapped 1:1 onto
 * `SubscriptionStatus` (PascalCase for display) — "company lifecycle is
 * a derived read of its one governing subscription," so there is no
 * separate state machine here. `Subscribed`/`Reactivated`, the two
 * directive-named states with no steady-state equivalent, are one-time
 * transition EVENTS instead (logged to `subscription_status_history`,
 * surfaced as a notification) — see `company-lifecycle-engine.ts`'s own
 * docstring. `getCompanyLifecycleState()` only ever returns one of the
 * 8 steady states below. */
export const COMPANY_LIFECYCLE_STATES = ["Trial", "Active", "PastDue", "GracePeriod", "Suspended", "Cancelled", "Expired", "Archived"] as const;
export type CompanyLifecycleState = (typeof COMPANY_LIFECYCLE_STATES)[number];

/** Event-metered — no permanent row exists to count, so these are
 * incremented over time into `usage_period_counters` via
 * `fn_record_usage_event` (migration `0047`, CHECK-constrained list
 * corrected by `0051` — see that migration's header for why
 * `active_users`/`storage_mb`/`documents` moved OUT of this set). */
export const METERED_USAGE_KEYS = [
  "communications", "automation_runs", "ai_requests", "api_requests",
  "bank_imports", "reports_generated", "forecasts", "financial_statements", "scheduled_jobs",
] as const;
export type MeteredUsageKey = (typeof METERED_USAGE_KEYS)[number];

/** Live-counted directly against the real owning table on every read
 * (a `count(*)`/`sum()` query, aggregate-first — same discipline this
 * session already had to apply to banking automation) — never
 * incremented/stored, so these can never drift from reality the way a
 * manually-maintained counter could (e.g. a deleted document silently
 * leaving `storage_mb` too high forever). */
export const LIVE_COUNTED_USAGE_KEYS = [
  "companies", "users", "customers", "suppliers", "inventory_items", "assets", "documents", "storage_mb",
] as const;
export type LiveCountedUsageKey = (typeof LIVE_COUNTED_USAGE_KEYS)[number];

export const USAGE_METRIC_KEYS = [...METERED_USAGE_KEYS, ...LIVE_COUNTED_USAGE_KEYS] as const;
export type UsageMetricKey = (typeof USAGE_METRIC_KEYS)[number];

export const BILLING_PROVIDERS = ["stripe", "manual", "migrated"] as const;
export type BillingProviderName = (typeof BILLING_PROVIDERS)[number];

/** The Billing Event Bus's fixed event catalog — "every significant
 * billing action must publish a business event." See
 * `src/server/billing-platform/events/billing-event-bus.ts`. */
export const BILLING_EVENT_TYPES = [
  "SubscriptionCreated", "SubscriptionChanged", "SubscriptionCancelled", "TrialStarted", "TrialExpired",
  "PaymentReceived", "PaymentFailed", "RefundIssued", "CreditApplied", "InvoiceGenerated",
  "SeatIncreased", "FeatureEnabled", "FeatureDisabled",
] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

export type BillingEvent = {
  id: number;
  companyId: string | null;
  eventType: BillingEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type SubscriptionPlan = {
  id: number;
  planKey: PlanKey;
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
};

export type SubscriptionPlanPrice = {
  id: number;
  planId: number;
  billingCycle: BillingCycle;
  currencyCode: string;
  unitAmount: number;
  isActive: boolean;
  providerPriceId: string | null;
  createdAt: string;
};

export type SubscriptionPlanEntitlement = {
  id: number;
  planId: number;
  limitKey: LimitKey;
  limitValue: number | null; // null = unlimited
};

export type FeatureFlagDefinition = {
  id: number;
  featureKey: FeatureKey;
  name: string;
  description: string;
  createdAt: string;
};

export type SubscriptionPlanFeature = {
  id: number;
  planId: number;
  featureId: number;
  isEnabled: boolean;
};

export type BillingAccount = {
  id: string;
  organisationId: string;
  billingEmail: string;
  billingContactName: string;
  taxNumber: string;
  billingAddress: string;
  defaultCurrencyCode: string;
  providerCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Subscription = {
  id: string;
  billingAccountId: string;
  planId: number;
  billingCycle: BillingCycle;
  currencyCode: string;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  gracePeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  trialWarningSentAt: string | null;
  provider: BillingProviderName;
  providerSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionStatusHistoryEntry = {
  id: number;
  subscriptionId: string;
  fromStatus: SubscriptionStatus | null;
  toStatus: SubscriptionStatus;
  reason: string;
  performedBy: string;
  occurredAt: string;
};

export type SubscriptionCompanyLink = {
  id: number;
  subscriptionId: string;
  companyId: string;
  addedAt: string;
};

export type CompanyFeatureOverride = {
  id: number;
  companyId: string;
  featureId: number;
  isEnabled: boolean;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type UsagePeriodCounter = {
  id: number;
  companyId: string;
  metricKey: UsageMetricKey;
  periodStart: string;
  counterValue: number;
  updatedAt: string;
};

export type Entitlements = {
  planKey: PlanKey;
  limits: Record<LimitKey, number | null>;
};

export type UsageLimitCheck = {
  allowed: boolean;
  limit: number | null;
  used: number;
  reason?: string;
};

export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

export type Invoice = {
  id: string;
  billingAccountId: string;
  subscriptionId: string | null;
  invoiceNumber: string;
  status: InvoiceStatus;
  currencyCode: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  provider: BillingProviderName;
  providerInvoiceId: string | null;
  createdAt: string;
};

export type InvoiceLine = {
  id: number;
  invoiceId: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  lineOrder: number;
};

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded" | "partially_refunded";

export type Payment = {
  id: string;
  billingAccountId: string;
  invoiceId: string | null;
  status: PaymentStatus;
  amount: number;
  currencyCode: string;
  failureReason: string | null;
  provider: BillingProviderName;
  providerPaymentId: string | null;
  createdAt: string;
};

export type Refund = {
  id: string;
  paymentId: string;
  amount: number;
  reason: string;
  status: "pending" | "succeeded" | "failed";
  provider: BillingProviderName;
  providerRefundId: string | null;
  performedBy: string;
  createdAt: string;
};

export type BillingCredit = {
  id: string;
  billingAccountId: string;
  amount: number;
  currencyCode: string;
  reason: string;
  appliedToInvoiceId: string | null;
  performedBy: string;
  createdAt: string;
};

export type BillingProviderConnectionStatus = "Not Connected" | "Connected" | "Error";

export type BillingProviderConnection = {
  id: number;
  providerName: "stripe";
  status: BillingProviderConnectionStatus;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  notes: string;
  createdAt: string;
};

export type BillingWebhookEventStatus = "received" | "processed" | "failed" | "ignored" | "duplicate";

export type BillingWebhookEvent = {
  id: number;
  provider: string;
  providerEventId: string;
  eventType: string;
  status: BillingWebhookEventStatus;
  payload: unknown;
  signatureVerified: boolean;
  receivedAt: string;
  processedAt: string | null;
  errorMessage: string | null;
  retryCount: number;
};

export type BillingSupportNote = {
  id: number;
  billingAccountId: string;
  note: string;
  createdBy: string;
  createdAt: string;
};
