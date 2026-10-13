import type { Metadata } from "next";
import FeedbackPage from "./FeedbackPage";
import { absoluteUrl } from "../../lib/site";

export const metadata: Metadata = {
  title: "Feedback",
  description: "Share feedback, bug reports, or suggestions for DLXSTORE.",
  alternates: { canonical: absoluteUrl("/feedback") },
  openGraph: {
    title: "Feedback | DLXSTORE",
    description: "Share your feedback to help improve DLXSTORE.",
    url: absoluteUrl("/feedback"),
  },
};

export default function FeedbackRoute() {
  return <FeedbackPage />;
}
