import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PRECISIA",
    short_name: "PRECISIA",
    description:
      "PRECISIA — Financial Intelligence. A product of Vyronsoft (Pty) Ltd.",
    start_url: "/",
    display: "standalone",
    background_color: "#050c18",
    theme_color: "#050c18",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
    ],
  };
}
