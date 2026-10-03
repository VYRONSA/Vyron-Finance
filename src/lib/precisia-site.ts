/**
 * Public identity of the PRECISIA website and its place in the VYRONSOFT
 * software ecosystem — one source for the marketing footer, page metadata,
 * robots.txt, sitemap.xml and the homepage structured data.
 *
 * Everything here is public, owner-supplied information. The ecosystem list
 * (names, descriptors, order and URLs) is the VYRONSOFT standard shared by
 * every product site; keep it word-for-word.
 */

/** The canonical production origin (apex precisia.co.za redirects here). */
export const PRECISIA_ORIGIN = "https://www.precisia.co.za";
export const PRECISIA_URL = `${PRECISIA_ORIGIN}/`;

export const PRECISIA_TITLE = "PRECISIA™ | Finance Intelligence";
export const PRECISIA_DESCRIPTION =
  "PRECISIA™ Finance Intelligence brings accounting, banking, invoicing, VAT, reporting and AI together in one platform. A product of VYRONSOFT (Pty) Ltd.";

export const VYRONSOFT = {
  name: "VYRONSOFT (Pty) Ltd",
  url: "https://www.vyronsoft.co.za/",
  statement: "BUSINESS INTELLIGENCE FOR A STRONGER TOMORROW.",
} as const;

export const VYRONSOFT_ECOSYSTEM = [
  { name: "VOLORA™", descriptor: "Cost Intelligence", url: "https://www.volora.co.za/" },
  { name: "UMORA™", descriptor: "Human & Workforce Intelligence", url: "https://www.umora.co.za/" },
  { name: "LAVORARE™", descriptor: "Workforce & Payroll Intelligence", url: "https://www.lavorare.co.za/" },
  { name: "SAFENZA™", descriptor: "Safety Intelligence", url: "https://www.safenza.co.za/" },
  { name: "PROVENA™", descriptor: "Sustainability & Compliance Intelligence", url: "https://www.provena.co.za/" },
  { name: "PRECISIA™", descriptor: "Finance Intelligence", url: PRECISIA_URL },
] as const;

/** Public pages that should be indexed — the marketing site only. */
export const PUBLIC_PAGES = ["/", "/pricing"] as const;

/**
 * Areas that are never useful to crawl: the signed-in workspaces, the
 * API, the auth callbacks and the one-time setup flow. They are all
 * access-controlled anyway; this only keeps crawlers off them.
 */
export const NON_PUBLIC_PREFIXES = ["/api/", "/auth/", "/company/", "/platform", "/setup"] as const;

const ORGANIZATION_ID = `${VYRONSOFT.url}#organization`;

/**
 * Homepage JSON-LD: the VYRONSOFT organisation, the PRECISIA website and
 * PRECISIA as a business application, linked by @id. Deliberately no
 * offers, prices, ratings, reviews or operatingSystem — none are
 * published, so none are claimed.
 */
export function buildHomeStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: VYRONSOFT.name,
        legalName: VYRONSOFT.name,
        url: VYRONSOFT.url,
        slogan: VYRONSOFT.statement,
      },
      {
        "@type": "WebSite",
        "@id": `${PRECISIA_URL}#website`,
        name: "PRECISIA",
        url: PRECISIA_URL,
        publisher: { "@id": ORGANIZATION_ID },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${PRECISIA_URL}#software`,
        name: "PRECISIA™",
        url: PRECISIA_URL,
        description: PRECISIA_DESCRIPTION,
        applicationCategory: "BusinessApplication",
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  };
}
