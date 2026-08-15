import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "../components/shared/ThemeProvider";
import { AuthProvider } from "../context/AuthContext";
import { CartProvider } from "../context/CartContext";
import { NotificationProvider } from "../context/NotificationContext";
import Header from "../components/shared/Header";
import Footer from "../components/shared/Footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "DLXSTORE - Shop Smart. Delivered Free.",
    template: "%s | DLXSTORE",
  },
  description: "Boutique en ligne premium pour la ville de Goma. Livraison gratuite partout à Goma, paiement cash à la livraison uniquement (COD).",
  keywords: ["Goma", "Kivu", "RDC", "E-commerce", "Boutique en ligne", "Livraison gratuite"],
  robots: "index, follow",
  openGraph: {
    title: "DLXSTORE - Shop Smart. Delivered Free.",
    description: "La première plateforme e-commerce premium à Goma. Livraison gratuite, paiement à la réception.",
    url: "https://dlxstore.cd",
    siteName: "DLXSTORE",
    locale: "fr_FR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DLXSTORE",
    description: "La première plateforme e-commerce premium à Goma.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground transition-colors duration-200">
        <ThemeProvider>
          <AuthProvider>
            <CartProvider>
              <NotificationProvider>
                <Header />
                <main className="flex-1 w-full mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                  {children}
                </main>
                <Footer />
              </NotificationProvider>
            </CartProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
