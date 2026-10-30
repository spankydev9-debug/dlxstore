"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../context/AuthContext";
import { useLanguage } from "../../../context/LanguageContext";
import { SellerDashboard } from "../../../components/partner/SellerDashboard";

function SellerDashboardContent() {
  const { user, isLoading, authError, retryAuth } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  useEffect(() => {
    // Only a definitive "signed out" may redirect; an unverified session offers
    // a retry so a slow connection cannot look like a forced sign-out.
    if (!isLoading && !user && !authError) router.push("/auth?mode=login");
  }, [user, isLoading, authError, router]);

  if (authError && !user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4 px-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground" role="alert">
          {authError.kind === "session-unverified" ? t.sessionUnverified : t.profileUnavailable}
        </p>
        <button
          type="button"
          onClick={() => { void retryAuth(); }}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t.retry}
        </button>
      </div>
    );
  }

  // The seller dashboard is money. Rendering it for a signed-out visitor would
  // flash an empty console before the redirect lands, so wait for auth to settle.
  if (isLoading || !user) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <SellerDashboard />
    </main>
  );
}

export default function SellerDashboardRoute() {
  const { t } = useLanguage();
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{t.sellerDashboardTitle}</p>
      </div>
    }>
      <SellerDashboardContent />
    </Suspense>
  );
}
