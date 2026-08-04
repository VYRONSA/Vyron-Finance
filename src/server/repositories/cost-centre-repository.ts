/**
 * Repository layer for Cost Centres. `accounting_engine`'s
 * `fi_merchant_rules.cost_centre` is a free-text stub field, never
 * enforced against a real table anywhere — this is that real master
 * table, genuinely new.
 */

import { createClient } from "@/lib/supabase/server";
import { costCentreFromRow, type CostCentreRow } from "@/server/company-management/mappers";
import type { CostCentre } from "@/server/company-management/types";

export async function listCostCentres(companyId: string): Promise<CostCentre[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("cost_centres").select("*").eq("company_id", companyId).order("name").returns<CostCentreRow[]>();
  if (error) throw error;
  return data.map(costCentreFromRow);
}

export type NewCostCentre = { name: string; code?: string };

export async function createCostCentre(companyId: string, input: NewCostCentre): Promise<CostCentre> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cost_centres")
    .insert({ company_id: companyId, name: input.name, code: input.code ?? "" })
    .select("*")
    .single<CostCentreRow>();
  if (error) throw error;
  return costCentreFromRow(data);
}

export async function setCostCentreActive(companyId: string, costCentreId: number, isActive: boolean): Promise<CostCentre> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cost_centres")
    .update({ is_active: isActive })
    .eq("company_id", companyId)
    .eq("id", costCentreId)
    .select("*")
    .single<CostCentreRow>();
  if (error) throw error;
  return costCentreFromRow(data);
}
