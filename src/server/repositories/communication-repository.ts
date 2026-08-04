/**
 * Repository layer for the RC1 Phase 5 Communication Platform — the ONE
 * table every module's outbound communication writes to
 * (`communications`), plus its template catalog
 * (`communication_templates`/`communication_template_versions`).
 */

import { createClient } from "@/lib/supabase/server";
import {
  attachmentFromRow, communicationFromRow, templateFromRow, templateVersionFromRow,
  type CommunicationAttachmentRow, type CommunicationRow, type CommunicationTemplateRow, type CommunicationTemplateVersionRow,
} from "@/server/communications/mappers";
import type {
  CommunicationAttachment, CommunicationChannel, CommunicationPriority, CommunicationRecipient, CommunicationRecord,
  CommunicationStatus, CommunicationTemplate, CommunicationTemplateVersion, TemplateCategory, TemplateVariableSpec,
} from "@/server/communications/types";

export async function listTemplates(companyId: string): Promise<CommunicationTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communication_templates")
    .select("*")
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("code")
    .returns<CommunicationTemplateRow[]>();
  if (error) throw error;
  return data.map(templateFromRow);
}

export async function getTemplate(companyId: string, templateId: number): Promise<CommunicationTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communication_templates")
    .select("*")
    .eq("id", templateId)
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .maybeSingle<CommunicationTemplateRow>();
  if (error) throw error;
  return data ? templateFromRow(data) : null;
}

/** Resolves the template a business event should render with: the
 * company's own override if one exists for this `code`+`channel`,
 * otherwise the platform-wide default — never a hardcoded fallback
 * string, since every template lives in this one catalog. */
export async function getTemplateByCode(companyId: string, code: string, channel: CommunicationChannel): Promise<CommunicationTemplate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communication_templates")
    .select("*")
    .eq("code", code)
    .eq("channel", channel)
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("company_id", { ascending: false, nullsFirst: false })
    .limit(1)
    .returns<CommunicationTemplateRow[]>();
  if (error) throw error;
  return data[0] ? templateFromRow(data[0]) : null;
}

export type NewCommunicationTemplate = {
  code: string;
  name: string;
  channel: CommunicationChannel;
  category?: TemplateCategory;
  subjectTemplate?: string | null;
  bodyTemplate: string;
  variablesSchema?: TemplateVariableSpec[];
  branding?: Record<string, unknown>;
  requiresApproval?: boolean;
  approvalWorkflowDefinitionId?: number | null;
  createdBy?: string;
};

export async function createTemplate(companyId: string, input: NewCommunicationTemplate): Promise<CommunicationTemplate> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communication_templates")
    .insert({
      company_id: companyId,
      code: input.code,
      name: input.name,
      channel: input.channel,
      category: input.category ?? "Internal",
      subject_template: input.subjectTemplate ?? null,
      body_template: input.bodyTemplate,
      variables_schema: input.variablesSchema ?? [],
      branding: input.branding ?? {},
      requires_approval: input.requiresApproval ?? false,
      approval_workflow_definition_id: input.approvalWorkflowDefinitionId ?? null,
      created_by: input.createdBy ?? "System",
    })
    .select("*")
    .single<CommunicationTemplateRow>();
  if (error) throw error;
  return templateFromRow(data);
}

export type TemplateUpdate = Partial<{
  name: string; subjectTemplate: string | null; bodyTemplate: string; category: TemplateCategory;
  variablesSchema: TemplateVariableSpec[]; branding: Record<string, unknown>;
  requiresApproval: boolean; approvalWorkflowDefinitionId: number | null; isActive: boolean;
}>;

export async function updateTemplate(companyId: string, templateId: number, patch: TemplateUpdate, bumpVersion: boolean): Promise<CommunicationTemplate> {
  const supabase = await createClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.subjectTemplate !== undefined) update.subject_template = patch.subjectTemplate;
  if (patch.bodyTemplate !== undefined) update.body_template = patch.bodyTemplate;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.variablesSchema !== undefined) update.variables_schema = patch.variablesSchema;
  if (patch.branding !== undefined) update.branding = patch.branding;
  if (patch.requiresApproval !== undefined) update.requires_approval = patch.requiresApproval;
  if (patch.approvalWorkflowDefinitionId !== undefined) update.approval_workflow_definition_id = patch.approvalWorkflowDefinitionId;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  if (bumpVersion) update.version = (await getTemplate(companyId, templateId))!.version + 1;

  const { data, error } = await supabase.from("communication_templates").update(update).eq("company_id", companyId).eq("id", templateId).select("*").single<CommunicationTemplateRow>();
  if (error) throw error;
  return templateFromRow(data);
}

export async function recordTemplateVersion(templateId: number, versionNumber: number, subjectTemplate: string | null, bodyTemplate: string, changedBy: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("communication_template_versions").insert({
    template_id: templateId, version_number: versionNumber, subject_template: subjectTemplate, body_template: bodyTemplate, changed_by: changedBy,
  });
  if (error) throw error;
}

export async function listTemplateVersions(templateId: number): Promise<CommunicationTemplateVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communication_template_versions")
    .select("*")
    .eq("template_id", templateId)
    .order("version_number", { ascending: false })
    .returns<CommunicationTemplateVersionRow[]>();
  if (error) throw error;
  return data.map(templateVersionFromRow);
}

export async function deleteTemplate(companyId: string, templateId: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("communication_templates").delete().eq("company_id", companyId).eq("id", templateId);
  if (error) throw error;
}

const COMMUNICATIONS_LIST_CAP = 500;

export type CommunicationFilters = { status?: CommunicationStatus; channel?: CommunicationChannel; module?: string; businessObjectType?: string; businessObjectId?: number };

export async function listCommunications(companyId: string, filters: CommunicationFilters = {}): Promise<CommunicationRecord[]> {
  const supabase = await createClient();
  let query = supabase.from("communications").select("*").eq("company_id", companyId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.channel) query = query.eq("channel", filters.channel);
  if (filters.module) query = query.eq("module", filters.module);
  if (filters.businessObjectType) query = query.eq("business_object_type", filters.businessObjectType);
  if (filters.businessObjectId !== undefined) query = query.eq("business_object_id", filters.businessObjectId);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(COMMUNICATIONS_LIST_CAP).returns<CommunicationRow[]>();
  if (error) throw error;
  return data.map(communicationFromRow);
}

export async function getCommunication(companyId: string, id: number): Promise<CommunicationRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("communications").select("*").eq("company_id", companyId).eq("id", id).maybeSingle<CommunicationRow>();
  if (error) throw error;
  return data ? communicationFromRow(data) : null;
}

/** Every row still capable of sending — `Queued` or `Failed` — the
 * snapshot the pure `selectDueCommunications`/`selectExpiredCommunications`
 * engine filters down to "what's actually due right now." */
export async function listPendingCommunications(companyId: string): Promise<CommunicationRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communications")
    .select("*")
    .eq("company_id", companyId)
    .in("status", ["Queued", "Failed"])
    .order("scheduled_for", { ascending: true })
    .limit(COMMUNICATIONS_LIST_CAP)
    .returns<CommunicationRow[]>();
  if (error) throw error;
  return data.map(communicationFromRow);
}

export type NewCommunication = {
  module: string;
  businessObjectType?: string | null;
  businessObjectId?: number | null;
  templateId?: number | null;
  channel: CommunicationChannel;
  recipients: CommunicationRecipient[];
  subject: string | null;
  body: string;
  variables?: Record<string, unknown>;
  status: CommunicationStatus;
  priority?: CommunicationPriority;
  scheduledFor?: string;
  expiresAt?: string | null;
  maxRetries?: number;
  approvalWorkflowInstanceId?: number | null;
  auditRef?: string | null;
  createdBy?: string;
};

export async function createCommunication(companyId: string, input: NewCommunication): Promise<CommunicationRecord> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communications")
    .insert({
      company_id: companyId,
      module: input.module,
      business_object_type: input.businessObjectType ?? null,
      business_object_id: input.businessObjectId ?? null,
      template_id: input.templateId ?? null,
      channel: input.channel,
      recipients: input.recipients,
      subject: input.subject,
      body: input.body,
      variables: input.variables ?? {},
      status: input.status,
      priority: input.priority ?? "Normal",
      scheduled_for: input.scheduledFor ?? new Date().toISOString(),
      expires_at: input.expiresAt ?? null,
      max_retries: input.maxRetries ?? 3,
      approval_workflow_instance_id: input.approvalWorkflowInstanceId ?? null,
      audit_ref: input.auditRef ?? null,
      created_by: input.createdBy ?? "System",
    })
    .select("*")
    .single<CommunicationRow>();
  if (error) throw error;
  return communicationFromRow(data);
}

export type CommunicationUpdate = Partial<{
  status: CommunicationStatus;
  retryCount: number;
  nextRetryAt: string | null;
  sentAt: string | null;
  deliveryResult: Record<string, unknown> | null;
  failureReason: string | null;
  relatedNotificationId: number | null;
  approvalWorkflowInstanceId: number | null;
}>;

export async function updateCommunication(companyId: string, id: number, patch: CommunicationUpdate): Promise<CommunicationRecord> {
  const supabase = await createClient();
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.retryCount !== undefined) update.retry_count = patch.retryCount;
  if (patch.nextRetryAt !== undefined) update.next_retry_at = patch.nextRetryAt;
  if (patch.sentAt !== undefined) update.sent_at = patch.sentAt;
  if (patch.deliveryResult !== undefined) update.delivery_result = patch.deliveryResult;
  if (patch.failureReason !== undefined) update.failure_reason = patch.failureReason;
  if (patch.relatedNotificationId !== undefined) update.related_notification_id = patch.relatedNotificationId;
  if (patch.approvalWorkflowInstanceId !== undefined) update.approval_workflow_instance_id = patch.approvalWorkflowInstanceId;

  const { data, error } = await supabase.from("communications").update(update).eq("company_id", companyId).eq("id", id).select("*").single<CommunicationRow>();
  if (error) throw error;
  return communicationFromRow(data);
}

/** Idempotent per-company defaults: the real templates + a default
 * approval workflow + the singleton scheduler task. See the migration's
 * own `seed_company_communication_defaults()` for the full definition. */
export async function seedCompanyCommunicationDefaults(companyId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("seed_company_communication_defaults", { target_company_id: companyId });
  if (error) throw error;
}

/** Attaches documents from the shared Document Platform (Phase 4) to a
 * communication — no duplicated attachment/upload logic, `document_id`
 * references the SAME `documents` table. */
export async function addCommunicationAttachments(communicationId: number, documentIds: number[]): Promise<void> {
  if (documentIds.length === 0) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("communication_attachments")
    .insert(documentIds.map((documentId) => ({ communication_id: communicationId, document_id: documentId })));
  if (error) throw error;
}

export async function listCommunicationAttachments(communicationId: number): Promise<CommunicationAttachment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("communication_attachments")
    .select("*")
    .eq("communication_id", communicationId)
    .returns<CommunicationAttachmentRow[]>();
  if (error) throw error;
  return data.map(attachmentFromRow);
}
