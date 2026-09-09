import type { TransactionDetail } from "@/server/accounting/types";

type TimelineEvent = {
  key: string;
  label: string;
  timestamp: string | null;
  detail: string;
  reached: boolean;
};

/** Real events only, chronologically ordered. Journal Created only
 * appears once a journal actually exists; Posted reflects the journal's
 * real status — reached once the General Ledger's posting engine
 * (`posting-engine-service.ts`) has actually written it to
 * `gl_transactions`, not before. */
export function TransactionTimeline({ detail }: { detail: TransactionDetail }) {
  const { transaction, matchHistory, reviewHistory, journal } = detail;

  const events: TimelineEvent[] = [
    { key: "imported", label: "Imported", timestamp: transaction.createdAt, detail: transaction.sourceFilename || transaction.importBatch, reached: true },
  ];

  const firstMatch = matchHistory[0];
  events.push({
    key: "matched",
    label: "Matched",
    timestamp: firstMatch?.createdAt ?? null,
    detail: firstMatch ? `${firstMatch.newStatus} — ${firstMatch.reason}` : "Not yet matched",
    reached: matchHistory.length > 0,
  });

  const glAssigned = transaction.suggestedGlAccount !== null;
  events.push({
    key: "gl-assigned",
    label: "GL Assigned",
    timestamp: null,
    detail: glAssigned ? `${transaction.suggestedGlAccount}` : "Not yet assigned",
    reached: glAssigned,
  });

  const vatAssigned = transaction.suggestedVatCode !== null;
  events.push({
    key: "vat-assigned",
    label: "VAT Assigned",
    timestamp: null,
    detail: vatAssigned ? `${transaction.suggestedVatCode}` : "Not yet assigned",
    reached: vatAssigned,
  });

  const lastReview = reviewHistory.at(-1);
  events.push({
    key: "reviewed",
    label: "Reviewed",
    timestamp: lastReview?.createdAt ?? null,
    detail: lastReview ? `${lastReview.newReviewStatus} by ${lastReview.performedBy}` : "Not yet reviewed",
    reached: reviewHistory.length > 0,
  });

  events.push({
    key: "journal-created",
    label: "Journal Created",
    timestamp: journal?.createdAt ?? null,
    detail: journal ? `${journal.journalNumber} (${journal.status})` : "No journal generated yet",
    reached: journal !== null,
  });

  events.push({
    key: "posted",
    label: "Posted",
    timestamp: journal?.postedAt ?? null,
    detail: journal?.status === "Posted" ? "Posted to the General Ledger" : "Not yet posted",
    reached: journal?.status === "Posted",
  });

  return (
    <ol className="flex flex-col gap-0">
      {events.map((event, i) => (
        <li key={event.key} className="relative flex gap-3 pb-4 last:pb-0">
          {i < events.length - 1 && <span aria-hidden className="absolute top-3 left-[5px] h-full w-px bg-vf-paper-border" />}
          <span
            aria-hidden
            className={`relative mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${event.reached ? "bg-vf-red-500" : "bg-vf-paper-border"}`}
          />
          <div>
            <p className={`text-sm font-medium ${event.reached ? "text-vf-ink" : "text-vf-ink-faint"}`}>{event.label}</p>
            <p className="text-xs text-vf-ink-faint">{event.detail}</p>
            {event.timestamp && <p className="text-[0.65rem] text-vf-ink-faint">{new Date(event.timestamp).toLocaleString()}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
