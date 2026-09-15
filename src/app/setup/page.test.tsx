/**
 * P0 security remediation — the /setup page. Renders the REAL page module.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: () => {
    const error = new Error("NEXT_HTTP_ERROR_FALLBACK;404") as Error & { digest: string };
    error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
    throw error;
  },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/supabase/is-configured", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/supabase/admin", () => ({ isSupabaseAdminConfigured: () => true, createAdminClient: () => { throw new Error("the page must not touch the database"); } }));

import SetupPage, { dynamic, metadata } from "./page";

const ORIGINAL = process.env.PLATFORM_BOOTSTRAP_ENABLED;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PLATFORM_BOOTSTRAP_ENABLED;
  else process.env.PLATFORM_BOOTSTRAP_ENABLED = ORIGINAL;
});

describe("/setup", () => {
  it("is rendered per request — never prerendered or cached", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("is noindex", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it.each([undefined, "false", "TRUE", "1"])("PLATFORM_BOOTSTRAP_ENABLED=%s → 404", (value) => {
    if (value === undefined) delete process.env.PLATFORM_BOOTSTRAP_ENABLED;
    else process.env.PLATFORM_BOOTSTRAP_ENABLED = value;
    let thrown: unknown;
    try {
      SetupPage();
    } catch (error) {
      thrown = error;
    }
    expect((thrown as { digest?: string })?.digest).toContain("404");
  });

  it("when enabled, shows the secret-gated form and never reveals bootstrap state (no database read)", () => {
    process.env.PLATFORM_BOOTSTRAP_ENABLED = "true";
    render(SetupPage());
    expect(screen.getByLabelText("Setup secret")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.queryByText(/Already set up|already exists|pending|completed/i)).toBeNull();
    // The administrator's password is set by the invitee from the emailed link, never here.
    // (The setup-secret field has its own "show" toggle; there is no password field.)
    expect(screen.queryByLabelText(/^(confirm )?password$/i)).toBeNull();
    expect(document.querySelectorAll('input[autocomplete="new-password"], input[name="password"]')).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Send administrator invitation" })).toBeInTheDocument();
  });
});
