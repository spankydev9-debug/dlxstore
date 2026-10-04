import type { MetadataRoute } from "next";

/**
 * Installability requirements Chrome audits before firing `beforeinstallprompt`:
 * a name, a 192px and a 512px icon, `start_url`, `display`, and a service worker
 * that controls the page. The maskable entry is what Android uses when the user
 * picks "Add to Home screen" and the launcher crops the icon to their shape.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "DLXSTORE",
    short_name: "DLXSTORE",
    description:
      "Digital marketplace for the Democratic Republic of Congo: shop, chat, share and pay cash on delivery.",
    lang: "en",
    dir: "ltr",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait-primary",
    background_color: "#050505",
    theme_color: "#050505",
    categories: ["shopping", "business", "social"],
    prefer_related_applications: false,
    icons: [
      { src: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    shortcuts: [
      { name: "Shop", short_name: "Shop", url: "/shop?source=pwa-shortcut" },
      { name: "Cart", short_name: "Cart", url: "/cart?source=pwa-shortcut" },
      { name: "My account", short_name: "Account", url: "/dashboard?source=pwa-shortcut" },
      { name: "Messages", short_name: "Chat", url: "/chat?source=pwa-shortcut" }
    ]
  };
}
