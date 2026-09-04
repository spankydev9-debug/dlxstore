/**
 * Format a numeric amount in USD following DLXSTORE's existing display
 * convention (`<value> $` with a space before the dollar sign), while rounding
 * away floating-point noise.
 *
 * Example: `4489.9400000000005` -> `"4,489.94 $"`
 */
export function formatMoney(amount: number): string {
  if (!Number.isFinite(amount)) return "0.00 $";
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  return `${rounded.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} $`;
}