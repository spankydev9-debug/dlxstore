import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "../lib/site";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = `${SITE_NAME} — ${SITE_TAGLINE}`;

export default function OpenGraphImage() {
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
          background: "linear-gradient(135deg, #0a0a0a 0%, #1c1917 60%, #292524 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: 8 }}>DLX</span>
          <span style={{ fontSize: 28, fontWeight: 300, letterSpacing: 8, color: "#d4af37" }}>STORE</span>
        </div>
        <div style={{ marginTop: 24, fontSize: 56, fontWeight: 700, letterSpacing: -1 }}>
          Shop Smart. Delivered Free.
        </div>
        <div style={{ marginTop: 16, fontSize: 24, color: "#a8a29e" }}>{SITE_TAGLINE}</div>
        <div style={{ marginTop: 8, fontSize: 18, color: "#d4af37" }}>Goma · Free delivery · Cash on delivery</div>
      </div>
    ),
    { ...size },
  );
}