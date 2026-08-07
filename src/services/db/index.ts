import { createClient } from "@supabase/supabase-js";
import {
  mockCategories,
  mockProducts,
  mockReviews,
  mockOrders,
  mockNotifications,
  mockProfiles,
  mockStoreSettings,
  mockInventoryHistory,
} from "../../lib/mock-data";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

// Helper to initialize local storage data if empty
export function initMockDb() {
  if (typeof window === "undefined") return;

  if (!localStorage.getItem("dlxstore_categories")) {
    localStorage.setItem("dlxstore_categories", JSON.stringify(mockCategories));
  }

  if (!localStorage.getItem("dlxstore_products")) {
    localStorage.setItem("dlxstore_products", JSON.stringify(mockProducts));
  }

  if (!localStorage.getItem("dlxstore_reviews")) {
    localStorage.setItem("dlxstore_reviews", JSON.stringify(mockReviews));
  }

  if (!localStorage.getItem("dlxstore_orders")) {
    localStorage.setItem("dlxstore_orders", JSON.stringify(mockOrders));
  }

  if (!localStorage.getItem("dlxstore_notifications")) {
    localStorage.setItem("dlxstore_notifications", JSON.stringify(mockNotifications));
  }

  if (!localStorage.getItem("dlxstore_profiles")) {
    localStorage.setItem("dlxstore_profiles", JSON.stringify(mockProfiles));
  }

  if (!localStorage.getItem("dlxstore_settings")) {
    localStorage.setItem("dlxstore_settings", JSON.stringify(mockStoreSettings));
  }

  if (!localStorage.getItem("dlxstore_inventory_history")) {
    localStorage.setItem("dlxstore_inventory_history", JSON.stringify(mockInventoryHistory));
  }
}
