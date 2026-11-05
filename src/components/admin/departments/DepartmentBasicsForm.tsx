"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, Save, Sparkles } from "lucide-react";
import type { Department } from "../../../services/db/departments";
import { updateDepartment, type DepartmentInput } from "../../../services/db/departments";
import { uploadProductImage } from "../../../services/db/storage";
import type { PartnerShop } from "../../../types";

/**
 * Content, theme and SEO for one department.
 *
 * Every field here maps to a column, and every column is applied by the
 * renderer — there is no field in this form that only writes a settings record.
 * `metadata.canonical_path` is singled out because it changes the public URL,
 * so the UI labels it as routing rather than decoration.
 */

const ICON_CHOICES = ["shop", "store", "utensils", "zap", "sparkles"] as const;
const COLOR_PRESETS = [
  { label: "Nuit", from: "#0f172a", to: "#334155" },
  { label: "Food", from: "#f97316", to: "#e11d48" },
  { label: "Énergie", from: "#059669", to: "#0f766e" },
  { label: "Océan", from: "#1d4ed8", to: "#1e3a8a" },
  { label: "Or", from: "#d97706", to: "#b45309" },
  { label: "Prune", from: "#7c3aed", to: "#4c1d95" },
];

const fieldClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function canonicalPath(department: Department): string {
  const value = department.metadata?.canonical_path;
  return typeof value === "string" ? value : "";
}

export default function DepartmentBasicsForm({
  department,
  canManageStructure,
  shops,
  onSaved,
}: {
  department: Department;
  /** False for a partner: platform-owned fields are shown read-only. */
  canManageStructure: boolean;
  shops: PartnerShop[];
  onSaved: (next: Department) => void;
}) {
  const [form, setForm] = useState({
    name: department.name,
    tagline: department.tagline ?? "",
    description: department.description ?? "",
    hero_image_url: department.hero_image_url ?? "",
    icon: department.icon ?? "sparkles",
    accent_from: department.accent_from ?? "#0f172a",
    accent_to: department.accent_to ?? "#334155",
    accent_color: department.accent_color ?? "#0f172a",
    seo_title: department.seo_title ?? "",
    seo_description: department.seo_description ?? "",
    canonical_path: canonicalPath(department),
    slug: department.slug,
    sort_order: department.sort_order,
    is_active: department.is_active,
    show_in_navigation: department.show_in_navigation,
    owner_vendor_id: department.owner_vendor_id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // A different department selected in the console must not show stale fields.
  useEffect(() => {
    setForm({
      name: department.name,
      tagline: department.tagline ?? "",
      description: department.description ?? "",
      hero_image_url: department.hero_image_url ?? "",
      icon: department.icon ?? "sparkles",
      accent_from: department.accent_from ?? "#0f172a",
      accent_to: department.accent_to ?? "#334155",
      accent_color: department.accent_color ?? "#0f172a",
      seo_title: department.seo_title ?? "",
      seo_description: department.seo_description ?? "",
      canonical_path: canonicalPath(department),
      slug: department.slug,
      sort_order: department.sort_order,
      is_active: department.is_active,
      show_in_navigation: department.show_in_navigation,
      owner_vendor_id: department.owner_vendor_id ?? "",
    });
    setNotice("");
    setError("");
  }, [department]);

  const previewStyle = useMemo(
    () => ({
      backgroundImage: `linear-gradient(135deg, ${form.accent_from} 0%, ${form.accent_to} 100%)`,
    }),
    [form.accent_from, form.accent_to]
  );

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const url = await uploadProductImage(file);
      update("hero_image_url", url);
      setNotice("Image téléversée — enregistrez pour publier.");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Téléversement impossible.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const metadata = { ...department.metadata };
      const path = form.canonical_path.trim();
      if (path) metadata.canonical_path = path.startsWith("/") ? path : `/${path}`;
      else delete metadata.canonical_path;

      const patch: Partial<DepartmentInput> = {
        name: form.name.trim(),
        tagline: form.tagline.trim() || null,
        description: form.description.trim() || null,
        hero_image_url: form.hero_image_url.trim() || null,
        icon: form.icon || null,
        accent_from: form.accent_from,
        accent_to: form.accent_to,
        accent_color: form.accent_color,
        seo_title: form.seo_title.trim() || null,
        seo_description: form.seo_description.trim() || null,
        metadata,
      };

      // Platform-owned fields are only sent when the caller may change them.
      // A partner never sees the inputs, and `protect_department_columns()`
      // would clamp them at the database anyway.
      if (canManageStructure) {
        patch.slug = form.slug.trim();
        patch.sort_order = Number(form.sort_order) || 0;
        patch.is_active = form.is_active;
        patch.show_in_navigation = form.show_in_navigation;
        patch.owner_vendor_id = form.owner_vendor_id || null;
      }

      const next = await updateDepartment(department.id, patch);
      onSaved(next);
      setNotice("Département enregistré. La vitrine est à jour au prochain chargement.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Hero preview is the same gradient the storefront renders. */}
      <div className="relative overflow-hidden rounded-2xl px-5 py-6 text-white" style={previewStyle}>
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative space-y-1">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/15 px-2.5 py-1 text-[11px] font-bold">
            <Sparkles className="h-3 w-3" aria-hidden />
            {form.name || "Nouveau département"}
          </span>
          <p className="text-lg font-extrabold">{form.tagline || "Sous-titre du département"}</p>
          <p className="max-w-xl text-xs text-white/85">
            {form.description || "Description affichée dans le bloc d'identité."}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="dept-name">Nom</label>
          <input
            id="dept-name"
            className={fieldClass}
            value={form.name}
            onChange={(event) => update("name", event.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="dept-tagline">Sous-titre (hero)</label>
          <input
            id="dept-tagline"
            className={fieldClass}
            value={form.tagline}
            onChange={(event) => update("tagline", event.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="dept-description">Description</label>
          <textarea
            id="dept-description"
            rows={3}
            className={fieldClass}
            value={form.description}
            onChange={(event) => update("description", event.target.value)}
          />
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className={labelClass}>Identité visuelle</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="dept-icon">Icône</label>
            <select
              id="dept-icon"
              className={fieldClass}
              value={form.icon}
              onChange={(event) => update("icon", event.target.value)}
            >
              {ICON_CHOICES.map((icon) => (
                <option key={icon} value={icon}>{icon}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="dept-hero">Image du hero</label>
            <div className="flex gap-2">
              <input
                id="dept-hero"
                className={fieldClass}
                value={form.hero_image_url}
                onChange={(event) => update("hero_image_url", event.target.value)}
                placeholder="URL de l'image"
              />
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted">
                {uploading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                )}
                <span className="sr-only">Téléverser une image</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImage} />
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                update("accent_from", preset.from);
                update("accent_to", preset.to);
                update("accent_color", preset.from);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition hover:border-foreground/40"
            >
              <span
                className="h-4 w-4 rounded-full"
                style={{ backgroundImage: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}
                aria-hidden
              />
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["accent_from", "Dégradé — début"],
            ["accent_to", "Dégradé — fin"],
            ["accent_color", "Couleur d'accent"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className={labelClass} htmlFor={`dept-${key}`}>{label}</label>
              <div className="flex items-center gap-2">
                <input
                  id={`dept-${key}`}
                  type="color"
                  value={form[key]}
                  onChange={(event) => update(key, event.target.value)}
                  className="h-9 w-10 cursor-pointer rounded-lg border border-border bg-background"
                  aria-label={label}
                />
                <input
                  className={fieldClass}
                  value={form[key]}
                  onChange={(event) => update(key, event.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className={labelClass}>Référencement</legend>
        <div>
          <label className={labelClass} htmlFor="dept-seo-title">Titre SEO</label>
          <input
            id="dept-seo-title"
            className={fieldClass}
            value={form.seo_title}
            onChange={(event) => update("seo_title", event.target.value)}
            placeholder={`${form.name || "Département"} | DLXSTORE`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="dept-seo-desc">Description SEO</label>
          <textarea
            id="dept-seo-desc"
            rows={2}
            className={fieldClass}
            value={form.seo_description}
            onChange={(event) => update("seo_description", event.target.value)}
          />
        </div>
        {canManageStructure && (
          <div>
            <label className={labelClass} htmlFor="dept-canonical">URL publique (canonique)</label>
            <input
              id="dept-canonical"
              className={fieldClass}
              value={form.canonical_path}
              onChange={(event) => update("canonical_path", event.target.value)}
              placeholder={`/d/${form.slug}`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Laisser vide pour utiliser <code>/d/{form.slug}</code>. Une valeur comme{" "}
              <code>/energy</code> sert la vitrine à cette adresse et pointe le canonical dessus.
            </p>
          </div>
        )}
      </fieldset>

      {canManageStructure && (
        <fieldset className="space-y-3 rounded-2xl border border-border/60 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Plateforme
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="dept-slug">Slug</label>
              <input
                id="dept-slug"
                className={fieldClass}
                value={form.slug}
                onChange={(event) => update("slug", event.target.value)}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="dept-order">Ordre</label>
              <input
                id="dept-order"
                type="number"
                className={fieldClass}
                value={form.sort_order}
                onChange={(event) => update("sort_order", Number(event.target.value))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass} htmlFor="dept-owner">Boutique partenaire propriétaire</label>
              <select
                id="dept-owner"
                className={fieldClass}
                value={form.owner_vendor_id}
                onChange={(event) => update("owner_vendor_id", event.target.value)}
              >
                <option value="">DLXSTORE (plateforme)</option>
                {shops.map((shop) => (
                  <option key={shop.id} value={shop.id}>
                    {shop.display_name ?? shop.shop_name ?? shop.business_name} — {shop.status}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                Un propriétaire peut modifier le contenu de cette vitrine, ses blocs, sa
                navigation, ses produits et ses vendeurs. Il ne peut pas changer le slug, l&apos;URL,
                l&apos;ordre, la visibilité ni le propriétaire.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) => update("is_active", event.target.checked)}
              />
              Visible dans la boutique
            </label>
            <label className="inline-flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.show_in_navigation}
                onChange={(event) => update("show_in_navigation", event.target.checked)}
              />
              Afficher dans la navigation du site
            </label>
          </div>
        </fieldset>
      )}

      {notice && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          Enregistrer le contenu
        </button>
      </div>
    </form>
  );
}
