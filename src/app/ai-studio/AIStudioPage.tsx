"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AIProductStudio } from "../../components/studio/AIProductStudio";

/**
 * Keep the seller workspace behind a client boundary: it reads the current
 * authenticated user and catalogue media, while the route itself remains safe
 * to render for metadata and navigation.
 */
export default function AIStudioPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[60vh] w-full items-center justify-center bg-[#0a0a0a]">
          <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
        </main>
      }
    >
      <AIProductStudio />
    </Suspense>
  );
}
