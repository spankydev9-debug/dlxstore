import type { Metadata } from "next";
import { absoluteUrl } from "../../../lib/site";
import SellerDashboardRoute from "./SellerDashboardRoute";

export const metadata: Metadata = {
  title: "Espace vendeur",
  description: "Gérez vos ventes, vos stocks et vos versements sur le marketplace DLXSTORE.",
  alternates: { canonical: absoluteUrl("/partner/dashboard") },
  robots: { index: false, follow: false }
};

export default function SellerDashboardPage() {
  return <SellerDashboardRoute />;
}
