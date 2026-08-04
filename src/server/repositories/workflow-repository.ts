/**
 * Repository layer for the platform-wide Workflow Engine — genuinely new
 * shared infrastructure (Approval/Review/Exception/Audit workflows).
 */

import { createClient } from "@/lib/supabase/server";
import {
  workflowDefinitionFromRow,
  workflowInstanceFromRow,
  workflowInstanceStepFromRow,
  type WorkflowDefinitionRow,
  type WorkflowInstanceRow,
  type WorkflowInstanceStepRow,
} from "@/server/automation/mappers";
import type { WorkflowDefinition, WorkflowInstance, WorkflowInstanceStatus, WorkflowInstanceStep, WorkflowStepDefinition, WorkflowType } from "@/server/automation/types";

export async function listWorkflowDefinitions(companyId: string): Promise<WorkflowDefinition[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_definitions")
    .select("*")
    .eq("company_id", companyId)
    .order("name")
    .returns<WorkflowDefinitionRow[]>();
  if (error) throw error;
  return data.map(workflowDefinitionFromRow);
}

export async function getWorkflowDefinition(companyId: string, definitionId: number): Promise<WorkflowDefinition | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_definitions")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", definitionId)
    .maybeSingle<WorkflowDefinitionRow>();
  if (error) throw error;
  return data ? workflowDefinitionFromRow(data) : null;
}

export async function createWorkflowDefinition(companyId: string, input: { workflowType: WorkflowType; name: string; steps: WorkflowStepDefinition[] }): Promise<WorkflowDefinition> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_definitions")
    .insert({ company_id: companyId, workflow_type: input.workflowType, name: input.name, steps: input.steps })
    .select("*")
    .single<WorkflowDefinitionRow>();
  if (error) throw error;
  return workflowDefinitionFromRow(data);
}

export async function setWorkflowDefinitionActive(companyId: string, definitionId: number, isActive: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("workflow_definitions").update({ is_active: isActive }).eq("company_id", companyId).eq("id", definitionId);
  if (error) throw error;
}

export async function createWorkflowInstance(companyId: string, definitionId: number, subjectType: string, subjectId: number): Promise<WorkflowInstance> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_instances")
    .insert({ company_id: companyId, workflow_definition_id: definitionId, subject_type: subjectType, subject_id: subjectId })
    .select("*")
    .single<WorkflowInstanceRow>();
  if (error) throw error;
  return workflowInstanceFromRow(data);
}

export async function getWorkflowInstance(companyId: string, instanceId: number): Promise<WorkflowInstance | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", instanceId)
    .maybeSingle<WorkflowInstanceRow>();
  if (error) throw error;
  return data ? workflowInstanceFromRow(data) : null;
}

export async function getWorkflowInstanceForSubject(companyId: string, subjectType: string, subjectId: number): Promise<WorkflowInstance | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("company_id", companyId)
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<WorkflowInstanceRow>();
  if (error) throw error;
  return data ? workflowInstanceFromRow(data) : null;
}

export async function listPendingWorkflowInstances(companyId: string): Promise<WorkflowInstance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "Pending")
    .returns<WorkflowInstanceRow[]>();
  if (error) throw error;
  return data.map(workflowInstanceFromRow);
}

/** RC1 Phase 6 — the Operations Centre's Workflow Engine health needs
 * every recent instance regardless of status (Pending/Approved/Rejected/
 * Cancelled), not just the pending worklist `listPendingWorkflowInstances`
 * already serves. */
export async function listRecentWorkflowInstances(companyId: string, limit = 100): Promise<WorkflowInstance[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_instances")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<WorkflowInstanceRow[]>();
  if (error) throw error;
  return data.map(workflowInstanceFromRow);
}

export async function updateWorkflowInstance(companyId: string, instanceId: number, fields: { currentStep?: number; status?: WorkflowInstanceStatus }): Promise<WorkflowInstance> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (fields.currentStep !== undefined) update.current_step = fields.currentStep;
  if (fields.status !== undefined) update.status = fields.status;
  const { data, error } = await supabase
    .from("workflow_instances")
    .update(update)
    .eq("company_id", companyId)
    .eq("id", instanceId)
    .select("*")
    .single<WorkflowInstanceRow>();
  if (error) throw error;
  return workflowInstanceFromRow(data);
}

export async function recordWorkflowStepDecision(instanceId: number, stepOrder: number, decidedBy: string, decision: "Approved" | "Rejected", note: string): Promise<WorkflowInstanceStep> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_instance_steps")
    .insert({ instance_id: instanceId, step_order: stepOrder, decided_by: decidedBy, decision, note })
    .select("*")
    .single<WorkflowInstanceStepRow>();
  if (error) throw error;
  return workflowInstanceStepFromRow(data);
}

export async function listWorkflowInstanceSteps(instanceId: number): Promise<WorkflowInstanceStep[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_instance_steps")
    .select("*")
    .eq("instance_id", instanceId)
    .order("step_order")
    .returns<WorkflowInstanceStepRow[]>();
  if (error) throw error;
  return data.map(workflowInstanceStepFromRow);
}
