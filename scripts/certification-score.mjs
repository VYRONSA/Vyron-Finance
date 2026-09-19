/**
 * Phase 5Q.7 — score a completed certification run.
 *
 *   node scripts/certification-score.mjs --run=<id>
 *
 * Read-only and deterministic. Reads persisted evidence through the
 * certification reader, scores it against the frozen answer keys as
 * corrected by `expectations-v2.json`, and prints the report.
 *
 * Contacts no AI provider — it only needs the certification database.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRET_VARS = ["VYRON_CERTIFICATION_SUPABASE_URL", "VYRON_CERTIFICATION_SERVICE_ROLE_KEY"];

function die(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

function loadSecrets() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) die(`no ${path}.`);
  const found = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    if (!SECRET_VARS.includes(name)) continue;
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!value) continue;
    process.env[name] = value;
    found.push(name);
  }
  return found;
}

async function main() {
  const runArg = process.argv.slice(2).find((a) => a.startsWith("--run="));
  const runId = runArg ? Number(runArg.slice("--run=".length)) : null;
  if (!runId || !Number.isFinite(runId)) die("--run=<id> is required.");

  const found = loadSecrets();
  for (const name of SECRET_VARS) if (!found.includes(name)) die(`${name} is not set in .env.local.`);

  let createJiti;
  try {
    ({ createJiti } = await import("jiti"));
  } catch {
    die("jiti is not available.");
  }
  const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": join(ROOT, "src") } });

  const budget = await jiti.import("../src/server/supplier-invoice-capture/certification-budget.ts");
  const evidenceModule = await jiti.import("../src/server/supplier-invoice-capture/certification-evidence.ts");
  const scoring = await jiti.import("../src/server/supplier-invoice-capture/certification-scoring.ts");

  const db = budget.createCertificationDb(process.env);
  if (!db) die("the certification database could not be constructed.");

  const evidence = await evidenceModule.readCertificationEvidence(db, runId);
  if (evidence.length === 0) die(`certification run #${runId} has no recorded evidence.`);

  console.log(scoring.formatRunScore(scoring.scoreRun(runId, evidence)));
}

main().catch((error) => {
  console.error(`SCORING ERROR: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
