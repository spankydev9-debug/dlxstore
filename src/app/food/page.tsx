import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import FoodPage from "./FoodPage";

export const metadata: Metadata = {
  title: "DLX Food",
  description:
    "Restaurants et fast-foods disponibles sur le marketplace DLX à Goma. Livraison gratuite et paiement à la livraison.",
  alternates: { canonical: absoluteUrl("/food") },
  openGraph: {
    title: "DLX Food | DLXSTORE",
    description: "Restaurants et fast-foods à Goma — livraison gratuite, paiement à la livraison.",
    url: absoluteUrl("/food"),
  },
};

export default function FoodRoute() {
  return <FoodPage />;
}