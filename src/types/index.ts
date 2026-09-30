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
  type: "order_status" | "low_stock" | "new_order" | "chat_message" | "reward";
  created_at: string;
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
export interface PartnerShop {
  id: string;
  profile_id?: string;
  business_name: string;
  slug: string;
  description?: string;
  shop_name?: string;
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
export interface PartnerApplication { id: string; business_name: string; owner_name: string; phone: string; email?: string; social_media?: string; province: string; city: string; business_category: string; description: string; products_services?: string; location?: string; collaboration_type: "vendor" | "brand" | "creator" | "partner"; additional_information?: string; status: "pending" | "reviewing" | "approved" | "declined"; created_at: string; }

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

export type ConversationType = "customer_support" | "internal" | "group";
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
