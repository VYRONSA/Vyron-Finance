import type { MetadataRoute } from "next";
import { PRECISIA_ORIGIN, PUBLIC_PAGES } from "@/lib/precisia-site";

// The public marketing pages only. No lastModified: there is no reliable
// per-page date to give, and a guessed one is worse than none.
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((path) => ({ url: `${PRECISIA_ORIGIN}${path}` }));
}
