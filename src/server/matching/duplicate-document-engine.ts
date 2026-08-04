/**
 * The shared "duplicate transactional document" pattern — a genuinely
 * new primitive (confirmed absent by research: no duplicate-detector
 * exists anywhere for Sales Orders, Purchase Orders, Quotations, Bills-
 * as-documents, Receipts, or Payments). Unlike `duplicate-party-engine.ts`
 * (name/secondary-id collision, for master data), a transactional
 * document has no "name" — a duplicate here means the same party entered
 * the same amount twice within a short window, optionally corroborated
 * by a shared reference number. One detector, reused by every document
 * type's thin wrapper in `duplicate-detection-service.ts`.
 */

export type DuplicatableDocument = { id: number; partyId: number | null; amount: number; date: string | null; reference: string };

export type DuplicateDocumentFinding = {
  relatedId: number;
  groupIds: number[];
  confidence: number;
  reason: string;
  evidence: string;
};

const AMOUNT_TOLERANCE = 0.01;
const DEFAULT_WINDOW_DAYS = 3;

function daysBetween(a: string, b: string): number {
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

export function findDuplicateDocuments(documents: DuplicatableDocument[], windowDays = DEFAULT_WINDOW_DAYS): DuplicateDocumentFinding[] {
  const byParty = new Map<number, DuplicatableDocument[]>();
  for (const d of documents) {
    if (d.partyId === null || d.date === null) continue;
    const list = byParty.get(d.partyId) ?? [];
    list.push(d);
    byParty.set(d.partyId, list);
  }

  const findings: DuplicateDocumentFinding[] = [];
  for (const group of byParty.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (Math.abs(a.amount - b.amount) > AMOUNT_TOLERANCE) continue;
        if (daysBetween(a.date!, b.date!) > windowDays) continue;

        const referenceMatch = Boolean(a.reference) && a.reference === b.reference;
        const confidence = referenceMatch ? 0.85 : 0.6;
        const reason = referenceMatch
          ? `Same party, amount, and reference "${a.reference}" within ${windowDays} day(s).`
          : `Same party and exact amount (within ${windowDays} day(s)) — possible duplicate entry.`;
        const evidence = `Matching IDs: ${a.id}, ${b.id}.`;

        findings.push({ relatedId: a.id, groupIds: [a.id, b.id], confidence, reason, evidence });
        findings.push({ relatedId: b.id, groupIds: [a.id, b.id], confidence, reason, evidence });
      }
    }
  }
  return findings;
}
