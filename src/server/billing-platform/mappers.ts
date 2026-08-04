/**
 * Row (snake_case, as Supabase returns it) -> domain type (camelCase)
 * mappers, one per table — matches this codebase's established
 * `src/server/inventory/mappers.ts` convention (row types colocated
 * with their mapper, repositories import both).
 */

import type {
  BillingAccount, BillingCredit, BillingEvent, BillingProviderConnection, BillingSupportNote, BillingWebhookEvent,
  CompanyFeatureOverride, Entitlements, FeatureFlagDefinition, Invoice, InvoiceLine, Payment, Refund,
  Subscription, SubscriptionCompanyLink, SubscriptionPlan, SubscriptionPlanEntitlement, SubscriptionPlanFeature,
  SubscriptionPlanPrice, SubscriptionStatusHistoryEntry, UsagePeriodCounter,
  BillingProviderName, BillingCycle, BillingEventType, FeatureKey, LimitKey, PlanKey, SubscriptionStatus, UsageMetricKey,
  BillingProviderConnectionStatus, BillingWebhookEventStatus, InvoiceStatus, PaymentStatus,
} from "./types";

export type SubscriptionPlanRow = {
  id: number; plan_key: string; name: string; description: string; is_active: boolean; sort_order: number; created_at: string;
};
export function subscriptionPlanFromRow(row: SubscriptionPlanRow): SubscriptionPlan {
  return { id: row.id, planKey: row.plan_key as PlanKey, name: row.name, description: row.description, isActive: row.is_active, sortOrder: row.sort_order, createdAt: row.created_at };
}

export type SubscriptionPlanPriceRow = {
  id: number; plan_id: number; billing_cycle: string; currency_code: string; unit_amount: number; is_active: boolean; provider_price_id: string | null; created_at: string;
};
export function subscriptionPlanPriceFromRow(row: SubscriptionPlanPriceRow): SubscriptionPlanPrice {
  return {
    id: row.id, planId: row.plan_id, billingCycle: row.billing_cycle as BillingCycle, currencyCode: row.currency_code,
    unitAmount: Number(row.unit_amount), isActive: row.is_active, providerPriceId: row.provider_price_id, createdAt: row.created_at,
  };
}

export type SubscriptionPlanEntitlementRow = { id: number; plan_id: number; limit_key: string; limit_value: number | null };
export function subscriptionPlanEntitlementFromRow(row: SubscriptionPlanEntitlementRow): SubscriptionPlanEntitlement {
  return { id: row.id, planId: row.plan_id, limitKey: row.limit_key as LimitKey, limitValue: row.limit_value };
}

/** Assembles a plan's entitlement rows into the `Entitlements` shape
 * `licensing-engine.ts` returns — any limit key with no row for this
 * plan defaults to `0` (deny by default), never `null`/unlimited, so a
 * missing seed row fails closed rather than silently granting
 * unlimited access. */
export function entitlementsFromRows(planKey: PlanKey, rows: SubscriptionPlanEntitlementRow[]): Entitlements {
  const limits = Object.fromEntries(
    (["max_users", "max_companies", "max_storage_mb", "max_documents", "max_ai_requests_monthly", "max_automation_runs_monthly", "max_api_calls_monthly", "max_integrations"] as LimitKey[])
      .map((key) => [key, 0]),
  ) as Record<LimitKey, number | null>;
  for (const row of rows) limits[row.limit_key as LimitKey] = row.limit_value;
  return { planKey, limits };
}

export type FeatureFlagRow = { id: number; feature_key: string; name: string; description: string; created_at: string };
export function featureFlagFromRow(row: FeatureFlagRow): FeatureFlagDefinition {
  return { id: row.id, featureKey: row.feature_key as FeatureKey, name: row.name, description: row.description, createdAt: row.created_at };
}

export type SubscriptionPlanFeatureRow = { id: number; plan_id: number; feature_id: number; is_enabled: boolean };
export function subscriptionPlanFeatureFromRow(row: SubscriptionPlanFeatureRow): SubscriptionPlanFeature {
  return { id: row.id, planId: row.plan_id, featureId: row.feature_id, isEnabled: row.is_enabled };
}

export type BillingAccountRow = {
  id: string; organisation_id: string; billing_email: string; billing_contact_name: string; tax_number: string;
  billing_address: string; default_currency_code: string; provider_customer_id: string | null; created_at: string; updated_at: string;
};
export function billingAccountFromRow(row: BillingAccountRow): BillingAccount {
  return {
    id: row.id, organisationId: row.organisation_id, billingEmail: row.billing_email, billingContactName: row.billing_contact_name,
    taxNumber: row.tax_number, billingAddress: row.billing_address, defaultCurrencyCode: row.default_currency_code,
    providerCustomerId: row.provider_customer_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export type SubscriptionRow = {
  id: string; billing_account_id: string; plan_id: number; billing_cycle: string; currency_code: string; status: string;
  trial_ends_at: string | null; current_period_start: string | null; current_period_end: string | null; grace_period_ends_at: string | null;
  cancel_at_period_end: boolean; cancelled_at: string | null; trial_warning_sent_at: string | null; provider: string; provider_subscription_id: string | null;
  created_at: string; updated_at: string;
};
export function subscriptionFromRow(row: SubscriptionRow): Subscription {
  return {
    id: row.id, billingAccountId: row.billing_account_id, planId: row.plan_id, billingCycle: row.billing_cycle as BillingCycle,
    currencyCode: row.currency_code, status: row.status as SubscriptionStatus, trialEndsAt: row.trial_ends_at,
    currentPeriodStart: row.current_period_start, currentPeriodEnd: row.current_period_end, gracePeriodEndsAt: row.grace_period_ends_at,
    cancelAtPeriodEnd: row.cancel_at_period_end, cancelledAt: row.cancelled_at, trialWarningSentAt: row.trial_warning_sent_at,
    provider: row.provider as BillingProviderName, providerSubscriptionId: row.provider_subscription_id, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export type SubscriptionStatusHistoryRow = {
  id: number; subscription_id: string; from_status: string | null; to_status: string; reason: string; performed_by: string; occurred_at: string;
};
export function subscriptionStatusHistoryFromRow(row: SubscriptionStatusHistoryRow): SubscriptionStatusHistoryEntry {
  return {
    id: row.id, subscriptionId: row.subscription_id, fromStatus: row.from_status as SubscriptionStatus | null,
    toStatus: row.to_status as SubscriptionStatus, reason: row.reason, performedBy: row.performed_by, occurredAt: row.occurred_at,
  };
}

export type SubscriptionCompanyRow = { id: number; subscription_id: string; company_id: string; added_at: string };
export function subscriptionCompanyFromRow(row: SubscriptionCompanyRow): SubscriptionCompanyLink {
  return { id: row.id, subscriptionId: row.subscription_id, companyId: row.company_id, addedAt: row.added_at };
}

export type CompanyFeatureOverrideRow = {
  id: number; company_id: string; feature_id: number; is_enabled: boolean; reason: string; created_by: string; created_at: string;
};
export function companyFeatureOverrideFromRow(row: CompanyFeatureOverrideRow): CompanyFeatureOverride {
  return { id: row.id, companyId: row.company_id, featureId: row.feature_id, isEnabled: row.is_enabled, reason: row.reason, createdBy: row.created_by, createdAt: row.created_at };
}

export type UsagePeriodCounterRow = { id: number; company_id: string; metric_key: string; period_start: string; counter_value: number; updated_at: string };
export function usagePeriodCounterFromRow(row: UsagePeriodCounterRow): UsagePeriodCounter {
  return { id: row.id, companyId: row.company_id, metricKey: row.metric_key as UsageMetricKey, periodStart: row.period_start, counterValue: Number(row.counter_value), updatedAt: row.updated_at };
}

export type InvoiceRow = {
  id: string; billing_account_id: string; subscription_id: string | null; invoice_number: string; status: string; currency_code: string;
  subtotal: number; tax_amount: number; total: number; amount_paid: number; issued_at: string | null; due_at: string | null;
  paid_at: string | null; provider: string; provider_invoice_id: string | null; created_at: string;
};
export function invoiceFromRow(row: InvoiceRow): Invoice {
  return {
    id: row.id, billingAccountId: row.billing_account_id, subscriptionId: row.subscription_id, invoiceNumber: row.invoice_number,
    status: row.status as InvoiceStatus, currencyCode: row.currency_code, subtotal: Number(row.subtotal), taxAmount: Number(row.tax_amount),
    total: Number(row.total), amountPaid: Number(row.amount_paid), issuedAt: row.issued_at, dueAt: row.due_at, paidAt: row.paid_at,
    provider: row.provider as BillingProviderName, providerInvoiceId: row.provider_invoice_id, createdAt: row.created_at,
  };
}

export type InvoiceLineRow = { id: number; invoice_id: string; description: string; quantity: number; unit_amount: number; amount: number; line_order: number };
export function invoiceLineFromRow(row: InvoiceLineRow): InvoiceLine {
  return { id: row.id, invoiceId: row.invoice_id, description: row.description, quantity: Number(row.quantity), unitAmount: Number(row.unit_amount), amount: Number(row.amount), lineOrder: row.line_order };
}

export type PaymentRow = {
  id: string; billing_account_id: string; invoice_id: string | null; status: string; amount: number; currency_code: string;
  failure_reason: string | null; provider: string; provider_payment_id: string | null; created_at: string;
};
export function paymentFromRow(row: PaymentRow): Payment {
  return {
    id: row.id, billingAccountId: row.billing_account_id, invoiceId: row.invoice_id, status: row.status as PaymentStatus,
    amount: Number(row.amount), currencyCode: row.currency_code, failureReason: row.failure_reason,
    provider: row.provider as BillingProviderName, providerPaymentId: row.provider_payment_id, createdAt: row.created_at,
  };
}

export type RefundRow = {
  id: string; payment_id: string; amount: number; reason: string; status: string; provider: string; provider_refund_id: string | null; performed_by: string; created_at: string;
};
export function refundFromRow(row: RefundRow): Refund {
  return {
    id: row.id, paymentId: row.payment_id, amount: Number(row.amount), reason: row.reason, status: row.status as Refund["status"],
    provider: row.provider as BillingProviderName, providerRefundId: row.provider_refund_id, performedBy: row.performed_by, createdAt: row.created_at,
  };
}

export type BillingCreditRow = {
  id: string; billing_account_id: string; amount: number; currency_code: string; reason: string; applied_to_invoice_id: string | null; performed_by: string; created_at: string;
};
export function billingCreditFromRow(row: BillingCreditRow): BillingCredit {
  return {
    id: row.id, billingAccountId: row.billing_account_id, amount: Number(row.amount), currencyCode: row.currency_code, reason: row.reason,
    appliedToInvoiceId: row.applied_to_invoice_id, performedBy: row.performed_by, createdAt: row.created_at,
  };
}

export type BillingProviderConnectionRow = {
  id: number; provider_name: string; status: string; connected_at: string | null; last_verified_at: string | null; notes: string; created_at: string;
};
export function billingProviderConnectionFromRow(row: BillingProviderConnectionRow): BillingProviderConnection {
  return {
    id: row.id, providerName: row.provider_name as "stripe", status: row.status as BillingProviderConnectionStatus,
    connectedAt: row.connected_at, lastVerifiedAt: row.last_verified_at, notes: row.notes, createdAt: row.created_at,
  };
}

export type BillingWebhookEventRow = {
  id: number; provider: string; provider_event_id: string; event_type: string; status: string; payload: unknown;
  signature_verified: boolean; received_at: string; processed_at: string | null; error_message: string | null; retry_count: number;
};
export function billingWebhookEventFromRow(row: BillingWebhookEventRow): BillingWebhookEvent {
  return {
    id: row.id, provider: row.provider, providerEventId: row.provider_event_id, eventType: row.event_type,
    status: row.status as BillingWebhookEventStatus, payload: row.payload, signatureVerified: row.signature_verified,
    receivedAt: row.received_at, processedAt: row.processed_at, errorMessage: row.error_message, retryCount: row.retry_count,
  };
}

export type BillingSupportNoteRow = { id: number; billing_account_id: string; note: string; created_by: string; created_at: string };
export function billingSupportNoteFromRow(row: BillingSupportNoteRow): BillingSupportNote {
  return { id: row.id, billingAccountId: row.billing_account_id, note: row.note, createdBy: row.created_by, createdAt: row.created_at };
}

export type BillingEventRow = { id: number; company_id: string | null; event_type: string; payload: Record<string, unknown>; occurred_at: string };
export function billingEventFromRow(row: BillingEventRow): BillingEvent {
  return { id: row.id, companyId: row.company_id, eventType: row.event_type as BillingEventType, payload: row.payload, occurredAt: row.occurred_at };
}
