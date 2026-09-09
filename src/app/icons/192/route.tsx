import { ImageResponse } from "next/og";
import { vyronIconElement } from "@/lib/brand-icon";

// A dedicated, fixed-size render of the brand tile for the PWA manifest's
// 192x192 icon slot — `manifest.ts` needs a concrete served URL to point
// `icons[].src` at, which the special `icon`/`apple-icon` file conventions
// don't provide (those only ever produce one favicon-sized image each).
export function GET() {
  return new ImageResponse(vyronIconElement(192), { width: 192, height: 192 });
}
