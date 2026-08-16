import { PartnerApplication } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

export async function submitPartnerApplication(input: Omit<PartnerApplication, "id" | "status" | "created_at">): Promise<PartnerApplication> {
  const record = { ...input, status: "pending" as const };
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("partner_applications").insert(record).select().single();
    if (error) throw error;
    return data as PartnerApplication;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured to receive applications yet.");
  const application: PartnerApplication = { ...record, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  const stored = JSON.parse(localStorage.getItem("dlxstore_partner_applications") || "[]") as PartnerApplication[];
  localStorage.setItem("dlxstore_partner_applications", JSON.stringify([...stored, application]));
  return application;
}

export async function getPartnerApplications(): Promise<PartnerApplication[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("partner_applications").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []) as PartnerApplication[];
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured to retrieve applications yet.");
  return JSON.parse(localStorage.getItem("dlxstore_partner_applications") || "[]") as PartnerApplication[];
}
