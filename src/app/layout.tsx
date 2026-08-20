import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "../components/shared/ThemeProvider";
import { AuthProvider } from "../context/AuthContext";
import { CartProvider } from "../context/CartContext";
import { NotificationProvider } from "../context/NotificationContext";
import { LanguageProvider } from "../context/LanguageContext";
import { StorefrontShell } from "../components/shared/StorefrontShell";
import { PwaRegistration } from "../components/shared/PwaRegistration";
import { getGoogleSiteVerification, getSiteUrl } from "../lib/site-url";

const siteUrl = getSiteUrl();
const googleVerification = getGoogleSiteVerification();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "DLXSTORE | Marketplace à Goma, RDC",
    template: "%s | DLXSTORE",
  },
  description:
    "DLXSTORE est une marketplace numérique à Goma, en République démocratique du Congo. Commandez des produits, payez à la livraison et suivez vos commandes.",
  keywords: ["DLXSTORE", "Goma", "RDC", "marketplace", "livraison", "paiement à la livraison"],
  applicationName: "DLXSTORE",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    title: "DLXSTORE | Marketplace à Goma, RDC",
    description:
      "Achetez à Goma avec paiement à la livraison. Catalogue, commandes et suivi depuis DLXSTORE.",
    siteName: "DLXSTORE",
    locale: "fr_CD",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "DLXSTORE | Marketplace à Goma, RDC",
    description: "Marketplace numérique à Goma. Paiement à la livraison.",
  },
  ...(googleVerification
    ? { verification: { google: googleVerification } }
    : {}),
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#000000",
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className="h-full overflow-x-clip antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col overflow-x-clip bg-background text-foreground transition-colors duration-200">
        <PwaRegistration />
        <ThemeProvider>
          <LanguageProvider>
          <AuthProvider>
            <CartProvider>
              <NotificationProvider>
                <StorefrontShell>{children}</StorefrontShell>
              </NotificationProvider>
            </CartProvider>
          </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
