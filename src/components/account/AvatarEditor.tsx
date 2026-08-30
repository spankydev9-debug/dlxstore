"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { getMyAvatar, saveMyAvatar } from "../../services/db/avatar";
import {
  AvatarAttributes,
  avatarOptionGroups,
  defaultAvatarAttributes,
  getAvatarFaceEmoji,
  getAvatarPreview,
  summarizeAvatarAttributes,
} from "../../lib/avatar";
import { Sparkles, Save, RefreshCw } from "lucide-react";

type AvatarGroupLabelKey =
  | "style"
  | "build"
  | "height"
  | "skinTone"
  | "hairStyle"
  | "hairColor"
  | "clothingSize"
  | "facePreset";

// Avatar option-group keys -> i18n label keys
const groupLabelKeys: Record<keyof AvatarAttributes, AvatarGroupLabelKey> = {
  presentation: "style",
  build: "build",
  height: "height",
  skinTone: "skinTone",
  hairStyle: "hairStyle",
  hairColor: "hairColor",
  clothingSize: "clothingSize",
  facePreset: "facePreset",
};

export function AvatarEditor() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [attributes, setAttributes] = useState<AvatarAttributes>(defaultAvatarAttributes);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getMyAvatar(user.id)
      .then((avatar) => {
        if (avatar && avatar.attributes) {
          setAttributes(avatar.attributes);
        }
      })
      .catch((err) => {
        console.error("Error loading avatar:", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [user]);

  const handleSelectOption = (key: keyof AvatarAttributes, value: string) => {
    setAttributes((current: AvatarAttributes) => ({
      ...current,
      [key]: value,
    }));
    setSuccessMessage("");
    setErrorMessage("");
  };

  const handleRandomize = () => {
    const randomAttributes = { ...defaultAvatarAttributes };
    avatarOptionGroups.forEach((group) => {
      const randomIndex = Math.floor(Math.random() * group.options.length);
      randomAttributes[group.key] = group.options[randomIndex] as any;
    });
    setAttributes(randomAttributes);
    setSuccessMessage("");
    setErrorMessage("");
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setSuccessMessage("");
    setErrorMessage("");
    try {
      await saveMyAvatar(user.id, attributes);
      setSuccessMessage(t.avatarSaved);
      window.dispatchEvent(new Event("dlxstore-avatar-updated"));
      setTimeout(() => setSuccessMessage(""), 4000);
    } catch (err) {
      console.error("Error saving avatar:", err);
      setErrorMessage(
        err instanceof Error ? err.message : t.avatarSaveError
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  const preview = getAvatarPreview(attributes);
  const faceEmoji = getAvatarFaceEmoji(attributes);
  const summary = summarizeAvatarAttributes(attributes);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <h3 className="text-lg font-bold text-foreground">{t.avatarEditorTitle}</h3>
        <button
          onClick={handleRandomize}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-all"
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          {t.avatarRandom}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr]">
        {/* Preview Panel */}
        <div className="flex flex-col items-center space-y-4 rounded-2xl border border-border bg-muted/20 p-4 text-center">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t.avatarPreview}
          </span>

          {/* Avatar representation using swatch & faceEmoji */}
          <div className="relative">
            {/* Skin tone base circle */}
            <div
              className={`flex h-28 w-28 items-center justify-center rounded-full shadow-md transition-colors duration-300 ${preview.swatch}`}
            >
              {/* Primary expression emoji */}
              <span className="select-none text-6xl leading-none">{faceEmoji}</span>
            </div>

            {/* Floating hairstyle preview sticker */}
            <div
              className={`absolute -right-1 -top-1 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card shadow-sm ${preview.hairSwatch}`}
              title={`${t.avatarGroupLabels.hairStyle}: ${attributes.hairStyle}`}
            >
              <span className="select-none text-lg leading-none">{preview.emoji}</span>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-bold text-foreground">
              {user?.full_name || t.avatarGuestName}
            </p>
            <p className="max-w-[150px] text-[10px] text-muted-foreground leading-normal">
              {summary}
            </p>
          </div>
        </div>

        {/* Options Panel */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {avatarOptionGroups.map((group) => (
              <div key={group.key} className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t.avatarGroupLabels[groupLabelKeys[group.key]] ?? group.label}
                </label>
                <select
                  value={attributes[group.key]}
                  onChange={(e) => handleSelectOption(group.key, e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                >
                  {group.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {successMessage && (
            <p className="rounded-xl bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-600">
              {successMessage}
            </p>
          )}

          {errorMessage && (
            <p className="rounded-xl bg-destructive/10 px-4 py-2.5 text-xs font-semibold text-destructive">
              {errorMessage}
            </p>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-primary px-6 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition-all shadow-md disabled:opacity-50"
            >
              {saving ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? t.avatarSaving : t.avatarSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}