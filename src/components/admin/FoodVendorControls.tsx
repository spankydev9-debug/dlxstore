"use client";

import { FormEvent, useEffect, useState } from "react";
import { Check, Clock3, Pencil, Plus, Star, Tag, Trash2, UtensilsCrossed } from "lucide-react";
import { FoodVendor, FoodCategory } from "../../types";
import {
  getFoodVendors,
  createFoodVendor,
  deleteFoodVendor,
  updateFoodVendor,
  setFoodVendorStatus,
  getFoodCategories,
  createFoodCategory,
  updateFoodCategory,
  deleteFoodCategory,
} from "../../services/db/food";
import { DRC_PROVINCES } from "../../lib/drc-geography";

function slugify(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function FoodVendorControls() {
  const [vendors, setVendors] = useState<FoodVendor[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [bannerImageUrl, setBannerImageUrl] = useState("");
  const [is247, setIs247] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [minimumOrderAmount, setMinimumOrderAmount] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("");
  const [preparationTime, setPreparationTime] = useState("");
  const [categories, setCategories] = useState("");
  const [editing, setEditing] = useState<FoodVendor | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      setVendors(await getFoodVendors(true));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de charger les food vendors.");
    }
  };

  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setName("");
    setSlug("");
    setDescription("");
    setProvince("");
    setCity("");
    setPhone("");
    setEmail("");
    setImageUrl("");
    setBannerImageUrl("");
    setIs247(false);
    setIsFeatured(false);
    setMinimumOrderAmount("");
    setDeliveryFee("");
    setPreparationTime("");
    setCategories("");
    setEditing(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (!trimmedName || !trimmedSlug) return;
    setIsSaving(true);
    try {
      const payload = {
        name: trimmedName,
        slug: trimmedSlug,
        description: description.trim() || undefined,
        province: province || "Nord-Kivu",
        city: city.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        image_url: imageUrl.trim() || undefined,
        banner_image_url: bannerImageUrl.trim() || undefined,
        is_24_7: is247,
        is_featured: isFeatured,
        minimum_order_amount: minimumOrderAmount !== "" ? Number(minimumOrderAmount) : undefined,
        delivery_fee: deliveryFee !== "" ? Number(deliveryFee) : undefined,
        preparation_time_minutes: preparationTime !== "" ? Number(preparationTime) : undefined,
        hours: editing?.hours || [],
        food_categories: categories.split(",").map(c => c.trim()).filter(Boolean),
      };
      if (editing) {
        await updateFoodVendor(editing.id, payload);
      } else {
        await createFoodVendor(payload);
      }
      resetForm();
      await load();
      setNotice("Food vendor enregistré.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Le food vendor n'a pas été enregistré.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!editing) setSlug(slugify(value));
  };

  const startEditing = (vendor: FoodVendor) => {
    setEditing(vendor);
    setName(vendor.name);
    setSlug(vendor.slug);
    setDescription(vendor.description ?? "");
    setProvince(vendor.province);
    setCity(vendor.city ?? "");
    setPhone(vendor.phone ?? "");
    setEmail(vendor.email ?? "");
    setImageUrl(vendor.image_url ?? "");
    setBannerImageUrl(vendor.banner_image_url ?? "");
    setIs247(vendor.is_24_7);
    setIsFeatured(vendor.is_featured);
    setMinimumOrderAmount(vendor.minimum_order_amount != null ? String(vendor.minimum_order_amount) : "");
    setDeliveryFee(vendor.delivery_fee != null ? String(vendor.delivery_fee) : "");
    setPreparationTime(vendor.preparation_time_minutes != null ? String(vendor.preparation_time_minutes) : "");
    setCategories(vendor.food_categories.join(", "));
  };

  return <div className="space-y-6">
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><UtensilsCrossed className="h-4 w-4" /> Food Vendors</h3>
          <p className="mt-1 text-sm text-muted-foreground">Gérez les restaurants et fast-foods partenaires sur DLX Food.</p>
        </div>
        {notice && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs">{notice}</p>}
      </div>

      <form onSubmit={handleSave} className="mt-5 grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-2">
        <label className="text-sm font-medium">Nom du restaurant
          <input required value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Ex. Goma Grill Express" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Slug (URL)
          <input required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="goma-grill-express" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="md:col-span-2 text-sm font-medium">Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Province
          <select required value={province} onChange={(e) => setProvince(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2">
            <option value="">Sélectionner une province</option>
            {DRC_PROVINCES.map((prov) => <option key={prov} value={prov}>{prov}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Ville
          <input required value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex. Goma" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Téléphone (optionnel)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex. +243 …" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">E-mail (optionnel)
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@restaurant.cd" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Image du restaurant — URL (optionnel)
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Bannière — URL (optionnel)
          <input value={bannerImageUrl} onChange={(e) => setBannerImageUrl(e.target.value)} placeholder="https://…" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Commande minimum $ (optionnel)
          <input type="number" min="0" step="0.5" value={minimumOrderAmount} onChange={(e) => setMinimumOrderAmount(e.target.value)} placeholder="Ex. 5" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Frais de livraison $ (optionnel)
          <input type="number" min="0" step="0.5" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} placeholder="Ex. 0" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Temps de préparation (minutes, optionnel)
          <input type="number" min="1" value={preparationTime} onChange={(e) => setPreparationTime(e.target.value)} placeholder="Ex. 25" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Catégories alimentaires (séparées par virgules)
          <input value={categories} onChange={(e) => setCategories(e.target.value)} placeholder="Ex. Grillades, Fast food, Plats chauds" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="flex items-center gap-2 text-sm font-medium pt-2">
          <input type="checkbox" checked={is247} onChange={(e) => setIs247(e.target.checked)} className="h-4.5 w-4.5 rounded border-border text-primary" />
          Ouvert 24h/24, 7j/7
        </label>
        <label className="flex items-center gap-2 text-sm font-medium pt-2">
          <input type="checkbox" checked={isFeatured} onChange={(e) => setIsFeatured(e.target.checked)} className="h-4.5 w-4.5 rounded border-border text-primary" />
          Mettre en vedette sur DLX Food
        </label>
        <div className="md:col-span-2 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={resetForm} className="rounded-full border border-border px-4 py-2 text-sm font-semibold">Annuler</button>
          <button disabled={isSaving} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editing ? "Mettre à jour" : "Ajouter un restaurant"}
          </button>
        </div>
      </form>

      <div className="mt-5 divide-y divide-border">
        {vendors.length ? vendors.map((vendor) => (
          <FoodVendorRow
            key={vendor.id}
            vendor={vendor}
            onEdit={() => startEditing(vendor)}
            onDelete={() => { if (window.confirm(`Supprimer ${vendor.name} ?`)) void deleteFoodVendor(vendor.id).then(load).catch(() => setNotice("Impossible de supprimer.")); }}
            onToggleStatus={() => void setFoodVendorStatus(vendor.id, !vendor.active).then(load).catch(() => setNotice("Impossible de modifier le statut."))}
            onToggleFeatured={() => void updateFoodVendor(vendor.id, { is_featured: !vendor.is_featured }).then(load).catch(() => setNotice("Impossible de modifier la mise en avant."))}
          />
        )) : <p className="py-5 text-sm text-muted-foreground">Aucun food vendor configuré.</p>}
      </div>
    </section>

    <FoodCategoryManager />
  </div>;
}

function FoodVendorRow({ vendor, onEdit, onDelete, onToggleStatus, onToggleFeatured }: {
  vendor: FoodVendor;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
  onToggleFeatured: () => void;
}) {
  return (
    <article className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-semibold">{vendor.name} <span className="text-xs font-normal text-muted-foreground">/{vendor.slug}</span></span>
          <p className="text-xs text-muted-foreground">
            {vendor.active ? "Actif" : "Inactif"}
            {vendor.city && ` · ${vendor.city}, ${vendor.province}`}
            {vendor.food_categories.length > 0 && ` · ${vendor.food_categories.join(", ")}`}
            {vendor.minimum_order_amount != null && ` · Min. ${vendor.minimum_order_amount} $`}
            {vendor.delivery_fee != null && ` · Livraison ${vendor.delivery_fee} $`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {vendor.is_featured && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary flex items-center gap-1"><Star className="h-3 w-3" />Vedette</span>}
          {vendor.is_24_7 && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary flex items-center gap-1"><Clock3 className="h-3 w-3" />24/7</span>}
          <button type="button" onClick={onToggleFeatured} className="rounded border border-border px-3 py-2 text-xs font-semibold">{vendor.is_featured ? "Retirer la vedette" : "Mettre en vedette"}</button>
          <button type="button" onClick={onToggleStatus} className="rounded border border-border px-3 py-2 text-xs font-semibold">{vendor.active ? "Désactiver" : "Activer"}</button>
          <button type="button" onClick={onEdit} className="rounded border border-border p-2" aria-label="Modifier"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onDelete} className="rounded border border-destructive/30 p-2 text-destructive" aria-label="Supprimer"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </article>
  );
}

function FoodCategoryManager() {
  const [categories, setCategories] = useState<FoodCategory[]>([]);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      setCategories(await getFoodCategories({ includeInactive: true }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de charger les catégories food.");
    }
  };

  useEffect(() => { void load(); }, []);

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setIsSaving(true);
    try {
      await createFoodCategory({
        name: trimmedName,
        slug: slugify(trimmedName),
        icon_emoji: emoji.trim() || undefined,
      });
      setName("");
      setEmoji("");
      await load();
      setNotice("Catégorie ajoutée.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La catégorie n'a pas été ajoutée.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Tag className="h-4 w-4" /> Catégories Food</h3>
          <p className="mt-1 text-sm text-muted-foreground">Organisez l&apos;offre DLX Food par type de cuisine.</p>
        </div>
        {notice && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs">{notice}</p>}
      </div>

      <form onSubmit={handleAdd} className="mt-4 flex flex-wrap gap-2">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Grillades" className="min-w-40 flex-1 rounded-lg border border-border bg-background p-2 text-sm" />
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="Emoji (optionnel)" className="w-36 rounded-lg border border-border bg-background p-2 text-sm" />
        <button disabled={isSaving || !name.trim()} className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          <Plus className="h-4 w-4" />
          Ajouter
        </button>
      </form>

      <ul className="mt-4 divide-y divide-border">
        {categories.length ? categories.map((category) => (
          <li key={category.id} className="flex items-center justify-between gap-2 py-2">
            <span className="text-sm font-medium">
              {category.icon_emoji && <span className="mr-2">{category.icon_emoji}</span>}
              {category.name} <span className="text-xs font-normal text-muted-foreground">/{category.slug}</span>
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void updateFoodCategory(category.id, { is_active: !category.is_active }).then(load).catch(() => setNotice("Impossible de modifier la catégorie."))}
                className={`rounded px-2 py-1 text-xs font-semibold ${category.is_active ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
              >
                {category.is_active ? "Active" : "Inactive"}
              </button>
              <button
                type="button"
                onClick={() => { if (window.confirm(`Supprimer la catégorie ${category.name} ?`)) void deleteFoodCategory(category.id).then(load).catch(() => setNotice("Impossible de supprimer la catégorie.")); }}
                className="rounded border border-destructive/30 p-1 text-destructive"
                aria-label="Supprimer la catégorie"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        )) : <li className="py-4 text-sm text-muted-foreground">Aucune catégorie food configurée.</li>}
      </ul>
    </section>
  );
}
