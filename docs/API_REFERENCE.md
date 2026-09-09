# VYRON FINANCE — API Reference

RC2 Phase 12 deliverable. 236 routes under `src/app/api/`, every one following one of two fixed shapes — this document explains the shape and the module map; it does not restate all 236 individually (that information is the route source itself, always current by construction — a hand-maintained per-route list would drift the moment a route changes). For the permission key each route actually requires, read the route file directly — the pattern below tells you exactly where to look.

## The two shapes, verbatim

**Every mutation route** (POST/PUT/PATCH/DELETE):

```ts
export async function POST(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const { companyId } = await params;
  const check = await requirePermission(companyId, "Module:Action");
  // or: await requireApproval(companyId, "ApproveX", "Category", amount);
  if (!check.ok) return check.response;

  const body = await request.json();
  try {
    const result = await someService.doThing(companyId, body);
    return NextResponse.json({ result }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
}
```

**Every read route** (GET): `requireSession()` only — authorization for reads is enforced by RLS + the repository's own `.eq("company_id", companyId)` filter, not a separate permission key (view-level RBAC is a disclosed, out-of-scope-for-RC1/RC2 item — see `PERMISSION_MODEL.md`).

## Response codes, consistently

| Code | Meaning |
|---|---|
| 200 / 201 | Success |
| 400 | `ValidationError` — malformed input, caught and reported cleanly |
| 401 | No session (`requireSession()` failed) |
| 403 | Session valid, but `requirePermission`/`requireApproval` failed — message names the exact missing permission or the exceeded limit |
| 404 | `NotFoundError` — record doesn't exist *or* belongs to another company (RLS/repository filtering makes these indistinguishable from the outside, which is itself a defense-in-depth property, not an inconsistency) |
| 405 | Method not implemented on this route (e.g. no `GET` handler exists for a mutation-only route) |
| 409 | Conflict — e.g. `/api/setup/bootstrap` after an administrator already exists |
| 500 | Uncaught error — see `OPERATIONS_MANUAL.md` for how to investigate; a disclosed, not-fully-closed category (roughly 53 routes still lack a try/catch for their specific service's error types, per RC1 Phase 7's own audit) |
| 501 | The route's dependency isn't configured in this environment (no Supabase project, or no `SUPABASE_SERVICE_ROLE_KEY`) — Preview Mode's own signal, not a real production response |

## Route map by module (236 total)

| Module | Routes | Notable sub-paths |
|---|---|---|
| General Ledger | 22 | `journals/[id]` (submit/approve/reject/cancel/reverse), `posting/run`, `posting-rules`, `chart-of-accounts` |
| Audit | 17 | `engagements`, `areas`, `steps`, `findings`, `working-papers/generate`, `queries/[id]/run` |
| Matching | 15 | `customers/allocate`, `suppliers/allocate`, `duplicates/ignore`, `merchants/merge` |
| Fixed Assets | 14 | `register/[id]/{capitalise,dispose,improve,revalue,transfer}`, `depreciation-runs` |
| Banking Rules | 12 | `[id]/{rollback,test}`, `import`, `run` |
| Sales | 11 | `invoices`, `orders`, `quotations`, `deliveries`, `receipts` |
| Purchasing | 11 | `bills`, `orders`, `grns`, `payments`, `requisitions` |
| Inventory | 9 | `stock-items`, `stock-takes`, `transactions`, `warehouses` |
| Communications | 8 | `templates`, `templates/[id]/{preview,test-send}` |
| Transactions | 7 | `[id]/split`, `bulk` |
| Suppliers | 7 | `addresses`, `contacts`, `draft-communication` |
| Customers | 7 | `addresses`, `contacts`, `draft-communication` |
| Cashbook | 7 | `batches`, `payments`, `receipts`, `transfers` |
| Roles | 5 | `assignments`, `[id]` |
| Copilot | 5 | `ask`, `briefings`, `narratives`, `scenarios` |
| ...30 more modules | ~85 | Company Management, VAT, Financial Statements, Documents, Operations, Automation, Recurring Templates, Reports, Users/Invite, Setup, and every other module named in `ENTERPRISE_ARCHITECTURE.md`'s module list |

## Programmatic route discovery

Every route in the current codebase, with its actual required method(s):

```bash
find src/app/api -name "route.ts" | sort
grep -n "^export async function" <route-file>          # methods implemented
grep -n "requirePermission\|requireApproval" <route-file>  # exact permission key(s) required
```

This is the authoritative, always-current source — deliberately not duplicated into a static table here, since a hand-maintained copy would silently drift from the real route the moment either changes.
