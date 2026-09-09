import { ImageResponse } from "next/og";
import { vyronIconElement, VYRON_BRAND_COLORS } from "@/lib/brand-icon";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          background: `linear-gradient(135deg, ${VYRON_BRAND_COLORS.navyTop} 0%, ${VYRON_BRAND_COLORS.navyBottom} 100%)`,
        }}
      >
        {vyronIconElement(220)}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              fontSize: 64,
              fontWeight: 600,
              letterSpacing: "0.02em",
              color: "#f7f4f1",
            }}
          >
            VYRON FINANCE
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 24,
              fontWeight: 500,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#9aa3b8",
            }}
          >
            Recover. Understand. Control.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
