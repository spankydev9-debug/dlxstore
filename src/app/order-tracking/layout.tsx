import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Suivi de commande",
  robots: { index: false, follow: false },
};

export default function OrderTrackingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
