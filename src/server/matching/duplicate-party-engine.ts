/**
 * The shared "duplicate master-record" pattern — extracted, behavior-
 * preserving, from `audit-tests-engine.ts::findDuplicateParties` (the
 * Auditor Workspace's own Duplicate Customers/Suppliers tests), the same
 * "extract the PATTERN, keep the exact rule set" refactor technique
 * already used for `confidence-engine.ts`. Two passes: a normalized-name
 * collision (weaker signal) and a shared-secondary-identifier collision
 * (bank account / VAT / registration / SKU — stronger signal, higher
 * confidence). Used by the Auditor Workspace (Customers/Suppliers, via
 * `audit-tests-engine.ts`'s thin wrapper) AND directly by the Matching
 * Platform's own Duplicate Detection tab for entity types the Auditor
 * Workspace has no finding type for (Merchants, Inventory Items) — one
 * detector, two consumers, never two implementations.
 */

function normalizeIdentifier(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type DuplicatableParty = { id: number; name: string; secondaryIds: string[] };

export type DuplicatePartyFinding = {
  relatedId: number;
  groupIds: number[];
  confidence: number;
  reason: string;
  evidence: string;
  suggestedProcedure: string;
};

export function findDuplicateParties(parties: DuplicatableParty[]): DuplicatePartyFinding[] {
  const findings: DuplicatePartyFinding[] = [];

  const byName = new Map<string, DuplicatableParty[]>();
  for (const p of parties) {
    const key = normalizeIdentifier(p.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const groupIds = group.map((g) => g.id);
    for (const p of group) {
      findings.push({
        relatedId: p.id,
        groupIds,
        confidence: 0.6,
        reason: `${group.length} records share the normalized name "${group[0].name}".`,
        evidence: `Matching IDs: ${groupIds.join(", ")}.`,
        suggestedProcedure: "Confirm these aren't the same real-world record captured twice under slightly different spelling.",
      });
    }
  }

  const bySecondary = new Map<string, DuplicatableParty[]>();
  for (const p of parties) {
    for (const raw of p.secondaryIds) {
      const key = normalizeIdentifier(raw);
      if (!key) continue;
      bySecondary.set(key, [...(bySecondary.get(key) ?? []), p]);
    }
  }
  for (const group of bySecondary.values()) {
    const groupIds = [...new Set(group.map((g) => g.id))];
    if (groupIds.length < 2) continue;
    for (const p of group) {
      findings.push({
        relatedId: p.id,
        groupIds,
        confidence: 0.8,
        reason: `${groupIds.length} distinct records share the same secondary identifier (bank account / VAT / registration / code).`,
        evidence: `Matching IDs: ${groupIds.join(", ")}.`,
        suggestedProcedure: "Verify whether these should be merged — a shared secondary identifier is a strong duplicate signal.",
      });
    }
  }

  return findings;
}
