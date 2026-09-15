// @vitest-environment node
/**
 * P0 security remediation — the platform bootstrap lifecycle END TO END,
 * with nothing faked: the real route handler, guard and service, a real
 * Supabase Auth (GoTrue) server, the real email it sends (captured by the
 * local Mailpit mail catcher), real invitation acceptance, and Postgres
 * with every migration applied. Local Supabase only — never production.
 *
 * Skipped unless all of these are set: VYRON_TEST_SUPABASE_URL,
 * VYRON_TEST_SUPABASE_ANON_KEY, VYRON_TEST_SUPABASE_SERVICE_ROLE_KEY,
 * VYRON_TEST_MAILPIT_URL, VYRON_TEST_DB_CONTAINER. The Auth server should
 * have "Confirm email" on (the hosted Supabase default).
 *
 * Shares bootstrap state with platform-security.db.test.ts — run the two
 * with --no-file-parallelism. Everything it creates is removed again.
 */
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/setup/bootstrap/route";

const SUPABASE_URL = process.env.VYRON_TEST_SUPABASE_URL;
const ANON_KEY = process.env.VYRON_TEST_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.VYRON_TEST_SUPABASE_SERVICE_ROLE_KEY;
const MAILPIT = process.env.VYRON_TEST_MAILPIT_URL;
const CONTAINER = process.env.VYRON_TEST_DB_CONTAINER;
const configured = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_KEY && MAILPIT && CONTAINER);

const DOMAIN = "p0-gotrue.test";
const run = randomUUID().slice(0, 8);
const owner1 = `owner1-${run}@${DOMAIN}`;
const owner2 = `owner2-${run}@${DOMAIN}`;
const SECRET = `gotrue-e2e-${randomBytes(24).toString("hex")}`;
const squatterPassword1 = `Squat1-${randomBytes(9).toString("hex")}!`;
const squatterPassword2 = `Squat2-${randomBytes(9).toString("hex")}!`;
const ORIGINAL = { ...process.env };
const seenTokens: string[] = [];

function sql(statement: string): string {
  return execFileSync("docker", ["exec", "-i", CONTAINER ?? "", "psql", "-U", "postgres", "-d", "postgres", "-At", "-q", "-v", "ON_ERROR_STOP=1"], { input: statement, encoding: "utf8" }).trim();
}
const status = () => sql("select platform_bootstrap_status();");
const userId = (email: string) => sql(`select coalesce(string_agg(id::text, ','), '') from auth.users where lower(email) = '${email}';`);
const adminAssignments = () => sql(`select coalesce(string_agg(u.email, ',' order by u.email), '') from user_role_assignments ura join permission_roles pr on pr.id = ura.role_id join auth.users u on u.id = ura.user_id where ura.company_id is null and pr.role_key = 'platform_super_administrator';`);
const anon = () => createClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = () => createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

let ip = 0;
function post(email: string) {
  return POST(new Request("http://127.0.0.1:3000/api/setup/bootstrap", {
    method: "POST",
    headers: { "content-type": "application/json", "x-vyron-bootstrap-secret": SECRET, "x-forwarded-for": `203.0.113.${++ip % 250}`, "user-agent": "vitest-gotrue" },
    body: JSON.stringify({ email }),
  }));
}

type MailSummary = { ID: string };
async function mailsTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  return ((await res.json()) as { messages: MailSummary[] }).messages ?? [];
}
/** The verification link in the newest invitation to `address`. */
async function newestInviteLink(address: string): Promise<string> {
  const [newest] = await mailsTo(address);
  expect(newest, `an invitation email to ${address}`).toBeTruthy();
  const message = (await (await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`)).json()) as { Text?: string; HTML?: string };
  const match = `${message.Text ?? ""}\n${message.HTML ?? ""}`.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/);
  expect(match, "a verification link in the invitation").toBeTruthy();
  return match![0].replace(/&amp;/g, "&");
}
/** Follows an emailed link the way a browser would; returns the session token GoTrue issues, if any. */
async function follow(link: string): Promise<string | null> {
  const res = await fetch(link, { redirect: "manual" });
  const location = res.headers.get("location") ?? "";
  const token = new URLSearchParams(location.split("#")[1] ?? "").get("access_token");
  if (token) seenTokens.push(token);
  return token;
}

function cleanUp() {
  sql(`delete from platform_bootstrap_state;
       delete from user_role_assignments where user_id in (select id from auth.users where email like '%@${DOMAIN}');
       delete from auth.users where email like '%@${DOMAIN}';
       delete from system_events where event_type = 'PlatformBootstrapAttempt';`);
}

const describeGoTrue = configured ? describe : describe.skip;

describeGoTrue("platform bootstrap end to end — real GoTrue, real email, real Postgres", () => {
  beforeAll(async () => {
    expect(sql("select platform_bootstrap_completed()::text;")).toBe("false"); // a fresh installation
    cleanUp();
    await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
    Object.assign(process.env, {
      PLATFORM_BOOTSTRAP_ENABLED: "true",
      PLATFORM_BOOTSTRAP_SECRET: SECRET,
      BOOTSTRAP_OWNER_EMAIL: owner1,
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    });
  });

  afterAll(() => {
    process.env = { ...ORIGINAL };
    cleanUp();
  });

  it("a sign-up pre-registered on the owner's address (attacker-chosen password) can never become the platform administrator", async () => {
    const { data } = await anon().auth.signUp({ email: owner1, password: squatterPassword1 });
    expect(data.user?.email_confirmed_at ?? null).toBeNull(); // "Confirm email" is on
    const res = await post(owner1);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not created by setup|already has an account/);
    expect(status()).toBe("not_started");
    expect(adminAssignments()).toBe("");
    // Operator recovery without touching the database: remove the unverified account in Supabase Auth.
    const squatter = userId(owner1);
    expect((await admin().auth.admin.deleteUser(squatter)).error).toBeNull();
    await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
  });

  it("5 truly concurrent requests → one invitation account, one assignment, one state row; the account is unverified and password-less", async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(owner1)));
    const codes = responses.map((r) => r.status);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.every((c) => [200, 201, 400, 500].includes(c))).toBe(true);
    expect(userId(owner1).split(",")).toHaveLength(1);
    expect(adminAssignments()).toBe(owner1);
    expect(sql("select count(*) || ':' || platform_admin_email from platform_bootstrap_state group by platform_admin_email;")).toBe(`1:${owner1}`);
    expect(sql(`select (email_confirmed_at is null)::text || ',' || (coalesce(encrypted_password, '') = '')::text || ',' || (last_sign_in_at is null)::text from auth.users where lower(email) = '${owner1}';`)).toBe("true,true,true");
    expect(status()).toBe("pending_verification");
    expect((await mailsTo(owner1)).length).toBeGreaterThanOrEqual(1);
    // Nobody can sign in to it yet — it has no password.
    expect((await anon().auth.signInWithPassword({ email: owner1, password: squatterPassword1 })).error).not.toBeNull();
  });

  it("even with the secret, invitations are capped at 5 per hour", async () => {
    let successes = Number(sql("select count(*) from system_events where event_type = 'PlatformBootstrapAttempt' and metadata ->> 'outcome' = 'success';"));
    while (successes < 5) {
      expect((await post(owner1)).status).toBe(200);
      successes++;
    }
    const limited = await post(owner1);
    expect(limited.status).toBe(429);
    // Test-only reset of the hourly counter so the lifecycle can continue.
    sql("delete from system_events where event_type = 'PlatformBootstrapAttempt' and metadata ->> 'outcome' = 'success';");
  });

  it("while pending, a repeat request re-sends the invitation for the same single account", async () => {
    const before = (await mailsTo(owner1)).length;
    const id = userId(owner1);
    const res = await post(owner1);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "reissued" });
    expect(userId(owner1)).toBe(id);
    expect(adminAssignments()).toBe(owner1);
    expect((await mailsTo(owner1)).length).toBe(before + 1);
  });

  it("a corrected owner address moves the pending invitation; the old never-verified account is removed and its link is dead", async () => {
    const oldLink = await newestInviteLink(owner1);
    process.env.BOOTSTRAP_OWNER_EMAIL = owner2;
    expect((await post(owner1)).status).toBe(403);
    const res = await post(owner2);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ outcome: "rebound" });
    expect(userId(owner1)).toBe("");
    expect(adminAssignments()).toBe(owner2);
    expect(sql("select platform_admin_email from platform_bootstrap_state;")).toBe(owner2);
    expect(await follow(oldLink)).toBeNull();
  });

  it("a sign-up attempt on the pending address cannot plant a password", async () => {
    await anon().auth.signUp({ email: owner2, password: squatterPassword2 });
    expect(sql(`select (coalesce(encrypted_password, '') = '')::text from auth.users where lower(email) = '${owner2}';`)).toBe("true");
    expect(status()).toBe("pending_verification");
  });

  it("accepting the emailed invitation — and only that — completes bootstrap; the new administrator has platform, not tenant, powers", async () => {
    expect(sql("select platform_bootstrap_completed()::text;")).toBe("false");
    const token = await follow(await newestInviteLink(owner2));
    expect(token).toBeTruthy();
    expect(sql(`select (email_confirmed_at is not null)::text from auth.users where lower(email) = '${owner2}';`)).toBe("true");
    expect(status()).toBe("completed");

    const asAdmin = createClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    expect((await asAdmin.rpc("user_has_platform_permission", { target_permission_key: "ManageBilling" })).data).toBe(true);
    expect((await asAdmin.rpc("user_has_platform_permission", { target_permission_key: "CrossTenantRead" })).data).toBe(false);
    expect((await asAdmin.rpc("platform_bootstrap_status")).error).not.toBeNull(); // service role only
    // The planted password never works.
    expect((await anon().auth.signInWithPassword({ email: owner2, password: squatterPassword2 })).error).not.toBeNull();
  });

  it("after completion every attempt is refused (409) and nothing is sent or created — for any address", async () => {
    const mailsBefore = (await mailsTo(owner2)).length;
    expect((await post(owner2)).status).toBe(409);
    process.env.BOOTSTRAP_OWNER_EMAIL = owner1;
    expect((await post(owner1)).status).toBe(409);
    expect(userId(owner1)).toBe("");
    expect(adminAssignments()).toBe(owner2);
    expect((await mailsTo(owner2)).length).toBe(mailsBefore);
    expect((await mailsTo(owner1)).length).toBeGreaterThan(0); // only the earlier, pre-correction invitations
    const res = await GET(new Request("http://127.0.0.1:3000/api/setup/bootstrap", { headers: { "x-vyron-bootstrap-secret": SECRET, "x-forwarded-for": "203.0.113.251" } }));
    expect(await res.json()).toEqual({ status: "completed" });
  });

  it("every attempt is in the security-event log, and none of it contains the secret, a password or a token", () => {
    const log = sql("select coalesce(json_agg(json_build_object('detail', detail, 'metadata', metadata, 'severity', severity)), '[]') from system_events where event_type = 'PlatformBootstrapAttempt';");
    const reasons = new Set((JSON.parse(log) as Array<{ metadata: { reason: string } }>).map((e) => e.metadata.reason));
    for (const reason of ["validation", "reissued", "rebound", "owner_email_mismatch", "already_completed"]) expect(reasons).toContain(reason);
    for (const forbidden of [SECRET, squatterPassword1, squatterPassword2, ...seenTokens]) expect(log).not.toContain(forbidden);
    expect(log).not.toMatch(/access_token|refresh_token|"password"/i);
  });
});
