import type {
  CommunicationAttachment,
  CommunicationChannel,
  CommunicationPriority,
  CommunicationRecipient,
  CommunicationRecord,
  CommunicationStatus,
  CommunicationTemplate,
  CommunicationTemplateVersion,
  TemplateCategory,
  TemplateVariableSpec,
} from "./types";

export type CommunicationTemplateRow = {
  id: number;
  company_id: string | null;
  code: string;
  name: string;
  channel: string;
  category: string;
  subject_template: string | null;
  body_template: string;
  variables_schema: TemplateVariableSpec[];
  branding: { logoUrl?: string; primaryColor?: string; footerText?: string };
  requires_approval: boolean;
  approval_workflow_definition_id: number | null;
  is_active: boolean;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function templateFromRow(row: CommunicationTemplateRow): CommunicationTemplate {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    channel: row.channel as CommunicationChannel,
    category: row.category as TemplateCategory,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    variablesSchema: row.variables_schema ?? [],
    branding: row.branding ?? {},
    requiresApproval: row.requires_approval,
    approvalWorkflowDefinitionId: row.approval_workflow_definition_id,
    isActive: row.is_active,
    version: row.version,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CommunicationTemplateVersionRow = {
  id: number;
  template_id: number;
  version_number: number;
  subject_template: string | null;
  body_template: string;
  changed_by: string;
  created_at: string;
};

export function templateVersionFromRow(row: CommunicationTemplateVersionRow): CommunicationTemplateVersion {
  return {
    id: row.id,
    templateId: row.template_id,
    versionNumber: row.version_number,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    changedBy: row.changed_by,
    createdAt: row.created_at,
  };
}

export type CommunicationRow = {
  id: number;
  company_id: string;
  module: string;
  business_object_type: string | null;
  business_object_id: number | null;
  template_id: number | null;
  channel: string;
  recipients: CommunicationRecipient[];
  subject: string | null;
  body: string;
  variables: Record<string, unknown>;
  status: string;
  priority: string;
  scheduled_for: string;
  expires_at: string | null;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  sent_at: string | null;
  delivery_result: Record<string, unknown> | null;
  failure_reason: string | null;
  approval_workflow_instance_id: number | null;
  related_notification_id: number | null;
  audit_ref: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export function communicationFromRow(row: CommunicationRow): CommunicationRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    module: row.module,
    businessObjectType: row.business_object_type,
    businessObjectId: row.business_object_id,
    templateId: row.template_id,
    channel: row.channel as CommunicationChannel,
    recipients: row.recipients ?? [],
    subject: row.subject,
    body: row.body,
    variables: row.variables ?? {},
    status: row.status as CommunicationStatus,
    priority: row.priority as CommunicationPriority,
    scheduledFor: row.scheduled_for,
    expiresAt: row.expires_at,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    nextRetryAt: row.next_retry_at,
    sentAt: row.sent_at,
    deliveryResult: row.delivery_result,
    failureReason: row.failure_reason,
    approvalWorkflowInstanceId: row.approval_workflow_instance_id,
    relatedNotificationId: row.related_notification_id,
    auditRef: row.audit_ref,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type CommunicationAttachmentRow = { id: number; communication_id: number; document_id: number; created_at: string };

export function attachmentFromRow(row: CommunicationAttachmentRow): CommunicationAttachment {
  return { id: row.id, communicationId: row.communication_id, documentId: row.document_id, createdAt: row.created_at };
}
