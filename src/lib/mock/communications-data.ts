import { MOCK_COMPANY } from "./financial-data";
import type { CommunicationRecord, CommunicationTemplate } from "@/server/communications/types";

const COMPANY_ID = MOCK_COMPANY.id;

export const MOCK_COMMUNICATION_TEMPLATES: CommunicationTemplate[] = [
  {
    id: 1, companyId: COMPANY_ID, code: "PaymentReminder", name: "Payment Reminder", channel: "Email", category: "Customers",
    subjectTemplate: "Payment Reminder — {{recipientName}}",
    bodyTemplate: "Dear {{recipientName}},{{#if message}}\n\n{{message}}{{/if}}\n\nThis is a reminder regarding your account with us.\n\nRegards,\n{{companyName}}",
    variablesSchema: [{ name: "recipientName", description: "Customer or supplier name" }, { name: "message", description: "Optional custom message" }, { name: "companyName", description: "Sending company name" }],
    branding: {}, requiresApproval: true, approvalWorkflowDefinitionId: 1, isActive: true, version: 1,
    createdBy: "System", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, code: "CustomerStatement", name: "Customer Statement", channel: "Email", category: "Customers",
    subjectTemplate: "Statement of Account — {{customerName}}",
    bodyTemplate: "Dear {{customerName}},\n\nPlease find your statement summary below.\n\nOutstanding balance: {{outstandingBalance}}\nOverdue: {{overdueAmount}}\n\nRegards,\n{{companyName}}",
    variablesSchema: [{ name: "customerName", description: "Customer name" }, { name: "outstandingBalance", description: "Total outstanding" }, { name: "overdueAmount", description: "Total overdue" }, { name: "companyName", description: "Sending company name" }],
    branding: {}, requiresApproval: true, approvalWorkflowDefinitionId: 1, isActive: true, version: 1,
    createdBy: "System", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, code: "SupplierStatement", name: "Supplier Statement", channel: "Email", category: "Suppliers",
    subjectTemplate: "Statement of Account — {{supplierName}}",
    bodyTemplate: "Dear {{supplierName}},\n\nPlease find your statement summary below.\n\nOutstanding balance: {{outstandingBalance}}\n\nRegards,\n{{companyName}}",
    variablesSchema: [{ name: "supplierName", description: "Supplier name" }, { name: "outstandingBalance", description: "Total outstanding" }, { name: "companyName", description: "Sending company name" }],
    branding: {}, requiresApproval: false, approvalWorkflowDefinitionId: null, isActive: true, version: 1,
    createdBy: "System", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z",
  },
];

export const MOCK_COMMUNICATIONS: CommunicationRecord[] = [
  {
    id: 1, companyId: COMPANY_ID, module: "Sales", businessObjectType: "Customer", businessObjectId: 1, templateId: 2, channel: "Email",
    recipients: [{ type: "Customer", id: 1, name: "Meridian Traders", address: "nomsa@meridiantraders.co.za" }],
    subject: "Statement of Account — Meridian Traders", body: "Dear Meridian Traders,\n\nOutstanding balance: 18450.00\nOverdue: 4200.00",
    variables: { customerName: "Meridian Traders", outstandingBalance: "18450.00", overdueAmount: "4200.00" },
    status: "PendingApproval", priority: "Normal", scheduledFor: "2026-08-01T08:00:00Z", expiresAt: null,
    retryCount: 0, maxRetries: 3, nextRetryAt: null, sentAt: null, deliveryResult: null, failureReason: null,
    approvalWorkflowInstanceId: 1, relatedNotificationId: null, auditRef: null,
    createdBy: "System", createdAt: "2026-08-01T08:00:00Z", updatedAt: "2026-08-01T08:00:00Z",
  },
  {
    id: 2, companyId: COMPANY_ID, module: "Purchasing", businessObjectType: "Supplier", businessObjectId: 1, templateId: 3, channel: "Email",
    recipients: [{ type: "Supplier", id: 1, name: "Fenwick Office Supplies", address: "grace@fenwickoffice.co.za" }],
    subject: "Statement of Account — Fenwick Office Supplies", body: "Dear Fenwick Office Supplies,\n\nOutstanding balance: 9120.00",
    variables: { supplierName: "Fenwick Office Supplies", outstandingBalance: "9120.00" },
    status: "Failed", priority: "Normal", scheduledFor: "2026-07-30T08:00:00Z", expiresAt: null,
    retryCount: 3, maxRetries: 3, nextRetryAt: null, sentAt: null, deliveryResult: null,
    failureReason: "No email provider is configured for this deployment.",
    approvalWorkflowInstanceId: null, relatedNotificationId: null, auditRef: null,
    createdBy: "System", createdAt: "2026-07-30T08:00:00Z", updatedAt: "2026-07-30T08:20:00Z",
  },
  {
    id: 3, companyId: COMPANY_ID, module: "Sales", businessObjectType: "Customer", businessObjectId: 2, templateId: 1, channel: "InApp",
    recipients: [{ type: "Customer", id: 2, name: "Bramwell Dental Practice", address: null }],
    subject: "Payment Reminder — Bramwell Dental Practice", body: "Dear Bramwell Dental Practice,\n\nThis is a reminder regarding your account with us.",
    variables: { recipientName: "Bramwell Dental Practice" },
    status: "Sent", priority: "Normal", scheduledFor: "2026-07-28T08:00:00Z", expiresAt: null,
    retryCount: 0, maxRetries: 3, nextRetryAt: null, sentAt: "2026-07-28T08:00:04Z",
    deliveryResult: { notificationId: 42 }, failureReason: null,
    approvalWorkflowInstanceId: null, relatedNotificationId: 42, auditRef: null,
    createdBy: "System", createdAt: "2026-07-28T08:00:00Z", updatedAt: "2026-07-28T08:00:04Z",
  },
];
