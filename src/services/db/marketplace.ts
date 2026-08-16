import { DeliveryZone, PartnerApplication } from "../../types";
import { isSupabaseConfigured, isDemoMode, supabase } from "./index";

export async function getDeliveryZones(includeInactive = false): Promise<DeliveryZone[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase.from("delivery_zones").select("country_code, province, city, territory, commune, active, fee, currency").order("province");
    if (!includeInactive) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(({ country_code, ...zone }) => ({ ...zone, country: country_code as "CD" })) as DeliveryZone[];
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  return JSON.parse(localStorage.getItem("dlxstore_delivery_zones") || "[]") as DeliveryZone[];
}

export async function saveDeliveryZone(zone: DeliveryZone): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("delivery_zones").insert({ country_code: zone.country, province: zone.province, city: zone.city || null, territory: zone.territory || null, commune: zone.commune || null, active: zone.active, fee: zone.fee, currency: zone.currency });
    if (error) throw error;
    return;
  }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const zones = await getDeliveryZones(true); localStorage.setItem("dlxstore_delivery_zones", JSON.stringify([...zones, zone]));
}

export async function updatePartnerApplicationStatus(id: string, status: PartnerApplication["status"]): Promise<void> {
  if (isSupabaseConfigured && supabase) { const { error } = await supabase.from("partner_applications").update({ status }).eq("id", id); if (error) throw error; return; }
  if (!isDemoMode) throw new Error("No production data source configured.");
  const applications = JSON.parse(localStorage.getItem("dlxstore_partner_applications") || "[]") as PartnerApplication[];
  localStorage.setItem("dlxstore_partner_applications", JSON.stringify(applications.map((application) => application.id === id ? { ...application, status } : application)));
}
