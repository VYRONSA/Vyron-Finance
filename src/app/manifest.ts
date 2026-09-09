import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VYRON FINANCE",
    short_name: "VYRON",
    description:
      "An intelligent accounting recovery and financial intelligence platform — bank transaction intelligence, Merchant Rules, automatic GL & VAT coding, and executive reporting.",
    start_url: "/",
    display: "standalone",
    background_color: "#05060a",
    theme_color: "#161d33",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
