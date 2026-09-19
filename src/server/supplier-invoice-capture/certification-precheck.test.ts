/**
 * Phase 5Q.2 — the read-only precheck, tested.
 *
 * @vitest-environment node
 *
 * NO DATABASE IS CONTACTED AND NO PROVIDER REQUEST IS MADE. Every test
 * injects a fake query surface.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_COMPANY_NAME,
  EXPECTED_LOCAL_URL,
  PRODUCTION_PROJECT_REF,
  runCertificationPrecheck,
} from "./certification-precheck";
import type { CertificationDb } from "./certification-budget";

const COMPANY = "5a0c0000-0000-4000-8000-00000000513a";

type FakeShape = {
  company?: { id: string; name: string } | null;
  counts?: Record<string, number>;
  error?: { message: string };
  throws?: boolean;
};

/** A stand-in for the Supabase query builder, narrowed to what the
 * precheck uses. It records every table touched so a test can assert that
 * nothing but reads happened. */
function fakeDb(shape: FakeShape) {
  const touched: string[] = [];
  const db = {
    async rpc() {
      throw new Error("the precheck must not call rpc");
    },
    from(table: string) {
      touched.push(table);
      let taskTypeFiltered = false;
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: string) {
          if (column === "task_type" && value === "SupplierInvoiceExtraction") taskTypeFiltered = true;
          return builder;
        },
        async maybeSingle() {
          if (shape.throws) throw new Error("connection refused");
          if (shape.error) return { data: null, error: shape.error };
          return { data: shape.company ?? null, error: null };
        },
        then(resolve: (v: { data: unknown; error: unknown; count?: number | null }) => unknown) {
          if (shape.throws) throw new Error("connection refused");
          if (shape.error) return Promise.resolve({ data: null, error: shape.error, count: null }).then(resolve);
          const key = table === "automation_tasks" && taskTypeFiltered ? "extractionTasks" : table;
          const count = shape.counts?.[key] ?? 0;
          return Promise.resolve({ data: null, error: null, count }).then(resolve);
        },
      };
      return builder as unknown as ReturnType<CertificationDb["from"]>;
    },
  } as unknown as CertificationDb;
  return { db, touched };
}

const HEALTHY: FakeShape = {
  company: { id: COMPANY, name: EXPECTED_COMPANY_NAME },
  counts: { ae_journals: 0, ae_imported_bills: 0, ae_suppliers: 0, extractionTasks: 0 },
};

const base = (shape: FakeShape, overrides: Partial<Parameters<typeof runCertificationPrecheck>[0]> = {}) => {
  const { db } = fakeDb(shape);
  return { db, url: EXPECTED_LOCAL_URL, companyId: COMPANY, ...overrides };
};

describe("a healthy local sandbox", () => {
  it("passes every check", async () => {
    const result = await runCertificationPrecheck(base(HEALTHY));
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.companyName).toBe(EXPECTED_COMPANY_NAME);
    expect(result.baseline).toEqual({ journals: 0, bills: 0, suppliers: 0, extractionTasks: 0 });
    expect(result.url).toBe(EXPECTED_LOCAL_URL);
  });

  it("tolerates a trailing slash on the URL", async () => {
    const result = await runCertificationPrecheck(base(HEALTHY, { url: `${EXPECTED_LOCAL_URL}/` }));
    expect(result.ok).toBe(true);
  });
});

describe("production can never be used", () => {
  it("REFUSES a URL naming the production project, before connecting", async () => {
    // The worst outcome this phase could produce is a healthy-looking
    // report about the production database. So this is checked before any
    // query runs.
    const { db, touched } = fakeDb(HEALTHY);
    const result = await runCertificationPrecheck({
      db,
      url: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
      companyId: COMPANY,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "not-production")?.passed).toBe(false);
    // Nothing was queried at all.
    expect(touched).toEqual([]);
  });

  it("refuses any URL that is not the expected local endpoint", async () => {
    for (const url of ["https://other.supabase.co", "http://127.0.0.1:54321", "http://localhost:56321"]) {
      const result = await runCertificationPrecheck(base(HEALTHY, { url }));
      expect(`${url}:${result.ok}`).toBe(`${url}:false`);
      expect(result.checks.find((c) => c.name === "url-is-local-sandbox")?.passed).toBe(false);
    }
  });

  it("names no credential fallback anywhere", () => {
    const source = readFileSync("src/server/supplier-invoice-capture/certification-precheck.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|process\.env/);
  });
});

describe("missing or broken credentials fail closed", () => {
  it("no URL", async () => {
    const result = await runCertificationPrecheck(base(HEALTHY, { url: undefined }));
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ name: "url-present", passed: false });
  });

  it("no client — the key was missing, so none could be built", async () => {
    const result = await runCertificationPrecheck({ db: null, url: EXPECTED_LOCAL_URL, companyId: COMPANY });
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "client-constructed")?.passed).toBe(false);
  });

  it("a rejected read (wrong key) fails at authentication", async () => {
    const result = await runCertificationPrecheck(base({ error: { message: "Invalid API key" } }));
    expect(result.ok).toBe(false);
    const auth = result.checks.find((c) => c.name === "authenticated");
    expect(auth?.passed).toBe(false);
    expect(auth?.detail).toContain("Invalid API key");
  });

  it("an unreachable host fails at authentication rather than throwing", async () => {
    const result = await runCertificationPrecheck(base({ throws: true }));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "authenticated")?.passed).toBe(false);
  });
});

describe("the company must be the right one", () => {
  it("an absent company fails", async () => {
    const result = await runCertificationPrecheck(base({ company: null }));
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "company-exists")?.passed).toBe(false);
  });

  it("a DIFFERENT company name fails, and reports what it found", async () => {
    const result = await runCertificationPrecheck(base({ company: { id: COMPANY, name: "Lifecycle company" } }));
    expect(result.ok).toBe(false);
    const nameCheck = result.checks.find((c) => c.name === "company-name");
    expect(nameCheck?.passed).toBe(false);
    expect(nameCheck?.detail).toContain("Lifecycle company");
    expect(result.companyName).toBe("Lifecycle company");
  });
});

describe("the baseline must be clean", () => {
  it.each([
    ["ae_journals", "journals"],
    ["ae_imported_bills", "bills"],
    ["ae_suppliers", "suppliers"],
  ])("a non-zero %s count fails", async (table) => {
    const result = await runCertificationPrecheck(
      base({ company: { id: COMPANY, name: EXPECTED_COMPANY_NAME }, counts: { ...HEALTHY.counts, [table]: 10 } }),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "clean-baseline")?.passed).toBe(false);
  });

  it("an existing SupplierInvoiceExtraction task fails", async () => {
    const result = await runCertificationPrecheck(
      base({ company: { id: COMPANY, name: EXPECTED_COMPANY_NAME }, counts: { ...HEALTHY.counts, extractionTasks: 1 } }),
    );
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "clean-baseline")?.detail).toContain("extraction tasks=1");
  });

  it("reports the counts it found, so a failure is diagnosable", async () => {
    const result = await runCertificationPrecheck(
      base({ company: { id: COMPANY, name: EXPECTED_COMPANY_NAME }, counts: { ...HEALTHY.counts, ae_journals: 3 } }),
    );
    expect(result.baseline).toEqual({ journals: 3, bills: 0, suppliers: 0, extractionTasks: 0 });
  });
});

describe("strictly read-only", () => {
  const source = readFileSync("src/server/supplier-invoice-capture/certification-precheck.ts", "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("contains no write of any kind", () => {
    expect(code).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\brpc\(/);
  });

  it("only ever selects", () => {
    const verbs = code.match(/\.\b(select|insert|update|delete|upsert)\b\(/g) ?? [];
    expect(new Set(verbs)).toEqual(new Set([".select("]));
  });

  it("opens no certification run and reserves no call", () => {
    expect(code).not.toMatch(/openCertificationRun|reserveCertificationCall|fn_ai_certification/);
  });

  it("makes no provider request and imports no provider", () => {
    const imports = source.match(/^import[\s\S]*?;$/gm)?.join("\n") ?? "";
    expect(imports).not.toMatch(/provider-selection|extraction-provider|gateway|generateObject/);
    expect(code).not.toMatch(/extract\(|generateObject|AI_GATEWAY_API_KEY/);
  });

  it("is isolated from the certification execution path", () => {
    // Nothing in the run imports the precheck, and the precheck imports
    // nothing from the run. A precheck wired into a live run is one more
    // thing that can fail during one.
    const imports = source.match(/^import[\s\S]*?;$/gm)?.join("\n") ?? "";
    expect(imports).not.toMatch(/certification-run/);
    const runSource = readFileSync("src/server/supplier-invoice-capture/certification-run.ts", "utf8");
    expect(runSource).not.toMatch(/certification-precheck/);
  });

  it("touches only the four expected tables", async () => {
    const { db, touched } = fakeDb(HEALTHY);
    await runCertificationPrecheck({ db, url: EXPECTED_LOCAL_URL, companyId: COMPANY });
    expect(new Set(touched)).toEqual(new Set(["companies", "ae_journals", "ae_imported_bills", "ae_suppliers", "automation_tasks"]));
  });
});

describe("secrets are never exposed", () => {
  it("no result ever carries the service-role key", async () => {
    const result = await runCertificationPrecheck(base(HEALTHY));
    // The key is not a parameter of this function at all — it reaches the
    // client and stops there. The URL is a localhost address and is safe.
    expect(JSON.stringify(result)).not.toMatch(/eyJ|service_role|SERVICE_ROLE/);
    expect(result.url).toBe(EXPECTED_LOCAL_URL);
  });

  it("the CLI loads only the two Supabase variables — not the Gateway key", () => {
    const cli = readFileSync("scripts/certification-precheck.mjs", "utf8");
    const code = cli.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // A precheck that cannot reach a provider cannot call one by accident.
    expect(code).toMatch(/const SECRET_VARS = \["VYRON_CERTIFICATION_SUPABASE_URL", "VYRON_CERTIFICATION_SERVICE_ROLE_KEY"\]/);
    expect(code).not.toMatch(/AI_GATEWAY_API_KEY/);
    expect(code).not.toMatch(/--confirm/);
  });

  it("the CLI prints names and counts, never values", () => {
    const cli = readFileSync("scripts/certification-precheck.mjs", "utf8");
    const consoleLines = cli.split("\n").filter((l) => /console\.(log|error)/.test(l));
    expect(consoleLines.some((l) => /process\.env\[|SERVICE_ROLE_KEY/.test(l))).toBe(false);
  });
});
