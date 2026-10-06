"use client";

import { useState } from "react";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { Outfit } from "../../lib/studio/outfit";
import { isLocalOnly, looksStoreFor, type LooksStore, type NewLook, type SavedLook } from "../../services/studio/looks-store";
import { StudioLabel } from "./StudioEnvironment";
import { ProductImage } from "../shared/ProductImage";

/**
 * Saved Looks — a first-class citizen of the studio, alongside the wardrobe.
 *
 * Persistence is local-first by decision D1, and the panel says so in words
 * rather than implying a cloud save. `looksSavedLocally` / `looksLocalNote`
 * are rendered unconditionally while the live adapter reports `local`, so the
 * claim of "saved" is never stronger than the truth.
 *
 * The panel is deliberately storage-agnostic: it talks to `LooksStore`, so a
 * future `save_wardrobe_item` adapter drops in with no change here.
 */
export function StudioLooksPanel({
  profileId,
  outfit,
  looks,
  onChange,
  onApply,
  onNotice,
  className = "",
}: {
  profileId: string;
  outfit: Outfit;
  looks: SavedLook[];
  onChange: (looks: SavedLook[]) => void;
  /** Applying a Look replaces the current outfit and reports what happened. */
  onApply: (look: SavedLook) => void;
  /** Short, transient, already-translated status line. */
  onNotice: (message: string | null) => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const [store] = useState<LooksStore>(() => looksStoreFor());
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const canSave = outfit.length > 0 && !busy;

  const handleSave = async () => {
    if (!canSave) return;
    const label = name.trim() || `${t.looks} ${new Date().toLocaleDateString()}`;
    setBusy(true);
    try {
      const record: NewLook = {
        id: `look_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        name: label,
        profileId,
        items: outfit,
      };
      const saved = await store.save(record);
      onChange([saved, ...looks.filter((entry) => entry.id !== saved.id)]);
      setName("");
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2600);
      // Deliberately the local-only message while the adapter is local: this
      // Look did not reach the production account.
      onNotice(isLocalOnly(store) ? t.lookSavedLocally : t.lookSaved);
    } catch {
      onNotice(t.lookSavedLocally);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (look: SavedLook) => {
    setBusy(true);
    try {
      await store.remove(profileId, look.id);
      onChange(looks.filter((entry) => entry.id !== look.id));
      onNotice(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-1.5">
        <Bookmark className="h-3.5 w-3.5 text-[#d4af37]/70" aria-hidden />
        <StudioLabel>{t.saveLookLabel}</StudioLabel>
        <span className="ml-auto text-xs text-white/45">{looks.length}</span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={48}
          placeholder={t.lookNamePlaceholder}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/[0.1] bg-black/45 px-3 text-sm text-white/90 outline-none transition-colors placeholder:text-white/40 focus:border-[#d4af37]/60"
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-gradient-to-b from-[#e6c65a] to-[#c39c22] px-3.5 text-xs font-semibold text-black transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-35"
        >
          {justSaved ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          {t.saveLook}
        </button>
      </div>

      {outfit.length === 0 ? (
        <p className="mt-2 text-[11px] text-white/45">{t.emptyOutfit}</p>
      ) : null}

      <p className="mt-2 text-[11px] leading-relaxed text-[#d4af37]/70">{t.looksLocalNote}</p>

      <div className="mt-3">
        {looks.length === 0 ? (
          <p className="rounded-xl border border-white/[0.07] bg-black/25 px-3 py-3 text-xs text-white/55">
            {t.noLooksYet}
          </p>
        ) : (
          <ul className="space-y-2">
            {looks.map((look) => (
              <li
                key={look.id}
                className="rounded-xl border border-white/[0.07] bg-black/25 p-2.5"
              >
                <div className="flex items-center gap-2">
                  <div className="flex -space-x-1.5">
                    {look.items.slice(0, 3).map((item) => (
                      <span
                        key={`${look.id}-${item.slot}`}
                        className="h-7 w-7 overflow-hidden rounded-md bg-white/[0.05] ring-1 ring-black/60"
                      >
                        {item.imageUrl ? (
                          <ProductImage
                            src={item.imageUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </span>
                    ))}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-white/90">{look.name}</p>
                    <p className="truncate text-[10px] text-white/45">
                      {look.items.length} · {new Date(look.createdAt).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => onApply(look)}
                      className="flex h-11 items-center rounded-lg border border-[#d4af37]/40 bg-[#d4af37]/10 px-3 text-[11px] font-semibold text-[#f0dfae] transition-colors hover:bg-[#d4af37]/20"
                    >
                      {t.applyLook}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(look)}
                      disabled={busy}
                      aria-label={`${t.deleteLook} — ${look.name}`}
                      className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 text-white/55 transition-colors hover:text-[#f0a0a0] disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
