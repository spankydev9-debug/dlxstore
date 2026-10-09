export type UserRole = "customer" | "staff" | "admin";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: UserRole;
  is_active?: boolean;
  created_at: string;
  updated_at: string;
  /** Added by 20260928102000_social_foundation.sql. Nullable and not yet exposed in UI. */
  username?: string;
  bio?: string;
  avatar_url?: string;
  is_private?: boolean;
  last_seen_at?: string;
  allow_messages_from?: string;
  allow_follows_from?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  is_active?: boolean;
  display_order?: number;
  created_at: string;
}

/** A curated merchandising collection. A product keeps ONE permanent category but may appear in MANY sessions. */
export interface StoreSession {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  is_active?: boolean;
  display_order?: number;
  starts_at?: string | null;
  ends_at?: string | null;
  created_at: string;
}

/** Membership of a product within a session, with its per-session ordering. */
export interface SessionProduct {
  session_id: string;
  product_id: string;
  display_order: number;
  created_at?: string;
}

export type ProductType = "standard" | "food";

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  discount_price?: number;
  category_id: string;
  brand: string;
  sizes: string[];
  colors: string[];
  sku: string;
  rating: number;
  stock_quantity: number;
  is_featured: boolean;
  is_best_seller: boolean;
  is_new_arrival: boolean;
  tags?: string[];
  is_active?: boolean;
  is_archived?: boolean;
  low_stock_threshold?: number;
  product_type?: ProductType;
  food_vendor_id?: string;
  /** Marketplace owner. NULL for DLX's own stock, which is the default. */
  vendor_id?: string | null;
  food_category?: string;
  created_at: string;
  images: string[];
  reviews?: Review[];
}

/** Row-level product media asset. Reusable by partners/shops, avatar and future try-on assets. */
export interface ProductMediaAsset {
  id: string;
  product_id: string;
  image_url: string;
  is_primary: boolean;
  display_order: number;
  alt_text?: string | null;
  storage_object_path?: string | null;
  owner_type?: string | null;
  owner_id?: string | null;
  created_at: string;
}

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled";

export interface Order {
  id: string;
  customer_id?: string;
  status: OrderStatus;
  customer_name: string;
  phone_number: string;
  municipality: string; // Goma or Karisimbi
  neighborhood: string;
  avenue: string;
  house_number?: string;
  delivery_notes?: string;
  coupon_code?: string;
  discount_amount?: number;
  whatsapp_handoff_status?: "not_attempted" | "link_opened" | "unavailable" | "not_configured";
  whatsapp_handoff_at?: string;
  total_amount: number;
  created_at: string;
  updated_at: string;
  items: OrderItem[];
  delivery?: Delivery;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  price_at_sale: number;
  size?: string;
  color?: string;
  product?: Product;
}

export interface Delivery {
  id: string;
  order_id: string;
  driver_id?: string;
  driver_name?: string;
  status: string;
  assigned_at?: string;
  delivered_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  is_read: boolean;
  type:
    | "order_status"
    | "low_stock"
    | "new_order"
    | "chat_message"
    | "reward"
    | "friend_request"
    | "friend_accepted"
    | "partner_application"
    | "streak_milestone"
    | "story_reaction"
    | "story_mention"
    | "product_share"
    | "product_reaction"
    | "promotion"
    | "new_drop";
  created_at: string;
  actor_id?: string;
  entity_type?: string;
  entity_id?: string;
  data?: Record<string, unknown>;
  read_at?: string;
}

export interface Review {
  id: string;
  product_id: string;
  user_id: string;
  user_name: string;
  rating: number;
  comment?: string;
  created_at: string;
}

export interface HomepageBanner {
  id: string;
  title: string;
  subtitle?: string;
  link?: string;
  active: boolean;
}

export interface HomepagePromotion {
  id: string;
  label: string;
  description?: string;
  link?: string;
  active: boolean;
}

export interface BusinessHours {
  day: number;
  open: string;
  close: string;
  closed?: boolean;
}

export interface FoodVendor {
  id: string;
  name: string;
  slug: string;
  province: string;
  city: string;
  description?: string;
  phone?: string;
  email?: string;
  image_url?: string;
  banner_image_url?: string;
  is_24_7: boolean;
  hours: BusinessHours[];
  food_categories: string[];
  is_featured: boolean;
  minimum_order_amount?: number;
  delivery_fee?: number;
  rating?: number;
  preparation_time_minutes?: number;
  active: boolean;
  created_at?: string;
}

export interface FoodCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  icon_emoji?: string;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

/** Unified partner/shop entity combining vendor and storefront capabilities */
/**
 * The caller's own `vendors` row as returned by `get_my_vendor()`.
 *
 * Deliberately not `PartnerShop`: that type models the *public* projection and
 * carries no onboarding fields, so typing the seller RPC with it silently hid
 * `legal_name`, `contact_email`, `payout_method` and friends from the profile
 * form, leaving every field blank on a seller who had already filled them in.
 */
export interface MyVendor {
  id: string;
  profile_id: string | null;
  business_name: string;
  slug: string;
  status: "pending" | "active" | "suspended";
  commission_rate: number | null;
  /** Read-only. DLX sets this; the seller cannot change it from the dashboard. */
  suspended_reason: string | null;
  onboarding_step: string;
  legal_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  payout_method: PayoutMethod | null;
  payout_account_ref: string | null;
  business_hours: Record<string, unknown> | null;
  description: string | null;
  shop_name: string | null;
  shop_description: string | null;
}

/** One of the caller's own products, from `seller_list_my_products()`. */
export interface SellerProduct {
  product_id: string;
  name: string;
  slug: string;
  image_url: string | null;
  stock_quantity: number;
  is_active: boolean;
  warehouse_count: number;
}

/** One of the caller's own suppliers, from `seller_list_suppliers()`. */
export interface SellerSupplier {
  supplier_id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  active: boolean;
  product_count: number;
}

export interface PartnerShop {
  id: string;
  profile_id?: string;
  business_name: string;
  slug: string;
  description?: string;
  shop_name?: string;
  /**
   * Present only on `vendor_public_cards`, where it is
   * `COALESCE(shop_name, business_name)`. Public reads go through the view, so
   * this is the field that actually carries the seller's chosen shop name --
   * `shop_name` is absent from the view and always undefined there.
   */
  display_name?: string;
  shop_description?: string;
  shop_image_url?: string;
  banner_image_url?: string;
  province: string;
  city?: string;
  status: "pending" | "active" | "suspended";
  is_featured: boolean;
  commission_rate?: number;
  payment_info?: Record<string, unknown>;
  business_hours?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Product assignment to a partner shop with visibility control */
export interface ShopProduct {
  id: string;
  shop_id: string;
  product_id: string;
  is_visible: boolean;
  display_order: number;
  created_at: string;
}

/** Shop statistics for admin dashboard */
export interface ShopStats {
  product_count: number;
  total_orders: number;
  total_revenue: number;
}

export type CouponType = "percentage" | "fixed";
export type CouponAudience = "all" | "returning" | "referral" | "campaign";

export interface Coupon {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  min_order: number;
  max_uses?: number;
  used_count: number;
  audience: CouponAudience;
  campaign_id?: string;
  expires_at?: string;
  active: boolean;
  created_at: string;
}

export interface StoreSettings {
  name: string;
  tagline: string;
  city: string;
  contact_phone: string;
  contact_email: string;
  whatsapp_enabled: boolean;
  whatsapp_buy_number?: string;
  launch: { mode: "active" | "coming_soon"; starts_at: string | null; timezone: string; announcement: string };
  contacts: Partial<Record<"general" | "support" | "orders" | "delivery" | "partnerships", { phone?: string; email?: string; whatsapp?: string }>>;
  delivery_zones: DeliveryZone[];
  homepage_banners?: HomepageBanner[];
  homepage_promotions?: HomepagePromotion[];
}

export interface DeliveryZone { country: "CD"; province: string; city?: string; territory?: string; commune?: string; active: boolean; fee: number; currency: "USD" | "CDF"; }
export interface PartnerApplication { id: string; business_name: string; owner_name: string; phone: string; email?: string; social_media?: string; province: string; city: string; business_category: string; description: string; products_services?: string; location?: string; collaboration_type: "vendor" | "brand" | "creator" | "partner"; additional_information?: string; status: "pending" | "reviewing" | "approved" | "declined"; created_at: string; applicant_id?: string | null; }

// ---------------------------------------------------------------------------
// Marketplace (P14)
// ---------------------------------------------------------------------------

/**
 * One seller's slice of an order. Derived from `order_items` by a database
 * trigger, never written by checkout, so a sale can never lose its seller.
 *
 * `commission_rate` is captured at sale time on purpose: a later rate change must
 * not retroactively move money already promised to a seller.
 */
/**
 * Mirrors the `order_sub_orders.status` CHECK constraint exactly:
 * pending, confirmed, preparing, ready, out_for_delivery, delivered,
 * cancelled, refunded. There is no `shipped` value in either the constraint or
 * `seller_update_sub_order_status`, so a seller-facing button for it could only
 * ever be rejected.
 */
export type SubOrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface SubOrder {
  id: string;
  order_id: string;
  vendor_id: string;
  status: SubOrderStatus;
  subtotal: number;
  commission_rate: number;
  commission_amount: number;
  vendor_net_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
  /** Seller display name, joined for display only. */
  vendor_name?: string;
  /** Parent order reference, joined for display only. */
  order_reference?: string | null;
}

export type CommissionLedgerStatus = "pending" | "earned" | "paid" | "reversed";

export interface CommissionLedgerEntry {
  id: string;
  vendor_id: string;
  sub_order_id: string | null;
  order_id: string | null;
  kind: string;
  /** DLX's cut. `amount` is the commission, never the seller's revenue. */
  amount: number;
  rate: number;
  currency: string;
  status: CommissionLedgerStatus;
  created_at: string;
  reversed_at: string | null;
}

export type PayoutStatus = "requested" | "processing" | "paid" | "cancelled";
export type PayoutMethod = "mobile_money" | "bank_transfer" | "cash";

export interface VendorPayout {
  id: string;
  vendor_id: string;
  vendor_name?: string;
  status: PayoutStatus;
  gross_amount: number;
  commission_amount: number;
  /** What actually reaches the seller: gross minus commission. */
  net_amount: number;
  currency: string;
  method: PayoutMethod | null;
  account_ref: string | null;
  note: string | null;
  requested_at: string;
  settled_at: string | null;
  created_at: string;
  entry_count?: number;
}

export interface VendorWarehouse {
  id: string;
  vendor_id: string;
  name: string;
  city: string | null;
  province: string | null;
  address: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface WarehouseStockRow {
  product_id: string;
  warehouse_id: string;
  quantity: number;
  product_name?: string;
  warehouse_name?: string;
}

export interface Supplier {
  id: string;
  vendor_id: string | null;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  province: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
}

/**
 * Per-seller totals. `commission_*` figures are DLX's cut; `pending_payout_net`
 * is the seller's own money already claimed by an open payout.
 */
export interface SellerDashboard {
  product_count: number;
  sub_order_count: number;
  units_sold: number;
  gross_revenue: number;
  commission_paid: number;
  commission_pending: number;
  commission_reversed: number;
  pending_payout_net: number;
  active_payout_status: PayoutStatus | null;
}

export interface MarketplaceOverview {
  active_vendor_count: number;
  pending_application_count: number;
  open_payout_count: number;
  open_payout_net: number;
  pending_sub_order_count: number;
  delivered_sub_order_count: number;
  commission_earned: number;
  commission_paid: number;
}

export type OnboardingStep = "profile" | "documents" | "review" | "approved";

/** Fields a seller may set on their own shop record. Never includes rate or status. */
export interface VendorOnboardingInput {
  legal_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  payout_method?: PayoutMethod | null;
  payout_account_ref?: string | null;
  business_hours?: Record<string, unknown> | null;
  shop_description?: string | null;
}

export interface PayoutRequestResult {
  payout_id: string;
  entry_count: number;
  gross_amount: number;
  commission: number;
  net_amount: number;
}

export interface WarehouseStockResult {
  product_id: string;
  warehouse_id: string;
  quantity: number;
  total_allocated: number;
  product_stock: number;
}

export interface InventoryHistoryEntry {
  id: string;
  product_id: string;
  product_name: string;
  quantity_changed: number;
  type: "sale" | "restock" | "manual_adjustment";
  notes?: string;
  created_at: string;
}
// ---------------------------------------------------------------------------
// DLX Chat
// ---------------------------------------------------------------------------

// "direct" is enforced by the conversations_type_check constraint widened in
// 20261019090000_direct_chat.sql. "group" is declared for the group columns
// (is_group / group_admin_id) but no code path creates one yet, so the database
// still rejects it.
export type ConversationType = "customer_support" | "internal" | "direct" | "group";
export type ConversationStatus = "open" | "resolved" | "closed";
export type UserPresenceStatus = "online" | "away" | "offline";
export type MessageStatusType = "sent" | "delivered" | "read";
export type MediaType = "image" | "video" | "audio" | "document" | "sticker";
export type MemberRole = "admin" | "moderator" | "member";

/** A participant surfaced through list_my_conversations for identity/context. */
export interface ConversationParticipantInfo {
  profile_id: string;
  full_name: string;
  role: UserRole;
  phone?: string | null;
  email?: string | null;
  presence?: UserPresenceInfo | null;
  last_read_at?: string | null;
  last_delivered_at?: string | null;
  member_role?: MemberRole | null;
}

export interface UserPresenceInfo {
  status: UserPresenceStatus;
  last_seen_at: string;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title?: string | null;
  customer_profile_id?: string | null;
  order_id?: string | null;
  status: ConversationStatus;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  created_at: string;
  updated_at: string;
  unread_count: number;
  participants: ConversationParticipantInfo[];
  is_group?: boolean;
  group_avatar_url?: string | null;
  group_description?: string | null;
  group_admin_id?: string | null;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name?: string | null;
  sender_role?: UserRole | null;
  body: string;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  reactions?: MessageReaction[];
  media?: MessageMedia[];
  status?: MessageStatus[];
  is_pinned?: boolean;
  pinned_at?: string | null;
  pinned_by?: string | null;
  pinned_by_name?: string | null;
  pinned_note?: string | null;
}

export interface MessageReaction {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  user_name?: string;
}

export interface MessageMedia {
  id: string;
  message_id: string;
  media_type: MediaType;
  file_url: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  duration_seconds?: number;
  created_at: string;
}

export interface MessageStatus {
  message_id: string;
  user_id: string;
  status: MessageStatusType;
  updated_at: string;
}

export interface TypingIndicator {
  conversation_id: string;
  user_id: string;
  is_typing: boolean;
  last_updated_at: string;
  user_name?: string;
}

export interface PinnedMessage {
  conversation_id: string;
  message_id: string;
  pinned_by: string;
  pinned_by_name?: string;
  pinned_at: string;
  note?: string;
}

export interface ForwardedMessage {
  id: string;
  original_message_id: string;
  forwarded_message_id: string;
  created_at: string;
}

export interface ChatRealtimeData {
  conversation_id: string;
  conversation_type: string;
  conversation_title?: string;
  conversation_status: string;
  last_message_at?: string;
  participants: ConversationParticipantInfo[];
  typing_users: TypingIndicator[];
  pinned_messages: PinnedMessage[];
  unread_count: number;
}

// ---------------------------------------------------------------------------
// Customer Avatar
// ---------------------------------------------------------------------------

/** Attribute set chosen by the customer for their DLXSTORE avatar. */
export interface AvatarAttributes {
  presentation: string;
  build: string;
  height: string;
  skinTone: string;
  hairStyle: string;
  hairColor: string;
  clothingSize: string;
  facePreset: string;
}

export interface CustomerAvatar {
  id: string;
  profile_id: string;
  attributes: AvatarAttributes;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// DLX Rewards
// ---------------------------------------------------------------------------

export interface RewardMilestone {
  id: string;
  label: string;
  milestone_type: "purchase_count" | "share_count";
  threshold: number;
  coupon_code: string;
  coupon_type: CouponType;
  coupon_value: number;
  coupon_min_order: number;
  coupon_expires_days: number | null;
  is_active: boolean;
  created_at: string;
}

export type RewardStatus = "pending" | "awarded" | "used" | "expired";

export interface CustomerReward {
  id: string;
  profile_id: string;
  milestone_id: string;
  coupon_id: string;
  coupon_code: string;
  status: RewardStatus;
  awarded_at: string;
  expires_at: string | null;
  used_at: string | null;
  milestone_label: string;
  coupon_type: CouponType;
  coupon_value: number;
}

export interface ShareEvent {
  id: string;
  profile_id: string;
  channel: string;
  created_at: string;
}

export interface RewardsSummary {
  qualifying_order_count: number;
  share_count: number;
  next_purchase_milestone: RewardMilestone | null;
  next_share_milestone: RewardMilestone | null;
  rewards: CustomerReward[];
}

/**
 * A person as seen from another person's social graph.
 *
 * Deliberately narrow. `profiles` is self-or-admin readable, so every read goes
 * through a SECURITY DEFINER RPC that returns only these columns — email, phone,
 * role and last_seen_at are never exposed to another customer.
 */
export interface SocialProfile {
  id: string;
  username: string | null;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
}

/** A confirmed friendship. `friends_since` is the friendships.created_at value. */
export interface Friend extends SocialProfile {
  friends_since: string;
}

/** A follow edge. `followed_since` is the follows.created_at value. */
export interface Follow extends SocialProfile {
  followed_since: string;
}

export type FriendRequestDirection = "incoming" | "outgoing";

/**
 * A pending friend request flattened around the other party.
 *
 * `direction` is from the signed-in customer's point of view: `incoming` means
 * they can accept or decline, `outgoing` means they sent it and can cancel.
 */
export interface FriendRequestSummary {
  request_id: string;
  direction: FriendRequestDirection;
  profile_id: string;
  username: string | null;
  full_name: string;
  avatar_url: string | null;
  created_at: string;
}

/** Everything the friends screen needs, from three RPCs. */
export interface FriendGraph {
  friends: Friend[];
  followers: Follow[];
  following: Follow[];
  requests: FriendRequestSummary[];
}

/**
 * Streak milestones (ROADMAP Phase 9). `3` is a celebration-only threshold with
 * no badge of its own; 7/30/100/365 are the named badges. `new_streak` is
 * implied by `total_active_days > 0` and needs no ledger row.
 */
export type StreakBadgeKey = "new_streak" | "seven_days" | "thirty_days" | "hundred_days" | "three_sixty_five_days";

export const STREAK_BADGE_THRESHOLDS = [3, 7, 30, 100, 365] as const;
export type StreakThreshold = (typeof STREAK_BADGE_THRESHOLDS)[number];

export interface EarnedStreakMilestone {
  threshold: number;
  earned_at: string;
}

export interface StreakNextMilestone {
  threshold: number;
  days_remaining: number;
}

/**
 * Projected streak state as returned by `get_my_streak()` /
 * `record_streak_activity()`.
 *
 * `current_count` is projected, not raw: it is 0 once the last activity is older
 * than yesterday, because this project has no scheduler to expire the counter.
 * `streak_broken` distinguishes "never started" from "lapsed".
 */
export interface StreakState {
  current_count: number;
  streak_broken: boolean;
  longest_count: number;
  total_active_days: number;
  /** `YYYY-MM-DD` in Africa/Kinshasa, or null if never active. */
  last_activity_date: string | null;
  activity_recorded_today: boolean;
  /** True when the streak is alive but not yet extended today: the in-app reminder. */
  expires_today: boolean;
  advanced_today: boolean;
  milestones_awarded: number[];
  next_milestone: StreakNextMilestone | null;
  badges: EarnedStreakMilestone[];
}

// ---------------------------------------------------------------------------
// DLX Stories (ROADMAP Phase 5)
// ---------------------------------------------------------------------------
// The story tables ship with `20260928102000_social_foundation.sql`. These types
// describe what the Phase 5 SECURITY DEFINER RPCs return, not the raw rows:
// `profiles` is self-or-admin readable, so the author fields arrive pre-joined
// and deliberately narrow (no email, phone, role or last_seen_at).

export type StoryMediaType = "image" | "video" | "text";
export type StoryVisibility = "public" | "followers" | "close_friends";

export const STORY_VISIBILITIES: readonly StoryVisibility[] = [
  "public",
  "followers",
  "close_friends",
];

export const STORY_MEDIA_TYPES: readonly StoryMediaType[] = ["image", "text", "video"];

/** A product featured in a story. Mirrors the catalogue; no data is copied. */
export interface StoryProductRef {
  id: string;
  name: string;
  slug: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
}

/** Fields common to a story in the feed and a story in the owner's history. */
export interface StoryBase {
  id: string;
  author_id: string;
  author_username: string | null;
  author_name: string;
  author_avatar_url: string | null;
  media_type: StoryMediaType;
  /** Private `story-media` object path, or null for a text story. */
  storage_object_path: string | null;
  text_content: string | null;
  background_color: string | null;
  visibility: StoryVisibility;
  expires_at: string;
  created_at: string;
  reaction_count: number;
  my_reactions: string[];
  products: StoryProductRef[];
}

/**
 * A story someone in the caller's circle shared.
 *
 * `viewer_count` is null for other people's stories: only the owner may see who
 * watched, so a number here would either leak it or lie.
 */
export interface StoryItem extends StoryBase {
  is_mine: boolean;
  viewed: boolean;
  viewer_count: number | null;
}

/** A story in the owner's own history, including archived and expired ones. */
export interface MyStoryItem extends StoryBase {
  viewer_count: number;
  is_archived: boolean;
  is_expired: boolean;
}

export interface StoryAuthor {
  id: string;
  username: string | null;
  full_name: string;
  avatar_url: string | null;
}

/** One ring in the rail: an author and their active stories in play order. */
export interface StoryGroup {
  author: StoryAuthor;
  stories: StoryItem[];
  hasUnseen: boolean;
  isMine: boolean;
}

/** Who watched one of the caller's own stories. Owner-only. */
export interface StoryViewer {
  viewer_id: string;
  username: string | null;
  full_name: string;
  avatar_url: string | null;
  viewed_at: string;
}

/**
 * The identity of a story is chosen by the client on purpose: story media lives
 * at `<profile_id>/<story_id>.<ext>`, so the id must exist before the upload can
 * happen. `create_story` re-validates everything else.
 */
export interface CreateStoryInput {
  storyId: string;
  mediaType: StoryMediaType;
  storageObjectPath?: string | null;
  textContent?: string | null;
  backgroundColor?: string | null;
  visibility: StoryVisibility;
  productIds?: string[];
}

/** Reaction palette. Free-text emoji is allowed by the database; this is the UI set. */
export const STORY_REACTION_EMOJIS = ["❤️", "🔥", "👏", "😍", "😂", "🙌"] as const;

// ---------------------------------------------------------------------------
// DLX Social commerce (master roadmap area 12)
// ---------------------------------------------------------------------------
// Connects the social graph to the catalogue. Added by
// 20261008090000_social_commerce_core.sql.

/**
 * How a product was shared.
 *
 * `friend` is a direct share to one person and is the only channel that notifies
 * anybody. The others are open channels: a counter, and nothing more. The RPC
 * forces `friend` whenever a recipient is set, so the two cannot disagree.
 */
export type ShareChannel = "web" | "whatsapp" | "copy_link" | "native_share" | "friend";

/**
 * Anonymous social proof for one product.
 *
 * Every count is an integer; none of them is backed by a customer's identity.
 * `circle_*` fields count only people the signed-in customer follows or is friends
 * with, and are 0 for an anonymous visitor rather than hidden.
 */
export interface ProductSocialProof {
  buyer_count: number;
  wishlist_count: number;
  share_count: number;
  circle_buyer_count: number;
  circle_wishlist_count: number;
  /** The signed-in customer already bought this. */
  i_bought_it: boolean;
  /** The signed-in customer already saved this. */
  i_wishlisted_it: boolean;
  /** Someone in the caller's circle shared this specific product with them. */
  shared_with_me: boolean;
}

/** Why a product was recommended, so the UI can be honest about the reason. */
export type RecommendationReason = "bought_by_friends" | "saved_by_friends";

/** A product surfaced because the caller's circle engaged with it. */
export interface SocialRecommendation {
  id: string;
  name: string;
  slug: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  reason: RecommendationReason;
  score: number;
}

/** One row of the caller's own share history. */
export interface SocialShare {
  share_id: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  image_url: string | null;
  channel: ShareChannel;
  /** Null for a channel share. */
  recipient_id: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// DLX Custom orders & quotations
// ---------------------------------------------------------------------------
// Added by 20261021090000_custom_orders.sql (unapplied pending approval).
// A customer describes a product DLXSTORE does not stock and receives a quote
// from the DLX team. Prices are always the reviewer's real number.

export type CustomOrderStatus =
  | "open"
  | "quoted"
  | "accepted"
  | "declined"
  | "cancelled"
  | "fulfilled";

export type CustomOrderQuoteStatus = "sent" | "accepted" | "declined" | "superseded";

export type CustomOrderContactPreference = "chat" | "whatsapp";

/** A quotation attached to a request. Price is in minor units (cents). */
export interface CustomOrderQuote {
  id: string;
  price_cents: number;
  message: string | null;
  status: CustomOrderQuoteStatus;
  created_at: string;
}

/** A customer's own request, with its quotes (newest first). */
export interface CustomOrderRequest {
  id: string;
  title: string;
  details: string;
  budget_cents: number | null;
  contact_preference: CustomOrderContactPreference;
  reference_image_urls: string[];
  status: CustomOrderStatus;
  created_at: string;
  updated_at: string;
  quotes: CustomOrderQuote[];
}

/** A request as seen by a reviewer (admin/staff) in the review queue. */
export interface CustomOrderReviewItem {
  id: string;
  title: string;
  details: string;
  budget_cents: number | null;
  contact_preference: CustomOrderContactPreference;
  reference_image_urls: string[];
  status: CustomOrderStatus;
  created_at: string;
  updated_at: string;
  customer_id: string;
  customer_name: string;
  quote_count: number;
}


// ---------------------------------------------------------------------------
// DLX Discover (master roadmap area 14)
// ---------------------------------------------------------------------------
// Added by 20261009090000_discover_recent_and_trending.sql.

/**
 * A discoverable product, flattened by the RPC.
 *
 * Deliberately narrower than `Product`: Discover shows name, price, image and a
 * link, and does not need sizes, stock or SKU. `product_type` is carried so a
 * DLX Food item can be labelled as food rather than mislabelled as a catalogue
 * product, and `viewed_at` is present only on recently-viewed rows.
 */
export interface DiscoverItem {
  id: string;
  name: string;
  slug: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
  /** `'food'` for DLX Food items, `'product'` for catalogue items. */
  product_type: string | null;
  /** Only set on recently-viewed rows. */
  viewed_at?: string;
}

// ---------------------------------------------------------------------------
// DLX AI Shopping Assistant (master roadmap area 15)
// ---------------------------------------------------------------------------
// Added by 20261010090000_ai_shopping_assistant.sql.

/** One persisted exchange. `source` records how the answer was actually produced. */
export interface AssistantTurn {
  id: string;
  role: "user" | "assistant";
  message: string;
  /** Product ids this turn surfaced, already filtered to buyable products. */
  product_ids: string[];
  /** `deterministic` until an AI provider is configured. Never faked as `ai`. */
  source: "ai" | "deterministic";
  created_at: string;
}

export interface AssistantConversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Safety & Privacy (ROADMAP Phase 16)
// ---------------------------------------------------------------------------

export type ReportType = "harassment" | "spam" | "inappropriate_content" | "fake_account" | "other";
export type ReportStatus = "pending" | "reviewed" | "resolved" | "dismissed";

export interface BlockedProfile {
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
  blocked_at: string;
}

export interface RestrictedProfile {
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
  restricted_at: string;
}

export interface CloseFriend {
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
  added_at: string;
}

export interface MutedProfile {
  profile_id: string;
  full_name: string;
  avatar_url: string | null;
  muted_at: string;
}

export interface AbuseReport {
  id: string;
  reporter_id: string;
  reported_id: string | null;
  story_id: string | null;
  report_type: ReportType;
  description: string | null;
  status: ReportStatus;
  created_at: string;
}

export interface AdminAbuseReport extends AbuseReport {
  reporter_name?: string;
  reported_name?: string;
  reviewed_by?: string;
  reviewed_at?: string | null;
}

export interface PrivacySettings {
  is_private: boolean;
  allow_messages_from: string;
  allow_follows_from: string;
}

export interface ProfileSearchResult {
  profile_id: string;
  full_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
}

export interface FriendSuggestion extends ProfileSearchResult {
  mutual_friends_count: number;
}


// ---------------------------------------------------------------------------
// Phase 11 (P11) — Growth & loyalty
// ---------------------------------------------------------------------------

export type LoyaltyTierCode = "bronze" | "silver" | "gold" | "vip";

export type PointsReason =
  | "order_delivered"
  | "streak"
  | "referral_earned"
  | "referral_signed_up"
  | "birthday"
  | "redemption"
  | "admin_adjustment"
  | "recovery";

export interface LoyaltySummary {
  tier_code: LoyaltyTierCode;
  tier_label: string;
  balance: number;
  lifetime_earned: number;
  lifetime_redeemed: number;
  points_to_next_tier: number;
  next_tier_label: string;
  discount_percent: number;
  free_shipping: boolean;
  early_access: boolean;
  points_multiplier: number;
  referral_code: string | null;
}

export interface PointsEntry {
  id: string;
  delta: number;
  reason: PointsReason;
  description: string | null;
  created_at: string;
}

export interface ReferralInvite {
  referee_id: string;
  full_name: string | null;
  status: "pending" | "qualified" | "rewarded" | "rejected";
  qualified_at: string | null;
  rewarded_at: string | null;
}

export interface ReferralSummary {
  total: number;
  qualified: number;
  rewarded: number;
  code: string;
  invites: ReferralInvite[];
}

export interface FlashSaleItem {
  flash_sale_id: string;
  name: string;
  slug: string;
  tagline: string | null;
  discount_percent: number;
  ends_at: string;
  product_id: string;
  product_name: string;
  product_slug: string;
  image_url: string | null;
  original_price: number;
  sale_price: number;
  stock_quantity: number;
  sold_count: number;
}

export interface BundleSummary {
  bundle_id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  bundle_price: number;
  items_total: number;
  savings: number;
  savings_percent: number;
  item_count: number;
}

export interface PersonalizedPromotion {
  id: string;
  title: string;
  message: string | null;
  segment: string;
  discount_percent: number | null;
  coupon_code: string | null;
  ends_at: string;
}

export interface CartRecoveryOffer {
  cart_id: string;
  items: unknown;
  subtotal: number;
  coupon_code: string | null;
  discount_percent: number;
  recovery_expires_at: string;
}

// ---------------------------------------------------------------------------
// P12 — Analytics & business intelligence
//
// Every field is nullable or zero-valued exactly where the database could not
// know the answer. `cost_coverage_percent` exists so a margin computed over
// part of the catalogue is never presented as the margin of the whole shop.
// ---------------------------------------------------------------------------

export type AnalyticsBucket = "day" | "week" | "month" | "quarter" | "year";

export interface RevenueSummary {
  revenue: number;
  orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  units: number;
  customers: number;
  aov: number;
  discounts: number;
  cancellation_rate: number;
  avg_order_value: number;
}

export interface TopSeller {
  product_id: string;
  product_name: string;
  sku: string;
  units: number;
  revenue: number;
  /** null when the product has no recorded cost. Never silently 0. */
  profit: number | null;
  in_stock: number;
}

export interface SlowMover {
  product_id: string;
  product_name: string;
  sku: string;
  stock_quantity: number;
  units_sold: number;
  /** null when no cost is recorded. */
  stock_value: number | null;
  idle_days: number;
}

export interface CategoryPerformance {
  category_id: string;
  category_name: string;
  units: number;
  revenue: number;
  orders: number;
  revenue_share: number;
  product_count: number;
}

export interface RetentionSummary {
  registered_customers: number;
  ordering_customers: number;
  repeat_customers: number;
  new_customers: number;
  repeat_rate: number;
  activation_rate: number;
  avg_orders_per_customer: number;
  repeat_revenue_share: number;
}

export interface DeliveryPerformance {
  delivery_status: string;
  orders: number;
  avg_hours_to_complete: number;
  max_hours_to_complete: number;
}

export interface InventoryTurnover {
  product_id: string;
  product_name: string;
  units_sold: number;
  avg_stock: number;
  turnover_ratio: number;
  /** null when nothing sold: days of supply is undefined, not infinite. */
  days_of_supply: number | null;
  stock_on_hand: number;
}

export interface ProfitSummary {
  revenue: number;
  cost_of_goods: number;
  /** null when nothing sold with a recorded cost. */
  gross_profit: number | null;
  /** null when there is no covered revenue to take a percentage of. */
  margin_percent: number | null;
  cost_coverage_percent: number | null;
  unpriced_product_count: number;
}

export interface SalesTimeseriesPoint {
  bucket: string;
  revenue: number;
  orders: number;
  units: number;
}

export interface AnalyticsDailySnapshot {
  snapshot_date: string;
  revenue: number;
  orders: number;
  units: number;
  customers: number;
  new_customers: number;
  repeat_customers: number;
  delivered_orders: number;
  cancelled_orders: number;
  discounts: number;
  gross_profit: number | null;
  cost_coverage_percent: number | null;
  avg_delivery_hours: number | null;
}

export interface BusinessFact {
  fact_key: string;
  fact_value: string;
  detail: string;
}

export interface AnalyticsBundle {
  summary: RevenueSummary | null;
  profit: ProfitSummary | null;
  retention: RetentionSummary | null;
  timeseries: SalesTimeseriesPoint[];
  categories: CategoryPerformance[];
  topSellers: TopSeller[];
  slowMovers: SlowMover[];
  delivery: DeliveryPerformance[];
  turnover: InventoryTurnover[];
}

// ---------------------------------------------------------------------------
// P13 — Communication & Marketing
//
// The outbox is the system of record for every message the shop owes a customer.
// A row exists from the moment the request is accepted, so `status` is a real
// delivery state and never an optimistic guess: `pending` means accepted but not
// yet handed to a provider, and only a confirmed provider result moves a row to
// `sent`.
// ---------------------------------------------------------------------------

export type MessageChannel = "in_app" | "whatsapp" | "email";

export type OutboxStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export interface MessageTemplate {
  id: string;
  template_key: string;
  channel: MessageChannel;
  locale: string;
  subject: string | null;
  body: string;
  is_active: boolean;
  updated_at?: string;
}

/**
 * Per-customer communication preferences. Marketing consent is always opt-in:
 * `false` here means "no marketing", never "unknown, assume yes".
 */
export interface MessageOptIns {
  locale: string;
  whatsapp_marketing: boolean;
  email_marketing: boolean;
}

export interface OutboxRow {
  id: string;
  channel: MessageChannel;
  template_key: string;
  locale: string;
  recipient_id: string | null;
  recipient_address: string | null;
  is_transactional: boolean;
  subject: string | null;
  body: string;
  status: OutboxStatus;
  skip_reason: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  provider: string | null;
  provider_message_id: string | null;
  related_type: string | null;
  related_id: string | null;
  dedupe_key: string | null;
  created_at: string;
  claimed_at: string | null;
  next_attempt_at: string | null;
  sent_at: string | null;
}

export interface MessageStats {
  total: number;
  sent: number;
  /** Rows that reached a terminal state (`sent` or `failed`). */
  finished: number;
  /** Percent of finished rows that were delivered. Null until anything finishes. */
  delivery_rate: number | null;
  /** Consent refusals, counted rather than silently dropped. */
  skipped_no_consent: number;
  by_status: Record<string, number>;
  by_channel: Record<string, number>;
}

export interface MarketingAudience {
  segment: string;
  total: number;
  opted_in: number;
}

export interface CampaignSendResult {
  campaign_id: string;
  matched: number;
  queued: number;
  skipped: number;
  dry_run: boolean;
}

export interface OutboxFilters {
  status?: OutboxStatus | null;
  channel?: MessageChannel | null;
  limit?: number;
}
