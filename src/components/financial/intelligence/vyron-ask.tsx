"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconAlertTriangle, IconSparkles } from "@/components/ui/icons";
import { isValidCopilotAnswer, toVyronAskAnswer, type VyronAskAnswer } from "./vyron-ask-view";

/** Phase 12, section 1 — "Only show suggested prompts that the
 * underlying intelligence engine can actually answer." Each of these is
 * a real, permanent entry in `SUPPORTED_COPILOT_QUESTIONS`
 * (copilot-assistant-engine.ts) backed by a real builder that always
 * returns an honest answer (even "nothing needs attention") — never an
 * unmatched/unsupported question. Phase 13 adds the 7 questions the
 * expanded Financial Intelligence Engine (Cash Flow, Customers,
 * Suppliers, Profitability, General Ledger, VAT, Data Quality) can now
 * genuinely answer. Phase 14 adds Business Situation awareness — "What
 * are my biggest financial problems?" is included even though it has no
 * new catalog entry of its own, since it already routes cleanly to the
 * existing "biggest-risks" question. Phase 15 doesn't add new prompts
 * here deliberately — VYRON AI answers anything typed freely, so its
 * "example" is the free-text input itself, not another fixed chip. */
const EXAMPLE_PROMPTS = [
  "What needs my attention?",
  "Why are there banking warnings?",
  "What should I do next?",
  "Show me my biggest financial risks.",
  "Why is my company showing Data Quality warnings?",
  "What is happening with my cash?",
  "Are customers paying late?",
  "Do I have supplier payments that need attention?",
  "How is profitability looking?",
  "What GL issues has VYRON found?",
  "What VAT issues need attention?",
  "What data is missing from my financial picture?",
  "What situations need my attention?",
  "Are any of the warnings related?",
  "Why is VYRON concerned about cash?",
  "What are the main risks in my business?",
  "What are my biggest financial problems?",
  "What should I deal with first?",
];

const UNAVAILABLE_MESSAGE = "VYRON Ask is temporarily unavailable.";

/** Only the last few EXCHANGES (question+answer pairs) are sent as
 * conversation context — bounds request size and matches the server's
 * own cap (`gateway-provider.ts::MAX_CONVERSATION_TURNS`). Session-only:
 * nothing here is ever persisted (brief, section 16). */
const MAX_CONTEXT_EXCHANGES = 3;

type Turn = { question: string; status: "loading" | "done" | "error"; answer?: VyronAskAnswer; errorMessage?: string };

function replaceLast(turns: Turn[], next: Turn): Turn[] {
  return [...turns.slice(0, -1), next];
}

/** The client already legitimately has this data — it's exactly what's
 * rendered on screen. Sent only for tone/continuity; the server always
 * rebuilds the real Evidence Package fresh from authorized data, never
 * from this conversation text (brief, section 16/17). */
function buildConversationContext(turns: Turn[]): { role: "user" | "assistant"; content: string }[] {
  const done = turns.filter((t): t is Turn & { answer: VyronAskAnswer } => t.status === "done" && Boolean(t.answer)).slice(-MAX_CONTEXT_EXCHANGES);
  return done.flatMap((t) => [
    { role: "user" as const, content: t.question },
    { role: "assistant" as const, content: t.answer.answer },
  ]);
}

function AnswerBubble({ turn }: { turn: Turn }) {
  const answeredByAi = turn.answer?.answeredBy === "VyronAI";

  return (
    <div className="flex flex-col gap-2">
      <div className="self-end rounded-vf-md bg-vf-red-500/10 px-4 py-2.5 text-sm font-medium text-vf-ink">{turn.question}</div>

      {turn.status === "loading" && (
        <div className="flex items-center gap-2 rounded-vf-md border border-vf-paper-border bg-vf-paper-alt px-4 py-3 text-sm text-vf-ink-faint">
          <IconSparkles className="h-4 w-4 animate-pulse" />
          VYRON is thinking…
        </div>
      )}

      {turn.status === "error" && (
        <div role="alert" className="flex items-center gap-2 rounded-vf-md border border-vf-danger/25 bg-vf-danger/5 px-4 py-3 text-sm text-vf-danger">
          <IconAlertTriangle className="h-4 w-4 shrink-0" />
          {turn.errorMessage ?? UNAVAILABLE_MESSAGE}
        </div>
      )}

      {turn.status === "done" && turn.answer && (
        <div className="rounded-vf-md border border-vf-paper-border p-4">
          <Badge tone={answeredByAi ? "info" : "muted"} className="mb-2">
            {answeredByAi ? "VYRON AI" : "VYRON Intelligence"}
          </Badge>

          <p className="text-sm text-vf-ink">{turn.answer.answer}</p>

          {turn.answer.keyPoints.length > 0 && (
            <ul className="mt-3 list-disc pl-4 text-sm text-vf-ink-soft">
              {turn.answer.keyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          )}

          {turn.answer.evidence.length > 0 && (
            <div className="mt-3 rounded-vf-sm border border-vf-paper-border bg-vf-paper-alt p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-vf-ink-faint">Evidence</p>
              <ul className="mt-1.5 flex flex-col gap-1 text-xs text-vf-ink-soft">
                {turn.answer.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {turn.answer.evidenceReferences.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {turn.answer.evidenceReferences.map((ref, i) =>
                ref.href ? (
                  <Button key={i} href={ref.href} variant="subtle" size="sm">
                    {ref.label}
                  </Button>
                ) : (
                  <span key={i} className="rounded-full border border-vf-paper-border px-3 py-1.5 text-xs text-vf-ink-soft">
                    {ref.label}
                  </span>
                ),
              )}
            </div>
          )}

          {turn.answer.recommendedActions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {turn.answer.recommendedActions.map((action, i) =>
                action.href ? (
                  <Button key={i} href={action.href} variant="subtle" size="sm">
                    {action.label}
                  </Button>
                ) : (
                  <span key={i} className="rounded-full border border-vf-paper-border px-3 py-1.5 text-xs text-vf-ink-soft">
                    {action.label}
                  </span>
                ),
              )}
            </div>
          )}

          {turn.answer.uncertainties.length > 0 && (
            <div className="mt-3 rounded-vf-sm border border-vf-warning/25 bg-vf-warning/8 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#93601f]">What VYRON AI isn&rsquo;t certain about</p>
              <ul className="mt-1.5 flex flex-col gap-1 text-xs text-vf-ink-soft">
                {turn.answer.uncertainties.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>
          )}

          {turn.answer.sources.length > 0 && (
            <p className="mt-3 text-xs text-vf-ink-faint">
              Source: {turn.answer.sources.join(", ")} — {answeredByAi ? "explained by VYRON AI from VYRON's evidence-based intelligence." : "deterministic, evidence-based. Not generated by a language model."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Phase 12 — VYRON Ask. Reuses the EXISTING `/api/companies/{companyId}/
 * copilot/ask` endpoint (same session/permission/plan/usage-limit checks,
 * same `askCopilot()` engine) — no new API route. This component only
 * builds the request, validates the response before trusting it, and
 * renders — it contains no financial logic of its own.
 *
 * Phase 15 — VYRON Ask is now a hybrid front end: a fixed question still
 * returns an instant VYRON Intelligence answer exactly as before;
 * anything else routes server-side to VYRON AI, which explains VYRON's
 * own evidence rather than computing anything new. Both answer types
 * render through this same component, distinguished only by the
 * "VYRON Intelligence" / "VYRON AI" badge on each answer.
 */
export function VyronAsk({ companyId, previewMode }: { companyId: string; previewMode: boolean }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const busy = turns.some((t) => t.status === "loading");
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function ask(rawQuestion: string) {
    const text = rawQuestion.trim();
    if (!text || previewMode || busy) return;

    const conversation = buildConversationContext(turns);
    setTurns((prev) => [...prev, { question: text, status: "loading" }]);
    setQuestion("");

    // periodStart/periodEnd/financialYearStartDate are required by the
    // existing route contract (unchanged) but unused by the Finding-
    // aware questions this component actually asks — real calendar
    // dates, not meaningful accounting-period choices the user should
    // have to make for a question like "What needs my attention?".
    const todayIso = new Date().toISOString().slice(0, 10);
    try {
      const res = await fetch(`/api/companies/${companyId}/copilot/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          periodStart: `${todayIso.slice(0, 7)}-01`,
          periodEnd: todayIso,
          financialYearStartDate: `${todayIso.slice(0, 4)}-01-01`,
          conversation,
        }),
      });

      if (!res.ok) {
        setTurns((prev) => replaceLast(prev, { question: text, status: "error", errorMessage: UNAVAILABLE_MESSAGE }));
        return;
      }

      const body: unknown = await res.json();
      const rawAnswer = body && typeof body === "object" ? (body as { answer?: unknown }).answer : undefined;
      if (!isValidCopilotAnswer(rawAnswer)) {
        setTurns((prev) => replaceLast(prev, { question: text, status: "error", errorMessage: UNAVAILABLE_MESSAGE }));
        return;
      }

      setTurns((prev) => replaceLast(prev, { question: text, status: "done", answer: toVyronAskAnswer(rawAnswer) }));
    } catch {
      setTurns((prev) => replaceLast(prev, { question: text, status: "error", errorMessage: UNAVAILABLE_MESSAGE }));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <IconSparkles className="h-4 w-4 text-vf-red-600" />
        <div>
          <CardTitle>VYRON Ask</CardTitle>
          <CardDescription>Ask a fixed question for an instant VYRON Intelligence answer, or ask anything else and VYRON AI will explain it.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <p className="text-xs text-vf-ink-faint">VYRON AI answers using your company&rsquo;s financial intelligence and available evidence. It does not independently audit your business.</p>

        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={previewMode || busy}
              onClick={() => ask(prompt)}
              className="rounded-full border border-vf-paper-border px-3 py-1.5 text-xs font-medium text-vf-ink-soft transition hover:border-vf-red-400 disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>

        {turns.length === 0 ? (
          <p className="text-sm text-vf-ink-faint">Ask a question above, or click one of the suggested prompts. Anything not on the list is answered by VYRON AI.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {turns.map((turn, i) => (
              <AnswerBubble key={i} turn={turn} />
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            placeholder="Ask VYRON anything about your financial intelligence…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") ask(question);
            }}
            disabled={previewMode}
            className="flex-1"
          />
          <Button variant="primary" size="sm" disabled={previewMode || busy || !question.trim()} title={disabledTitle} onClick={() => ask(question)}>
            {busy ? "Asking…" : "Ask"}
          </Button>
        </div>
        {previewMode && <Badge tone="muted">Available once a production Supabase project is connected</Badge>}
      </CardContent>
    </Card>
  );
}
