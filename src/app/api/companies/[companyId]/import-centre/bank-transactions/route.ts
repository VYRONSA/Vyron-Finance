import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { importBankStatement, ValidationError } from "@/server/services/import-service";
import { hasPermission, requirePermission } from "@/server/services/permission-service";

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;

  // Phase 5C — importing transactions is `Banking:Create` and stays so.
  // The Banking Rules pass an import runs can POST an accounting journal,
  // which needs `Banking:Post`; without it the import still completes in
  // full, and the transactions a rule would have posted are left
  // untouched and reported in `rulePass` so someone who may post them
  // still can.
  const check = await requirePermission(companyId, "Banking:Create");
  if (!check.ok) return check.response;
  const mayPost = await hasPermission(companyId, "Banking:Post");

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  try {
    const { batch, exceptions, rulesAutoAllocated, rulePass } = await importBankStatement(companyId, file, undefined, { mayPost });
    return NextResponse.json({ batch, exceptions, rulesAutoAllocated, rulePass }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
