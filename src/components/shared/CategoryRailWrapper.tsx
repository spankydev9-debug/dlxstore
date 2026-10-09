"use client";

import { Suspense } from "react";
import { CategoryRail } from "./CategoryRail";

export function CategoryRailWrapper() {
  return (
    <Suspense fallback={null}>
      <CategoryRail />
    </Suspense>
  );
}
