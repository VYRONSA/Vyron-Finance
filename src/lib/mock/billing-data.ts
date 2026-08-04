/**
 * Preview Mode seed data for the Commercial Billing Platform's Customer
 * Portal. Field shapes match the real domain types
 * (`src/server/billing-platform/types.ts`) exactly. Depicts a company
 * mid-trial — the one real, working end-to-end state this session could
 * fully build and verify without a connected Stripe account (see
 * `docs/MIGRATION_ROADMAP.md`'s Commercial Billing Platform section).
 */

import { MOCK_COMPANY } from "./financial-data";
import type {
  BillingAccount, BillingCredit, BillingEvent, Entitlements, Invoice, Payment, Subscription, SubscriptionPlan,
  SubscriptionPlanPrice, CompanyLifecycleState, UsageMetricKey,
} from "@/server/billing-platform/types";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_BILLING_PLANS: SubscriptionPlan[] = [
  { id: 1, planKey: "free_trial", name: "Free Trial", description: "Full-featured evaluation period before choosing a paid plan.", isActive: true, sortOrder: 0, createdAt: "2025-01-01T00:00:00Z" },
  { id: 2, planKey: "starter", name: "Starter", description: "For a single company getting started with core accounting.", isActive: true, sortOrder: 1, createdAt: "2025-01-01T00:00:00Z" },
  { id: 3, planKey: "professional", name: "Professional", description: "Multi-company accounting with automation and intelligence.", isActive: true, sortOrder: 2, createdAt: "2025-01-01T00:00:00Z" },
  { id: 4, planKey: "enterprise", name: "Enterprise", description: "Full platform, highest limits, dedicated support.", isActive: true, sortOrder: 3, createdAt: "2025-01-01T00:00:00Z" },
];

export const MOCK_BILLING_PLAN_PRICES: SubscriptionPlanPrice[] = [
  { id: 1, planId: 1, billingCycle: "monthly", currencyCode: "ZAR", unitAmount: 0, isActive: true, providerPriceId: null, createdAt: "2025-01-01T00:00:00Z" },
  { id: 2, planId: 2, billingCycle: "monthly", currencyCode: "ZAR", unitAmount: 450, isActive: true, providerPriceId: null, createdAt: "2025-01-01T00:00:00Z" },
  { id: 3, planId: 2, billingCycle: "annual", currencyCode: "ZAR", unitAmount: 4590, isActive: true, providerPriceId: null, createdAt: "2025-01-01T00:00:00Z" },
  { id: 4, planId: 3, billingCycle: "monthly", currencyCode: "ZAR", unitAmount: 950, isActive: true, providerPriceId: null, createdAt: "2025-01-01T00:00:00Z" },
  { id: 5, planId: 3, billingCycle: "annual", currencyCode: "ZAR", unitAmount: 9690, isActive: true, providerPriceId: null, createdAt: "2025-01-01T00:00:00Z" },
  { id: 6, planId: 4, billingCycle: "monthly", currencyCode: "ZAR", unitAmount: 2400, isActive: true, providerPriceId: null, createdAt: "2025-01-01T00:00:00Z" },
  { id: 7, planId: 4, billingCycle: "annual", currencyCode: "ZAR", unitAmount: 24480, isActive: true, providerPriceId: null, createdAt: "2025-01-01T00:00:00Z" },
];

export const MOCK_BILLING_ACCOUNT: BillingAccount = {
  id: "ba_1",
  organisationId: "org_1",
  billingEmail: "accounts@harlowretail.co.za",
  billingContactName: "Priya Shah",
  taxNumber: "",
  billingAddress: "",
  defaultCurrencyCode: "ZAR",
  providerCustomerId: null,
  createdAt: "2026-06-01T09:00:00Z",
  updatedAt: "2026-06-01T09:00:00Z",
};

export const MOCK_SUBSCRIPTION: Subscription = {
  id: "sub_1",
  billingAccountId: "ba_1",
  planId: 1,
  billingCycle: "monthly",
  currencyCode: "ZAR",
  status: "trial",
  trialEndsAt: "2026-08-15T09:00:00Z",
  currentPeriodStart: "2026-06-01T09:00:00Z",
  currentPeriodEnd: "2026-08-15T09:00:00Z",
  gracePeriodEndsAt: null,
  cancelAtPeriodEnd: false,
  cancelledAt: null,
  trialWarningSentAt: null,
  provider: "manual",
  providerSubscriptionId: null,
  createdAt: "2026-06-01T09:00:00Z",
  updatedAt: "2026-06-01T09:00:00Z",
};

export const MOCK_COMPANY_LIFECYCLE_STATE: CompanyLifecycleState = "Trial";

export const MOCK_ENTITLEMENTS: Entitlements = {
  planKey: "free_trial",
  limits: {
    max_users: 3, max_companies: 1, max_storage_mb: 500, max_documents: 100,
    max_ai_requests_monthly: 50, max_automation_runs_monthly: 50, max_api_calls_monthly: 1000, max_integrations: 1,
  },
};

export const MOCK_USAGE_SNAPSHOT: Record<UsageMetricKey, number> = {
  companies: 1, users: 4, customers: 128, suppliers: 76, inventory_items: 342, assets: 12, documents: 63, storage_mb: 214,
  communications: 18, automation_runs: 22, ai_requests: 9, api_requests: 0, bank_imports: 3, reports_generated: 2, forecasts: 0, financial_statements: 1, scheduled_jobs: 0,
};

export const MOCK_INVOICES: Invoice[] = [];
export const MOCK_PAYMENTS: Payment[] = [];
export const MOCK_CREDITS: BillingCredit[] = [];

export const MOCK_BILLING_EVENTS: BillingEvent[] = [
  { id: 1, companyId: COMPANY_ID, eventType: "TrialStarted", payload: { subscriptionId: "sub_1", planKey: "free_trial" }, occurredAt: "2026-06-01T09:00:00Z" },
];
