// @vitest-environment node
/**
 * P0 security remediation — REAL Postgres tests for migrations 0097 and 0098.
 *
 * Runs against a local Supabase Postgres that has every migration applied
 * (never production). Set VYRON_TEST_DB_CONTAINER to the database
 * container's name; the suite is skipped otherwise. Statements run through
 * `psql` inside that container, so each call is a separate database
 * connection — the concurrency tests are real parallelism, not simulated.
 * Identities are simulated exactly as PostgREST does it: `set role` plus
 * the JWT claims `auth.uid()` reads.
 *
 * Shares bootstrap state with platform-bootstrap.gotrue.test.ts — run the
 * two with --no-file-parallelism. Every row this suite creates uses fresh
 * random ids and is removed again; write probes run inside a transaction
 * that is rolled back.
 */
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const CONTAINER = process.env.VYRON_TEST_DB_CONTAINER;
const run = promisify(execFile);
type As = { role: "anon" | "authenticated" | "service_role"; sub?: string };

function prefix(as?: As): string {
  if (!as) return "";
  const claims = JSON.stringify({ sub: as.sub ?? null, role: as.role });
  return `set role ${as.role};\nset "request.jwt.claims" = '${claims}';\nset "request.jwt.claim.sub" = '${as.sub ?? ""}';\n`;
}
const args = ["exec", "-i", CONTAINER ?? "", "psql", "-U", "postgres", "-d", "postgres", "-At", "-q", "-v", "ON_ERROR_STOP=1"];
function sql(statement: string, as?: As): string {
  return execFileSync("docker", args, { input: prefix(as) + statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
/** Runs as `as` inside a transaction that is always rolled back. */
function sqlRolledBack(statement: string, as: As): string {
  return execFileSync("docker", args, { input: `begin;\n${prefix(as)}${statement}\nrollback;\n`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function sqlFails(statement: string, as?: As): string {
  try {
    sql(statement, as);
  } catch (error) {
    return String((error as { stderr?: string }).stderr ?? error);
  }
  throw new Error(`expected failure: ${statement}`);
}
async function sqlAsync(statement: string, as?: As): Promise<string> {
  const child = run("docker", args, { encoding: "utf8" });
  child.child.stdin?.end(prefix(as) + statement);
  return (await child).stdout.trim();
}
const bool = (statement: string, as: As) => sql(`select (${statement})::text;`, as) === "true";

const ids = {
  orgA: randomUUID(), orgB: randomUUID(), companyA: randomUUID(), companyB: randomUUID(),
  ownerA: randomUUID(), ownerB: randomUUID(), superAdmin: randomUUID(), partner: randomUUID(), support: randomUUID(), reader: randomUUID(),
  candidates: Array.from({ length: 10 }, () => randomUUID()),
};
const users = [ids.ownerA, ids.ownerB, ids.superAdmin, ids.partner, ids.support, ids.reader, ...ids.candidates];
const quoted = (list: string[]) => list.map((u) => `'${u}'`).join(",");
const emailOf = (u: string) => `p0-${u}@p0.test`;
const PSA = "(select id from permission_roles where company_id is null and role_key = 'platform_super_administrator')";
let readerRoleId = "";

/** No bootstrap state, and every candidate back to a fresh, unverified, password-less invitee. */
function resetBootstrap() {
  sql(`delete from platform_bootstrap_state;
       delete from user_role_assignments where company_id is null and role_id = ${PSA} and user_id in (${quoted(ids.candidates)});
       update auth.users set email_confirmed_at = null, encrypted_password = '', last_sign_in_at = null where id in (${quoted(ids.candidates)});`);
}
const bootstrap = (u: string, email = emailOf(u)) => `select complete_platform_bootstrap('${u}', '${email}') ->> 'outcome';`;
const svc: As = { role: "service_role" };
const psaCount = () => sql(`select count(*) from user_role_assignments where company_id is null and role_id = ${PSA} and user_id in (${quoted(ids.candidates)});`);

const describeDb = CONTAINER ? describe : describe.skip;

describeDb(`platform security in Postgres (${CONTAINER ?? "no test database"})`, () => {
  beforeAll(() => {
    expect(sql("select count(*) from platform_bootstrap_state;")).toBe("0"); // a clean test database
    sql(`
      insert into auth.users (id, email, aud, role, encrypted_password) select u, 'p0-' || u || '@p0.test', 'authenticated', 'authenticated', '' from unnest(array[${quoted(users)}]::uuid[]) u;
      insert into organisations (id, name) values ('${ids.orgA}', 'P0 Org A'), ('${ids.orgB}', 'P0 Org B');
      insert into organisation_members (organisation_id, user_id, role) values ('${ids.orgA}', '${ids.ownerA}', 'owner'), ('${ids.orgB}', '${ids.ownerB}', 'owner');
      insert into companies (id, organisation_id, name) values ('${ids.companyA}', '${ids.orgA}', 'P0 Company A'), ('${ids.companyB}', '${ids.orgB}', 'P0 Company B');
      select seed_company_rbac_defaults('${ids.companyA}'); select seed_company_rbac_defaults('${ids.companyB}');
      insert into user_role_assignments (user_id, company_id, role_id, assigned_by)
        select '${ids.ownerA}'::uuid, company_id, id, 'p0-test' from permission_roles where company_id = '${ids.companyA}' and role_key = 'company_owner'
        union all select '${ids.ownerB}'::uuid, company_id, id, 'p0-test' from permission_roles where company_id = '${ids.companyB}' and role_key = 'company_owner';
      insert into customers (company_id, customer_code, name) values ('${ids.companyA}', 'P0-A', 'P0 Customer A'), ('${ids.companyB}', 'P0-B', 'P0 Customer B');
      insert into billing_accounts (organisation_id, billing_email, default_currency_code) values ('${ids.orgA}', 'billing-a@p0.test', 'ZAR'), ('${ids.orgB}', 'billing-b@p0.test', 'ZAR');
      insert into billing_support_notes (billing_account_id, note, created_by) select id, 'P0 support note', 'p0-test' from billing_accounts where organisation_id = '${ids.orgA}';
      insert into system_events (company_id, event_type, severity, detail) values (null, 'PermissionDenied', 'warning', 'P0 platform-level event');
      insert into user_role_assignments (user_id, company_id, role_id, assigned_by) values
        ('${ids.partner}', null, (select id from permission_roles where company_id is null and role_key = 'partner'), 'p0-test'),
        ('${ids.support}', null, (select id from permission_roles where company_id is null and role_key = 'support_technician'), 'p0-test');
    `);
    readerRoleId = sql(`insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (null, 'p0_test_cross_tenant_reader', 'P0 test cross-tenant reader', false, 'platform') returning id;`);
    sql(`insert into role_permissions (role_id, permission_key) values (${readerRoleId}, 'CrossTenantRead');
         insert into user_role_assignments (user_id, company_id, role_id, assigned_by) values ('${ids.reader}', null, ${readerRoleId}, 'p0-test');`);
  });

  afterAll(() => {
    sql(`
      delete from platform_bootstrap_state;
      delete from system_events where detail = 'P0 platform-level event';
      delete from billing_support_notes where billing_account_id in (select id from billing_accounts where organisation_id in ('${ids.orgA}', '${ids.orgB}'));
      delete from billing_accounts where organisation_id in ('${ids.orgA}', '${ids.orgB}');
      delete from customers where company_id in ('${ids.companyA}', '${ids.companyB}');
      delete from user_role_assignments where user_id in (${quoted(users)});
      delete from role_permissions where role_id = ${readerRoleId || "null"};
      delete from permission_roles where id = ${readerRoleId || "null"};
      delete from companies where id in ('${ids.companyA}', '${ids.companyB}');
      delete from organisation_members where organisation_id in ('${ids.orgA}', '${ids.orgB}');
      delete from organisations where id in ('${ids.orgA}', '${ids.orgB}');
      delete from auth.users where id in (${quoted(users)});
    `);
  });

  describe("C/D. first platform administrator — atomic, pending until verified, then final", () => {
    beforeEach(() => resetBootstrap());

    it("10 truly concurrent calls for the same fresh invitee → one 'invited', nine 'reissued'; one assignment, one state row", async () => {
      const u = ids.candidates[0];
      const results = await Promise.all(Array.from({ length: 10 }, () => sqlAsync(bootstrap(u), svc)));
      expect(results.filter((r) => r === "invited")).toHaveLength(1);
      expect(results.filter((r) => r === "reissued")).toHaveLength(9);
      expect(psaCount()).toBe("1");
      expect(sql("select count(*) || ':' || max(platform_admin_user_id::text) from platform_bootstrap_state;")).toBe(`1:${u}`);
      expect(sql("select platform_bootstrap_status();", svc)).toBe("pending_verification");
    });

    it("10 truly concurrent calls for 10 different invitees → exactly one pending administrator at any time", async () => {
      const results = await Promise.all(ids.candidates.map((u) => sqlAsync(bootstrap(u), svc)));
      expect(results.filter((r) => r === "invited")).toHaveLength(1);
      expect(results.filter((r) => r === "rebound")).toHaveLength(9);
      expect(psaCount()).toBe("1");
      const holder = sql(`select user_id from user_role_assignments where company_id is null and role_id = ${PSA} and user_id in (${quoted(ids.candidates)});`);
      expect(sql("select platform_admin_user_id from platform_bootstrap_state;")).toBe(holder);
    });

    it("once the invitee has verified, bootstrap is complete: every later attempt is refused and changes nothing", () => {
      const [first, second] = ids.candidates;
      expect(sql(bootstrap(first), svc)).toBe("invited");
      expect(sql("select platform_bootstrap_completed()::text;", svc)).toBe("false");
      sql(`update auth.users set email_confirmed_at = now() where id = '${first}';`); // what accepting the invitation does (proven for real in the GoTrue suite)
      expect(sql("select platform_bootstrap_status();", svc)).toBe("completed");
      expect(sql(bootstrap(second), svc)).toBe("already_completed");
      expect(sql(bootstrap(first), svc)).toBe("already_completed");
      expect(sql(`select count(*) from user_role_assignments where user_id = '${second}';`)).toBe("0");
      expect(sql("select platform_admin_user_id from platform_bootstrap_state;")).toBe(first);
      expect(psaCount()).toBe("1");
    });

    it("only a fresh invitation is eligible — anything else raises and leaves no partial state", () => {
      const u = ids.candidates[1];
      const ineligible: Array<[string, string]> = [
        ["already verified", `update auth.users set email_confirmed_at = now() where id = '${u}';`],
        ["has a password (e.g. a self-registered sign-up)", `update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuv' where id = '${u}';`],
        ["has signed in before", `update auth.users set last_sign_in_at = now() where id = '${u}';`],
      ];
      for (const [, setup] of ineligible) {
        resetBootstrap();
        sql(setup);
        expect(sqlFails(bootstrap(u), svc)).toMatch(/bootstrap_account_not_eligible/);
        expect(sql("select count(*) from platform_bootstrap_state;")).toBe("0");
        expect(psaCount()).toBe("0");
      }
      resetBootstrap();
      expect(sqlFails(bootstrap(u, "someone-else@p0.test"), svc)).toMatch(/bootstrap_account_not_eligible: the account email does not match/);
      expect(sqlFails(`select complete_platform_bootstrap('${randomUUID()}', 'ghost@p0.test');`, svc)).toMatch(/Unknown user/);
      expect(sql("select count(*) from platform_bootstrap_state;")).toBe("0");
      expect(psaCount()).toBe("0");
      expect(sql("select platform_bootstrap_status();", svc)).toBe("not_started");
    });

    it("the public API roles cannot run or read bootstrap at all; no API role can touch the state table", () => {
      for (const role of ["anon", "authenticated"] as const) {
        expect(sqlFails(bootstrap(ids.candidates[0]), { role, sub: ids.ownerA })).toMatch(/permission denied/);
        expect(sqlFails("select platform_bootstrap_completed();", { role, sub: ids.ownerA })).toMatch(/permission denied/);
        expect(sqlFails("select platform_bootstrap_status();", { role, sub: ids.ownerA })).toMatch(/permission denied/);
      }
      for (const role of ["anon", "authenticated", "service_role"] as const) {
        expect(sqlFails("select * from platform_bootstrap_state;", { role, sub: ids.ownerA })).toMatch(/permission denied/);
      }
      expect(sqlFails(`insert into user_role_assignments (user_id, company_id, role_id) values ('${ids.ownerA}', null, 1);`, { role: "authenticated", sub: ids.ownerA })).toMatch(/row-level security|permission denied/);
    });
  });

  describe("F. platform roles no longer imply tenant access", () => {
    const tenantRows = (sub: string) => sql(`select count(*) from customers where company_id in ('${ids.companyA}', '${ids.companyB}');`, { role: "authenticated", sub });
    beforeAll(() => {
      resetBootstrap();
      sql(`insert into user_role_assignments (user_id, company_id, role_id, assigned_by) values ('${ids.superAdmin}', null, ${PSA}, 'p0-test');`);
    });
    afterAll(() => {
      sql(`delete from user_role_assignments where user_id = '${ids.superAdmin}';`);
    });

    it("platform_super_administrator: no tenant accounting access, no company permissions", () => {
      const as: As = { role: "authenticated", sub: ids.superAdmin };
      expect(tenantRows(ids.superAdmin)).toBe("0");
      expect(bool(`user_can_access_company('${ids.companyA}')`, as)).toBe(false);
      expect(bool(`user_has_permission('${ids.companyA}', 'ManageUsers')`, as)).toBe(false);
      expect(bool(`user_has_permission('${ids.companyA}', 'RunReports')`, as)).toBe(false);
      expect(sqlFails(`insert into customers (company_id, customer_code, name) values ('${ids.companyA}', 'HACK', 'x');`, as)).toMatch(/row-level security/);
    });

    it("platform_super_administrator keeps platform administration (ManageBilling, platform-level AuditAccess)", () => {
      const as: As = { role: "authenticated", sub: ids.superAdmin };
      expect(bool(`user_has_permission(null, 'ManageBilling')`, as)).toBe(true);
      expect(bool(`user_has_platform_permission('ManageBilling')`, as)).toBe(true);
      expect(bool(`user_has_permission(null, 'AuditAccess')`, as)).toBe(true);
      expect(sql("select count(*) from billing_support_notes where note = 'P0 support note';", as)).toBe("1");
    });

    it("partner: nothing — no tenant data, no billing, no platform permissions", () => {
      const as: As = { role: "authenticated", sub: ids.partner };
      expect(tenantRows(ids.partner)).toBe("0");
      expect(bool(`user_can_access_company('${ids.companyA}')`, as)).toBe(false);
      expect(bool(`user_has_permission(null, 'ManageBilling')`, as)).toBe(false);
      expect(sql("select count(*) from billing_support_notes where note = 'P0 support note';", as)).toBe("0");
    });

    it("support_technician: no tenant accounting access and no billing (has no ManageBilling)", () => {
      const as: As = { role: "authenticated", sub: ids.support };
      expect(tenantRows(ids.support)).toBe("0");
      expect(bool(`user_can_access_company('${ids.companyB}')`, as)).toBe(false);
      expect(bool(`user_has_permission('${ids.companyB}', 'RunReports')`, as)).toBe(false);
      expect(sql("select count(*) from billing_support_notes where note = 'P0 support note';", as)).toBe("0");
    });

    it("explicit CrossTenantRead grants READ-ONLY access across tenants — never write", () => {
      const as: As = { role: "authenticated", sub: ids.reader };
      expect(tenantRows(ids.reader)).toBe("2");
      expect(bool(`user_can_access_company('${ids.companyA}')`, as)).toBe(false);
      expect(sqlFails(`insert into customers (company_id, customer_code, name) values ('${ids.companyA}', 'HACK', 'x');`, as)).toMatch(/row-level security/);
      expect(sql(`with u as (update customers set name = 'HACKED' where company_id = '${ids.companyA}' returning 1) select count(*) from u;`, as)).toBe("0");
      expect(sql(`with d as (delete from customers where company_id = '${ids.companyB}' returning 1) select count(*) from d;`, as)).toBe("0");
      expect(sql(`select name from customers where company_id = '${ids.companyA}';`)).toBe("P0 Customer A");
    });
  });

  describe("G. company owners keep exactly their own company's access", () => {
    it("owner A: full access to company A, nothing in company B", () => {
      const as: As = { role: "authenticated", sub: ids.ownerA };
      expect(bool(`user_can_access_company('${ids.companyA}')`, as)).toBe(true);
      expect(bool(`user_can_access_company('${ids.companyB}')`, as)).toBe(false);
      expect(bool(`user_has_permission('${ids.companyA}', 'ManageUsers')`, as)).toBe(true);
      expect(bool(`user_has_permission('${ids.companyA}', 'RunReports')`, as)).toBe(true);
      expect(bool(`user_has_permission('${ids.companyB}', 'ManageUsers')`, as)).toBe(false);
      expect(bool(`user_has_permission(null, 'ManageBilling')`, as)).toBe(false);
      expect(sql(`select string_agg(customer_code, ',' order by customer_code) from customers where company_id in ('${ids.companyA}', '${ids.companyB}');`, as)).toBe("P0-A");
      expect(sqlRolledBack(`with i as (insert into customers (company_id, customer_code, name) values ('${ids.companyA}', 'P0-A2', 'Second') returning 1) select count(*) from i;`, as)).toBe("1");
      expect(sqlFails(`insert into customers (company_id, customer_code, name) values ('${ids.companyB}', 'P0-X', 'x');`, as)).toMatch(/row-level security/);
    });

    it("owner B: mirror image", () => {
      const as: As = { role: "authenticated", sub: ids.ownerB };
      expect(bool(`user_can_access_company('${ids.companyB}')`, as)).toBe(true);
      expect(bool(`user_can_access_company('${ids.companyA}')`, as)).toBe(false);
      expect(sql(`select string_agg(customer_code, ',' order by customer_code) from customers where company_id in ('${ids.companyA}', '${ids.companyB}');`, as)).toBe("P0-B");
    });

    it("owners can still manage roles in their own company only (assign_company_role)", () => {
      const roleB = sql(`select id from permission_roles where company_id = '${ids.companyB}' and role_key = 'bookkeeper';`);
      expect(sqlFails(`select * from assign_company_role('${ids.reader}', '${ids.companyB}', ${roleB}, 'x');`, { role: "authenticated", sub: ids.ownerA })).toMatch(/Not authorized/);
      expect(sqlFails(`select * from assign_company_role('${ids.reader}', null, ${roleB}, 'x');`, { role: "authenticated", sub: ids.superAdmin })).toMatch(/Not authorized|Company not found/);
    });
  });

  describe("I. RLS / platform-role matrix — every cell measured in Postgres", () => {
    type Cell = "ALLOWED" | "DENIED" | "n/a";
    const attempt = (fn: () => boolean): boolean => {
      try {
        return fn();
      } catch {
        return false;
      }
    };
    const cell = (v: boolean | null): Cell => (v === null ? "n/a" : v ? "ALLOWED" : "DENIED");
    const rolledBackCount = (statement: string, as: As) => attempt(() => Number(sqlRolledBack(statement, as)) > 0);

    beforeAll(() => {
      resetBootstrap();
      sql(`insert into user_role_assignments (user_id, company_id, role_id, assigned_by) values ('${ids.superAdmin}', null, ${PSA}, 'p0-test');`);
    });
    afterAll(() => {
      sql(`delete from user_role_assignments where user_id = '${ids.superAdmin}';`);
    });

    function measure(sub: string, own: { company: string; org: string } | null) {
      const as: As = { role: "authenticated", sub };
      const others = own ? [own.company === ids.companyA ? ids.companyB : ids.companyA] : [ids.companyA, ids.companyB];
      const otherOrgs = own ? [own.org === ids.orgA ? ids.orgB : ids.orgA] : [ids.orgA, ids.orgB];
      const inOthers = quoted(others);
      const reader = ids.reader;
      const bookkeeper = (company: string) => sql(`select id from permission_roles where company_id = '${company}' and role_key = 'bookkeeper';`);
      return {
        ownRead: own ? attempt(() => Number(sql(`select count(*) from customers where company_id = '${own.company}';`, as)) > 0) : null,
        ownWrite: own
          ? rolledBackCount(`with i as (insert into customers (company_id, customer_code, name) values ('${own.company}', 'M-OWN', 'x') returning 1) select count(*) from i;`, as) &&
            rolledBackCount(`with u as (update customers set notes = 'm' where company_id = '${own.company}' returning 1) select count(*) from u;`, as)
          : null,
        otherRead: attempt(() => Number(sql(`select count(*) from customers where company_id in (${inOthers});`, as)) > 0),
        otherWrite:
          rolledBackCount(`with i as (insert into customers (company_id, customer_code, name) values ('${others[0]}', 'M-X', 'x') returning 1) select count(*) from i;`, as) ||
          rolledBackCount(`with u as (update customers set notes = 'm' where company_id in (${inOthers}) returning 1) select count(*) from u;`, as) ||
          rolledBackCount(`with d as (delete from customers where company_id in (${inOthers}) returning 1) select count(*) from d;`, as),
        platformBilling:
          attempt(() => Number(sql(`select count(*) from billing_accounts where organisation_id in (${quoted(otherOrgs)});`, as)) > 0) ||
          rolledBackCount(`with i as (insert into billing_support_notes (billing_account_id, note, created_by) select id, 'm', 'm' from billing_accounts where organisation_id = '${ids.orgA}' returning 1) select count(*) from i;`, as),
        platformAudit: attempt(() => Number(sql("select count(*) from system_events where company_id is null and detail = 'P0 platform-level event';", as)) > 0),
        roleAdminOwnCompany: own ? rolledBackCount(`select count(*) from assign_company_role('${reader}', '${own.company}', ${bookkeeper(own.company)}, 'm');`, as) : null,
        roleAdminOtherCompany: rolledBackCount(`select count(*) from assign_company_role('${reader}', '${others[0]}', ${bookkeeper(others[0])}, 'm');`, as),
        platformRoleEscalation:
          rolledBackCount(`with i as (insert into user_role_assignments (user_id, company_id, role_id, assigned_by) values ('${sub}', null, ${PSA}, 'm') returning 1) select count(*) from i;`, as) ||
          rolledBackCount(`with i as (insert into role_permissions (role_id, permission_key) values (${PSA}, 'CrossTenantRead') returning 1) select count(*) from i;`, as) ||
          rolledBackCount(`with i as (insert into permission_roles (company_id, role_key, name, is_system_role, scope) values (null, 'm_escalate', 'm', false, 'platform') returning 1) select count(*) from i;`, as) ||
          rolledBackCount(`with u as (update role_permissions set permission_key = 'CrossTenantRead' where role_id = ${PSA} returning 1) select count(*) from u;`, as),
      };
    }

    it("matches the intended least-privilege matrix", () => {
      const identities: Array<[string, string, { company: string; org: string } | null]> = [
        ["Owner A (Metanoia-equivalent: company_owner of its own company)", ids.ownerA, { company: ids.companyA, org: ids.orgA }],
        ["Owner B (Northwood-equivalent: company_owner, separate organisation)", ids.ownerB, { company: ids.companyB, org: ids.orgB }],
        ["platform_super_administrator", ids.superAdmin, null],
        ["support_technician", ids.support, null],
        ["partner", ids.partner, null],
        ["explicit CrossTenantRead holder", ids.reader, null],
      ];
      const actual = Object.fromEntries(
        identities.map(([label, sub, own]) => [label, Object.fromEntries(Object.entries(measure(sub, own)).map(([k, v]) => [k, cell(v)]))]),
      );
      if (process.env.VYRON_MATRIX_OUT) writeFileSync(process.env.VYRON_MATRIX_OUT, JSON.stringify(actual, null, 2));

      const owner = { ownRead: "ALLOWED", ownWrite: "ALLOWED", otherRead: "DENIED", otherWrite: "DENIED", platformBilling: "DENIED", platformAudit: "DENIED", roleAdminOwnCompany: "ALLOWED", roleAdminOtherCompany: "DENIED", platformRoleEscalation: "DENIED" };
      const platform = (billing: Cell, audit: Cell, otherRead: Cell = "DENIED") => ({ ownRead: "n/a", ownWrite: "n/a", otherRead, otherWrite: "DENIED", platformBilling: billing, platformAudit: audit, roleAdminOwnCompany: "n/a", roleAdminOtherCompany: "DENIED", platformRoleEscalation: "DENIED" });
      expect(actual).toEqual({
        [identities[0][0]]: owner,
        [identities[1][0]]: owner,
        [identities[2][0]]: platform("ALLOWED", "ALLOWED"),
        [identities[3][0]]: platform("DENIED", "ALLOWED"),
        [identities[4][0]]: platform("DENIED", "DENIED"),
        [identities[5][0]]: platform("DENIED", "DENIED", "ALLOWED"),
      });
    }, 60_000); // 54 separate database connections
  });
});
