import type { Notification } from "../types";

/**
 * Where a notification actually leads.
 *
 * We only ever store a `type` (never a deep entity id), so the destination is
 * the surface that owns that type: an order goes to orders, a friend request to
 * friends, a new drop to the shop. Clicking a notification must always land
 * somewhere real — marking it read with no visible consequence is a dead
 * interaction.
 */
export function notificationDestination(notification: Notification): string {
  switch (notification.type) {
    case "order_status":
    case "new_order":
      return "/dashboard?tab=orders";
    case "reward":
      return "/dashboard?tab=rewards";
    case "friend_request":
    case "friend_accepted":
      return "/dashboard?tab=friends";
    case "story_reaction":
    case "story_mention":
      return "/dashboard?tab=stories";
    case "streak_milestone":
      return "/dashboard?tab=streak";
    case "product_share":
    case "product_reaction":
      return "/dashboard?tab=shares";
    case "partner_application":
      return "/partner";
    case "chat_message":
      return "/chat";
    case "promotion":
    case "new_drop":
    case "low_stock":
      return "/shop";
    default:
      return "/dashboard?tab=notifications";
  }
}
