import type { Metadata } from "next";
import { absoluteUrl } from "../lib/site";
import HomePage from "./HomePage";

export const metadata: Metadata = {
  title: "Shop Smart. Delivered Free.",
  description:
    "Le marketplace DLXSTORE pour Goma : articles originaux, livraison gratuite partout dans la ville et paiement à la livraison (Cash on Delivery).",
  alternates: { canonical: absoluteUrl("/") },
  openGraph: {
    title: "DLXSTORE — Shop Smart. Delivered Free.",
    description: "Livraison gratuite à Goma, paiement à la livraison. Découvrez nos articles originaux et partenaires locaux.",
    url: absoluteUrl("/"),
  },
};

export default function HomeRoute() {
  return <HomePage />;
}