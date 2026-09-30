"use client";

import Image from "next/image";
import { type CSSProperties, useState } from "react";
import {
  getProductImageFallback,
  resolveProductImageUrl,
  validateProductImageUrl,
} from "../../lib/product-image";

type ProductImageProps = {
  src?: string | null;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  className?: string;
  priority?: boolean;
  style?: CSSProperties;
};

export function ProductImage({ src, alt, fill, width, height, sizes, className, priority, style }: ProductImageProps) {
  const validation = validateProductImageUrl(src);
  const resolvedSrc = resolveProductImageUrl(src);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const currentSrc = failedSrc === resolvedSrc ? getProductImageFallback() : resolvedSrc;
  const fallbackReason = failedSrc === resolvedSrc
    ? "load_failed"
    : validation.isAllowed ? undefined : validation.reason;

  const shared = {
    alt,
    className,
    priority,
    style,
    onError: () => setFailedSrc(resolvedSrc),
    "data-dlx-image-state": fallbackReason ? "fallback" : "ready",
    "data-dlx-image-reason": fallbackReason,
  };

  if (fill) {
    return <Image src={currentSrc} fill sizes={sizes || "100vw"} {...shared} />;
  }

  return <Image src={currentSrc} width={width || 400} height={height || 400} sizes={sizes} {...shared} />;
}
