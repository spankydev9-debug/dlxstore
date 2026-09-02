import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import PartnerPage from "./PartnerPage";

export const metadata: Metadata = {
  title: "Devenir partenaire",
  description:
    "Rejoignez le marketplace DLXSTORE à Goma comme vendeur, marque, créateur ou partenaire commercial.",
  alternates: { canonical: absoluteUrl("/partner") },
  openGraph: {
    title: "Devenir partenaire | DLXSTORE",
    description: "Postulez pour rejoindre le marketplace DLXSTORE à Goma.",
    url: absoluteUrl("/partner"),
  },
};

export default function PartnerRoute() {
  return <PartnerPage />;
}