import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import {
  generateAccountAnalysis,
  generateAuditNote,
  generateExceptionReport,
  generateLeadSchedule,
  generateReconciliation,
  generateRiskSummary,
  generateSamplingList,
  generateSupportingSchedule,
  generateVarianceReport,
} from "@/server/services/audit-working-paper-service";
import type { AuditWorkingPaperType } from "@/server/audit/types";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "AuditAccess");
  if (!check.ok) return check.response;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();
  const paperType = body.paperType as AuditWorkingPaperType;
  const engagementId = body.engagementId ?? null;

  try {
    switch (paperType) {
      case "LeadSchedule": {
        const paper = await generateLeadSchedule(companyId, engagementId, body.asOfDate, performedBy);
        return NextResponse.json({ workingPaper: paper }, { status: 201 });
      }
      case "SupportingSchedule": {
        const paper = await generateSupportingSchedule(companyId, engagementId, Number(body.accountId), body.dateFrom, body.dateTo, performedBy);
        return NextResponse.json({ workingPaper: paper }, { status: 201 });
      }
      case "Reconciliation": {
        const paper = await generateReconciliation(companyId, engagementId, body.dateFrom, body.dateTo, performedBy);
        return NextResponse.json({ workingPaper: paper }, { status: 201 });
      }
      case "AccountAnalysis": {
        const paper = await generateAccountAnalysis(companyId, engagementId, Number(body.accountId), body.dateFrom, body.dateTo, performedBy);
        if (!paper) return NextResponse.json({ error: "Account not found." }, { status: 404 });
        return NextResponse.json({ workingPaper: paper }, { status: 201 });
      }
      case "VarianceReport": {
        const paper = await generateVarianceReport(companyId, engagementId, body.financialYearLabel, body.periodStart, body.periodEnd, performedBy);
        return NextResponse.json({ workingPaper: paper }, { status: 201 });
      }
      case "RiskSummary": {
        if (!engagementId) return NextResponse.json({ error: "engagementId is required for a Risk Summary." }, { status: 400 });
        const paper = await generateRiskSummary(companyId, engagementId, performedBy);
        return NextResponse.json({ workingPaper: paper }, { status: 201 });
      }
      case "ExceptionReport": {
        const paper = await generateExceptionReport(companyId, engagementId, performedBy);
        return NextResponse.json({ workingPaper: paper }, { status: 201 });
      }
      case "SamplingList": {
        const paper = await generateSamplingList(companyId, engagementId, body.dateFrom, body.dateTo, Number(body.sampleSize ?? 25), performedBy);
        return NextResponse.json({ workingPaper: paper }, { status: 201 });
      }
      case "AuditNote": {
        const paper = await generateAuditNote(companyId, engagementId, body.note ?? "", performedBy);
        return NextResponse.json({ workingPaper: paper }, { status: 201 });
      }
      default:
        return NextResponse.json({ error: `Unsupported paperType: ${paperType}` }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof Error) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
