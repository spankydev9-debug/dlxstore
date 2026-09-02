import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import PartnersPage from "./PartnersPage";

export const metadata: Metadata = {
  title: "Boutiques partenaires",
  description:
    "Découvrez les boutiques des partenaires DLX à Goma : chaque boutique propose sa propre sélection d'articles avec livraison gratuite.",
  alternates: { canonical: absoluteUrl("/partners") },
  openGraph: {
    title: "Boutiques partenaires | DLXSTORE",
    description: "Les boutiques des partenaires DLXSTORE à Goma.",
    url: absoluteUrl("/partners"),
  },
};

export default function PartnersRoute() {
  return <PartnersPage />;
}