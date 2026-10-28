"use client";

import { Suspense } from "react";
import { CategoryRail, CategoryRailSkeleton } from "./CategoryRail";

/**
 * `CategoryRail` reads `useSearchParams`, so Next requires a Suspense boundary.
 * The boundary used to fall back to `null`, which meant the server shipped no
 * rail markup and the browser grew that 55px band only after hydration — the
 * layout shift the skeleton now prevents. `StorefrontShell` mounts this wrapper
 * only on routes that show a rail, so no other page reserves the space.
 */
export function CategoryRailWrapper() {
  return (
    <Suspense fallback={<CategoryRailSkeleton />}>
      <CategoryRail />
    </Suspense>
  );
}
