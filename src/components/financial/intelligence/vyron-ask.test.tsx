import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { VyronAsk } from "./vyron-ask";
import type { CopilotAnswer } from "@/server/copilot/copilot-assistant-engine";

function answer(overrides: Partial<CopilotAnswer> = {}): CopilotAnswer {
  return {
    questionId: "needs-attention",
    question: "What needs my attention?",
    executiveSummary: "2 item(s) currently need attention. The most urgent is [Critical] 3 possible duplicates detected.",
    confidence: 0.85,
    evidence: ["3 open PossibleDuplicate exception(s)."],
    calculationsUsed: "Reused financial-intelligence-engine.ts.",
    transactionsConsulted: [],
    journalsConsulted: [],
    documentsConsulted: ["VYRON Intelligence Centre"],
    suggestedActions: ["Review Banking Exceptions"],
    alternativeExplanations: [],
    keyPoints: ["[Critical] 3 possible duplicates detected"],
    actionLinks: [{ label: "Review Banking Exceptions", href: "/company/co_1/banking-exceptions" }],
    ...overrides,
  };
}

describe("VyronAsk", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the VYRON Ask header, subtitle, and every example prompt", () => {
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    expect(screen.getByText("VYRON Ask")).toBeInTheDocument();
    expect(screen.getByText("Ask a fixed question for an instant VYRON Intelligence answer, or ask anything else and VYRON AI will explain it.")).toBeInTheDocument();
    for (const prompt of [
      "What needs my attention?",
      "Why are there banking warnings?",
      "What should I do next?",
      "Show me my biggest financial risks.",
      "Why is my company showing Data Quality warnings?",
    ]) {
      expect(screen.getByRole("button", { name: prompt })).toBeInTheDocument();
    }
  });

  it("shows every Phase 14 Business Situation-aware example prompt", () => {
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    for (const prompt of [
      "What situations need my attention?",
      "Are any of the warnings related?",
      "Why is VYRON concerned about cash?",
      "What are the main risks in my business?",
      "What are my biggest financial problems?",
      "What should I deal with first?",
    ]) {
      expect(screen.getByRole("button", { name: prompt })).toBeInTheDocument();
    }
  });

  it("shows an empty conversation state before anything is asked", () => {
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    expect(screen.getByText("Ask a question above, or click one of the suggested prompts. Anything not on the list is answered by VYRON AI.")).toBeInTheDocument();
  });

  it("shows the AI disclosure line", () => {
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    expect(screen.getByText(/VYRON AI answers using your company.s financial intelligence and available evidence/)).toBeInTheDocument();
    expect(screen.getByText(/does not independently audit your business/)).toBeInTheDocument();
  });

  it("asks a question with direct evidence and renders the answer, evidence, and a real recommended-action button", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: answer() }) }));
    render(<VyronAsk companyId="co_1" previewMode={false} />);

    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));

    await waitFor(() => expect(screen.getByText(/2 item\(s\) currently need attention/)).toBeInTheDocument());
    expect(screen.getByText("3 open PossibleDuplicate exception(s).")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review Banking Exceptions" })).toHaveAttribute("href", "/company/co_1/banking-exceptions");
  });

  it("sends the real question text to the existing /copilot/ask endpoint, never a new route", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: answer() }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<VyronAsk companyId="co_1" previewMode={false} />);

    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/companies/co_1/copilot/ask");
    const body = JSON.parse(init.body);
    expect(body.question).toBe("What needs my attention?");
    expect(typeof body.periodStart).toBe("string");
    expect(typeof body.periodEnd).toBe("string");
    expect(typeof body.financialYearStartDate).toBe("string");
  });

  it("renders multiple findings' key points together for a question with multiple findings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ answer: answer({ keyPoints: ["[Critical] Finding A", "[High] Finding B", "[Medium] Finding C"] }) }),
      }),
    );
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByText("[Critical] Finding A")).toBeInTheDocument());
    expect(screen.getByText("[High] Finding B")).toBeInTheDocument();
    expect(screen.getByText("[Medium] Finding C")).toBeInTheDocument();
  });

  it("answers a question with no relevant findings honestly, with zero fabricated evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ answer: answer({ executiveSummary: "There are no banking warnings right now.", evidence: [], keyPoints: [], actionLinks: [], suggestedActions: [] }) }),
      }),
    );
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Why are there banking warnings?" }));
    await waitFor(() => expect(screen.getByText("There are no banking warnings right now.")).toBeInTheDocument());
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
  });

  it("presents a Data Quality answer with reassuring language, distinct from a financial-problem framing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          answer: answer({
            executiveSummary: "VYRON has 1 Data Quality note(s). These don't mean something is financially wrong — they mean VYRON's picture of your business is still incomplete: No bank transactions have been imported yet.",
            evidence: ["0 import batches found."],
            keyPoints: ["No bank transactions have been imported yet"],
            actionLinks: [{ label: "Import a bank statement", href: "/company/co_1/import-centre" }],
          }),
        }),
      }),
    );
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Why is my company showing Data Quality warnings?" }));
    await waitFor(() => expect(screen.getByText(/don.t mean something is financially wrong/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Import a bank statement" })).toHaveAttribute("href", "/company/co_1/import-centre");
  });

  it("does not render a button for a recommended action with no real route (no fake button)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: answer({ actionLinks: undefined, suggestedActions: ["Review cost of sales."] }) }) }),
    );
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Show me my biggest financial risks." }));
    await waitFor(() => expect(screen.getByText("Review cost of sales.")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "Review cost of sales." })).not.toBeInTheDocument();
  });

  it("fails gracefully when the endpoint returns a non-OK response (provider failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "Internal error" }) }));
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("VYRON Ask is temporarily unavailable."));
  });

  it("fails gracefully when fetch itself rejects (network failure)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("VYRON Ask is temporarily unavailable."));
  });

  it("fails gracefully and never renders a malformed provider response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: { executiveSummary: 42 } }) }));
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("VYRON Ask is temporarily unavailable."));
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("disables prompts and the input in preview mode", () => {
    render(<VyronAsk companyId="co_1" previewMode />);
    expect(screen.getByRole("button", { name: "What needs my attention?" })).toBeDisabled();
    expect(screen.getByPlaceholderText("Ask VYRON anything about your financial intelligence…")).toBeDisabled();
  });

  it("has no obvious accessibility violations with an answered conversation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: answer() }) }));
    const { container } = render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByText(/2 item\(s\) currently need attention/)).toBeInTheDocument());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("VyronAsk — Phase 15 VYRON AI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("badges a deterministic answer 'VYRON Intelligence'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: answer({ answeredBy: "VyronIntelligence" }) }) }));
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByText("VYRON Intelligence")).toBeInTheDocument());
    expect(screen.queryByText("VYRON AI")).not.toBeInTheDocument();
  });

  it("badges an AI-generated answer 'VYRON AI', distinct from a deterministic one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          answer: answer({
            answeredBy: "VyronAI",
            questionId: "vyron-ai",
            question: "What's worrying you most?",
            executiveSummary: "VYRON currently identifies two business situations requiring attention.",
            keyPoints: [],
            evidence: [],
            actionLinks: [],
          }),
        }),
      }),
    );
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.change(screen.getByPlaceholderText("Ask VYRON anything about your financial intelligence…"), { target: { value: "What's worrying you most?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("VYRON currently identifies two business situations requiring attention.")).toBeInTheDocument());
    expect(screen.getByText("VYRON AI")).toBeInTheDocument();
    expect(screen.queryByText("VYRON Intelligence")).not.toBeInTheDocument();
  });

  it("renders clickable evidence references distinct from the plain evidence list (citations)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          answer: answer({
            answeredBy: "VyronAI",
            evidenceReferences: [{ label: "VYRON Intelligence — Cash Collection Pressure", href: "/company/co_1/intelligence" }],
            evidence: [],
            actionLinks: [],
          }),
        }),
      }),
    );
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "VYRON Intelligence — Cash Collection Pressure" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "VYRON Intelligence — Cash Collection Pressure" })).toHaveAttribute("href", "/company/co_1/intelligence");
  });

  it("renders VYRON AI's own flagged uncertainties, honestly labeled, when present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ answer: answer({ answeredBy: "VyronAI", uncertainties: ["The exact cause of the shortfall isn't captured in the current evidence."], evidence: [], actionLinks: [] }) }),
      }),
    );
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByText(/What VYRON AI isn.t certain about/)).toBeInTheDocument());
    expect(screen.getByText("The exact cause of the shortfall isn't captured in the current evidence.")).toBeInTheDocument();
  });

  it("never renders an uncertainties section when there are none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: answer({ answeredBy: "VyronIntelligence" }) }) }));
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByText("VYRON Intelligence")).toBeInTheDocument());
    expect(screen.queryByText(/What VYRON AI isn.t certain about/)).not.toBeInTheDocument();
  });

  it("sends the prior exchange as conversation context on the next question (multi-turn context)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: answer() }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<VyronAsk companyId="co_1" previewMode={false} />);

    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(screen.getByText(/2 item\(s\) currently need attention/)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Ask VYRON anything about your financial intelligence…"), { target: { value: "Tell me more about that." } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondCallBody.conversation).toEqual([{ role: "user", content: "What needs my attention?" }, { role: "assistant", content: answer().executiveSummary }]);
  });

  it("sends no conversation context on the very first question", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: answer() }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<VyronAsk companyId="co_1" previewMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "What needs my attention?" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.conversation).toEqual([]);
  });
});
