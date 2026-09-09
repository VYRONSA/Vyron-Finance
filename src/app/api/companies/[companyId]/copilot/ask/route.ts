import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth/require-session";
import { requirePermission } from "@/server/services/permission-service";
import { askCopilot } from "@/server/services/copilot-assistant-service";
import { hasFeature } from "@/server/billing-platform/engine/feature-flag-engine";
import { checkUsageLimit } from "@/server/billing-platform/engine/licensing-engine";
import { recordUsageEvent } from "@/server/billing-platform/engine/usage-metering-engine";
import type { ConversationTurn } from "@/server/ai/types";

/** Session-only conversation context the client already legitimately
 * has (it's what's rendered on the user's own screen) — see
 * `ConversationTurn`'s own docstring. Shape-validated here so a
 * malformed body can never reach `askCopilot`/the AI provider; never
 * trusted as a source of financial evidence regardless of its shape
 * (the server rebuilds that fresh from real data on every request). */
function parseConversation(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value.filter((turn): turn is ConversationTurn => {
    if (!turn || typeof turn !== "object") return false;
    const t = turn as Record<string, unknown>;
    return (t.role === "user" || t.role === "assistant") && typeof t.content === "string";
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  // Phase 15 — VYRON AI reuses this EXACT gate: the "AccessAICopilot"
  // permission, the "ai_copilot" feature, and the "max_ai_requests_monthly"
  // usage limit already cover both the deterministic VYRON Ask catalog
  // and VYRON AI's open-ended questions — one AI surface, one gate, no
  // new billing dimension invented for this phase.
  const check = await requirePermission(companyId, "AccessAICopilot");
  if (!check.ok) return check.response;
  if (!(await hasFeature(companyId, "ai_copilot"))) {
    return NextResponse.json({ error: "AI Executive Copilot is not included in your current plan." }, { status: 403 });
  }
  // Commercial Billing Platform — "AI usage exceeded -> Copilot
  // unavailable," enforced through the one Licensing Engine.
  const usageCheck = await checkUsageLimit(companyId, "max_ai_requests_monthly");
  if (!usageCheck.allowed) {
    return NextResponse.json({ error: usageCheck.reason ?? "Your plan's monthly AI request limit has been reached." }, { status: 403 });
  }
  const body = await request.json();
  const { question, periodStart, periodEnd, financialYearStartDate, accountCode, conversation } = body;

  if (!question || typeof question !== "string" || !question.trim() || !periodStart || !periodEnd || !financialYearStartDate) {
    return NextResponse.json({ error: "question, periodStart, periodEnd, and financialYearStartDate are required." }, { status: 400 });
  }

  const answer = await askCopilot(companyId, question, periodStart, periodEnd, financialYearStartDate, accountCode, parseConversation(conversation));
  // Phase 25K — a transient usage-metering failure must never fail a
  // request whose real work (the AI answer) already succeeded; same
  // defensive `.catch` guard already established for every other
  // `recordUsageEvent` call site (e.g. bank-sync-service.ts).
  await recordUsageEvent(companyId, "ai_requests").catch(() => {});
  return NextResponse.json({ answer });
}
