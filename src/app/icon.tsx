import { ImageResponse } from "next/og";

export function generateImageMetadata() {
  return [
    { contentType: "image/png", size: { width: 192, height: 192 }, id: "192" },
    { contentType: "image/png", size: { width: 512, height: 512 }, id: "512" },
  ];
}

export default function Icon({ id }: { id: string }) {
  const size = id === "192" ? 192 : 512;
  const fontSize = id === "192" ? 42 : 88;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050505",
          color: "#d4af37",
          fontSize,
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        DLX
      </div>
    ),
    { width: size, height: size }
  );
}
