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
