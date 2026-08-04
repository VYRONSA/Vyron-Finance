import { NextResponse } from "next/server";
import { requireSession, getCurrentUserId } from "@/server/auth/require-session";
import { createCompany, listCompaniesForUser, ValidationError } from "@/server/services/company-service";

export async function GET() {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const userId = await getCurrentUserId();
  const companies = await listCompaniesForUser(userId);
  return NextResponse.json({ companies });
}

export async function POST(request: Request) {
  const session = await requireSession();
  if (!session.ok) return session.response;

  const userId = await getCurrentUserId();
  const body = await request.json();

  try {
    const company = await createCompany(userId, body);
    return NextResponse.json({ company }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
