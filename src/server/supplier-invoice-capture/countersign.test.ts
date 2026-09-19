/**
 * Phase 5O — the countersignature gate, tested.
 *
 * @vitest-environment node
 *
 * The property that matters: live certification cannot begin until a second,
 * independent reader has agreed with every answer key — and that agreement
 * must be about the corpus as it stands, not about some earlier version of
 * it.
 *
 * NO PROVIDER IS CONTACTED BY ANY TEST HERE.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countersignReport,
  loadCountersignatures,
  requireCountersignedCorpus,
  REQUIRED_CHECKS,
  type CountersignatureFile,
} from "./countersign";
import { loadManifest } from "./certification-corpus";

const MANIFEST = loadManifest();

/** A throwaway copy of the real corpus, so a test can tamper without
 * touching the corpus the repository is certifying against. */
function corpusCopy(mutate?: (signatures: CountersignatureFile, root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), "vyron-corpus-"));
  mkdirSync(root, { recursive: true });
  cpSync("certification-corpus", root, { recursive: true });
  if (mutate) {
    const signatures = JSON.parse(readFileSync(join(root, "countersignatures.json"), "utf8")) as CountersignatureFile;
    mutate(signatures, root);
    writeFileSync(join(root, "countersignatures.json"), JSON.stringify(signatures, null, 2));
  }
  return root;
}

/** A complete, honest sign-off of every case. */
function signAll(signatures: CountersignatureFile, who = "A. Reviewer", on = "2026-09-20"): void {
  signatures.reviewedBy = who;
  signatures.reviewedOn = on;
  for (const caseId of Object.keys(signatures.cases)) {
    signatures.cases[caseId] = {
      status: "agreed",
      reviewedBy: who,
      reviewedOn: on,
      checks: Object.fromEntries(REQUIRED_CHECKS.map((c) => [c, true])),
      discrepancies: [],
      notes: "",
    };
  }
}

describe("the countersignature file as it stands today", () => {
  it("exists, covers all 24 cases, and is bound to the current corpus", () => {
    const signatures = loadCountersignatures();
    expect(Object.keys(signatures.cases)).toHaveLength(24);
    expect(signatures.corpusSha256).toBe(MANIFEST.corpusSha256);
  });

  it("is complete — all 24 keys independently countersigned", () => {
    // Phase 5O asserted the opposite here, with a note that it should be
    // updated deliberately once a review had actually happened. It has:
    // an independent reader countersigned all 24 keys on 2026-09-19
    // against corpus cce1e61…72be3. This is the state transition, and it
    // is recorded rather than quietly deleted.
    const report = countersignReport();
    expect(report.complete).toBe(true);
    expect(report.pending).toBe(0);
    expect(report.agreed).toBe(24);
    expect(report.discrepancies).toBe(0);
  });

  it("no longer blocks live certification", () => {
    expect(() => requireCountersignedCorpus()).not.toThrow();
    expect(requireCountersignedCorpus().complete).toBe(true);
  });
});

describe("a complete countersignature opens the gate", () => {
  it("passes once every case is agreed by a named reviewer", () => {
    const root = corpusCopy((signatures) => signAll(signatures));
    const report = countersignReport(root);

    expect(report.blockers).toEqual([]);
    expect(report.complete).toBe(true);
    expect(report.agreed).toBe(24);
    expect(report.reviewedBy).toBe("A. Reviewer");
    expect(() => requireCountersignedCorpus(root)).not.toThrow();
  });
});

describe("what must still block it", () => {
  it("one unreviewed case blocks all 24", () => {
    const root = corpusCopy((signatures) => {
      signAll(signatures);
      signatures.cases["credit-note"].status = "pending";
    });
    const report = countersignReport(root);
    expect(report.complete).toBe(false);
    expect(report.pending).toBe(1);
    expect(report.agreed).toBe(23);
  });

  it("a case ticked 'agreed' without actually confirming the checks does not count", () => {
    // The shape a rubber-stamp arrives in: status set, boxes unticked.
    const root = corpusCopy((signatures) => {
      signAll(signatures);
      signatures.cases["weight-column"].checks = { supplierIdentity: true };
    });
    const report = countersignReport(root);
    expect(report.complete).toBe(false);
    expect(report.blockers.join(" ")).toMatch(/weight-column \(unconfirmed: documentIdentity/);
  });

  it("an agreed case with no reviewer named does not count", () => {
    const root = corpusCopy((signatures) => {
      signAll(signatures);
      signatures.cases["clean-pdf"].reviewedBy = "  ";
    });
    expect(countersignReport(root).blockers.join(" ")).toMatch(/clean-pdf \(no reviewer named\)/);
  });

  it("an unattributed file-level sign-off is refused", () => {
    const root = corpusCopy((signatures) => {
      signAll(signatures);
      signatures.reviewedBy = null;
    });
    expect(countersignReport(root).blockers.join(" ")).toMatch(/unattributed sign-off is not a sign-off/i);
  });

  it("a RECORDED DISCREPANCY blocks certification and is never downgraded to a warning", () => {
    const root = corpusCopy((signatures) => {
      signAll(signatures);
      signatures.cases["discount"] = {
        status: "discrepancy",
        reviewedBy: "A. Reviewer",
        reviewedOn: "2026-09-20",
        checks: Object.fromEntries(REQUIRED_CHECKS.map((c) => [c, true])),
        discrepancies: [{ field: "vatAmount", originalValue: "135.00", correctedValue: "150.00", reason: "reviewer reads the page differently" }],
        notes: "VAT appears to be on the pre-discount amount",
      };
    });
    const report = countersignReport(root);

    expect(report.complete).toBe(false);
    expect(report.discrepancies).toBe(1);
    // And the message must say a HUMAN resolves it — nothing here may
    // quietly adopt the reviewer's value into the answer key.
    expect(report.blockers.join(" ")).toMatch(/A human must resolve each one/);
    expect(report.blockers.join(" ")).toMatch(/nothing resolves these automatically/i);
    expect(() => requireCountersignedCorpus(root)).toThrow();
  });
});

describe("the signature is bound to the exact corpus reviewed", () => {
  it("a corpus edited AFTER review voids every signature", () => {
    // The decisive property. A sign-off that survived an edit would carry
    // authority it had not earned — someone could review the corpus, then
    // change an answer key, and the review would still read as complete.
    const root = corpusCopy((signatures, dir) => {
      signAll(signatures);
      const truthPath = join(dir, "ground-truth", "clean-pdf.json");
      const truth = JSON.parse(readFileSync(truthPath, "utf8"));
      truth.printedTotals.total = 9999;
      writeFileSync(truthPath, `${JSON.stringify(truth, null, 2)}\n`);
    });

    const report = countersignReport(root);
    expect(report.complete).toBe(false);
    // Two independent alarms: the corpus no longer matches its manifest...
    expect(report.blockers.join(" ")).toMatch(/does not match its manifest/i);
    expect(() => requireCountersignedCorpus(root)).toThrow();
  });

  it("a signature given for a DIFFERENT corpus hash is refused", () => {
    const root = corpusCopy((signatures) => {
      signAll(signatures);
      signatures.corpusSha256 = "0".repeat(64);
    });
    const report = countersignReport(root);

    expect(report.boundToCurrentCorpus).toBe(false);
    expect(report.complete).toBe(false);
    expect(report.blockers.join(" ")).toMatch(/every signature is void/i);
  });

  it("reports both hashes so a reader can see what changed", () => {
    const root = corpusCopy((signatures) => {
      signAll(signatures);
      signatures.corpusSha256 = "0".repeat(64);
    });
    const report = countersignReport(root);
    expect(report.signedAgainst).toBe("0".repeat(64));
    expect(report.corpusSha256).toBe(MANIFEST.corpusSha256);
  });
});

describe("the review pack", () => {
  const pack = readFileSync("certification-corpus/review/countersign-pack.html", "utf8");

  it("is bound to the corpus hash it was built for", () => {
    expect(pack).toContain(MANIFEST.corpusSha256);
  });

  it("covers every case, with every required confirmation", () => {
    for (const entry of MANIFEST.cases) {
      expect(`${entry.caseId}:${pack.includes(`id="case-${entry.caseId}"`)}`).toBe(`${entry.caseId}:true`);
    }
    for (const check of REQUIRED_CHECKS) {
      expect(pack).toContain(`data-check="${check}"`);
    }
  });

  it("shows the reviewer the document itself, not merely its filename", () => {
    // A review of a rendering of the answer key against the answer key
    // would prove nothing at all.
    expect(pack).toMatch(/<embed class="doc" src="\.\.\/documents\//);
    expect(pack).toMatch(/<img class="doc" src="\.\.\/documents\//);
  });

  it("warns that the deliberately wrong document is supposed to be wrong", () => {
    // Without this a conscientious reviewer would "fix" the key for
    // arithmetic-mismatch, which would destroy the case's whole purpose.
    expect(pack).toMatch(/deliberately WRONG/);
    expect(pack).toMatch(/records what is <b>printed<\/b>/);
  });

  it("explains that an empty field is not automatically an error", () => {
    expect(pack).toMatch(/correctly absent/i);
    expect(pack).toMatch(/not applicable/i);
  });

  it("sends nothing anywhere — it is a local page over local files", () => {
    expect(pack).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|https?:\/\/(?!schema)/);
    expect(pack).not.toMatch(/AI_GATEWAY_API_KEY|generateObject|api\.|gateway/i);
  });

  it("refuses to export an unattributed or incomplete review", () => {
    expect(pack).toMatch(/an unattributed sign-off is not a sign-off/i);
    expect(pack).toMatch(/still unreviewed/);
  });
});
