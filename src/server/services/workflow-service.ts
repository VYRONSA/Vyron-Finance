/**
 * Service layer for the platform-wide Workflow Engine. Genuinely new
 * shared infrastructure (Approval/Review/Exception/Audit workflows) —
 * wired to ONE real caller this pass: a Recurring Template can require
 * approval before it ever activates (`recurring-template-service.ts`).
 * Deliberately NOT retrofitted onto already-shipped modules' own
 * status-transition logic (Purchase Orders' Submitted/Approved/Rejected,
 * Journals' own workflow) — see `docs/MIGRATION_ROADMAP.md` for why that
 * was judged a regression risk not worth taking in this pass.
 */

import * as repo from "@/server/repositories/workflow-repository";
import type { WorkflowDefinition, WorkflowInstance, WorkflowStepDefinition, WorkflowType } from "@/server/automation/types";

export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export const listWorkflowDefinitions = repo.listWorkflowDefinitions;
export const getWorkflowDefinition = repo.getWorkflowDefinition;
export const setWorkflowDefinitionActive = repo.setWorkflowDefinitionActive;
export const getWorkflowInstance = repo.getWorkflowInstance;
export const listPendingWorkflowInstances = repo.listPendingWorkflowInstances;
export const listWorkflowInstanceSteps = repo.listWorkflowInstanceSteps;

export async function createWorkflowDefinition(companyId: string, input: { workflowType: WorkflowType; name: string; steps: WorkflowStepDefinition[] }): Promise<WorkflowDefinition> {
  if (!input.name?.trim()) throw new ValidationError("Workflow name is required.");
  if (input.steps.length === 0) throw new ValidationError("A workflow needs at least one step.");
  return repo.createWorkflowDefinition(companyId, input);
}

/** Starts a new approval/review/exception/audit instance for a subject
 * (e.g. a Recurring Template) at step 0, `Pending`. */
export async function startWorkflow(companyId: string, definitionId: number, subjectType: string, subjectId: number): Promise<WorkflowInstance> {
  const definition = await repo.getWorkflowDefinition(companyId, definitionId);
  if (!definition) throw new NotFoundError(`No workflow definition with id ${definitionId}.`);
  if (!definition.isActive) throw new ValidationError(`Workflow "${definition.name}" is disabled.`);
  return repo.createWorkflowInstance(companyId, definitionId, subjectType, subjectId);
}

export async function getInstanceForSubject(companyId: string, subjectType: string, subjectId: number): Promise<WorkflowInstance | null> {
  return repo.getWorkflowInstanceForSubject(companyId, subjectType, subjectId);
}

/** Records one step's decision. A Rejected decision ends the instance
 * immediately (Rejected); an Approved decision on the final step ends it
 * (Approved); an Approved decision on a non-final step advances to the
 * next step and stays Pending. */
export async function decideStep(companyId: string, instanceId: number, decision: "Approved" | "Rejected", decidedBy: string, note = ""): Promise<WorkflowInstance> {
  const instance = await repo.getWorkflowInstance(companyId, instanceId);
  if (!instance) throw new NotFoundError(`No workflow instance with id ${instanceId}.`);
  if (instance.status !== "Pending") throw new ValidationError(`Workflow instance is already ${instance.status}.`);

  const definition = await repo.getWorkflowDefinition(companyId, instance.workflowDefinitionId);
  if (!definition) throw new NotFoundError(`No workflow definition with id ${instance.workflowDefinitionId}.`);

  await repo.recordWorkflowStepDecision(instanceId, instance.currentStep, decidedBy, decision, note);

  if (decision === "Rejected") {
    return repo.updateWorkflowInstance(companyId, instanceId, { status: "Rejected" });
  }

  const isFinalStep = instance.currentStep >= definition.steps.length - 1;
  if (isFinalStep) {
    return repo.updateWorkflowInstance(companyId, instanceId, { status: "Approved" });
  }
  return repo.updateWorkflowInstance(companyId, instanceId, { currentStep: instance.currentStep + 1 });
}

export async function cancelWorkflow(companyId: string, instanceId: number): Promise<WorkflowInstance> {
  return repo.updateWorkflowInstance(companyId, instanceId, { status: "Cancelled" });
}
