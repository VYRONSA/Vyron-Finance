import { describe, expect, it } from "vitest";
import { buildLogoStoragePath, validateLogoFile } from "./branding-engine";
import { MAX_LOGO_SIZE_BYTES } from "./types";

describe("buildLogoStoragePath", () => {
  it("puts the company id first in the path, matching the storage RLS policy's own foldername(name)[1] check", () => {
    const path = buildLogoStoragePath("11111111-1111-1111-1111-111111111111", "logo.png", "2026-08-12T10:00:00.000Z");
    expect(path.startsWith("11111111-1111-1111-1111-111111111111/logo/")).toBe(true);
  });

  it("sanitizes unsafe characters out of the filename", () => {
    const path = buildLogoStoragePath("co_1", "my logo (final)!.png", "2026-08-12T10:00:00.000Z");
    expect(path).toBe("co_1/logo/20260812100000-my_logo__final__.png");
  });

  it("produces a distinct path for two uploads at different timestamps (never collides, never silently overwrites)", () => {
    const a = buildLogoStoragePath("co_1", "logo.png", "2026-08-12T10:00:00.000Z");
    const b = buildLogoStoragePath("co_1", "logo.png", "2026-08-12T10:00:01.000Z");
    expect(a).not.toBe(b);
  });
});

describe("validateLogoFile", () => {
  it("accepts a supported raster type within the size limit", () => {
    expect(validateLogoFile("image/png", 1024)).toEqual({ valid: true });
    expect(validateLogoFile("image/jpeg", 1024)).toEqual({ valid: true });
    expect(validateLogoFile("image/webp", 1024)).toEqual({ valid: true });
  });

  it("rejects an unsupported MIME type, including SVG (no sanitization infrastructure exists for it)", () => {
    const result = validateLogoFile("image/svg+xml", 1024);
    expect(result.valid).toBe(false);
  });

  it("rejects an arbitrary non-image file", () => {
    const result = validateLogoFile("application/pdf", 1024);
    expect(result.valid).toBe(false);
  });

  it("rejects an empty file", () => {
    const result = validateLogoFile("image/png", 0);
    expect(result.valid).toBe(false);
  });

  it("rejects a file over the size ceiling", () => {
    const result = validateLogoFile("image/png", MAX_LOGO_SIZE_BYTES + 1);
    expect(result.valid).toBe(false);
  });

  it("accepts a file exactly at the size ceiling", () => {
    expect(validateLogoFile("image/png", MAX_LOGO_SIZE_BYTES)).toEqual({ valid: true });
  });
});
