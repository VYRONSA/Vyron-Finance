import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { metadata as homeMetadata } from "@/app/(marketing)/page";
import { buildHomeStructuredData, VYRONSOFT_ECOSYSTEM } from "./precisia-site";

describe("PRECISIA public SEO surface", () => {
  it("robots.txt allows the site, keeps crawlers off private areas and points at the production sitemap", () => {
    expect(robots()).toEqual({
      rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/company/", "/platform", "/setup"] },
      sitemap: "https://www.precisia.co.za/sitemap.xml",
    });
  });

  it("sitemap.xml lists only the public marketing pages, on the production domain", () => {
    expect(sitemap()).toEqual([{ url: "https://www.precisia.co.za/" }, { url: "https://www.precisia.co.za/pricing" }]);
  });

  it("ecosystem entries are the six approved products", () => {
    expect(VYRONSOFT_ECOSYSTEM.map((p) => p.name)).toEqual(["VOLORA™", "UMORA™", "LAVORARE™", "SAFENZA™", "PROVENA™", "PRECISIA™"]);
  });
});

describe("homepage structured data", () => {
  const data = buildHomeStructuredData();
  const byType = (t: string) => data["@graph"].find((n) => n["@type"] === t) as Record<string, unknown>;

  it("describes VYRONSOFT, the PRECISIA site and PRECISIA as linked entities", () => {
    expect(data["@context"]).toBe("https://schema.org");
    expect(byType("Organization")).toEqual({
      "@type": "Organization",
      "@id": "https://www.vyronsoft.co.za/#organization",
      name: "VYRONSOFT (Pty) Ltd",
      legalName: "VYRONSOFT (Pty) Ltd",
      url: "https://www.vyronsoft.co.za/",
      slogan: "BUSINESS INTELLIGENCE FOR A STRONGER TOMORROW.",
    });
    expect(byType("WebSite")).toMatchObject({ url: "https://www.precisia.co.za/", publisher: { "@id": "https://www.vyronsoft.co.za/#organization" } });
    expect(byType("SoftwareApplication")).toMatchObject({
      name: "PRECISIA™",
      url: "https://www.precisia.co.za/",
      applicationCategory: "BusinessApplication",
      publisher: { "@id": "https://www.vyronsoft.co.za/#organization" },
    });
  });

  it("claims nothing that is not published — no offers, prices, ratings, reviews or operating system", () => {
    const json = JSON.stringify(data);
    for (const key of ["offers", "price", "aggregateRating", "review", "ratingValue", "operatingSystem", "telephone", "address", "sameAs", "email"]) {
      expect(json).not.toContain(`"${key}"`);
    }
    expect(json).not.toMatch(/vercel|localhost/i);
  });
});

describe("homepage metadata", () => {
  it("is canonical to the production homepage and keeps its social image", () => {
    const image = { url: "/opengraph-image", width: 1200, height: 630, type: "image/png" };
    expect(homeMetadata.alternates).toEqual({ canonical: "/" });
    expect(homeMetadata.openGraph).toMatchObject({ type: "website", url: "https://www.precisia.co.za/", title: "PRECISIA™ | Finance Intelligence", images: [image] });
    expect(homeMetadata.twitter).toMatchObject({ card: "summary_large_image", title: "PRECISIA™ | Finance Intelligence", images: [image] });
    expect(homeMetadata.robots).toBeUndefined();
  });
});
