import { NextResponse } from "next/server";
import { requireSession, getPerformedByLabel } from "@/server/auth/require-session";
import { disposeAsset, ValidationError } from "@/server/services/asset-register-service";
import { requireApproval } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string; assetId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId, assetId } = await params;
  const body = await request.json();
  const performedBy = await getPerformedByLabel();

  const eventType = body.eventType as "Disposal" | "WriteOff" | "Retirement";
  if (!["Disposal", "WriteOff", "Retirement"].includes(eventType)) {
    return NextResponse.json({ error: "eventType must be 'Disposal', 'WriteOff', or 'Retirement'." }, { status: 400 });
  }

  // The amount at risk in a disposal decision is the real proceeds
  // changing hands, not a re-derivation of the asset's book value (that
  // figure belongs to Fixed Assets' own services, not duplicated here).
  const approvalCheck = await requireApproval(companyId, "ApproveAssets", "AssetDisposal", Number(body.proceeds ?? 0));
  if (!approvalCheck.ok) return approvalCheck.response;

  try {
    const asset = await disposeAsset(
      companyId,
      Number(assetId),
      eventType,
      Number(body.proceeds ?? 0),
      body.paymentAccountCode ?? null,
      body.disposalDate ?? new Date().toISOString().slice(0, 10),
      body.description ?? "",
      performedBy,
    );
    return NextResponse.json({ asset });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
