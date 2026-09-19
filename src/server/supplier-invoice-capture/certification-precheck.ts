/**
 * Phase 5Q.2 — the read-only connectivity precheck.
 *
 * WHY THIS EXISTS
 *
 * The 24-document dry run reports READY without ever contacting Supabase:
 * `createCertificationDb` builds a client object, and building one always
 * succeeds. A wrong URL, a wrong key, or a Supabase that is not running all
 * look identical to a correct setup — right up until `--confirm`, when the
 * first real contact happens in the same invocation that starts spending
 * provider calls.
 *
 * It would fail safely there: the reservation comes before the request, so
 * a broken database means no provider call. But "safely" is not the same as
 * "beforehand", and finding out beforehand costs nothing.
 *
 * WHAT IT IS ALLOWED TO DO
 *
 * Read four counts and one row. That is all. It cannot write, because the
 * query type it is handed (`CertificationReadQuery`) has no `insert`,
 * `update`, `delete` or `upsert` on it — the absence is enforced by the
 * type, not by discipline. It opens no certification run, reserves no call,
 * and never touches a provider.
 *
 * IT IS ISOLATED FROM THE EXECUTION PATH
 *
 * Nothing in `certification-run.ts` imports this, and this imports nothing
 * from there. A precheck wired into the run would be one more thing that
 * could fail during a live run; kept separate, it is a question you ask
 * before starting.
 *
 * EVERY CHECK FAILS CLOSED, AND SAYS WHICH ONE FAILED.
 */

import type { CertificationDb } from "./certification-budget";

/** The local sandbox, and nothing else. */
export const EXPECTED_LOCAL_URL = "http://127.0.0.1:56321";

/**
 * The production Supabase project reference.
 *
 * Named here for ONE purpose: to refuse it. If a certification URL ever
 * contains this, the precheck fails rather than reporting healthily on the
 * production database — which is the single worst outcome this whole phase
 * could produce.
 */
export const PRODUCTION_PROJECT_REF = "gnvhzckxryuttsqnvriv";

export const EXPECTED_COMPANY_NAME = "Phase 5J Sandbox";

/** A clean certification baseline: nothing to confuse a before/after
 * comparison with. */
export const EXPECTED_BASELINE = { journals: 0, bills: 0, suppliers: 0, extractionTasks: 0 } as const;

export type PrecheckCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type PrecheckResult = {
  ok: boolean;
  checks: PrecheckCheck[];
  /** Safe to print: a localhost URL is not a secret. The KEY never appears
   * in this type at all. */
  url: string | null;
  companyId: string;
  companyName: string | null;
  baseline: { journals: number; bills: number; suppliers: number; extractionTasks: number } | null;
};

export type PrecheckOptions = {
  db: CertificationDb | null;
  url: string | undefined;
  companyId: string;
  expectedUrl?: string;
  expectedCompanyName?: string;
};

function check(name: string, passed: boolean, detail: string): PrecheckCheck {
  return { name, passed, detail };
}

/** Counts rows for one company without fetching them. */
async function countFor(db: CertificationDb, table: string, companyId: string): Promise<number | null> {
  try {
    const result = await db.from(table).select("id", { count: "exact", head: true }).eq("company_id", companyId);
    if (result.error) return null;
    return typeof result.count === "number" ? result.count : null;
  } catch {
    return null;
  }
}

/**
 * Runs every precheck in order, stopping at the first failure.
 *
 * Ordered so the cheapest and most dangerous checks come first: there is no
 * point authenticating before establishing that the URL is not production.
 */
export async function runCertificationPrecheck(options: PrecheckOptions): Promise<PrecheckResult> {
  const expectedUrl = options.expectedUrl ?? EXPECTED_LOCAL_URL;
  const expectedName = options.expectedCompanyName ?? EXPECTED_COMPANY_NAME;
  const checks: PrecheckCheck[] = [];
  const fail = (): PrecheckResult => ({
    ok: false,
    checks,
    url: options.url ?? null,
    companyId: options.companyId,
    companyName: null,
    baseline: null,
  });

  // 1. The URL must be present at all.
  const url = options.url?.trim();
  if (!url) {
    checks.push(check("url-present", false, "VYRON_CERTIFICATION_SUPABASE_URL is not set."));
    return fail();
  }
  checks.push(check("url-present", true, "VYRON_CERTIFICATION_SUPABASE_URL is set."));

  // 2. It must not be production. Checked BEFORE connecting, because the
  //    damage of a healthy-looking report on production is done the moment
  //    the query succeeds.
  if (url.includes(PRODUCTION_PROJECT_REF)) {
    checks.push(check("not-production", false, `The URL names the PRODUCTION project (${PRODUCTION_PROJECT_REF}). Refused.`));
    return fail();
  }
  checks.push(check("not-production", true, `The URL does not name the production project (${PRODUCTION_PROJECT_REF}).`));

  // 3. And it must be the expected local endpoint, exactly.
  const normalised = url.replace(/\/+$/, "");
  if (normalised !== expectedUrl) {
    checks.push(check("url-is-local-sandbox", false, `Expected ${expectedUrl}, found ${normalised}.`));
    return fail();
  }
  checks.push(check("url-is-local-sandbox", true, `Resolves to ${expectedUrl}.`));

  // 4. A client must exist — built from the certification variables, with
  //    no fallback to anything else.
  if (!options.db) {
    checks.push(check("client-constructed", false, "The certification client could not be built (missing URL or service-role key)."));
    return fail();
  }
  checks.push(check("client-constructed", true, "Certification client built from the certification variables."));

  // 5. Authenticate by doing the smallest real read. An auth failure, a
  //    wrong key or an unreachable host all surface here.
  let row: { id?: string; name?: string } | null = null;
  try {
    const result = await options.db.from("companies").select("id,name").eq("id", options.companyId).maybeSingle();
    if (result.error) {
      const message = result.error instanceof Error ? result.error.message : String((result.error as { message?: string })?.message ?? result.error);
      checks.push(check("authenticated", false, `The read was refused: ${message}`));
      return fail();
    }
    row = result.data as { id?: string; name?: string } | null;
  } catch (error) {
    checks.push(check("authenticated", false, `Could not reach the certification database: ${error instanceof Error ? error.message : "unknown error"}`));
    return fail();
  }
  checks.push(check("authenticated", true, "The service-role key authenticated against the local instance."));

  // 6. The company must actually be there.
  if (!row?.id) {
    checks.push(check("company-exists", false, `No company ${options.companyId} in this database.`));
    return fail();
  }
  checks.push(check("company-exists", true, `Company ${options.companyId} found.`));

  // 7. And be the one we meant.
  if (row.name !== expectedName) {
    checks.push(check("company-name", false, `Expected "${expectedName}", found "${row.name}".`));
    return { ...fail(), companyName: row.name ?? null };
  }
  checks.push(check("company-name", true, `Named "${expectedName}".`));

  // 8. A clean baseline, so "nothing accounting changed" stays readable.
  const [journals, bills, suppliers, extractionTasks] = await Promise.all([
    countFor(options.db, "ae_journals", options.companyId),
    countFor(options.db, "ae_imported_bills", options.companyId),
    countFor(options.db, "ae_suppliers", options.companyId),
    countExtractionTasks(options.db, options.companyId),
  ]);

  if (journals === null || bills === null || suppliers === null || extractionTasks === null) {
    checks.push(check("baseline-readable", false, "One or more baseline counts could not be read."));
    return { ...fail(), companyName: row.name ?? null };
  }

  const baseline = { journals, bills, suppliers, extractionTasks };
  const expected = EXPECTED_BASELINE;
  const clean =
    journals === expected.journals &&
    bills === expected.bills &&
    suppliers === expected.suppliers &&
    extractionTasks === expected.extractionTasks;

  checks.push(
    check(
      "clean-baseline",
      clean,
      `journals=${journals}, bills=${bills}, suppliers=${suppliers}, extraction tasks=${extractionTasks}` +
        (clean ? " — all zero, as expected." : ` — expected all zero.`),
    ),
  );

  return {
    ok: checks.every((c) => c.passed),
    checks,
    url: normalised,
    companyId: options.companyId,
    companyName: row.name ?? null,
    baseline,
  };
}

/** Extraction tasks are counted by type as well as company, so this cannot
 * share the generic helper. */
async function countExtractionTasks(db: CertificationDb, companyId: string): Promise<number | null> {
  try {
    const result = await db
      .from("automation_tasks")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("task_type", "SupplierInvoiceExtraction");
    if (result.error) return null;
    return typeof result.count === "number" ? result.count : null;
  } catch {
    return null;
  }
}
