"use client";

import Image from "next/image";
import { type CSSProperties, useState } from "react";
import { AlertCircle } from "lucide-react";
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
  const isFallback = fallbackReason !== undefined;

  const shared = {
    alt,
    className,
    priority,
    style,
    onError: () => setFailedSrc(resolvedSrc),
    "data-dlx-image-state": isFallback ? "fallback" : "ready",
    "data-dlx-image-reason": fallbackReason,
  };

  // Observable broken-image state: when image is in fallback, show visual indicator
  if (isFallback) {
    return (
      <div 
        className="flex items-center justify-center bg-muted border border-border"
        style={fill ? { position: 'absolute', inset: 0, ...style } : { width: width || 400, height: height || 400, ...style }}
        data-dlx-fallback-visual="true"
      >
        <div className="flex flex-col items-center gap-2 p-4 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {fallbackReason === "load_failed" ? "Image unavailable" : "Invalid image source"}
          </span>
        </div>
        {/* Hidden Image for accessibility/SEO */}
        <Image 
          src={currentSrc} 
          fill={fill} 
          width={fill ? undefined : (width || 400)} 
          height={fill ? undefined : (height || 400)} 
          sizes={sizes || "100vw"} 
          {...shared}
          className="sr-only"
          style={{ position: 'absolute' }}
        />
      </div>
    );
  }

  if (fill) {
    return <Image src={currentSrc} fill sizes={sizes || "100vw"} {...shared} />;
  }

  return <Image src={currentSrc} width={width || 400} height={height || 400} sizes={sizes} {...shared} />;
}
