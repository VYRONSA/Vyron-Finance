import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { findExactDuplicateRule } from "@/server/services/banking-rule-service";
import { requirePermission } from "@/server/services/permission-service";
import type { RuleDomain } from "@/server/banking-rules/types";

/** Transaction Explorer Redesign, Phase 1 — backs the new inline grid's
 * "Set Rule" checkbox: a lightweight, non-mutating check the frontend
 * calls before creating a rule, so a true duplicate renders as an inline
 * badge on the checkbox itself rather than surfacing only after the rule
 * is already created. */
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Banking:Edit");
  if (!check.ok) return check.response;

  const body = await request.json();
  const domain = (body.domain ?? "Banking") as RuleDomain;
  const duplicate = await findExactDuplicateRule(companyId, domain, body.ruleType, body.conditions ?? [], body.actions ?? []);
  return NextResponse.json({ duplicate });
}
