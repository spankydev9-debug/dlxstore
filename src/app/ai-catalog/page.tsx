import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import AICatalogPage from "./AICatalogPage";

export const metadata: Metadata = {
  title: "Catalogue IA | DLXSTORE",
  description:
    "Enrichissez automatiquement votre catalogue produit avec l'IA — titre, description, catégorie, attributs et mots-clés suggérés à partir de vos images.",
  alternates: { canonical: absoluteUrl("/ai-catalog") },
  openGraph: {
    title: "Catalogue IA | DLXSTORE",
    description: "Enrichissement automatique du catalogue DLXSTORE par IA.",
    url: absoluteUrl("/ai-catalog"),
  },
  robots: { index: false, follow: true },
};

export default function AICatalogRoute() {
  return <AICatalogPage />;
}
