/**
 * Repository layer for Projects — the Financial Reporting & Executive
 * Intelligence Platform's (Module 9) 4th Management Reporting dimension,
 * a real master table mirroring Branches/Departments/Cost Centres exactly.
 */

import { createClient } from "@/lib/supabase/server";
import { projectFromRow, type ProjectRow } from "@/server/company-management/mappers";
import type { Project } from "@/server/company-management/types";

export async function listProjects(companyId: string): Promise<Project[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").select("*").eq("company_id", companyId).order("name").returns<ProjectRow[]>();
  if (error) throw error;
  return data.map(projectFromRow);
}

export type NewProject = { name: string; code?: string };

export async function createProject(companyId: string, input: NewProject): Promise<Project> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .insert({ company_id: companyId, name: input.name, code: input.code ?? "" })
    .select("*")
    .single<ProjectRow>();
  if (error) throw error;
  return projectFromRow(data);
}

export async function setProjectActive(companyId: string, projectId: number, isActive: boolean): Promise<Project> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ is_active: isActive })
    .eq("company_id", companyId)
    .eq("id", projectId)
    .select("*")
    .single<ProjectRow>();
  if (error) throw error;
  return projectFromRow(data);
}
