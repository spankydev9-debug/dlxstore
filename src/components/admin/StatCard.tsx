"use client";

import type { LucideIcon } from "lucide-react";

/**
 * Shared admin statistic card. The value container uses `min-w-0` + `break-words`
 * so long/wide values (including formatted currency) can never overflow the card,
 * and the label row wraps instead of pushing the icon out.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  cardClassName = "",
  iconClassName = "h-4 w-4 text-muted-foreground",
  valueClassName = "text-foreground",
  hintClassName = "text-muted-foreground",
}: {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  hint?: string;
  cardClassName?: string;
  iconClassName?: string;
  valueClassName?: string;
  hintClassName?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm space-y-2 overflow-hidden ${cardClassName}`}
    >
      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <span className="min-w-0 text-xs font-bold uppercase tracking-wider">
          {label}
        </span>
        <Icon className={`${iconClassName} shrink-0`} />
      </div>
      <p
        className={`min-w-0 text-2xl font-extrabold break-words ${valueClassName}`}
      >
        {value}
      </p>
      {hint && (
        <p className={`min-w-0 text-[10px] ${hintClassName}`}>{hint}</p>
      )}
    </div>
  );
}