import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import ShopPage from "./ShopPage";

export const metadata: Metadata = {
  title: "Boutique",
  description:
    "Tous nos articles à Goma : téléphones, informatique, mode, énergie solaire et plus. Livraison gratuite et paiement à la livraison.",
  alternates: { canonical: absoluteUrl("/shop") },
  openGraph: {
    title: "Boutique | DLXSTORE",
    description: "Catalogue DLXSTORE — livraison gratuite à Goma, paiement à la livraison.",
    url: absoluteUrl("/shop"),
  },
};

export default function ShopRoute() {
  return <ShopPage />;
}