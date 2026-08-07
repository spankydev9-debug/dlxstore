"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { Profile, UserRole } from "../types";
import { getCurrentUser, signIn as authSignIn, signUp as authSignUp, signOut as authSignOut } from "../services/auth";

type AuthContextType = {
  user: Profile | null;
  isLoading: boolean;
  signIn: (email: string, password?: string, role?: UserRole) => Promise<Profile>;
  signUp: (email: string, fullName: string, phone: string, password?: string) => Promise<Profile>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const u = await getCurrentUser();
      setUser(u);
    } catch (err) {
      console.error("Error refreshing auth user:", err);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();

    // Re-check auth state on localStorage changes (crucial for mock db fallback syncing)
    const handleStorageChange = () => {
      refreshUser();
    };

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const signIn = async (email: string, password?: string, role: UserRole = "customer") => {
    setIsLoading(true);
    try {
      const profile = await authSignIn(email, password, role);
      setUser(profile);
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
    } catch (err) {
      console.error("Error during signOut:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signUp, signOut, refreshUser }}>
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
