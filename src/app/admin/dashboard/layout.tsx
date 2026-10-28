import type { Metadata } from "next";
import React from "react";

export const metadata: Metadata = {
  title: "Tableau de bord Admin",
  robots: { index: false, follow: false },
};

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
