import type { MetadataRoute } from "next";
import { NON_PUBLIC_PREFIXES, PRECISIA_ORIGIN } from "@/lib/precisia-site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...NON_PUBLIC_PREFIXES] },
    sitemap: `${PRECISIA_ORIGIN}/sitemap.xml`,
  };
}
