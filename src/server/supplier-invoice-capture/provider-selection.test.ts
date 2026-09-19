/**
 * Phase 5N — the certification switch, tested.
 *
 * NO PROVIDER REQUEST IS MADE BY ANY TEST IN THIS FILE. The only test that
 * reaches the Gateway adapter mocks `generateObject` at the module
 * boundary first, so there is no path from this file to the network even
 * if a credential were present in the environment running it.
 *
 * What these prove is the thing that cannot be proven by reading imports:
 * that the default is OFF, that OFF means the provider which extracts
 * nothing, and that turning it on takes two deliberate acts rather than
 * one accident.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decideExtractionProvider,
  selectExtractionProvider,
  EXTRACTION_API_KEY_ENV_VAR,
  EXTRACTION_SWITCH_ENV_VAR,
  EXTRACTION_SWITCH_ON_VALUE,
} from "./provider-selection";
import { UnavailableExtractionProvider } from "./extraction-provider";

const generateObjectMock = vi.hoisted(() => vi.fn());
vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return { ...actual, generateObject: generateObjectMock };
});

const ON = { [EXTRACTION_SWITCH_ENV_VAR]: EXTRACTION_SWITCH_ON_VALUE };
const KEY = { [EXTRACTION_API_KEY_ENV_VAR]: "synthetic-test-placeholder" };

beforeEach(() => {
  generateObjectMock.mockReset();
});

describe("the switch is OFF unless deliberately set", () => {
  it("an empty environment selects the provider that extracts nothing", () => {
    const decision = decideExtractionProvider({});
    expect(decision.provider).toBe("unavailable");
    expect(decision.switchOn).toBe(false);
  });

  it("a credential ON ITS OWN does not turn extraction on", () => {
    // The brief's exact requirement: the Gateway provider must not become
    // the default merely because a key exists. Production HAS a key.
    const decision = decideExtractionProvider({ ...KEY });
    expect(decision.provider).toBe("unavailable");
    expect(decision.credentialPresent).toBe(true);
  });

  it.each(["1", "true", "TRUE", "on", "yes", "enabled", "", " "])(
    "the truthy-looking value %o does NOT turn it on",
    (value) => {
      // Every one of these is a value that arrives in an environment by
      // accident. Only the word does.
      const decision = decideExtractionProvider({ [EXTRACTION_SWITCH_ENV_VAR]: value, ...KEY });
      expect(decision.provider).toBe("unavailable");
    },
  );

  it("accepts the word regardless of surrounding whitespace or case", () => {
    for (const value of ["certification", "Certification", "  CERTIFICATION  "]) {
      expect(decideExtractionProvider({ [EXTRACTION_SWITCH_ENV_VAR]: value, ...KEY }).provider).toBe("gateway");
    }
  });
});

describe("switch ON but no credential — fails closed", () => {
  it("selects the unavailable provider, not a half-configured gateway", () => {
    const decision = decideExtractionProvider({ ...ON });
    expect(decision.provider).toBe("unavailable");
    expect(decision.switchOn).toBe(true);
    expect(decision.credentialPresent).toBe(false);
  });

  it("says which of the two conditions is missing", () => {
    // An operator who set the switch and sees "off" with no reason will go
    // looking for the wrong thing.
    expect(decideExtractionProvider({ ...ON }).reason).toContain(EXTRACTION_API_KEY_ENV_VAR);
  });

  it("treats a whitespace-only credential as absent", () => {
    expect(decideExtractionProvider({ ...ON, [EXTRACTION_API_KEY_ENV_VAR]: "   " }).provider).toBe("unavailable");
  });
});

describe("switch ON with a credential", () => {
  it("selects the gateway adapter", () => {
    expect(decideExtractionProvider({ ...ON, ...KEY }).provider).toBe("gateway");
  });

  it("builds the real adapter, and the unavailable one in every other case", async () => {
    const gateway = await selectExtractionProvider({ ...ON, ...KEY });
    expect(gateway).not.toBeInstanceOf(UnavailableExtractionProvider);

    for (const env of [{}, { ...KEY }, { ...ON }]) {
      expect(await selectExtractionProvider(env)).toBeInstanceOf(UnavailableExtractionProvider);
    }
  });

  it("the provider it builds still passes failures through the existing safety taxonomy", async () => {
    // The switch selects; it does not wrap, soften or reinterpret. A 402
    // must arrive at the caller as `payment-required` so
    // `circuitSignalFor` opens the circuit exactly as it does today.
    //
    // The credential is set on the real process environment here, not only
    // in the object passed to `selectExtractionProvider`, because the
    // adapter's own missing-key lock reads `process.env` directly — as the
    // Gateway SDK itself does. In a deployment the two are the same thing.
    const original = process.env[EXTRACTION_API_KEY_ENV_VAR];
    process.env[EXTRACTION_API_KEY_ENV_VAR] = "synthetic-test-placeholder";
    try {
      generateObjectMock.mockRejectedValue(Object.assign(new Error("Payment Required"), { statusCode: 402 }));
      const provider = await selectExtractionProvider({ ...ON, ...KEY });
      const result = await provider.extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.category).toBe("payment-required");
    } finally {
      if (original === undefined) delete process.env[EXTRACTION_API_KEY_ENV_VAR];
      else process.env[EXTRACTION_API_KEY_ENV_VAR] = original;
    }
  });

  it("the adapter refuses on its own when the real environment has no credential", async () => {
    // The second lock. Even if selection were somehow bypassed, no
    // document leaves the building on a credential nobody chose.
    const original = process.env[EXTRACTION_API_KEY_ENV_VAR];
    delete process.env[EXTRACTION_API_KEY_ENV_VAR];
    try {
      const { createGatewayExtractionProvider } = await import("./gateway-extraction-provider");
      const result = await createGatewayExtractionProvider().extract({ bytes: new Uint8Array([1]), mimeType: "application/pdf" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.category).toBe("missing-api-key");
      expect(generateObjectMock).not.toHaveBeenCalled();
    } finally {
      if (original !== undefined) process.env[EXTRACTION_API_KEY_ENV_VAR] = original;
    }
  });
});

describe("the credential is never handled, only counted", () => {
  it("no decision ever contains the credential's value", () => {
    const secret = "sk-this-value-must-never-appear";
    const decision = decideExtractionProvider({ ...ON, [EXTRACTION_API_KEY_ENV_VAR]: secret });
    expect(JSON.stringify(decision)).not.toContain(secret);
    // Not a prefix and not a length either — both are useful to an
    // attacker and useless to an operator.
    expect(JSON.stringify(decision)).not.toContain(secret.slice(0, 6));
  });

  it("the reason is safe to log in every state", () => {
    for (const env of [{}, { ...KEY }, { ...ON }, { ...ON, ...KEY }]) {
      const { reason } = decideExtractionProvider({ ...env, [EXTRACTION_API_KEY_ENV_VAR]: "secret-value-abc" });
      expect(reason).not.toContain("secret-value-abc");
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

describe("no fallback, and no second provider architecture", () => {
  it("there is exactly one place that names the gateway adapter", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/server/supplier-invoice-capture/provider-selection.ts", "utf8");
    // One dynamic import, in one branch. A second would be a fallback, and
    // a fallback is how a safety layer gets routed around.
    expect(source.match(/gateway-extraction-provider/g)).toHaveLength(1);
  });

  it("the decision has exactly two outcomes", () => {
    const outcomes = new Set(
      [{}, { ...KEY }, { ...ON }, { ...ON, ...KEY }].map((env) => decideExtractionProvider(env).provider),
    );
    expect([...outcomes].sort()).toEqual(["gateway", "unavailable"]);
  });

  it("selection reads the environment it is handed and never a file", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/server/supplier-invoice-capture/provider-selection.ts", "utf8");
    // Nothing here may reach web/.env.local, which holds the production
    // credential the certification brief forbids. Comments are stripped
    // first, because this file NAMES that path in order to say it must not
    // be read — and a guard that trips on its own explanation is noise.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/readFile|dotenv|loadEnvConfig/);
  });
});
