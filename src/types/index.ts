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
  /** Safe order summary provided to authenticated staff delivery screens. */
  order?: Pick<Order, "customer_name" | "phone_number" | "municipality" | "neighborhood" | "avenue" | "house_number" | "total_amount">;
}

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  is_read: boolean;
  type: "order_status" | "low_stock" | "new_order";
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
  is_24_7: boolean;
  hours: BusinessHours[];
  food_categories: string[];
  active: boolean;
  created_at?: string;
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
