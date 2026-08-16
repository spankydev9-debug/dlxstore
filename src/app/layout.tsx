import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "../components/shared/ThemeProvider";
import { AuthProvider } from "../context/AuthContext";
import { CartProvider } from "../context/CartContext";
import { NotificationProvider } from "../context/NotificationContext";
import { LanguageProvider } from "../context/LanguageContext";
import { StorefrontShell } from "../components/shared/StorefrontShell";
import { PwaRegistration } from "../components/shared/PwaRegistration";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://dlxstore.cd"),
  title: {
    default: "DLXSTORE | Digital marketplace for the DRC",
    template: "%s | DLXSTORE",
  },
  description: "DLXSTORE is building a trusted digital marketplace for the Democratic Republic of Congo.",
  keywords: ["RDC", "DRC", "marketplace", "e-commerce", "DLXSTORE"],
  robots: "index, follow",
  openGraph: {
    title: "DLXSTORE | Digital marketplace for the DRC",
    description: "A trusted digital marketplace for the Democratic Republic of Congo.",
    siteName: "DLXSTORE",
    locale: "fr_FR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DLXSTORE",
    description: "A trusted digital marketplace for the DRC.",
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
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
