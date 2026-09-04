"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User } from "lucide-react";
import { Profile, AvatarAttributes } from "../../types";
import { getMyAvatar } from "../../services/db/avatar";
import { useLanguage } from "../../context/LanguageContext";
import { AvatarVisual } from "./AvatarVisual";

const AVATAR_UPDATE_EVENT = "dlxstore-avatar-updated";

/**
 * Persistent avatar badge: renders the customer's actual saved DLX avatar
 * (the layered SVG character) wherever it is placed — the site header, chat
 * launchers, etc. Falls back to the profile's initial letter when no avatar
 * has been configured yet.
 */
export function AvatarBadge({
  user,
  className = "h-8 w-8",
}: {
  user: Profile | null;
  className?: string;
}) {
  const { t } = useLanguage();
  const [attributes, setAttributes] = useState<AvatarAttributes | null>(null);

  const reload = () => {
    if (!user) {
      setAttributes(null);
      return;
    }
    getMyAvatar(user.id)
      .then((avatar) => {
        setAttributes(avatar?.attributes ?? null);
      })
      .catch((err) => {
        console.error("Error loading avatar badge:", err);
        setAttributes(null);
      });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
    window.addEventListener(AVATAR_UPDATE_EVENT, reload);
    window.addEventListener("storage", reload);
    return () => {
      window.removeEventListener(AVATAR_UPDATE_EVENT, reload);
      window.removeEventListener("storage", reload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const badge = !attributes ? (
    <div
      className={`flex items-center justify-center rounded-full bg-secondary font-semibold text-sm text-secondary-foreground ${className}`}
      title={user?.full_name ?? ""}
    >
      {user?.full_name ? user.full_name.charAt(0).toUpperCase() : <User className="h-4 w-4" />}
    </div>
  ) : (
    <div
      className={`relative overflow-hidden rounded-full shadow-md ring-1 ring-black/10 ${className}`}
      title={user?.full_name ?? t.avatarSettings}
    >
      <AvatarVisual attributes={attributes} className="h-full w-full" showBackdrop={false} />
    </div>
  );

  if (user) {
    return (
      <Link
        href="/dashboard?tab=avatar"
        title={t.avatarSettings}
        className="block shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      >
        {badge}
      </Link>
    );
  }

  return badge;
}