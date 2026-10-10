"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AICatalogAutomation } from "../../components/studio/AICatalogAutomation";

export default function AICatalogPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[60vh] w-full items-center justify-center bg-[#0a0a0a]">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </main>
      }
    >
      <AICatalogAutomation />
    </Suspense>
  );
}
