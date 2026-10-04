import { ImageResponse } from "next/og";

export const runtime = "edge";

/**
 * iOS does not read the web manifest. Without `/apple-icon` an iPhone "Add to
 * Home Screen" produces a plain white-icon shortcut in a Safari chrome, which is
 * why `layout.tsx` also sets `appleWebApp`.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 62,
          fontWeight: 700,
          letterSpacing: -4
        }}
      >
        DLX
      </div>
    ),
    { ...size }
  );
}
