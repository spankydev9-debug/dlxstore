import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "../components/shared/ThemeProvider";
import { AuthProvider } from "../context/AuthContext";
import { CartProvider } from "../context/CartContext";
import { NotificationProvider } from "../context/NotificationContext";
import { StreakProvider } from "../context/StreakContext";
import { LanguageProvider } from "../context/LanguageContext";
import { ChatProvider } from "../context/ChatContext";
import { OverlayProvider } from "../context/OverlayContext";
import { StorefrontShell } from "../components/shared/StorefrontShell";
import { PwaRegistration } from "../components/shared/PwaRegistration";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} | ${SITE_TAGLINE}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: process.env.NEXT_PUBLIC_SITE_DESCRIPTION || "The DLXSTORE marketplace makes shopping in Goma easier with a curated catalog, free delivery and safe cash-on-delivery payment.",
  keywords: ["RDC", "DRC", "Goma", "marketplace", "e-commerce", "DLXSTORE"],
  robots: "index, follow",
  alternates: {
    canonical: "/",
  },
  verification: {
    google: "rDLfWrWhsGIOrBrggnaVJEkzdPSPWunULd-pUM-bR64",
  },
  openGraph: {
    title: `${SITE_NAME} | ${SITE_TAGLINE}`,
    description: "A trusted digital marketplace for the Democratic Republic of Congo, with free delivery across Goma and cash on delivery.",
    siteName: SITE_NAME,
    locale: "fr_CD",
    type: "website",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: "A trusted digital marketplace for the DRC with free delivery across Goma.",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    // iOS ignores the web manifest entirely: without these, "Add to Home Screen"
    // produces a Safari-chrome shortcut with a white icon instead of a standalone
    // app. /apple-icon is served by src/app/apple-icon.tsx.
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  maximumScale: 5,
  userScalable: true,
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon`,
  description: SITE_TAGLINE,
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_TAGLINE,
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE_URL}/shop?search={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground transition-colors duration-200">
        <PwaRegistration />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <ThemeProvider>
          <LanguageProvider>
            <AuthProvider>
              <CartProvider>
                <NotificationProvider>
                  <StreakProvider>
                    <ChatProvider>
                    <OverlayProvider>
                      <StorefrontShell>{children}</StorefrontShell>
                      </OverlayProvider>
                    </ChatProvider>
                  </StreakProvider>
                </NotificationProvider>
              </CartProvider>
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
