import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import DiscoverPage from "./DiscoverPage";

export const metadata: Metadata = {
  title: "Découvrir",
  description:
    "Reprenez où vous vous êtes arrêté et découvrez les produits tendance sur DLXSTORE — catalogue, mode et DLX Food à Goma.",
  alternates: { canonical: absoluteUrl("/discover") },
  openGraph: {
    title: "Découvrir | DLXSTORE",
    description:
      "Vos articles récemment vus et les tendances DLXSTORE — livraison gratuite à Goma, paiement à la livraison.",
    url: absoluteUrl("/discover"),
  },
};

export default function DiscoverRoute() {
  return <DiscoverPage />;
}
