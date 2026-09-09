import { ImageResponse } from "next/og";
import { vyronIconElement } from "@/lib/brand-icon";

// See src/app/icons/192/route.tsx — same reasoning, the manifest's
// 512x512 icon slot.
export function GET() {
  return new ImageResponse(vyronIconElement(512), { width: 512, height: 512 });
}
