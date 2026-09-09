import { NextResponse } from "next/server";
import { ValidationError } from "@/server/services/permission-service";
import {
  bootstrapPlatformSuperAdministrator,
  hasPlatformSuperAdministrator,
  AdminNotConfiguredError,
  AlreadyBootstrappedError,
} from "@/server/services/bootstrap-service";

/** Deliberately NOT behind `requireSession()` — this is the one route
 * that has to work before any session can exist. Its own safety is the
 * idempotency check inside `bootstrapPlatformSuperAdministrator` itself
 * (re-run on every call, not trusted from the page), not a permission
 * check — once a Platform Super Administrator exists, every subsequent
 * call fails closed regardless of who calls it. */
export async function GET() {
  return NextResponse.json({ alreadyBootstrapped: await hasPlatformSuperAdministrator() });
}

export async function POST(request: Request) {
  const body = await request.json();
  try {
    const result = await bootstrapPlatformSuperAdministrator(String(body.email ?? ""), String(body.password ?? ""));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof AlreadyBootstrappedError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof AdminNotConfiguredError) return NextResponse.json({ error: error.message }, { status: 501 });
    throw error;
  }
}
