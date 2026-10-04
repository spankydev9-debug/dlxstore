"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, LockKeyhole, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { getMyAvatar } from "../../services/db/avatar";
import { MannequinStudio } from "../../components/studio/MannequinStudio";
import type { CustomerAvatar } from "../../types";

/**
 * Client shell for `/studio`.
 *
 * The mannequin workspace needs the caller's persisted Avatar, which is only
 * readable with the user's own session, so this is a client component rather
 * than a server-rendered page. It is marked no-index because it is personal.
 */
export default function MannequinStudioPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[60vh] w-full items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      }
    >
      <MannequinStudioRoute />
    </Suspense>
  );
}

function MannequinStudioRoute() {
  const searchParams = useSearchParams();
  const productParam = searchParams.get("product") ?? undefined;

  return <MannequinStudioShell productParam={productParam} />;
}

function MannequinStudioShell({ productParam }: { productParam?: string }) {
  const { user, isLoading: authLoading } = useAuth();
  const [avatar, setAvatar] = useState<CustomerAvatar | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const record = await getMyAvatar(user.id);
        if (!cancelled) setAvatar(record);
      } catch {
        if (!cancelled) setAvatar(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading || loading) {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-5xl items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-[60vh] w-full max-w-5xl flex-col items-center justify-center gap-4 px-4 text-center">
        <LockKeyhole className="h-8 w-8 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Votre mannequin vous attend</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Connectez-vous pour créer votre mannequin DLXSTORE et essayer vos
          articles.
        </p>
        <Link
          href="/auth"
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground"
        >
          Se connecter
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-6 space-y-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          DLX AI Product Studio
        </p>
        <h1 className="text-2xl font-bold sm:text-3xl">Mon mannequin</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Votre mannequin personnel. Choisissez un article, modelez-le sur votre
          avatar, et retrouvez tous vos essayages au même endroit.
        </p>
      </header>

      <MannequinStudio user={user} avatar={avatar} initialProductId={productParam} />
    </main>
  );
}
