import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Panier",
  robots: { index: false, follow: false },
};

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
