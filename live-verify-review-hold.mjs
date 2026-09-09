/**
 * Live verification of the human-review hold (migration 0094) against
 * the REAL Supabase project.
 *
 * The unit tests prove the TypeScript layers refuse to offer a held
 * transaction to the AI. This proves the layer that actually matters:
 * `fn_apply_ai_classification` refuses the WRITE even when called
 * directly, with valid arguments, bypassing every TypeScript check —
 * which is the only guarantee that survives a stale caller, a new code
 * path, or a bug in the eligibility predicate.
 *
 * Runs entirely on a throwaway company and deletes it afterwards. It
 * snapshots the two real client companies before and after and fails if
 * either changed.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

function loadEnv(p) {
  const e = {};
  for (const l of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!l.includes("=") || l.trim().startsWith("#")) continue;
    const i = l.indexOf("=");
    let v = l.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    e[l.slice(0, i).trim()] = v;
  }
  return e;
}

const env = loadEnv(".env.local");
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const NORTHWOOD = "8d276630-42ee-4673-a308-e5dcaa7252fa";
const METANOIA = "45b3d2a0-3973-4587-a043-0e05d8d9bff3";

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? " :: " + detail : ""}`);
};

async function must(label, p) {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

/** PostgREST caps a response at 1000 rows, so paginate on a stable order. */
async function fetchAll(companyId, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("ae_bank_transactions").select(columns).eq("company_id", companyId).order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function snapshot(companyId) {
  const rows = await fetchAll(companyId, "id,debit,credit,gl_account,suggested_gl_account,allocation_status,allocation_method,review_hold,review_status,posted_flag,journal_id,reconciliation_id");
  return {
    rows: rows.length,
    totalDebit: Math.round(rows.reduce((s, r) => s + Number(r.debit), 0) * 100) / 100,
    totalCredit: Math.round(rows.reduce((s, r) => s + Number(r.credit), 0) * 100) / 100,
    classified: rows.filter((r) => (r.suggested_gl_account || "").trim()).length,
    held: rows.filter((r) => r.review_hold).length,
    posted: rows.filter((r) => r.posted_flag).length,
    journals: (await db.from("ae_journals").select("id", { count: "exact", head: true }).eq("company_id", companyId)).count,
    gl: (await db.from("gl_transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId)).count,
    batches: (await db.from("posting_batches").select("id", { count: "exact", head: true }).eq("company_id", companyId)).count,
  };
}

/** Calls the RPC exactly as `applyAiClassification` does. */
async function attemptAiClassification(companyId, transactionId, account = "9999") {
  const { data, error } = await db.rpc("fn_apply_ai_classification", {
    p_company_id: companyId,
    p_transaction_id: transactionId,
    p_suggested_gl_account: account,
    p_confidence: 99,
    p_explanation: "live-verify probe",
    p_model_used: "live-verify",
    p_performed_by: "live-verify",
    p_target_status: "Suggested",
  });
  if (error) throw new Error(`fn_apply_ai_classification: ${error.message}`);
  return data.claimed === true;
}

let company = null;

try {
  const before = { northwood: await snapshot(NORTHWOOD), metanoia: await snapshot(METANOIA) };
  console.log("Northwood before:", JSON.stringify(before.northwood));
  console.log("Metanoia  before:", JSON.stringify(before.metanoia));

  const org = await must("org", db.from("organisations").select("id").limit(1).single());
  company = (await must("company", db.from("companies").insert({ organisation_id: org.id, name: `ZZ Review Hold Verify ${Date.now()}`, status: "onboarding" }).select("id").single())).id;
  await must("seed", db.rpc("seed_company_defaults", { p_company_id: company }));
  const account = await must("bank account", db.from("ae_bank_accounts").insert({ company_id: company, account_number: "RH-001", account_name: "RH Bank", gl_account: "1000", currency: "ZAR", opening_balance: 0 }).select("id").single());

  const base = {
    company_id: company, bank_account: "RH Bank", bank_account_id: account.id, transaction_date: "2026-03-05",
    reference: "", beneficiary: "Capitec Bank", debit: 6, credit: 0, notes: "Migrated from Xero. Source: Spend Money.",
    gl_account: "3030 - Bank Charges, 820 - VAT", import_batch: "RH", source_filename: "rh.xlsx", allocation_status: "Unallocated",
  };
  const mk = async (over, occ) => (await must("insert", db.from("ae_bank_transactions").insert({ ...base, ...over, import_description: base.gl_account, source_occurrence: occ }).select("id").single())).id;

  const free = await mk({}, 1);
  const heldExplicit = await mk({}, 2);
  const heldByDecision = await mk({ review_status: "Approved" }, 3);
  const heldByAction = await mk({ required_action: "Review — possible duplicate payment" }, 4);
  const classifiedThenHeld = await mk({ suggested_gl_account: "2600", allocation_status: "Suggested", allocation_method: "Future AI" }, 5);

  // Place explicit holds through the only supported write path.
  const holdResult = await must("set hold", db.rpc("fn_set_review_hold", {
    p_company_id: company, p_transaction_ids: [heldExplicit, classifiedThenHeld], p_hold: true,
    p_reason: "Migration review in progress", p_performed_by: "live-verify",
  }));
  check("fn_set_review_hold places a hold and reports what changed", holdResult.changedCount === 2, JSON.stringify(holdResult));

  // 1 + 5. The database refuses the write for every held variant.
  check("1. explicit review_hold blocks the AI write", (await attemptAiClassification(company, heldExplicit)) === false);
  check("1b. a recorded human review decision blocks the AI write", (await attemptAiClassification(company, heldByDecision)) === false);
  check("1c. a system-raised required action blocks the AI write", (await attemptAiClassification(company, heldByAction)) === false);
  check("5. an already-classified but held transaction cannot be overwritten", (await attemptAiClassification(company, classifiedThenHeld)) === false);

  // 2 + 3 + 4. The held rows are untouched in every respect.
  const held = await fetchAll(company, "id,debit,credit,gl_account,suggested_gl_account,allocation_status,allocation_method,review_hold,review_hold_reason,review_hold_by,posted_flag,journal_id");
  const byId = new Map(held.map((r) => [r.id, r]));
  const he = byId.get(heldExplicit);
  check("2. a held Unprocessed transaction stays Unprocessed", he.suggested_gl_account === null && he.allocation_status === "Unallocated", JSON.stringify({ sugg: he.suggested_gl_account, status: he.allocation_status }));
  check("3. the Xero source account is unchanged", he.gl_account === "3030 - Bank Charges, 820 - VAT", he.gl_account);
  check("4. the original amount is unchanged", Number(he.debit) === 6 && Number(he.credit) === 0, `${he.debit}/${he.credit}`);
  const cth = byId.get(classifiedThenHeld);
  check("5b. the held row's existing allocation is preserved, not overwritten", cth.suggested_gl_account === "2600" && cth.allocation_method === "Future AI", JSON.stringify({ sugg: cth.suggested_gl_account, method: cth.allocation_method }));
  check("hold attribution is recorded", he.review_hold === true && he.review_hold_by === "live-verify" && he.review_hold_reason === "Migration review in progress");

  // 6. A transaction NOT held is still processed normally.
  check("6. an unheld transaction is still classified normally", (await attemptAiClassification(company, free, "6100")) === true);
  const freeRow = (await fetchAll(company, "id,suggested_gl_account,allocation_status,gl_account,debit")).find((r) => r.id === free);
  check("6b. the unheld row was genuinely written", freeRow.suggested_gl_account === "6100" && freeRow.allocation_status === "Suggested", JSON.stringify(freeRow));
  check("6c. even when classified, its Xero source account is untouched", freeRow.gl_account === "3030 - Bank Charges, 820 - VAT");

  // Releasing a hold restores eligibility — a hold is a hold, not a ban.
  await must("release", db.rpc("fn_set_review_hold", { p_company_id: company, p_transaction_ids: [heldExplicit], p_hold: false, p_reason: "", p_performed_by: "live-verify" }));
  check("releasing the hold restores normal processing", (await attemptAiClassification(company, heldExplicit, "6100")) === true);

  // 7. The sweep's own candidate query honours the hold.
  const candidates = await must("candidates", db.from("ae_bank_transactions").select("id")
    .eq("company_id", company).eq("allocation_status", "Unallocated").is("suggested_gl_account", null)
    .is("rule_id", null).is("matched_supplier_id", null).is("matched_customer_id", null).is("matched_merchant_id", null)
    .is("journal_id", null).eq("is_manual_override", false)
    .eq("review_hold", false).is("review_status", null).is("required_action", null));
  check("7. the candidate query returns no held transaction", candidates.every((c) => c.id !== heldByDecision && c.id !== heldByAction), JSON.stringify(candidates.map((c) => c.id)));

  // 8 + 9. Nothing was posted anywhere by any of this.
  const after = { northwood: await snapshot(NORTHWOOD), metanoia: await snapshot(METANOIA) };
  const mine = await snapshot(company);
  check("8. no automatic posting occurred", mine.posted === 0);
  check("9. no journals, GL transactions or posting batches were created", mine.journals === 0 && mine.gl === 0 && mine.batches === 0, JSON.stringify({ j: mine.journals, gl: mine.gl, b: mine.batches }));

  check("7b. Northwood is unchanged", JSON.stringify(before.northwood) === JSON.stringify(after.northwood), JSON.stringify(after.northwood));
  check("7c. Metanoia is unchanged", JSON.stringify(before.metanoia) === JSON.stringify(after.metanoia), JSON.stringify(after.metanoia));

  const task11 = await must("task 11", db.from("automation_tasks").select("id,task_type,is_active").eq("id", 11).single());
  check("AiClassificationSweep task 11 is still paused", task11.is_active === false, JSON.stringify(task11));
} catch (error) {
  check("verification run completed without error", false, error instanceof Error ? error.message : String(error));
} finally {
  if (company) await db.from("companies").delete().eq("id", company);
  const leftover = await db.from("companies").select("id,name").like("name", "ZZ Review Hold Verify%");
  console.log("\ncleanup — leftover test companies:", JSON.stringify(leftover.data ?? []));
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name} :: ${f.detail}`);
    process.exitCode = 1;
  }
}
