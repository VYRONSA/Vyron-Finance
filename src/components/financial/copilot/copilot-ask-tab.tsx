"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SUPPORTED_COPILOT_QUESTIONS, type CopilotAnswer } from "@/server/copilot/copilot-assistant-engine";

function AnswerCard({ answer }: { answer: CopilotAnswer }) {
  return (
    <div className="rounded-vf-md border border-vf-paper-border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-vf-ink">{answer.question}</p>
        <Badge tone={answer.confidence >= 0.6 ? "good" : answer.confidence > 0 ? "warn" : "muted"}>{Math.round(answer.confidence * 100)}% confidence</Badge>
      </div>
      <p className="mt-2 text-sm text-vf-ink-soft">{answer.executiveSummary}</p>

      {answer.evidence.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-vf-ink-faint">Evidence</p>
          <ul className="mt-1 list-disc pl-4 text-sm text-vf-ink-soft">
            {answer.evidence.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {answer.transactionsConsulted.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-vf-ink-faint">Transactions Consulted ({answer.transactionsConsulted.length})</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {answer.transactionsConsulted.slice(0, 20).map((t) => (
              <span key={t.id} className="rounded-full border border-vf-paper-border px-2 py-1 text-xs text-vf-ink-soft">
                {t.label}
                {t.amount !== null && ` — ${t.amount.toFixed(2)}`}
              </span>
            ))}
          </div>
        </div>
      )}

      {answer.journalsConsulted.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-vf-ink-faint">Journals Consulted ({answer.journalsConsulted.length})</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {answer.journalsConsulted.slice(0, 20).map((j) => (
              <span key={j.id} className="rounded-full border border-vf-paper-border px-2 py-1 text-xs text-vf-ink-soft">
                {j.label}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-vf-ink-faint">
        <span className="font-medium">Calculations Used:</span> {answer.calculationsUsed}
      </p>
      {answer.documentsConsulted.length > 0 && <p className="mt-1 text-xs text-vf-ink-faint">Documents Consulted: {answer.documentsConsulted.join(", ")}</p>}
      {answer.suggestedActions.length > 0 && (
        <div className="mt-2">
          <p className="text-xs font-medium text-vf-ink-faint">Suggested Actions</p>
          <ul className="mt-1 list-disc pl-4 text-sm text-vf-ink-soft">
            {answer.suggestedActions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {answer.alternativeExplanations.length > 0 && (
        <div className="mt-2 rounded-vf-sm bg-vf-warning/10 p-2 text-xs text-vf-ink-soft">
          <p className="font-medium text-vf-ink-faint">Alternative Explanations</p>
          <ul className="mt-1 list-disc pl-4">
            {answer.alternativeExplanations.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CopilotAskTab({
  companyId,
  periodStart,
  periodEnd,
  financialYearStartDate,
  previewMode,
}: {
  companyId: string;
  periodStart: string;
  periodEnd: string;
  financialYearStartDate: string;
  previewMode: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<CopilotAnswer[]>([]);
  const [loading, setLoading] = useState(false);
  const disabledTitle = previewMode ? "Available once a production Supabase project is connected" : undefined;

  async function ask(q: string) {
    if (!q.trim() || previewMode) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${companyId}/copilot/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, periodStart, periodEnd, financialYearStartDate }),
      });
      const data = await res.json();
      if (res.ok) setHistory((h) => [data.answer, ...h]);
      setQuestion("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        <p className="text-xs text-vf-ink-faint">
          Answers a fixed catalog of evidence-backed executive questions from live platform data — never an unsupported conclusion. Every answer
          states its Executive Summary, Confidence, Evidence, Calculations Used, Transactions/Journals/Documents Consulted, Suggested Actions, and
          Alternative Explanations where appropriate.
        </p>

        <div className="flex flex-wrap gap-2">
          {SUPPORTED_COPILOT_QUESTIONS.map((q) => (
            <button
              key={q.id}
              type="button"
              disabled={previewMode || loading}
              onClick={() => ask(q.label)}
              className="rounded-full border border-vf-paper-border px-3 py-1.5 text-xs font-medium text-vf-ink-soft transition hover:border-vf-red-400 disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <Input placeholder="Ask the Executive Copilot…" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={previewMode} className="flex-1" />
          <Button variant="primary" size="sm" disabled={previewMode || loading || !question.trim()} title={disabledTitle} onClick={() => ask(question)}>
            {loading ? "Asking…" : "Ask"}
          </Button>
        </div>

        {history.length === 0 ? (
          <p className="text-sm text-vf-ink-faint">Ask a question above, or click one of the supported questions.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {history.map((a, i) => (
              <AnswerCard key={i} answer={a} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
