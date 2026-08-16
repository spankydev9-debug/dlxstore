import { StoreSettings } from "../../types";
import { supabase, isSupabaseConfigured, initMockDb } from "./index";
import { defaultStoreSettings, normalizeStoreSettings } from "../../lib/store-config";

export async function getStoreSettings(): Promise<StoreSettings> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "store_info")
      .maybeSingle();

    if (error) throw error;
    if (data && data.value) return normalizeStoreSettings(data.value as Partial<StoreSettings>);
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_settings");
  return raw ? normalizeStoreSettings(JSON.parse(raw) as Partial<StoreSettings>) : defaultStoreSettings;
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
