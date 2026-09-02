import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import ContactPage from "./ContactPage";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contactez DLXSTORE : canaux officiels du support client, des commandes, de la livraison et des partenariats à Goma.",
  alternates: { canonical: absoluteUrl("/contact") },
  openGraph: {
    title: "Contact | DLXSTORE",
    description: "Les canaux officiels de contact DLXSTORE à Goma.",
    url: absoluteUrl("/contact"),
  },
};

export default function ContactRoute() {
  return <ContactPage />;
}