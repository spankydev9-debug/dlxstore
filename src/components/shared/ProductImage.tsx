"use client";

import Image from "next/image";
import { type CSSProperties, useState } from "react";
import { getProductImageFallback, resolveProductImageUrl } from "../../lib/product-image";

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
  const resolvedSrc = resolveProductImageUrl(src);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const currentSrc = failedSrc === resolvedSrc ? getProductImageFallback() : resolvedSrc;

  const shared = {
    alt,
    className,
    priority,
    style,
    onError: () => setFailedSrc(resolvedSrc),
  };

  if (fill) {
    return <Image src={currentSrc} fill sizes={sizes || "100vw"} {...shared} />;
  }

  return <Image src={currentSrc} width={width || 400} height={height || 400} sizes={sizes} {...shared} />;
}
