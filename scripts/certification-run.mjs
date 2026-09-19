/**
 * Phase 5Q.1 — CLI for the 24-document certification run.
 *
 *   node scripts/certification-run.mjs --company=<uuid>            # dry run
 *   node scripts/certification-run.mjs --company=<uuid> --confirm  # the real run
 *
 * THE DEFAULT IS A DRY RUN. With no `--confirm` it performs every gate,
 * opens nothing, reserves nothing and sends nothing. Spending twenty-four
 * paid requests requires typing a word.
 *
 * ORDER, AND WHY IT IS THIS ORDER
 *
 *   1. credential          — from .env.local, whitelisted, never printed
 *   2. certification DB    — from DEDICATED variables, never the app's
 *   3. corpus gates        — countersignature, frozen hash, all 48 files
 *   4. open ONE run        — only after the gates pass
 *   5. per case: reserve → send → record
 *   6. close the run       — in a finally, so it closes however this ends
 *
 * The gates run BEFORE the run is opened. Opening first would write a row
 * into `ai_certification_runs` describing an experiment that never
 * happened, and that table is meant to be a record of what actually did.
 *
 * TWO SECRETS, NEITHER EVER PRINTED
 *
 * `AI_GATEWAY_API_KEY` reaches the Gateway SDK; the Supabase service-role
 * key reaches the Supabase client. Neither is logged, echoed, passed as an
 * argument or written anywhere. Both are read into `process.env` and then
 * only ever handled by the libraries that need them.
 *
 * WHY THE SUPABASE VARIABLES HAVE CERTIFICATION-SPECIFIC NAMES
 *
 * `VYRON_CERTIFICATION_SUPABASE_URL` and
 * `VYRON_CERTIFICATION_SERVICE_ROLE_KEY` — deliberately NOT the app's
 * `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. If a shell had
 * production in those, certification would open runs and reserve calls in
 * the production database. There is no fallback to them, and a test
 * asserts the fallback does not exist.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The only variables taken from `.env.local`. A whitelist, so a stray
 * entry in that file cannot change how this process behaves. */
const SECRET_VARS = ["AI_GATEWAY_API_KEY", "VYRON_CERTIFICATION_SUPABASE_URL", "VYRON_CERTIFICATION_SERVICE_ROLE_KEY"];

function die(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

/** Loads the whitelisted variables. Returns the NAMES it found, never the
 * values — nothing in this file should be able to print what it loaded. */
function loadSecrets() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) die(`no ${path}. The non-production credentials must be supplied there.`);

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
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const companyArg = args.find((a) => a.startsWith("--company="));
  const companyId = companyArg ? companyArg.slice("--company=".length) : null;

  const found = loadSecrets();

  if (!found.includes("AI_GATEWAY_API_KEY")) die("AI_GATEWAY_API_KEY is not set in .env.local.");
  if (!found.includes("VYRON_CERTIFICATION_SUPABASE_URL")) {
    die("VYRON_CERTIFICATION_SUPABASE_URL is not set in .env.local. The call ceiling cannot be enforced, so nothing will be sent.");
  }
  if (!found.includes("VYRON_CERTIFICATION_SERVICE_ROLE_KEY")) {
    die("VYRON_CERTIFICATION_SERVICE_ROLE_KEY is not set in .env.local. The call ceiling cannot be enforced, so nothing will be sent.");
  }
  if (!companyId) die("--company=<uuid> is required: a certification run belongs to a company.");

  // In-process only, never written back to any file.
  process.env.VYRON_AI_INVOICE_EXTRACTION = "certification";

  let createJiti;
  try {
    ({ createJiti } = await import("jiti"));
  } catch {
    die("jiti is not available, so the TypeScript controller cannot be loaded. Nothing was sent.");
  }
  const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": join(ROOT, "src") } });

  const run = await jiti.import("../src/server/supplier-invoice-capture/certification-run.ts");
  const budget = await jiti.import("../src/server/supplier-invoice-capture/certification-budget.ts");

  // 3. GATES FIRST — before any run row exists.
  const preconditions = run.verifyCertificationPreconditions(process.env);
  if (!preconditions.ok) {
    console.error(`REFUSED at ${preconditions.stage}`);
    console.error(preconditions.reason);
    process.exit(1);
  }
  console.log(`corpus verified: ${preconditions.corpusSha256}`);

  const db = budget.createCertificationDb(process.env);
  if (!db) die("the certification database could not be constructed from the certification variables. Nothing was sent.");

  if (!confirm) {
    console.log("");
    console.log("DRY RUN — READY");
    console.log(`  company            : ${companyId}`);
    console.log(`  ceiling            : ${run.CERTIFICATION_CALL_CEILING}`);
    console.log("  No run was opened, nothing was reserved, and no request was made.");
    console.log("  Re-run with --confirm to open the run and send the corpus.");
    return;
  }

  // 4. Exactly ONE durable run. `fn_ai_certification_open_run` refuses a
  //    second Open run for the same company, so this cannot quietly double.
  const runId = await budget.openCertificationRun(
    companyId,
    `certification corpus ${preconditions.corpusSha256.slice(0, 12)}`,
    run.CERTIFICATION_CALL_CEILING,
    "certification-cli",
    db,
  );
  console.log(`opened certification run #${runId} with a ceiling of ${run.CERTIFICATION_CALL_CEILING}`);

  let result;
  try {
    // 5. Per case: reserve, then send. The controller owns this.
    // `companyId` is required: the evidence writer verifies the run
    // belongs to the company before recording. Omitting it silently
    // dropped the argument from the RPC and PostgREST could not resolve
    // the overload — which cost run #62 a call before stopping.
    result = await run.runCertificationCorpus({ runId, companyId, db, confirm: true });
  } finally {
    // 6. Close deterministically, however the run ended. A run left Open
    //    would block the next one and hide what this one spent.
    try {
      await budget.closeCertificationRun(runId, db);
      console.log(`closed certification run #${runId}`);
    } catch {
      console.error(`WARNING: certification run #${runId} could not be closed. Close it before opening another.`);
    }
  }

  if (!result.ok) {
    console.error(`REFUSED at ${result.stage}: ${result.reason}`);
    process.exit(1);
  }

  console.log("");
  console.log("CERTIFICATION RUN COMPLETE");
  console.log(`  run                : #${result.runId}`);
  console.log(`  corpus             : ${result.corpusSha256}`);
  console.log(`  ceiling            : ${result.ceiling}`);
  console.log(`  provider requests  : ${result.providerRequests}`);
  console.log(`  documents attempted: ${result.outcomes.length}`);
  if (result.stoppedEarly) {
    console.log(`  STOPPED EARLY      : after ${result.stoppedEarly.afterCases} case(s)`);
    console.log(`  reason             : ${result.stoppedEarly.reason}`);
  }
  console.log("");
  for (const outcome of result.outcomes) {
    const r = outcome.result;
    const detail = r.succeeded
      ? `${r.validationStatus.padEnd(10)} lines=${r.lineCount}/${r.declaredLineCount ?? "?"} ${r.findingCodes.join(",") || ""}`
      : `FAILED     ${r.errorCategory}${r.httpStatus ? ` ${r.httpStatus}` : ""}`;
    console.log(`  ${outcome.caseId.padEnd(26)} ${String(outcome.durationMs).padStart(6)}ms  ${detail}`);
  }
  console.log("");
  console.log("Scoring against the answer keys is Phase 5Q reporting, not this run.");
  console.log("No accounting data was written. No task was created. No credential was logged.");
}

main().catch((error) => {
  // Never print an unsanitised error: it can carry request context.
  console.error(`RUN ERROR: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
