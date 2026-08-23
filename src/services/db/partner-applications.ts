import { PartnerApplication } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

export async function submitPartnerApplication(input: Omit<PartnerApplication, "id" | "status" | "created_at">): Promise<PartnerApplication> {
  const record = { ...input, status: "pending" as const };
  if (isSupabaseConfigured && supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    
    // Attempt 1: Submit with applicant_id (for when 20260823_fix_order_rpc_and_partner_applications_rls migration is applied)
    if (user?.id) {
      const payload = { ...record, applicant_id: user.id };
      const { data, error } = await supabase.from("partner_applications").insert(payload);
      if (!error) {
        return (data ? (data as any)[0] : { ...payload, id: crypto.randomUUID(), created_at: new Date().toISOString() }) as PartnerApplication;
      }
      // If error is PGRST204 / 42703 (column applicant_id missing in schema cache on un-migrated remote DB), fall back to base record
      if (error.code !== "PGRST204" && error.code !== "42703") {
        console.error("[PARTNER APPLICATION] Insert with applicant_id failed:", error);
        throw new Error(error.message || "Could not send the application. Please try again.");
      }
    }

    // Attempt 2: Base insert without applicant_id (compatible with current remote DB schema & RLS)
    const { data, error } = await supabase.from("partner_applications").insert(record);
    if (error) {
      console.error("[PARTNER APPLICATION] Base insert failed:", error);
      throw new Error(error.message || "Could not send the application. Please try again.");
    }
    return (data ? (data as any)[0] : { ...record, id: crypto.randomUUID(), created_at: new Date().toISOString() }) as PartnerApplication;
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
    if (error) throw new Error(error.message || "An error occurred.");
    return (data || []) as PartnerApplication[];
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured to retrieve applications yet.");
  return JSON.parse(localStorage.getItem("dlxstore_partner_applications") || "[]") as PartnerApplication[];
}
