import { AvatarAttributes, CustomerAvatar } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

function readMockAvatars(): CustomerAvatar[] {
  const raw = localStorage.getItem("dlxstore_customer_avatars");
  return raw ? (JSON.parse(raw) as CustomerAvatar[]) : [];
}

function writeMockAvatars(avatars: CustomerAvatar[]) {
  localStorage.setItem("dlxstore_customer_avatars", JSON.stringify(avatars));
}

/** Load the current customer's avatar row (attributes), or null. */
export async function getMyAvatar(profileId: string): Promise<CustomerAvatar | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("customer_avatars")
      .select("*")
      .eq("profile_id", profileId)
      .maybeSingle();

    if (error) throw new Error(error.message || "Unable to load your avatar.");
    return (data as CustomerAvatar) ?? null;
  }

  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return readMockAvatars().find((avatar) => avatar.profile_id === profileId) ?? null;
}

/** Persist (upsert) the customer's avatar attributes. */
export async function saveMyAvatar(
  profileId: string,
  attributes: AvatarAttributes
): Promise<CustomerAvatar> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("customer_avatars")
      .upsert(
        {
          profile_id: profileId,
          attributes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "profile_id" }
      )
      .select()
      .single();

    if (error) throw new Error(error.message || "Unable to save your avatar.");
    return data as CustomerAvatar;
  }

  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  const avatars = readMockAvatars();
  const existing = avatars.find((avatar) => avatar.profile_id === profileId);
  if (existing) {
    existing.attributes = attributes;
    existing.updated_at = new Date().toISOString();
    writeMockAvatars(avatars);
    return existing;
  }
  const created: CustomerAvatar = {
    id: `avatar-${Math.random().toString(36).substr(2, 9)}`,
    profile_id: profileId,
    attributes,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  writeMockAvatars([...avatars, created]);
  return created;
}