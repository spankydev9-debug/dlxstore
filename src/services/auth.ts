import { Profile, UserRole } from "../types";
import { supabase, isSupabaseConfigured, initMockDb } from "./db/index";

export async function getCurrentUser(): Promise<Profile | null> {
  if (isSupabaseConfigured && supabase) {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return null;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError) return null;
    return profile;
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_current_user");
  return raw ? JSON.parse(raw) : null;
}

export async function signIn(email: string, password?: string, role: UserRole = "customer"): Promise<Profile> {
  if (isSupabaseConfigured && supabase) {
    if (!password) throw new Error("Password is required for Supabase Auth");
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
    if (!data.user) throw new Error("No user returned");

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .single();

    if (profileError) throw profileError;
    return profile;
  }

  // Local Storage Fallback
  initMockDb();
  const profilesRaw = localStorage.getItem("dlxstore_profiles");
  const profiles: Profile[] = profilesRaw ? JSON.parse(profilesRaw) : [];

  let profile = profiles.find(p => p.email.toLowerCase() === email.toLowerCase());

  if (!profile) {
    // If logging in with admin credentials and not found, auto-create
    if (email === "admin@dlxstore.cd") {
      profile = {
        id: "usr-admin",
        email: "admin@dlxstore.cd",
        full_name: "Directeur DLXSTORE",
        phone: "+243 999 999 999",
        role: "admin",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      profiles.push(profile);
      localStorage.setItem("dlxstore_profiles", JSON.stringify(profiles));
    } else {
      // Auto-create standard customer profile if not exists (for easy demo login)
      profile = {
        id: `usr-${Math.random().toString(36).substr(2, 9)}`,
        email: email,
        full_name: email.split("@")[0].charAt(0).toUpperCase() + email.split("@")[0].slice(1),
        phone: "+243 812 345 678",
        role: role,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      profiles.push(profile);
      localStorage.setItem("dlxstore_profiles", JSON.stringify(profiles));
    }
  }

  localStorage.setItem("dlxstore_current_user", JSON.stringify(profile));
  
  // Dispatch custom storage event to update auth listeners
  window.dispatchEvent(new Event("storage"));
  
  return profile;
}

export async function signUp(email: string, fullName: string, phone: string, password?: string): Promise<Profile> {
  if (isSupabaseConfigured && supabase) {
    if (!password) throw new Error("Password is required for Supabase Auth");

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone: phone,
          role: "customer"
        }
      }
    });

    if (error) throw error;
    if (!data.user) throw new Error("SignUp failed");

    // Profile is created by DB trigger, wait slightly and query it
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.user.id)
      .single();

    if (profileError) throw profileError;
    return profile;
  }

  // Local Storage Fallback
  initMockDb();
  const profilesRaw = localStorage.getItem("dlxstore_profiles");
  const profiles: Profile[] = profilesRaw ? JSON.parse(profilesRaw) : [];

  const existing = profiles.find(p => p.email.toLowerCase() === email.toLowerCase());
  if (existing) throw new Error("Cet email est déjà utilisé");

  const newProfile: Profile = {
    id: `usr-${Math.random().toString(36).substr(2, 9)}`,
    email,
    full_name: fullName,
    phone,
    role: "customer",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  profiles.push(newProfile);
  localStorage.setItem("dlxstore_profiles", JSON.stringify(profiles));
  localStorage.setItem("dlxstore_current_user", JSON.stringify(newProfile));
  
  window.dispatchEvent(new Event("storage"));
  
  return newProfile;
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return;
  }

  // Local Storage Fallback
  localStorage.removeItem("dlxstore_current_user");
  window.dispatchEvent(new Event("storage"));
}

export async function updateProfile(id: string, fields: Partial<Omit<Profile, "id" | "role" | "email" | "created_at">>): Promise<Profile> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("profiles")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Local Storage Fallback
  initMockDb();
  const profilesRaw = localStorage.getItem("dlxstore_profiles");
  const profiles: Profile[] = profilesRaw ? JSON.parse(profilesRaw) : [];
  const index = profiles.findIndex(p => p.id === id);
  if (index === -1) throw new Error("Profile not found");

  const updatedProfile = {
    ...profiles[index],
    ...fields,
    updated_at: new Date().toISOString()
  };

  profiles[index] = updatedProfile;
  localStorage.setItem("dlxstore_profiles", JSON.stringify(profiles));

  // Sync current user if applicable
  const current = localStorage.getItem("dlxstore_current_user");
  if (current) {
    const currentUser: Profile = JSON.parse(current);
    if (currentUser.id === id) {
      localStorage.setItem("dlxstore_current_user", JSON.stringify(updatedProfile));
    }
  }

  return updatedProfile;
}

export async function getProfiles(): Promise<Profile[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_profiles");
  return raw ? JSON.parse(raw) : [];
}
