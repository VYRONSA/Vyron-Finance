/**
 * Phase 5P — entry point for the single controlled certification probe.
 *
 *   node scripts/certification-probe.mjs                 # dry run (default)
 *   node scripts/certification-probe.mjs --confirm       # the ONE request
 *   node scripts/certification-probe.mjs --case=clean-pdf
 *
 * THE DEFAULT IS A DRY RUN. Running this file with no arguments performs
 * every gate — countersignature, corpus integrity, the document's own
 * hash, provider selection — and stops at the door without sending
 * anything. Making a paid request requires typing `--confirm`, which is
 * not something that happens by accident or by shell history.
 *
 * WHAT THIS FILE DOES WITH THE CREDENTIAL
 *
 * It reads `.env.local`, takes ONLY `AI_GATEWAY_API_KEY`, and places it in
 * this process's environment. It never prints it, never logs it, never
 * passes it as an argument, and never writes it anywhere. The value is
 * handled by the Gateway SDK alone. A whitelist is used rather than
 * loading the whole file, so a stray variable in `.env.local` cannot
 * change this process's behaviour.
 *
 * THE SWITCH IS SET IN-PROCESS ONLY
 *
 * `VYRON_AI_INVOICE_EXTRACTION=certification` is assigned to
 * `process.env` here and nowhere else. It is NOT written to `.env.local`,
 * not exported to the shell, and not persisted. When this process exits,
 * the environment is exactly as it was — the provider returns to
 * fail-closed with no cleanup step to forget.
 *
 * WHY jiti
 *
 * The probe logic is TypeScript that imports the existing 5M/5N/5O
 * modules. `jiti` is already present in this repository (via eslint,
 * tailwind and vite) and loads TypeScript without a build step or a new
 * dependency. If it is ever absent, this fails closed with a clear message
 * rather than falling back to anything.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Only this one variable is taken from the file. */
const CREDENTIAL_VAR = "AI_GATEWAY_API_KEY";

function die(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}

/**
 * Reads `.env.local` and returns whether the credential was found.
 *
 * Deliberately returns a boolean, not the value: nothing in this file
 * should be able to print what it loaded, so it never holds it in a
 * variable that outlives the assignment.
 */
function loadCredential() {
  const path = join(ROOT, ".env.local");
  if (!existsSync(path)) die(`no ${path}. The non-production credential must be supplied there.`);

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim().replace(/^export\s+/, "");
    if (name !== CREDENTIAL_VAR) continue;

    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!value) die(`${CREDENTIAL_VAR} in .env.local is empty.`);
    process.env[CREDENTIAL_VAR] = value;
    return true;
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const caseArg = args.find((a) => a.startsWith("--case="));
  const caseId = caseArg ? caseArg.slice("--case=".length) : undefined;

  if (!loadCredential()) die(`${CREDENTIAL_VAR} is not set in .env.local.`);

  // In-process only. Never written back to any file.
  process.env.VYRON_AI_INVOICE_EXTRACTION = "certification";

  let createJiti;
  try {
    ({ createJiti } = await import("jiti"));
  } catch {
    die("jiti is not available, so the TypeScript probe cannot be loaded. No request was made.");
  }

  // `@/…` is this project's path alias for `src/…` (tsconfig `paths`).
  // jiti does not read tsconfig, so it is mapped explicitly here. Without
  // it the probe fails closed on the first aliased import — which is what
  // happened on the first dry run, before anything was sent.
  const jiti = createJiti(import.meta.url, {
    interopDefault: true,
    alias: { "@": join(ROOT, "src") },
  });
  const probe = await jiti.import("../src/server/supplier-invoice-capture/certification-probe.ts");

  const result = await probe.runCertificationProbe({ caseId, confirm });

  console.log("");
  if (!result.ok) {
    const label = result.stage === "not-confirmed" ? "DRY RUN — READY" : `REFUSED at ${result.stage}`;
    console.log(`${label}`);
    console.log(result.reason);
    console.log(`provider requests made: ${result.providerRequests}`);
    // A dry run is a success; a genuine refusal is not.
    process.exit(result.stage === "not-confirmed" ? 0 : 1);
  }

  console.log("PROBE COMPLETE");
  console.log(`  case                : ${result.caseId} (${result.documentFile}, ${result.documentBytes} bytes, ${result.mimeType})`);
  console.log(`  document sha256     : ${result.documentSha256}`);
  console.log(`  corpus sha256       : ${result.corpusSha256}`);
  console.log(`  model               : ${result.model ?? "(none)"}`);
  console.log(`  provider requests   : ${result.providerRequests}`);
  console.log(`  duration            : ${result.durationMs} ms`);
  console.log(`  usage               : ${result.usage ? JSON.stringify(result.usage) : "(not reported)"}`);
  if (result.extraction.succeeded) {
    console.log(`  outcome             : extracted`);
    console.log(`  lines               : ${result.extraction.lineCount} (model declared ${result.extraction.declaredLineCount ?? "n/a"})`);
    console.log(`  validation          : ${result.extraction.validationStatus}`);
    console.log(`  findings            : ${result.extraction.findingCodes.join(", ") || "none"}`);
    // Safe to show: the certification corpus is wholly synthetic.
    console.log("");
    console.log("  EXTRACTED (synthetic corpus document):");
    const e = result.extraction.extracted;
    for (const [k, v] of Object.entries(e)) {
      if (k === "lines") continue;
      console.log(`    ${k.padEnd(26)}: ${v === null ? "(null)" : v}`);
    }
    e.lines.forEach((line, i) => {
      console.log(`    line ${i + 1}:`);
      for (const [k, v] of Object.entries(line)) {
        console.log(`      ${k.padEnd(24)}: ${v === null ? "(null)" : v}`);
      }
    });
  } else {
    console.log(`  outcome             : FAILED`);
    console.log(`  error category      : ${result.extraction.errorCategory}`);
    console.log(`  http status         : ${result.extraction.httpStatus ?? "(none)"}`);
    console.log(`  message             : ${result.extraction.message}`);
  }
  console.log("");
  console.log("No accounting data was written. No task was created. No credential was logged.");
}

main().catch((error) => {
  // Never print an unsanitised provider error: it can carry request
  // context. The probe's own failures are safe; anything else is reduced
  // to its name.
  console.error(`PROBE ERROR: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exit(1);
});
