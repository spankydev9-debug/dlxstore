import { StoreSettings } from "../../types";
import { supabase, isSupabaseConfigured, initMockDb } from "./index";

export async function getStoreSettings(): Promise<StoreSettings> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "store_info")
      .maybeSingle();

    if (error) throw error;
    if (data && data.value) return data.value as StoreSettings;
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_settings");
  return raw ? JSON.parse(raw) : {
    name: "DLXSTORE",
    tagline: "Shop Smart. Delivered Free.",
    city: "Goma",
    contact_phone: "+243 990 123 456",
    contact_email: "contact@dlxstore.cd",
    whatsapp_enabled: true
  };
}

export async function updateStoreSettings(newSettings: Partial<StoreSettings>): Promise<StoreSettings> {
  const current = await getStoreSettings();
  const updated = { ...current, ...newSettings };

  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "store_info", value: updated, updated_at: new Date().toISOString() });

    if (error) throw error;
    return updated;
  }

  // Local Storage Fallback
  localStorage.setItem("dlxstore_settings", JSON.stringify(updated));
  return updated;
}
