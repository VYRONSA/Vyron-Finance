// Throwaway live-verification script — Pilot Review Round 1 Final Certification.
// Creates a fresh test user + company, drives the REAL running app (localhost:3000)
// via authenticated HTTP requests, and cleans up everything at the end.
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import fs from "node:fs";

function loadEnv() {
  const content = fs.readFileSync("C:\\Users\\humres\\VYRON Finance Recovery Tool\\web\\.env.local", "utf8");
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line.includes("=") || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

const env = loadEnv();
const BASE = "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? " :: " + detail : ""}`);
}

async function signInAndGetCookieHeader(email, password) {
  const cookieJar = new Map();
  const client = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) cookieJar.set(name, value);
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

const stamp = Date.now();
const ownerEmail = `round1-owner-${stamp}@vyron-test.local`;
const clerkEmail = `round1-clerk-${stamp}@vyron-test.local`;
const password = "TestPass!2345678";

let ownerId, clerkId, companyId, orgId;
const cleanup = { customerId: null, supplierId: null, bankAccountId: null, entryIds: [] };

try {
  console.log("=== Setup: creating throwaway users ===");
  const { data: ownerUser, error: ownerErr } = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
  if (ownerErr) throw ownerErr;
  ownerId = ownerUser.user.id;

  const { data: clerkUser, error: clerkErr } = await admin.auth.admin.createUser({ email: clerkEmail, password, email_confirm: true });
  if (clerkErr) throw clerkErr;
  clerkId = clerkUser.user.id;

  const ownerCookie = await signInAndGetCookieHeader(ownerEmail, password);
  const clerkCookie = await signInAndGetCookieHeader(clerkEmail, password);
  console.log("Signed in as both test users.");

  console.log("\n=== Phase 1: Company creation (regression check) ===");
  const createRes = await api(ownerCookie, "POST", "/api/companies", { name: `Round1 Cert Co ${stamp}`, baseCurrencyCode: "ZAR" });
  check("Company creation succeeds (POST /api/companies)", createRes.status === 201 || createRes.status === 200, `status=${createRes.status} body=${JSON.stringify(createRes.json)}`);
  companyId = createRes.json?.id ?? createRes.json?.company?.id;
  if (!companyId) throw new Error("No companyId returned from company creation — cannot continue.");
  console.log("companyId:", companyId);

  const { data: companyRow } = await admin.from("companies").select("organisation_id, status").eq("id", companyId).single();
  orgId = companyRow.organisation_id;
  check("New company starts in 'onboarding' status", companyRow.status === "onboarding", `status=${companyRow.status}`);

  // Assign the clerk user a low-privilege role (Sales Clerk-equivalent) for permission-enforcement testing.
  const { data: roles } = await admin.from("permission_roles").select("id, role_key").eq("company_id", companyId);
  const clerkRole = roles.find((r) => r.role_key === "read_only") ?? roles[0];
  await admin.from("user_role_assignments").insert({ user_id: clerkId, company_id: companyId, role_id: clerkRole.id, assigned_by: "LiveVerificationScript" });
  console.log("Clerk assigned role:", clerkRole.role_key);

  console.log("\n=== Phase 2: Opening Balances Centre loads, categories, governance (onboarding) ===");
  const listRes1 = await api(ownerCookie, "GET", `/api/companies/${companyId}/opening-balances`);
  check("GET opening-balances succeeds while onboarding", listRes1.status === 200, `status=${listRes1.status}`);
  check("List starts empty", Array.isArray(listRes1.json?.entries) && listRes1.json.entries.length === 0, JSON.stringify(listRes1.json));

  // Fetch chart of accounts to find real GL codes for GeneralLedger/VATControl/Loan and confirm Debtors/Creditors control accounts exist.
  const coaRes = await api(ownerCookie, "GET", `/api/companies/${companyId}/general-ledger/chart-of-accounts`);
  const coa = coaRes.json?.accounts ?? [];
  const findAccount = (pred) => coa.find(pred);
  const glAsset = findAccount((a) => a.accountType === "Asset" && !a.isControlAccount) ?? findAccount((a) => a.accountType === "Asset");
  const vatControl = findAccount((a) => a.description?.toLowerCase().includes("vat"));
  const loanAccount = findAccount((a) => a.accountType === "Liability" && !a.isControlAccount) ?? findAccount((a) => a.accountType === "Liability");
  const debtorsControl = findAccount((a) => a.isControlAccount && a.description === "Debtors");
  const creditorsControl = findAccount((a) => a.isControlAccount && a.description === "Creditors");
  check("Chart of Accounts loaded with usable GL codes", !!glAsset && !!vatControl && !!loanAccount, `glAsset=${glAsset?.accountCode} vat=${vatControl?.accountCode} loan=${loanAccount?.accountCode}`);
  check("Debtors control account exists", !!debtorsControl, debtorsControl?.accountCode);
  check("Creditors control account exists", !!creditorsControl, creditorsControl?.accountCode);

  // Create a bank account, a customer, and a supplier to target.
  const bankRes = await api(ownerCookie, "POST", `/api/companies/${companyId}/bank-accounts`, {
    accountNumber: `999${stamp}`.slice(0, 11), accountName: "Cert Test Cheque Account", bankName: "Test Bank", currency: "ZAR", openingBalance: 0,
  });
  check("Bank account created", bankRes.status === 201 || bankRes.status === 200, JSON.stringify(bankRes.json));
  cleanup.bankAccountId = bankRes.json?.id ?? bankRes.json?.account?.id;

  const custRes = await api(ownerCookie, "POST", `/api/companies/${companyId}/customers`, { customerCode: `CERT${stamp}`.slice(0, 15), name: "Cert Test Customer" });
  check("Customer created", custRes.status === 201 || custRes.status === 200, JSON.stringify(custRes.json));
  cleanup.customerId = custRes.json?.id ?? custRes.json?.customer?.id;

  const supRes = await api(ownerCookie, "POST", `/api/companies/${companyId}/suppliers`, { name: "Cert Test Supplier" });
  check("Supplier created", supRes.status === 201 || supRes.status === 200, JSON.stringify(supRes.json));
  cleanup.supplierId = supRes.json?.id ?? supRes.json?.supplier?.id;

  console.log("\n=== Phase 3: Permission enforcement — low-privilege user blocked ===");
  const clerkAttempt = await api(clerkCookie, "POST", `/api/companies/${companyId}/opening-balances`, {
    category: "GeneralLedger", accountCode: glAsset.accountCode, description: "Clerk attempt", amount: 100,
  });
  check("Low-privilege user is blocked from creating opening balances (expect 403)", clerkAttempt.status === 403, `status=${clerkAttempt.status} body=${JSON.stringify(clerkAttempt.json)}`);

  console.log("\n=== Phase 4: Create entries across all 6 UI categories (onboarding — no reason required) ===");
  const entries = [
    { category: "GeneralLedger", accountCode: glAsset.accountCode, description: "Opening GL asset", amount: 10000 },
    { category: "BankAccount", bankAccountId: cleanup.bankAccountId, description: "Opening bank balance", amount: 5000 },
    { category: "Customer", customerId: cleanup.customerId, description: "Opening debtor balance", amount: 3000 },
    { category: "Supplier", supplierId: cleanup.supplierId, description: "Opening creditor balance", amount: -2000 },
    { category: "VATControl", accountCode: vatControl.accountCode, description: "Opening VAT control", amount: -1000 },
    { category: "Loan", accountCode: loanAccount.accountCode, description: "Opening loan balance", amount: -15000 },
  ];
  for (const e of entries) {
    const r = await api(ownerCookie, "POST", `/api/companies/${companyId}/opening-balances`, e);
    check(`Create ${e.category} entry (onboarding, no reason)`, r.status === 201 || r.status === 200, JSON.stringify(r.json));
    if (r.json?.entry?.id) cleanup.entryIds.push(r.json.entry.id);
  }
  check("6 entries created total", cleanup.entryIds.length === 6, `count=${cleanup.entryIds.length}`);

  const listRes2 = await api(ownerCookie, "GET", `/api/companies/${companyId}/opening-balances`);
  check("List now shows all 6 entries", listRes2.json?.entries?.length === 6, `count=${listRes2.json?.entries?.length}`);
  const totalDebit = listRes2.json.entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const totalCredit = listRes2.json.entries.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
  check("Entries balance (debits==credits) before posting", totalDebit === totalCredit, `debit=${totalDebit} credit=${totalCredit}`);

  console.log("\n=== Phase 5: Edit an entry ===");
  const editTargetId = cleanup.entryIds[0];
  const editRes = await api(ownerCookie, "PATCH", `/api/companies/${companyId}/opening-balances/${editTargetId}`, { amount: 10500, description: "Opening GL asset (adjusted)" });
  check("Edit entry succeeds (onboarding, no reason)", editRes.status === 200, JSON.stringify(editRes.json));
  check("Edited amount reflected", editRes.json?.entry?.amount === 10500, JSON.stringify(editRes.json));

  const auditRes1 = await admin.from("permission_audit_log").select("*").eq("company_id", companyId).eq("item_type", "OpeningBalance").order("performed_at", { ascending: true });
  check("Audit trail recorded 'created' entries for all 6 + edit fields for the amend", (auditRes1.data ?? []).length >= 8, `count=${(auditRes1.data ?? []).length}`);

  console.log("\n=== Phase 6: Delete an entry (VATControl, will re-add) ===");
  const vatEntryId = cleanup.entryIds[4];
  const delRes = await api(ownerCookie, "DELETE", `/api/companies/${companyId}/opening-balances/${vatEntryId}`, {});
  check("Delete entry succeeds", delRes.status === 200 || delRes.status === 204, `status=${delRes.status}`);
  cleanup.entryIds = cleanup.entryIds.filter((id) => id !== vatEntryId);
  const reAddVat = await api(ownerCookie, "POST", `/api/companies/${companyId}/opening-balances`, { category: "VATControl", accountCode: vatControl.accountCode, description: "Opening VAT control", amount: -1000 });
  check("Re-added VATControl entry after delete", reAddVat.status === 200 || reAddVat.status === 201, JSON.stringify(reAddVat.json));
  if (reAddVat.json?.entry?.id) cleanup.entryIds.push(reAddVat.json.entry.id);

  console.log("\n=== Phase 7: Company onboarding restriction — flip to 'active' (post go-live) ===");
  const flipRes = await api(ownerCookie, "PATCH", `/api/companies/${companyId}`, { status: "active" });
  check("Company status flipped to active", flipRes.status === 200 && flipRes.json?.status === "active", JSON.stringify(flipRes.json));

  const govNoReason = await api(ownerCookie, "PATCH", `/api/companies/${companyId}/opening-balances/${editTargetId}`, { amount: 11000 });
  check("Post go-live: edit WITHOUT reason is rejected", govNoReason.status === 400 || govNoReason.status === 422, `status=${govNoReason.status} body=${JSON.stringify(govNoReason.json)}`);

  const govWithReason = await api(ownerCookie, "PATCH", `/api/companies/${companyId}/opening-balances/${editTargetId}`, { amount: 10500 + 500, reason: "Certification test — post go-live edit with reason." });
  check("Post go-live: edit WITH reason succeeds", govWithReason.status === 200, JSON.stringify(govWithReason.json));

  const auditGov = await admin.from("permission_audit_log").select("*").eq("company_id", companyId).eq("item_type", "OpeningBalance").eq("item_id", String(editTargetId)).order("performed_at", { ascending: false }).limit(1);
  check("Post go-live audit entry captured the reason", auditGov.data?.[0]?.reason?.includes("Certification test"), JSON.stringify(auditGov.data?.[0]));

  console.log("\n=== Phase 8: Post opening balances — journal, GL, bank balance impact ===");
  const before = await admin.from("ae_bank_accounts").select("opening_balance, current_balance").eq("id", cleanup.bankAccountId).single();
  check("Bank account balance is 0 before posting", before.data.current_balance === 0, JSON.stringify(before.data));

  const postRes = await api(ownerCookie, "POST", `/api/companies/${companyId}/opening-balances/post`, {});
  check("Post opening balances succeeds", postRes.status === 200, JSON.stringify(postRes.json));
  const journalId = postRes.json?.result?.journalId;
  check("Post result reports balanced debit/credit", postRes.json?.result?.totalDebit === postRes.json?.result?.totalCredit, JSON.stringify(postRes.json));

  const glRows = await admin.from("gl_transactions").select("account_id, debit, credit").eq("company_id", companyId).eq("journal_id", journalId);
  check("GL transactions created for the posted journal", (glRows.data ?? []).length > 0, `count=${(glRows.data ?? []).length}`);
  const glDebit = (glRows.data ?? []).reduce((s, r) => s + Number(r.debit), 0);
  const glCredit = (glRows.data ?? []).reduce((s, r) => s + Number(r.credit), 0);
  check("GL transactions balance (debit==credit)", Math.abs(glDebit - glCredit) < 0.01, `debit=${glDebit} credit=${glCredit}`);
  const debtorsRow = (glRows.data ?? []).find((r) => r.account_id === debtorsControl.id);
  check("Customer opening balance rolled up into Debtors control account", !!debtorsRow && Number(debtorsRow.debit) === 3000, JSON.stringify(debtorsRow));
  const creditorsRow = (glRows.data ?? []).find((r) => r.account_id === creditorsControl.id);
  check("Supplier opening balance rolled up into Creditors control account", !!creditorsRow && Number(creditorsRow.credit) === 2000, JSON.stringify(creditorsRow));

  const after = await admin.from("ae_bank_accounts").select("opening_balance, current_balance").eq("id", cleanup.bankAccountId).single();
  check("Bank account current_balance updated by posting (fix under test)", after.data.current_balance === 5000, JSON.stringify(after.data));
  check("Bank account opening_balance updated by posting", after.data.opening_balance === 5000, JSON.stringify(after.data));

  const bankAuditRows = await admin.from("permission_audit_log").select("*").eq("company_id", companyId).eq("item_type", "BankAccountOpeningBalance").eq("item_id", String(cleanup.bankAccountId));
  check("Bank account opening-balance audit entry recorded for the posting", (bankAuditRows.data ?? []).length >= 1, JSON.stringify(bankAuditRows.data));

  const postedEntries = await admin.from("opening_balance_entries").select("status").eq("company_id", companyId);
  check("All entries marked posted", (postedEntries.data ?? []).every((e) => e.status === "posted"), JSON.stringify(postedEntries.data));

  console.log("\n=== Phase 9: Posted entries are immutable ===");
  const editPostedRes = await api(ownerCookie, "PATCH", `/api/companies/${companyId}/opening-balances/${editTargetId}`, { amount: 1, reason: "test" });
  check("Editing a posted entry is rejected", editPostedRes.status === 400 || editPostedRes.status === 422, `status=${editPostedRes.status}`);

  console.log("\n=== Phase 10: Regression — Customer/Supplier/Bank Account editing still work ===");
  const custEdit = await api(ownerCookie, "PATCH", `/api/companies/${companyId}/customers/${cleanup.customerId}`, { industry: "Manufacturing" });
  check("Customer non-sensitive edit succeeds", custEdit.status === 200, JSON.stringify(custEdit.json));
  const custSensitive = await api(ownerCookie, "PATCH", `/api/companies/${companyId}/customers/${cleanup.customerId}`, { creditLimit: 50000, reason: "Cert test" });
  check("Customer elevated (creditLimit) edit succeeds as owner", custSensitive.status === 200, JSON.stringify(custSensitive.json));
  const custSensitiveBlocked = await api(clerkCookie, "PATCH", `/api/companies/${companyId}/customers/${cleanup.customerId}`, { creditLimit: 99999, reason: "Clerk attempt" });
  check("Customer elevated edit blocked for low-privilege user", custSensitiveBlocked.status === 403, `status=${custSensitiveBlocked.status}`);

  const supEdit = await api(ownerCookie, "PATCH", `/api/companies/${companyId}/suppliers/${cleanup.supplierId}`, { supplierCategory: "Raw Materials" });
  check("Supplier non-sensitive edit succeeds", supEdit.status === 200, JSON.stringify(supEdit.json));
  const supSensitive = await api(ownerCookie, "PATCH", `/api/companies/${companyId}/suppliers/${cleanup.supplierId}`, { bankName: "New Bank", bankAccountNumber: "1234567890", reason: "Cert test" });
  check("Supplier elevated (banking) edit succeeds as owner", supSensitive.status === 200, JSON.stringify(supSensitive.json));

  const bankEdit = await api(ownerCookie, "PATCH", `/api/companies/${companyId}/bank-accounts/${cleanup.bankAccountId}`, { openingBalance: 6000, reason: "Cert test — further opening balance adjustment" });
  check("Direct bank account opening-balance edit still works post go-live with reason", bankEdit.status === 200, JSON.stringify(bankEdit.json));
  const bankAfterDirectEdit = await admin.from("ae_bank_accounts").select("current_balance").eq("id", cleanup.bankAccountId).single();
  check("Direct edit delta applied correctly on top of posted balance", bankAfterDirectEdit.data.current_balance === 6000, JSON.stringify(bankAfterDirectEdit.data));

  const dashRes = await api(ownerCookie, "GET", `/api/companies/${companyId}`);
  check("Company dashboard/detail endpoint still loads", dashRes.status === 200, `status=${dashRes.status}`);

} catch (err) {
  console.error("SCRIPT ERROR:", err);
  results.push({ name: "Script did not crash", pass: false, detail: String(err) });
} finally {
  console.log("\n=== Cleanup ===");
  try {
    if (companyId) {
      await admin.from("opening_balance_entries").delete().eq("company_id", companyId);
      await admin.from("permission_audit_log").delete().eq("company_id", companyId);
      await admin.from("gl_transactions").delete().eq("company_id", companyId);
      await admin.from("ae_journal_lines").delete().eq("company_id", companyId).then(() => {}).catch(() => {});
      await admin.from("ae_journals").delete().eq("company_id", companyId);
      await admin.from("customers").delete().eq("company_id", companyId);
      await admin.from("ae_suppliers").delete().eq("company_id", companyId);
      await admin.from("ae_bank_accounts").delete().eq("company_id", companyId);
      await admin.from("user_role_assignments").delete().eq("company_id", companyId);
      await admin.from("role_approval_limits").delete().in("role_id", (await admin.from("permission_roles").select("id").eq("company_id", companyId)).data?.map((r) => r.id) ?? []);
      await admin.from("role_permissions").delete().in("role_id", (await admin.from("permission_roles").select("id").eq("company_id", companyId)).data?.map((r) => r.id) ?? []);
      await admin.from("permission_roles").delete().eq("company_id", companyId);
      await admin.from("subscriptions").delete().eq("company_id", companyId).then(() => {}).catch(() => {});
      await admin.from("companies").delete().eq("id", companyId);
      console.log("Deleted company and all child rows:", companyId);
    }
    if (orgId) {
      await admin.from("organisation_members").delete().eq("organisation_id", orgId);
      await admin.from("organisations").delete().eq("id", orgId);
      console.log("Deleted organisation:", orgId);
    }
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
    if (clerkId) await admin.auth.admin.deleteUser(clerkId);
    console.log("Deleted test users.");
  } catch (cleanupErr) {
    console.error("CLEANUP ERROR (manual cleanup may be needed):", cleanupErr);
  }
}

console.log("\n=== SUMMARY ===");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log("FAILED CHECKS:");
  for (const f of failed) console.log(` - ${f.name} :: ${f.detail}`);
  process.exit(1);
}
