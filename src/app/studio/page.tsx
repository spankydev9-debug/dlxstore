import type { Metadata } from "next";
import { absoluteUrl } from "../../lib/site";
import MannequinStudioPage from "./MannequinStudioPage";

export const metadata: Metadata = {
  title: "Mon mannequin",
  description:
    "Votre mannequin DLXSTORE personnel : essayez vos articles, composez vos tenues et retrouvez vos essayages.",
  alternates: { canonical: absoluteUrl("/studio") },
  openGraph: {
    title: "Mon mannequin | DLXSTORE",
    description:
      "Votre mannequin DLXSTORE personnel : essayez vos articles et composez vos tenues.",
    url: absoluteUrl("/studio"),
  },
  robots: { index: false, follow: true },
};

export default function StudioRoute() {
  return <MannequinStudioPage />;
}
