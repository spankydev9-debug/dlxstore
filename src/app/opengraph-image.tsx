import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "DLXSTORE — marketplace à Goma, RDC";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "#050505",
          color: "#f8f8f2",
        }}
      >
        <div style={{ color: "#d4af37", fontSize: 28, letterSpacing: 8, fontWeight: 700 }}>DLXSTORE</div>
        <div style={{ marginTop: 24, fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>Marketplace à Goma</div>
        <div style={{ marginTop: 20, fontSize: 28, color: "#a1a1aa", maxWidth: 800 }}>
          Achetez, payez à la livraison, suivez votre commande.
        </div>
      </div>
    ),
    { ...size }
  );
}
