import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest { return { name: "DLXSTORE", short_name: "DLXSTORE", description: "Digital marketplace for the Democratic Republic of Congo.", start_url: "/", display: "standalone", background_color: "#000000", theme_color: "#000000", icons: [{ src: "/icon", sizes: "512x512", type: "image/png" }] }; }
