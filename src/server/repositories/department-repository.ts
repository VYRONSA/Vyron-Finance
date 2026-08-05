/**
 * Repository layer for Departments. No reference-app equivalent;
 * genuinely new master data.
 */

import { createClient } from "@/lib/supabase/server";
import { departmentFromRow, type DepartmentRow } from "@/server/company-management/mappers";
import type { Department } from "@/server/company-management/types";

export async function listDepartments(companyId: string): Promise<Department[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("departments").select("*").eq("company_id", companyId).order("name").returns<DepartmentRow[]>();
  if (error) throw error;
  return data.map(departmentFromRow);
}

export type NewDepartment = { name: string; code?: string };

export async function createDepartment(companyId: string, input: NewDepartment): Promise<Department> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .insert({ company_id: companyId, name: input.name, code: input.code ?? "" })
    .select("*")
    .single<DepartmentRow>();
  if (error) throw error;
  return departmentFromRow(data);
}

export async function getDepartment(companyId: string, departmentId: number): Promise<Department | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("departments").select("*").eq("company_id", companyId).eq("id", departmentId).maybeSingle<DepartmentRow>();
  if (error) throw error;
  return data ? departmentFromRow(data) : null;
}

export type UpdatableDepartmentFields = Partial<{ name: string; code: string }>;

/** Pilot Review Round 1, Phase 10 — previously only `isActive` could
 * change post-creation; a department could never be renamed or
 * recoded once created. */
export async function updateDepartment(companyId: string, departmentId: number, fields: UpdatableDepartmentFields): Promise<Department> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .update(fields)
    .eq("company_id", companyId)
    .eq("id", departmentId)
    .select("*")
    .single<DepartmentRow>();
  if (error) throw error;
  return departmentFromRow(data);
}

export async function setDepartmentActive(companyId: string, departmentId: number, isActive: boolean): Promise<Department> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .update({ is_active: isActive })
    .eq("company_id", companyId)
    .eq("id", departmentId)
    .select("*")
    .single<DepartmentRow>();
  if (error) throw error;
  return departmentFromRow(data);
}
