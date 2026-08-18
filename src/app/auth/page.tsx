"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { isDemoMode, isSupabaseConfigured } from "../../services/db/index";
import { useLanguage } from "../../context/LanguageContext";
import { ShieldCheck, Mail, Lock, User, Phone, LogIn, UserPlus } from "lucide-react";

function AuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, signUp, user } = useAuth();
  const { t } = useLanguage();

  const modeParam = searchParams.get("mode") || "login";
  const next = searchParams.get("next");
  // Derive isLogin directly from URL — no need for useEffect sync
  const isLogin = modeParam === "login";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // If already logged in, redirect to dashboard
  useEffect(() => {
    if (user) {
      if (next?.startsWith("/") && !next.startsWith("//")) {
        router.replace(next);
      } else if (user.role === "admin") {
        router.push("/admin/dashboard");
      } else {
        router.push("/dashboard");
      }
    }
  }, [user, router, next]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (isLogin) {
        // SignIn
        await signIn(email, password);
      } else {
        // SignUp
        await signUp(email, fullName, phone, password);
      }
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : t.authError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoLogin = async (role: "customer" | "admin") => {
    setError("");
    setIsLoading(true);
    try {
      if (role === "admin") {
        await signIn("admin@dlxstore.cd", "admin1234", "admin");
        router.push("/admin/dashboard");
      } else {
        await signIn("jean.paul@gmail.com", "customer1234", "customer");
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.demoLoginError);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-12 px-4 animate-fade-in space-y-6">
      
      {/* Brand / Title */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight">DLXSTORE</h1>
        <p className="text-xs sm:text-sm text-muted-foreground">
          {isLogin ? t.authLoginBody : t.authRegisterBody}
        </p>
      </div>

      {/* Main card */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive font-semibold">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Full Name (Sign Up only) */}
          {!isLogin && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <User className="h-4 w-4" />
                {t.fullName}
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ex. Sarah Muhindo"
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
            </div>
          )}

          {/* Email */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-4 w-4" />
              {t.emailAddress}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ex. sarah@gmail.com"
              className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
            />
          </div>

          {/* Phone (Sign Up only) */}
          {!isLogin && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Phone className="h-4 w-4" />
                {t.phone}
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ex. +243 990 123 456"
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
            </div>
          )}

          <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Lock className="h-4 w-4" />
                {t.password}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.securePassword}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/95 transition-all disabled:opacity-50"
          >
            {isLogin ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {isLoading ? t.loading : isLogin ? t.signIn : t.createAccount}
          </button>
        </form>

        {/* Toggle Mode Link */}
        <div className="text-center pt-2">
          <button
            onClick={() => {
              router.push(`/auth?mode=${isLogin ? "register" : "login"}`);
              setError("");
            }}
            className="text-xs font-semibold text-primary hover:underline"
          >
            {isLogin ? t.createCustomerAccount : t.alreadyRegistered}
          </button>
        </div>
      </div>

      {/* Demo Fast Login (Especially useful for mock DB review) */}
      {isDemoMode && !isSupabaseConfigured && (
        <div className="rounded-2xl border border-dashed border-border p-5 bg-card space-y-4">
          <div className="text-center space-y-1">
            <h4 className="font-bold text-xs text-foreground uppercase tracking-wider">Comptes de Démonstration (Mock DB)</h4>
            <p className="text-[10px] text-muted-foreground">Testez l'application sans base de données active en un clic.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => handleDemoLogin("customer")}
              className="flex flex-col items-center justify-center p-3 rounded-xl border border-border hover:bg-muted text-center space-y-1 transition-all"
            >
              <span className="font-bold text-xs text-foreground">Client Démo</span>
              <span className="text-[10px] text-muted-foreground">jean.paul@gmail.com</span>
            </button>
            <button
              onClick={() => handleDemoLogin("admin")}
              className="flex flex-col items-center justify-center p-3 rounded-xl border border-border hover:bg-muted text-center space-y-1 transition-all"
            >
              <span className="font-bold text-xs text-primary">Administrateur</span>
              <span className="text-[10px] text-muted-foreground">admin@dlxstore.cd</span>
            </button>
          </div>
        </div>
      )}

      {/* RLS/Safety Assurance */}
      <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-emerald-500" />
        <span>Données sécurisées via Row Level Security (RLS)</span>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">Chargement...</p>
      </div>
    }>
      <AuthContent />
    </Suspense>
  );
}
