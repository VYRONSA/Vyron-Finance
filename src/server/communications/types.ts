/**
 * Domain types for the RC1 Phase 5 Communication Platform — the ONE
 * shared place every module's outbound communication passes through, on
 * every channel. See supabase/migrations/0028_communication_platform.sql.
 */

import type { PermissionModule } from "@/server/permissions/types";

export const COMMUNICATION_CHANNELS = ["Email", "InApp", "SMS", "WhatsApp", "Teams", "Slack", "Push"] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

/** The only channels with a real sender wired up in this pass. Selecting
 * any other channel is rejected at `queueCommunication()` time — an
 * honest failure up front, never a communication silently promised on a
 * channel nothing can deliver. */
export const IMPLEMENTED_CHANNELS: CommunicationChannel[] = ["Email", "InApp"];

export const COMMUNICATION_STATUSES = ["Draft", "PendingApproval", "Rejected", "Queued", "Sending", "Sent", "Failed", "Cancelled", "Expired"] as const;
export type CommunicationStatus = (typeof COMMUNICATION_STATUSES)[number];

export const COMMUNICATION_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export type CommunicationPriority = (typeof COMMUNICATION_PRIORITIES)[number];

/** The fixed classification every template belongs to — RC1 Phase 5.1's
 * own taxonomy, so template management stays organised as the catalog
 * grows past the initial 16 seeded templates. */
export const TEMPLATE_CATEGORIES = ["Sales", "Purchasing", "Customers", "Suppliers", "Finance", "Audit", "Marketing", "Internal", "Legal"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export type CommunicationRecipient = {
  type: "Customer" | "Supplier" | "User" | "Email";
  id?: number | null;
  name: string;
  address?: string | null;
};

export type TemplateVariableSpec = { name: string; description: string; example?: string };

export type CommunicationTemplate = {
  id: number;
  companyId: string | null;
  code: string;
  name: string;
  channel: CommunicationChannel;
  category: TemplateCategory;
  subjectTemplate: string | null;
  bodyTemplate: string;
  variablesSchema: TemplateVariableSpec[];
  branding: { logoUrl?: string; primaryColor?: string; footerText?: string };
  requiresApproval: boolean;
  approvalWorkflowDefinitionId: number | null;
  isActive: boolean;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type CommunicationTemplateVersion = {
  id: number;
  templateId: number;
  versionNumber: number;
  subjectTemplate: string | null;
  bodyTemplate: string;
  changedBy: string;
  createdAt: string;
};

/** A `communications.module` value spans further than the fixed
 * `PermissionModule` union (Automation/AICopilot/CustomerManagement/
 * SupplierManagement aren't module-permission categories of their own) —
 * this resolves each known origin to the SAME module permission its
 * business object already uses (mirroring the Document Platform's
 * `DOCUMENT_PERMISSION_MODULE`), falling back to `Settings` (the
 * platform-administration bucket) for an origin with no more specific
 * home. Never a new, one-off permission category. */
const COMMUNICATION_PERMISSION_MODULE: Record<string, PermissionModule> = {
  Sales: "Sales",
  CustomerManagement: "Sales",
  Purchasing: "Purchasing",
  SupplierManagement: "Purchasing",
  Inventory: "Inventory",
  Banking: "Banking",
  Matching: "Matching",
  GeneralLedger: "GeneralLedger",
  VAT: "VAT",
  Assets: "Assets",
  FinancialStatements: "Reports",
  Reports: "Reports",
  Auditor: "Auditor",
  Cashbook: "Cashbook",
};

export function resolveCommunicationPermissionModule(module: string): PermissionModule {
  return COMMUNICATION_PERMISSION_MODULE[module] ?? "Settings";
}

export type CommunicationRecord = {
  id: number;
  companyId: string;
  module: string;
  businessObjectType: string | null;
  businessObjectId: number | null;
  templateId: number | null;
  channel: CommunicationChannel;
  recipients: CommunicationRecipient[];
  subject: string | null;
  body: string;
  variables: Record<string, unknown>;
  status: CommunicationStatus;
  priority: CommunicationPriority;
  scheduledFor: string;
  expiresAt: string | null;
  retryCount: number;
  maxRetries: number;
  nextRetryAt: string | null;
  sentAt: string | null;
  deliveryResult: Record<string, unknown> | null;
  failureReason: string | null;
  approvalWorkflowInstanceId: number | null;
  relatedNotificationId: number | null;
  auditRef: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** A document from the shared Document Platform (Phase 4) attached to
 * this communication — no duplicated attachment storage or upload logic,
 * `document_id` references the SAME `documents` table every entity type
 * already uploads to. */
export type CommunicationAttachment = {
  id: number;
  communicationId: number;
  documentId: number;
  createdAt: string;
};
