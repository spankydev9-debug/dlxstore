"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Profile, UserRole } from "../types";
import {
  getCurrentUser,
  signIn as authSignIn,
  signUp as authSignUp,
  signOut as authSignOut,
  cacheProfile,
  readCachedSessionProfile,
} from "../services/auth";
import { isSupabaseConfigured, supabase } from "../services/db";
import {
  ProfileUnavailableError,
  SessionVerificationError,
  authFailureMessage,
  type AuthFailureKind,
} from "../lib/auth-errors";

/**
 * A failure the customer can act on. `null` means "no problem"; a *signed-out*
 * visitor is not a failure either.
 */
export type AuthFailure = { kind: AuthFailureKind; message: string } | null;

type AuthContextType = {
  user: Profile | null;
  isLoading: boolean;
  authError: AuthFailure;
  signIn: (email: string, password?: string, role?: UserRole) => Promise<Profile>;
  signUp: (email: string, fullName: string, phone: string, password?: string) => Promise<Profile>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
  retryAuth: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<AuthFailure>(null);

  const refreshUser = useCallback(async () => {
    try {
      const u = await getCurrentUser();
      setUser(u);
      setAuthError(null);
      cacheProfile(u);
    } catch (err) {
      if (err instanceof SessionVerificationError || err instanceof ProfileUnavailableError) {
        // We could not reach a verdict, or the row is not readable yet. Keep the
        // identity we already have (which may be the cached one) and surface a
        // retry instead of silently turning this into a sign-out.
        console.warn("[AUTH] Could not resolve the session:", err.kind, err.message);
        setAuthError({ kind: err.kind, message: authFailureMessage(err.kind) });
      } else {
        console.error("Error refreshing auth user:", err);
        setUser(null);
        setAuthError(null);
        cacheProfile(null);
      }
    } finally {
      // Always reach a decision: no consumer may be left in a loading state.
      setIsLoading(false);
    }
  }, []);

  const retryAuth = useCallback(async () => {
    setIsLoading(true);
    await refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    let cancelled = false;

    // Paint the authenticated shell from the last known profile as soon as we
    // know a local session exists, then reconcile with the server. A stalled
    // request therefore cannot hold the account area behind a spinner.
    const bootstrap = async () => {
      const cached = await readCachedSessionProfile();
      if (!cancelled && cached) {
        setUser(cached);
        setIsLoading(false);
      }
      if (!cancelled) await refreshUser();
    };
    void bootstrap();

    // Re-check auth state on localStorage changes (crucial for mock db fallback syncing)
    const handleStorageChange = () => {
      void refreshUser();
    };

    window.addEventListener("storage", handleStorageChange);
    const subscription = isSupabaseConfigured && supabase
      ? supabase.auth.onAuthStateChange(() => { void refreshUser(); }).data.subscription
      : undefined;
    return () => {
      cancelled = true;
      window.removeEventListener("storage", handleStorageChange);
      subscription?.unsubscribe();
    };
  }, [refreshUser]);

  const signIn = async (email: string, password?: string, role: UserRole = "customer") => {
    setIsLoading(true);
    try {
      const profile = await authSignIn(email, password, role);
      setUser(profile);
      setAuthError(null);
      cacheProfile(profile);
      return profile;
    } catch (err) {
      setIsLoading(false);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, fullName: string, phone: string, password?: string) => {
    setIsLoading(true);
    try {
      const profile = await authSignUp(email, fullName, phone, password);
      setUser(profile);
      setAuthError(null);
      cacheProfile(profile);
      return profile;
    } catch (err) {
      setIsLoading(false);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    setIsLoading(true);
    try {
      await authSignOut();
      setUser(null);
      setAuthError(null);
      cacheProfile(null);
    } catch (err) {
      console.error("Error during signOut:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, authError, signIn, signUp, signOut, refreshUser, retryAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
