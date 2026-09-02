import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import AboutPage from "./AboutPage";

export const metadata: Metadata = {
  title: "À propos",
  description:
    "DLXSTORE est le marché numérique de référence pour Goma : une sélection d'articles originaux, une livraison gratuite et le paiement à la livraison.",
  alternates: { canonical: absoluteUrl("/about") },
  openGraph: {
    title: "À propos | DLXSTORE",
    description: "La mission, les fondateurs et les engagements de DLXSTORE à Goma.",
    url: absoluteUrl("/about"),
  },
};

export default function AboutRoute() {
  return <AboutPage />;
}