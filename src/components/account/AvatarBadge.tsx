"use client";

import { useEffect, useState } from "react";
import { User } from "lucide-react";
import { Profile, AvatarAttributes } from "../../types";
import { getMyAvatar } from "../../services/db/avatar";
import { getAvatarFaceEmoji, getAvatarPreview } from "../../lib/avatar";

const AVATAR_UPDATE_EVENT = "dlxstore-avatar-updated";

/**
 * Persistent avatar badge: renders the customer's saved DLX avatar (face emoji
 * on their skin-tone swatch, with a hair-style sticker) wherever it is placed —
 * the site header, chat launchers, etc. Falls back to the profile's initial
 * letter when no avatar has been configured yet.
 */
export function AvatarBadge({
  user,
  className = "h-8 w-8",
  emojiClassName = "text-base",
}: {
  user: Profile | null;
  className?: string;
  emojiClassName?: string;
}) {
  const [attributes, setAttributes] = useState<AvatarAttributes | null>(null);

  const reload = () => {
    if (!user) {
      setAttributes(null);
      return;
    }
    getMyAvatar(user.id)
      .then((avatar) => {
        if (avatar?.attributes) {
          setAttributes(avatar.attributes);
        } else {
          setAttributes(null);
        }
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

  if (!attributes) {
    return (
      <div className={`flex items-center justify-center rounded-full bg-secondary text-secondary-foreground font-semibold text-sm ${className}`}>
        {user?.full_name ? (
          user.full_name.charAt(0).toUpperCase()
        ) : (
          <User className="h-4 w-4" />
        )}
      </div>
    );
  }

  const preview = getAvatarPreview(attributes);
  const faceEmoji = getAvatarFaceEmoji(attributes);

  return (
    <div className={`relative flex items-center justify-center rounded-full shadow-md transition-colors duration-300 ${preview.swatch} ${className}`} title={`${user?.full_name ?? ""}`}>
      <span className={`select-none leading-none ${emojiClassName}`}>{faceEmoji}</span>
      {/* Floating hairstyle sticker */}
      <span
        className={`absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border bg-card shadow-sm ${preview.hairSwatch}`}
      >
        <span className="select-none text-[8px] leading-none">{preview.emoji}</span>
      </span>
    </div>
  );
}