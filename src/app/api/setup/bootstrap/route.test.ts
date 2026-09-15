// @vitest-environment node
/**
 * P0 security remediation — platform bootstrap route.
 *
 * Runs the REAL route handler, guard (`bootstrap-guard.ts`), service
 * (`bootstrap-service.ts`) and security-event repository. Only the
 * Supabase service-role client is replaced, by an in-memory fake that
 * behaves like the database: `system_events` rows are stored and counted
 * (so both rate limiters are exercised for real), and the bootstrap
 * functions keep state. Real GoTrue + Postgres behaviour (invitation
 * email, verification, concurrency) is proven in
 * `src/server/security/platform-bootstrap.gotrue.test.ts` and
 * `src/server/security/platform-security.db.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  events: [] as Row[],
  status: "not_started" as string,
  invites: [] as Row[],
  deleted: [] as string[],
  createUserCalls: 0,
  publicClientCalls: 0,
  rpcOutcome: null as null | Row,
  rpcError: null as null | Row,
  inviteError: null as null | Row,
}));

function eventQuery() {
  const filters: Array<(r: Row) => boolean> = [];
  const q = {
    is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), q),
    eq: (col: string, v: unknown) => {
      if (col.startsWith("metadata->>")) { const k = col.slice(11); filters.push((r) => String((r.metadata as Row)?.[k]) === v); }
      else filters.push((r) => r[col] === v);
      return q;
    },
    gte: (col: string, v: string) => (filters.push((r) => String(r[col]) >= v), q),
    then: (resolve: (x: { count: number; error: null }) => unknown) => resolve({ count: db.events.filter((r) => filters.every((f) => f(r))).length, error: null }),
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  isSupabaseAdminConfigured: () => true,
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "system_events") throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: Row) => { db.events.push({ ...row, created_at: new Date().toISOString() }); return { error: null }; },
        select: () => eventQuery(),
      };
    },
    rpc: async (name: string, args?: Row) => {
      if (name === "platform_bootstrap_status") return { data: db.status, error: null };
      if (name === "complete_platform_bootstrap") {
        if (db.rpcError) return { data: null, error: db.rpcError };
        if (db.rpcOutcome) return { data: db.rpcOutcome, error: null };
        const outcome = db.status === "pending_verification" ? "reissued" : "invited";
        db.status = "pending_verification";
        return { data: { outcome, user: args?.target_user_id }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    auth: {
      admin: {
        inviteUserByEmail: async (email: string, options: Row) => {
          db.invites.push({ email, options });
          if (db.inviteError) return { data: { user: null }, error: db.inviteError };
          return { data: { user: { id: "invitee-1", email } }, error: null };
        },
        deleteUser: async (id: string) => { db.deleted.push(id); return { error: null }; },
        createUser: async () => { db.createUserCalls++; return { data: null, error: null }; },
      },
    },
  }),
}));
// The public (anon) client must never be used by bootstrap any more.
vi.mock("@supabase/supabase-js", () => ({ createClient: () => { db.publicClientCalls++; throw new Error("bootstrap must not use the public client"); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { throw new Error("no session client in bootstrap"); } }));

import { GET, POST } from "./route";

const SECRET = "s3cr3t-For-Bootstrap-0123456789-abcdefghijkl";
const OWNER = "platform.owner@vyron.example";
const ORIGINAL = { ...process.env };
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

function req(method: "GET" | "POST", { secret, body, ip = "203.0.113.7", url = "https://vyron.example/api/setup/bootstrap" }: { secret?: string; body?: unknown; ip?: string; url?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": ip, "user-agent": "vitest" };
  if (secret !== undefined) headers["x-vyron-bootstrap-secret"] = secret;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
// A password in the body is ignored by bootstrap — it is sent here only to
// prove it can never end up anywhere.
const good = { email: "Platform.Owner@Vyron.Example", password: "Str0ngPassw0rd!" };
const enable = (extra: Record<string, string | undefined> = {}) => {
  Object.assign(process.env, { PLATFORM_BOOTSTRAP_ENABLED: "true", PLATFORM_BOOTSTRAP_SECRET: SECRET, BOOTSTRAP_OWNER_EMAIL: OWNER, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" });
  for (const [k, v] of Object.entries(extra)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
};

beforeEach(() => {
  Object.assign(db, { events: [], status: "not_started", invites: [], deleted: [], createUserCalls: 0, publicClientCalls: 0, rpcOutcome: null, rpcError: null, inviteError: null });
  process.env = { ...ORIGINAL };
  delete process.env.PLATFORM_BOOTSTRAP_ENABLED;
  delete process.env.PLATFORM_BOOTSTRAP_SECRET;
  delete process.env.BOOTSTRAP_OWNER_EMAIL;
  for (const m of ["log", "info", "warn", "error", "debug"] as const) consoleSpies.push(vi.spyOn(console, m));
});
afterEach(() => {
  consoleSpies.splice(0).forEach((s) => s.mockRestore());
  process.env = { ...ORIGINAL };
});

async function everything(res: Response) {
  const body = await res.text();
  return body + JSON.stringify([...res.headers.entries()]);
}

describe("A. bootstrap disabled (the default)", () => {
  it.each([undefined, "false", "TRUE", "1", "yes", " true"])("PLATFORM_BOOTSTRAP_ENABLED=%s → GET 404, reveals no state", async (value) => {
    if (value !== undefined) process.env.PLATFORM_BOOTSTRAP_ENABLED = value;
    process.env.PLATFORM_BOOTSTRAP_SECRET = SECRET;
    process.env.BOOTSTRAP_OWNER_EMAIL = OWNER;
    const res = await GET(req("GET", { secret: SECRET }));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toMatch(/bootstrap/i);
    expect(text).not.toMatch(/status|pending|completed|administrator/i);
  });

  it("anonymous POST → 404, nothing sent or created, even with the right secret and owner address", async () => {
    process.env.PLATFORM_BOOTSTRAP_SECRET = SECRET;
    process.env.BOOTSTRAP_OWNER_EMAIL = OWNER;
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(404);
    expect(db.invites).toHaveLength(0);
    expect(db.status).toBe("not_started");
  });

  it("a disabled probe is recorded as a security event (bounded), with no credentials in it", async () => {
    await POST(req("POST", { secret: SECRET, body: good }));
    expect(db.events).toHaveLength(1);
    expect(db.events[0]).toMatchObject({ event_type: "PlatformBootstrapAttempt", company_id: null, metadata: { outcome: "rejected_disabled", reason: "disabled" } });
    expect(JSON.stringify(db.events)).not.toContain(SECRET);
    expect(JSON.stringify(db.events)).not.toContain(good.password);
  });

  it("disabled-probe recording is capped per hour", async () => {
    for (let i = 0; i < 60; i++) await POST(req("POST", { body: good, ip: `198.51.100.${i}` }));
    expect(db.events.length).toBe(50);
  });
});

describe("B. bootstrap enabled — secret and configuration", () => {
  beforeEach(() => enable());

  it("missing secret → 401, nothing sent", async () => {
    const res = await POST(req("POST", { body: good }));
    expect(res.status).toBe(401);
    expect(db.invites).toHaveLength(0);
    expect(db.events.at(-1)).toMatchObject({ metadata: { outcome: "failure", reason: "secret_missing" }, severity: "high" });
  });

  it("wrong secret → 401, nothing sent", async () => {
    const res = await POST(req("POST", { secret: `${SECRET}x`, body: good }));
    expect(res.status).toBe(401);
    expect(db.invites).toHaveLength(0);
    expect(db.events.at(-1)).toMatchObject({ metadata: { outcome: "failure", reason: "secret_invalid" } });
  });

  it("a secret in the URL is ignored — only the header counts", async () => {
    const res = await POST(req("POST", { body: good, url: `https://vyron.example/api/setup/bootstrap?secret=${SECRET}&x-vyron-bootstrap-secret=${SECRET}` }));
    expect(res.status).toBe(401);
    expect(db.invites).toHaveLength(0);
  });

  it("a configured secret shorter than 32 characters never enables bootstrap (503)", async () => {
    process.env.PLATFORM_BOOTSTRAP_SECRET = "short-secret";
    const res = await POST(req("POST", { secret: "short-secret", body: good }));
    expect(res.status).toBe(503);
    expect(db.invites).toHaveLength(0);
  });

  it.each([undefined, "", "   ", "not-an-address"])("BOOTSTRAP_OWNER_EMAIL=%j → 503 even with the right secret: the owner address is mandatory", async (owner) => {
    enable({ BOOTSTRAP_OWNER_EMAIL: owner });
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(503);
    expect(db.invites).toHaveLength(0);
    expect(db.events.at(-1)).toMatchObject({ metadata: { outcome: "failure", reason: "owner_email_not_configured" } });
  });

  it("correct secret + owner address → Supabase invites the owner; the role is assigned once, through the database function", async () => {
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ invited: true, outcome: "invited", status: "pending_verification" });
    expect(db.invites).toEqual([{ email: OWNER, options: { redirectTo: "https://vyron.example/auth/confirm?type=invite&next=/reset-password" } }]);
    expect(db.events.at(-1)).toMatchObject({ severity: "critical", metadata: { outcome: "success", reason: "invited", emailDomain: "vyron.example" } });
  });

  it("GET with the secret reports the lifecycle state; without it → 401", async () => {
    expect((await GET(req("GET"))).status).toBe(401);
    expect(await (await GET(req("GET", { secret: SECRET }))).json()).toEqual({ status: "not_started" });
    await POST(req("POST", { secret: SECRET, body: good }));
    expect(await (await GET(req("GET", { secret: SECRET }))).json()).toEqual({ status: "pending_verification" });
  });

  it("responses are never cached or indexed", async () => {
    const res = await POST(req("POST", { body: good }));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });
});

describe("B. owner email", () => {
  beforeEach(() => enable());

  it("any other address is rejected (403), nothing sent", async () => {
    const res = await POST(req("POST", { secret: SECRET, body: { ...good, email: "attacker@evil.example" } }));
    expect(res.status).toBe(403);
    expect(db.invites).toHaveLength(0);
    expect(db.events.at(-1)).toMatchObject({ metadata: { reason: "owner_email_mismatch", emailDomain: "evil.example" } });
  });

  it("the owner's address in any letter case is accepted", async () => {
    const res = await POST(req("POST", { secret: SECRET, body: { ...good, email: " PLATFORM.owner@VYRON.example " } }));
    expect(res.status).toBe(201);
    expect(db.invites[0]).toMatchObject({ email: OWNER });
  });
});

describe("B. rate limiting", () => {
  beforeEach(() => enable());

  it("after 5 failures from one client, even the correct secret is refused (429)", async () => {
    for (let i = 0; i < 5; i++) expect((await POST(req("POST", { secret: "wrong", body: good }))).status).toBe(401);
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(429);
    expect(db.invites).toHaveLength(0);
  });

  it("other clients are still served until the global limit (20) is reached", async () => {
    for (let i = 0; i < 5; i++) await POST(req("POST", { secret: "wrong", body: good, ip: "203.0.113.7" }));
    expect((await POST(req("POST", { secret: "wrong", body: good, ip: "203.0.113.8" }))).status).toBe(401);
    for (let i = 0; i < 20; i++) await POST(req("POST", { secret: "wrong", body: good, ip: `192.0.2.${i}` }));
    expect((await POST(req("POST", { secret: SECRET, body: good, ip: "192.0.2.250" }))).status).toBe(429);
  });

  it("GET probing counts too", async () => {
    for (let i = 0; i < 5; i++) await GET(req("GET", { secret: "wrong" }));
    expect((await GET(req("GET", { secret: SECRET }))).status).toBe(429);
  });

  it("even a valid secret can trigger at most 5 invitations per hour", async () => {
    for (let i = 0; i < 5; i++) expect((await POST(req("POST", { secret: SECRET, body: good }))).status).toBeLessThan(300);
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(429);
    expect(db.invites).toHaveLength(5);
    expect(db.events.at(-1)).toMatchObject({ severity: "high", metadata: { reason: "invitation_rate_limited" } });
  });
});

describe("B. the secret and any password never leak", () => {
  it("no response, header, recorded event, Supabase call or console output contains them", async () => {
    enable();
    const outputs: string[] = [];
    outputs.push(await everything(await POST(req("POST", { secret: "wrong-" + SECRET.slice(6), body: good }))));
    outputs.push(await everything(await POST(req("POST", { secret: SECRET, body: good }))));
    outputs.push(await everything(await POST(req("POST", { secret: SECRET, body: good }))));
    outputs.push(await everything(await GET(req("GET", { secret: SECRET }))));
    outputs.push(JSON.stringify(db.events), JSON.stringify(db.invites));
    for (const spy of consoleSpies) outputs.push(JSON.stringify(spy.mock.calls));
    const all = outputs.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(good.password);
  });
});

describe("C/D. one platform administrator: pending until verified, then final", () => {
  beforeEach(() => enable());

  it("while the invitation is pending, a repeat request re-sends it for the same account (200)", async () => {
    expect((await POST(req("POST", { secret: SECRET, body: good }))).status).toBe(201);
    const again = await POST(req("POST", { secret: SECRET, body: good }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ outcome: "reissued" });
    expect(db.invites).toHaveLength(2);
    expect(db.deleted).toHaveLength(0);
  });

  it("a corrected owner address moves the pending invitation; the never-verified previous account is removed", async () => {
    db.rpcOutcome = { outcome: "rebound", previous_user_id: "old-invitee" };
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ outcome: "rebound" });
    expect(db.deleted).toEqual(["old-invitee"]);
    expect(db.events.at(-1)).toMatchObject({ metadata: { outcome: "success", reason: "rebound" } });
  });

  it("once complete (administrator verified), every attempt is refused (409) and no invitation is sent", async () => {
    db.status = "completed";
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(409);
    expect(db.invites).toHaveLength(0);
    expect(await (await GET(req("GET", { secret: SECRET }))).json()).toEqual({ status: "completed" });
  });

  it("if the administrator verifies mid-request, the request gets 409 and deletes nothing", async () => {
    db.rpcOutcome = { outcome: "already_completed" };
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(409);
    expect(db.deleted).toHaveLength(0);
  });
});

describe("E. email verification is not bypassed and the password is never chosen by the caller", () => {
  beforeEach(() => enable());

  it("only an invitation is sent — no password, no createUser, no public sign-up, no email_confirm", async () => {
    await POST(req("POST", { secret: SECRET, body: good }));
    expect(db.invites).toHaveLength(1);
    // The only option passed to Supabase is where the invitation lands.
    expect(Object.keys(db.invites[0].options as object)).toEqual(["redirectTo"]);
    expect(JSON.stringify(db.invites)).not.toMatch(/"password"|email_confirm/i);
    expect(JSON.stringify(db.invites)).not.toContain(good.password);
    expect(db.createUserCalls).toBe(0);
    expect(db.publicClientCalls).toBe(0);
    const fs = await import("node:fs");
    // Code only: comments describe the removed bypass.
    const source = fs.readFileSync(new URL("../../../../server/services/bootstrap-service.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/email_confirm\s*:/);
    expect(source).not.toMatch(/auth\.admin\.createUser|auth\.signUp|password/i);
  });

  it("an address with an already-verified account is refused (400), nothing assigned", async () => {
    db.inviteError = { code: "email_exists", status: 422, message: "A user with this email address has already been registered" };
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(400);
    expect(db.status).toBe("not_started");
  });

  it("an account not created by setup (e.g. a pre-registered sign-up) is refused (400) with recovery guidance", async () => {
    db.rpcError = { message: "bootstrap_account_not_eligible: only a fresh invitation (not verified, no password, never signed in) can become the platform administrator." };
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Remove that account in Supabase Auth/);
  });

  it("any other invitation failure → 500, nothing assigned", async () => {
    db.inviteError = { status: 500, message: "smtp down" };
    const res = await POST(req("POST", { secret: SECRET, body: good }));
    expect(res.status).toBe(500);
    expect(db.status).toBe("not_started");
  });
});
