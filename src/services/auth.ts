import { Profile, UserRole } from "../types";
import { supabase, isDemoMode, isSupabaseConfigured, initMockDb } from "./db/index";
import {
  ProfileUnavailableError,
  SessionVerificationError,
  isInvalidSessionError,
  isUnsettledError,
} from "../lib/auth-errors";

const productionConfigurationError = "DLXSTORE authentication is unavailable until the secure data connection is configured.";

/** Number of profile reads before we call the row genuinely missing. */
const PROFILE_READ_ATTEMPTS = 4;
const PROFILE_RETRY_BASE_MS = 200;
const PROFILE_CACHE_KEY = "dlxstore_profile_cache";

async function readProfileOnce(userId: string): Promise<Profile | null> {
  if (!supabase) throw new Error(productionConfigurationError);
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (data) return data as Profile;
  // PGRST116 = "no rows returned" from maybeSingle(); anything else is real.
  if (error && error.code !== "PGRST116") throw error;
  return null;
}

/**
 * Read the signed-in customer's profile, retrying briefly because the
 * `on_auth_user_created` trigger commits the row in the same transaction as the
 * user, and a replica can briefly lag behind the auth response.
 *
 * A missing row is **not** repaired from the client. `profiles` only grants
 * SELECT and UPDATE to `authenticated`, so a client INSERT is denied by RLS;
 * the previous fallback therefore could never succeed and its misleading
 * "contact support" text was then swallowed by `getCurrentUser`, which turned a
 * data problem into a silent sign-out. A missing row is reported as
 * `ProfileUnavailableError` so the UI can offer a retry instead.
 */
async function getProfileWithRetry(userId: string): Promise<Profile> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < PROFILE_READ_ATTEMPTS; attempt += 1) {
    try {
      const profile = await readProfileOnce(userId);
      if (profile) return profile;
    } catch (error) {
      // A request we could not complete is not a verdict about the profile.
      if (isUnsettledError(error)) throw new SessionVerificationError(error);
      if (isInvalidSessionError(error)) throw error;
      lastError = error;
    }
    if (attempt < PROFILE_READ_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, PROFILE_RETRY_BASE_MS * (attempt + 1)));
    }
  }

  console.error("[AUTH] Profile row missing after retries for user:", userId, lastError ?? "");
  throw new ProfileUnavailableError(lastError);
}

/**
 * Resolve the current customer, distinguishing three outcomes that must not be
 * conflated:
 *   - `null`                      → no valid session (safe to redirect to sign-in);
 *   - `SessionVerificationError`  → the request never settled (retry, do not sign out);
 *   - `ProfileUnavailableError`   → valid session, unreadable profile (retry).
 */
export async function getCurrentUser(): Promise<Profile | null> {
  if (isSupabaseConfigured && supabase) {
    // Local session read first: an unauthorised visitor must not cost a network
    // round-trip, and its absence is a definitive "signed out".
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      if (isUnsettledError(sessionError)) throw new SessionVerificationError(sessionError);
      return null;
    }
    if (!sessionData.session) return null;

    let userId: string | null = null;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) {
        if (isUnsettledError(error)) throw new SessionVerificationError(error);
        if (isInvalidSessionError(error)) return null;
        throw error;
      }
      userId = data.user?.id ?? null;
    } catch (error) {
      if (error instanceof SessionVerificationError) throw error;
      if (isUnsettledError(error)) throw new SessionVerificationError(error);
      if (isInvalidSessionError(error)) return null;
      throw new SessionVerificationError(error);
    }

    if (!userId) return null;
    return getProfileWithRetry(userId);
  }

  if (!isDemoMode) return null;

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_current_user");
  return raw ? JSON.parse(raw) : null;
}

/**
 * The locally cached `profiles` row for the given id, if any.
 *
 * Used only to paint the authenticated shell immediately while the authoritative
 * read is in flight, so a slow or stalled connection cannot hold the whole
 * account area behind a spinner. It is display data for an already-signed-in
 * customer: every privileged read and write still travels to PostgREST with the
 * live JWT and is subject to RLS.
 */
export function readCachedProfile(userId: string): Profile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id?: string; profile?: Profile };
    if (!parsed || parsed.id !== userId || !parsed.profile) return null;
    return parsed.profile;
  } catch {
    return null;
  }
}

export function cacheProfile(profile: Profile | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!profile) {
      window.localStorage.removeItem(PROFILE_CACHE_KEY);
      return;
    }
    window.localStorage.setItem(
      PROFILE_CACHE_KEY,
      JSON.stringify({ id: profile.id, profile })
    );
  } catch {
    // Quota/private-mode failures must never break authentication.
  }
}

/**
 * The cached profile, but only when a local session exists *and* it belongs to
 * that same customer. A signed-out visitor therefore never gets an identity
 * painted from a stale cache entry.
 */
export async function readCachedSessionProfile(): Promise<Profile | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const id = data.session?.user?.id;
    return id ? readCachedProfile(id) : null;
  } catch {
    return null;
  }
}


export async function signIn(email: string, password?: string, role: UserRole = "customer"): Promise<Profile> {
  if (isSupabaseConfigured && supabase) {
    if (!password) throw new Error("Password is required for Supabase Auth");
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw new Error(error.message || "An error occurred.");
    if (!data.user) throw new Error("No user returned");

    return getProfileWithRetry(data.user.id);
  }

  if (!isDemoMode) throw new Error(productionConfigurationError);

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

    if (error) throw new Error(error.message || "An error occurred.");
    if (!data.user) throw new Error("SignUp failed");

    if (!data.session) throw new Error("Account created. Email confirmation is enabled in Supabase; disable it to allow immediate access.");
    return getProfileWithRetry(data.user.id);
  }

  if (!isDemoMode) throw new Error(productionConfigurationError);

  // Local Storage fallback for explicitly enabled demo mode only.
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
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }

  if (!isDemoMode) throw new Error(productionConfigurationError);
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

    if (error) throw new Error(error.message || "An error occurred.");
    return data;
  }

  if (!isDemoMode) throw new Error(productionConfigurationError);
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

    if (error) throw new Error(error.message || "An error occurred.");
    return data || [];
  }

  if (!isDemoMode) throw new Error(productionConfigurationError);
  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_profiles");
  return raw ? JSON.parse(raw) : [];
}
