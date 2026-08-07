export type UserRole = "customer" | "admin";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  created_at: string;
}

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

export interface StoreSettings {
  name: string;
  tagline: string;
  city: string;
  contact_phone: string;
  contact_email: string;
  whatsapp_enabled: boolean;
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
