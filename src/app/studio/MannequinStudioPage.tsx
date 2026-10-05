"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, LockKeyhole } from "lucide-react";
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
    if (!user) return;
    let cancelled = false;

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

  if (authLoading || (user && loading)) {
    return (
      <main className="flex min-h-[100dvh] w-full items-center justify-center bg-[#050506]">
        <Loader2 className="h-6 w-6 animate-spin text-[#d4af37]" />
      </main>
    );
  }

  if (!user) {
    return (
      <main className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center gap-4 overflow-hidden bg-[#050506] px-4 text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 40%, rgba(212,175,55,0.16), rgba(5,5,6,0) 62%)",
          }}
        />
        <LockKeyhole className="h-8 w-8 text-[#d4af37]" />
        <h1 className="relative text-xl font-semibold text-white">Votre mannequin vous attend</h1>
        <p className="relative max-w-sm text-sm text-white/55">
          Connectez-vous pour créer votre mannequin DLXSTORE et essayer vos
          articles.
        </p>
        <Link
          href="/auth"
          className="relative inline-flex min-h-11 items-center rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-5 py-2 text-sm font-semibold text-black"
        >
          Se connecter
        </Link>
      </main>
    );
  }

  // The studio is a full-bleed environment: the character owns the viewport and
  // the component supplies its own header, so this shell adds no chrome of its own.
  return <MannequinStudio user={user} avatar={avatar} initialProductId={productParam} />;
}
