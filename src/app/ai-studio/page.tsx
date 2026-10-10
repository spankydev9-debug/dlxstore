import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import AIStudioPage from "./AIStudioPage";

export const metadata: Metadata = {
  title: "AI Product Studio | DLXSTORE",
  description:
    "Préparez les visuels produit dans DLXSTORE : mannequin fantôme, arrière-plan, amélioration et traitement par lot.",
  alternates: { canonical: absoluteUrl("/ai-studio") },
  openGraph: {
    title: "AI Product Studio | DLXSTORE",
    description: "Préparation de visuels produit assistée par IA sur DLXSTORE.",
    url: absoluteUrl("/ai-studio"),
  },
  robots: { index: false, follow: true },
};

export default function AIStudioRoute() {
  return <AIStudioPage />;
}
