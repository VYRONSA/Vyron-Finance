/**
 * Copilot's communication-drafting capability — per the Product Review
 * Board's own instruction, "the AI Copilot must not send messages... it
 * may draft, summarise, rewrite, improve tone, suggest wording." This
 * codebase has no LLM integration anywhere (confirmed: no API key, no
 * provider SDK) — every other Copilot output is deterministic/computed
 * text (`narrative-engine.ts`, `executive-briefing-service.ts`), and this
 * follows the same honest pattern: a real, useful draft built from
 * already-computed financial data, never framed as "AI-generated." Only
 * the Communication Platform (`communication-service.ts::queueCommunication`)
 * may actually queue or send what this suggests.
 */

export type AgingBuckets = { current: number; days30: number; days60: number; days90: number; days120Plus: number };

export function draftPaymentReminderMessage(recipientName: string, aging: AgingBuckets, outstandingBalance: number): string {
  const overdue = aging.days30 + aging.days60 + aging.days90 + aging.days120Plus;
  if (overdue <= 0) {
    return `Hi ${recipientName}, your account balance of ${outstandingBalance.toFixed(2)} is fully within terms — no overdue amount. This is a courtesy reminder only.`;
  }
  const mostOverdueBucket = aging.days120Plus > 0 ? "120+ days" : aging.days90 > 0 ? "90 days" : aging.days60 > 0 ? "60 days" : "30 days";
  return `Hi ${recipientName}, your account shows an overdue balance of ${overdue.toFixed(2)} (oldest amounts now ${mostOverdueBucket} past due) out of a total outstanding balance of ${outstandingBalance.toFixed(2)}. Please arrange payment at your earliest convenience, or let us know if you'd like to discuss a payment plan.`;
}

export function draftWelcomeMessage(recipientName: string, companyName: string): string {
  return `Hi ${recipientName}, welcome — we're glad to have you set up as a customer of ${companyName}. If you have any questions getting started, just reply to this message.`;
}
