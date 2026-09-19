/**
 * Phase 5Q.2 — CLI for the read-only connectivity precheck.
 *
 *   node scripts/certification-precheck.mjs --company=<uuid>
 *
 * Reads four counts and one row from the LOCAL certification Supabase and
 * reports whether the 24-document run would find what it expects. It opens
 * no certification run, reserves no call, writes nothing, and never
 * contacts the AI provider — it does not even load the Gateway credential,
 * because it has no use for one.
 *
 * There is no `--confirm` here, because there is nothing to confirm: every
 * path this script can take is a read.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Only the two Supabase variables. The Gateway credential is deliberately
 * NOT loaded: a precheck that cannot reach a provider cannot call one by
 * accident. */
const SECRET_VARS = ["VYRON_CERTIFICATION_SUPABASE_URL", "VYRON_CERTIFICATION_SERVICE_ROLE_KEY"];

function die(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

/** Returns the NAMES loaded, never the values. */
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
  const args = process.argv.slice(2);
  const companyArg = args.find((a) => a.startsWith("--company="));
  const companyId = companyArg ? companyArg.slice("--company=".length) : null;
  if (!companyId) die("--company=<uuid> is required.");

  const found = loadSecrets();
  for (const name of SECRET_VARS) {
    if (!found.includes(name)) die(`${name} is not set in .env.local.`);
  }

  let createJiti;
  try {
    ({ createJiti } = await import("jiti"));
  } catch {
    die("jiti is not available, so the TypeScript precheck cannot be loaded.");
  }
  const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": join(ROOT, "src") } });

  const budget = await jiti.import("../src/server/supplier-invoice-capture/certification-budget.ts");
  const precheck = await jiti.import("../src/server/supplier-invoice-capture/certification-precheck.ts");

  // The SAME client the certification run would use. No second
  // implementation, and no fallback to any other credentials.
  const db = budget.createCertificationDb(process.env);

  const result = await precheck.runCertificationPrecheck({
    db,
    url: process.env.VYRON_CERTIFICATION_SUPABASE_URL,
    companyId,
  });

  console.log("");
  console.log("READ-ONLY CERTIFICATION PRECHECK");
  console.log("");
  for (const c of result.checks) {
    console.log(`  ${c.passed ? "PASS" : "FAIL"}  ${c.name.padEnd(22)} ${c.detail}`);
  }
  console.log("");
  console.log(`  endpoint : ${result.url ?? "(none)"}`);
  console.log(`  company  : ${result.companyId} ${result.companyName ? `("${result.companyName}")` : ""}`);
  if (result.baseline) {
    console.log(`  baseline : journals=${result.baseline.journals} bills=${result.baseline.bills} suppliers=${result.baseline.suppliers} extractionTasks=${result.baseline.extractionTasks}`);
  }
  console.log("");
  console.log(result.ok ? "PRECHECK PASSED — read-only, nothing was written." : "PRECHECK FAILED — see the first FAIL above.");
  console.log("No certification run was opened. No call was reserved. No provider request was made.");

  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`PRECHECK ERROR: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
