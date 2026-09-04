"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { getMyAvatar, saveMyAvatar } from "../../services/db/avatar";
import {
  AvatarAttributes,
  avatarOptionGroups,
  defaultAvatarAttributes,
  normalizeAvatarAttributes,
} from "../../lib/avatar";
import { AvatarVisual } from "./AvatarVisual";
import { Check, Pencil, RefreshCw, Save, Sparkles, UserCircle } from "lucide-react";

const AVATAR_UPDATE_EVENT = "dlxstore-avatar-updated";

type AvatarGroupLabelKey =
  | "style"
  | "build"
  | "height"
  | "skinTone"
  | "hairStyle"
  | "hairColor"
  | "clothingSize"
  | "facePreset";

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

/** Localized label for a persisted attribute value (store values stay French canonical keys). */
function getOptionLabel(
  groupKey: keyof AvatarAttributes,
  option: string,
  optionLabels: Record<string, Record<string, string>>
): string {
  return optionLabels[groupKey]?.[option] ?? option;
}

export function AvatarEditor() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [attributes, setAttributes] = useState<AvatarAttributes>(defaultAvatarAttributes);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasExistingAvatar, setHasExistingAvatar] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const optionLabels = t.avatarOptionLabels as unknown as Record<string, Record<string, string>>;

  const translatedSummary = useMemo(
    () =>
      avatarOptionGroups
        .map((group) => getOptionLabel(group.key, attributes[group.key], optionLabels))
        .join(" · "),
    [attributes, optionLabels]
  );

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getMyAvatar(user.id)
      .then((avatar) => {
        if (avatar && avatar.attributes) {
          setAttributes(normalizeAvatarAttributes(avatar.attributes));
          setHasExistingAvatar(true);
          setIsEditing(false);
        } else {
          setHasExistingAvatar(false);
          setIsEditing(false);
        }
      })
      .catch((err) => {
        console.error("Error loading avatar:", err);
        setHasExistingAvatar(false);
        setIsEditing(true);
      })
      .finally(() => setLoading(false));
  }, [user]);

  const handleSelectOption = (key: keyof AvatarAttributes, value: string) => {
    setAttributes((current: AvatarAttributes) => ({ ...current, [key]: value }));
    setSuccessMessage("");
    setErrorMessage("");
  };

  const handleRandomize = () => {
    let next: AvatarAttributes = attributes;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate: AvatarAttributes = { ...defaultAvatarAttributes };
      avatarOptionGroups.forEach((group) => {
        candidate[group.key] = group.options[Math.floor(Math.random() * group.options.length)];
      });
      next = candidate;
      if (JSON.stringify(candidate) !== JSON.stringify(attributes)) break;
    }
    setAttributes(next);
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
      setHasExistingAvatar(true);
      setIsEditing(false);
      window.dispatchEvent(new Event(AVATAR_UPDATE_EVENT));
      window.setTimeout(() => setSuccessMessage(""), 4000);
    } catch (err) {
      console.error("Error saving avatar:", err);
      setErrorMessage(err instanceof Error ? err.message : t.avatarSaveError);
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

  const renderAvatarFrame = (box: string) => (
    <div className={`flex items-center justify-center rounded-[28px] border border-amber-400/20 bg-black/40 shadow-2xl ${box}`}>
      <AvatarVisual attributes={attributes} className="h-full w-full" />
    </div>
  );

  // ── EMPTY STATE: no avatar yet, not editing ──────────────────────────────
  if (!hasExistingAvatar && !isEditing) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/5 p-6 sm:p-8">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />
        <div className="flex flex-col items-center gap-5 py-4 text-center">
          {renderAvatarFrame("h-52 w-52 sm:h-56 sm:w-56")}
          <div className="max-w-sm space-y-1.5">
            <h3 className="text-lg font-extrabold tracking-tight text-foreground">{t.avatarCreateTitle}</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">{t.avatarCreateBody}</p>
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 px-7 text-sm font-bold text-black shadow-lg transition-all hover:from-amber-400 hover:to-amber-300"
          >
            <Sparkles className="h-4 w-4" />
            {t.avatarCreateCta}
          </button>
        </div>
      </div>
    );
  }

  // ── VIEW MODE: has avatar, not editing ──────────────────────────────────
  if (hasExistingAvatar && !isEditing) {
    return (
      <div className="space-y-6">
        {successMessage && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-600">
            <Check className="h-4 w-4 shrink-0" />
            {successMessage}
          </div>
        )}

        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-card via-card to-muted/30 p-6">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
            {renderAvatarFrame("h-44 w-44 shrink-0")}
            <div className="flex-1 space-y-2 text-center sm:text-left">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary/70">
                {t.avatarSettings}
              </p>
              <h3 className="text-xl font-extrabold tracking-tight text-foreground">
                {user?.full_name || t.avatarGuestName}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">{translatedSummary}</p>
              <button
                onClick={() => {
                  setIsEditing(true);
                  setSuccessMessage("");
                  setErrorMessage("");
                }}
                className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground shadow-sm transition-all hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" />
                {t.avatarEdit}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {avatarOptionGroups.map((group) => (
            <div key={group.key} className="rounded-xl border border-border/60 bg-card/60 px-3 py-2.5 text-center">
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                {t.avatarGroupLabels[groupLabelKeys[group.key]]}
              </p>
              <p className="mt-0.5 truncate text-xs font-semibold text-foreground">
                {getOptionLabel(group.key, attributes[group.key], optionLabels)}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }
// ── EDIT / CREATE MODE ────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/5 p-5">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <UserCircle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-foreground">
                {hasExistingAvatar ? t.avatarEditorTitle : t.avatarCreateTitle}
              </h3>
              <p className="text-xs text-muted-foreground">{t.avatarEditorBody}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRandomize}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-sm transition-all hover:bg-muted"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              {t.avatarRandom}
            </button>
            {hasExistingAvatar && (
              <button
                onClick={() => setIsEditing(false)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold shadow-sm transition-all hover:bg-muted"
              >
                {t.avatarCancel}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,320px)_1fr]">
        {/* Large live preview */}
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-border/60 bg-gradient-to-b from-[#1a1a29] to-[#0f0f1a] p-6 shadow-inner">
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">
            {t.avatarPreview}
          </span>
          <div className="relative flex aspect-square w-full max-w-[260px] items-center justify-center rounded-[28px] border border-amber-400/25 bg-black/50 shadow-2xl">
            <AvatarVisual attributes={attributes} className="h-full w-full" />
            <span className="absolute left-2 top-2 h-4 w-4 rounded-tl-md border-l-2 border-t-2 border-amber-400/70" />
            <span className="absolute right-2 top-2 h-4 w-4 rounded-tr-md border-r-2 border-t-2 border-amber-400/70" />
            <span className="absolute bottom-2 left-2 h-4 w-4 rounded-bl-md border-b-2 border-l-2 border-amber-400/70" />
            <span className="absolute bottom-2 right-2 h-4 w-4 rounded-br-md border-b-2 border-r-2 border-amber-400/70" />
          </div>
          <p className="text-sm font-bold text-foreground">{user?.full_name || t.avatarGuestName}</p>
          <p className="min-h-[3rem] text-center text-[11px] leading-relaxed text-muted-foreground">
            {translatedSummary}
          </p>
        </div>
{/* Attribute controls */}
        <div className="space-y-5">
          {avatarOptionGroups.map((group) => (
            <fieldset key={group.key}>
              <legend className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t.avatarGroupLabels[groupLabelKeys[group.key]]}
              </legend>
              <div className="flex flex-wrap gap-2">
                {group.options.map((option) => {
                  const selected = attributes[group.key] === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handleSelectOption(group.key, option)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                        selected
                          ? "border-amber-400/70 bg-amber-500/15 text-foreground shadow-sm ring-1 ring-amber-400/40"
                          : "border-border/70 bg-card text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      {selected && <Check className="h-3 w-3 text-amber-400" />}
                      {getOptionLabel(group.key, option, optionLabels)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}

          {successMessage && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-600">
              <Check className="h-4 w-4 shrink-0" />
              {successMessage}
            </div>
          )}
          {errorMessage && (
            <p className="rounded-xl bg-destructive/10 px-4 py-2.5 text-xs font-semibold text-destructive">
              {errorMessage}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-amber-500 to-amber-400 px-7 text-sm font-bold text-black shadow-lg transition-all hover:from-amber-400 hover:to-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? t.avatarSaving : t.avatarSave}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}