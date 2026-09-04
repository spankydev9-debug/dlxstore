"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, Store, X, MapPin, TrendingUp } from "lucide-react";
import { PartnerShop, ShopProduct, Product } from "../../types";
import {
  getPartnerShops,
  createPartnerShop,
  deletePartnerShop,
  updatePartnerShop,
  setPartnerShopStatus,
  setPartnerShopFeatured,
  getShopProducts,
  addProductToShop,
  removeProductFromShop,
  setShopProductVisibility,
  reorderShopProducts,
  getShopStats,
} from "../../services/db/partner-shops";
import { getProducts } from "../../services/db/products";
import { DRC_PROVINCES } from "../../lib/drc-geography";
import { formatMoney } from "../../lib/format";

function slugify(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function PartnerControls() {
  const [shops, setShops] = useState<PartnerShop[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopDescription, setShopDescription] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [commissionRate, setCommissionRate] = useState("");
  const [editing, setEditing] = useState<PartnerShop | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      setShops(await getPartnerShops({ includeInactive: true }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de charger les boutiques partenaires.");
    }
  };

  useEffect(() => { void load(); }, []);

  const resetForm = () => { 
    setName(""); 
    setSlug(""); 
    setDescription(""); 
    setShopName(""); 
    setShopDescription(""); 
    setProvince(""); 
    setCity(""); 
    setCommissionRate(""); 
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
        business_name: trimmedName,
        slug: trimmedSlug,
        description: description.trim() || undefined,
        shop_name: shopName.trim() || undefined,
        shop_description: shopDescription.trim() || undefined,
        province: province || "Nord-Kivu",
        city: city.trim() || undefined,
        commission_rate: commissionRate ? Number(commissionRate) : undefined,
      };
      if (editing) {
        await updatePartnerShop(editing.id, payload);
      } else {
        await createPartnerShop(payload);
      }
      resetForm();
      await load();
      setNotice("Boutique partenaire enregistrée.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La boutique n'a pas été enregistrée.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (!editing) setSlug(slugify(value));
  };

  const startEditing = (shop: PartnerShop) => { 
    setEditing(shop); 
    setName(shop.business_name); 
    setSlug(shop.slug); 
    setDescription(shop.description ?? ""); 
    setShopName(shop.shop_name ?? ""); 
    setShopDescription(shop.shop_description ?? ""); 
    setProvince(shop.province); 
    setCity(shop.city ?? ""); 
    setCommissionRate(shop.commission_rate?.toString() ?? ""); 
  };

  return <section className="rounded-2xl border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold flex items-center gap-2"><Store className="h-4 w-4" /> Boutiques Partenaires</h3>
        <p className="mt-1 text-sm text-muted-foreground">Gérez les boutiques partenaires et leurs produits sur DLXSTORE.</p>
      </div>
      {notice && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs">{notice}</p>}
    </div>

    <form onSubmit={handleSave} className="mt-5 grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-2">
      <label className="text-sm font-medium">Nom de l'entreprise
        <input required value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Ex. Tech Hub Goma" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
      </label>
      <label className="text-sm font-medium">Slug (URL)
        <input required value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="tech-hub-goma" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
      </label>
      <label className="md:col-span-2 text-sm font-medium">Description de l'entreprise
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
      </label>
      <label className="text-sm font-medium">Nom de la boutique (optionnel)
        <input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder="Ex. Tech Hub" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
      </label>
      <label className="text-sm font-medium">Description boutique (optionnel)
        <textarea value={shopDescription} onChange={(e) => setShopDescription(e.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
      </label>
      <label className="text-sm font-medium">Province
        <select required value={province} onChange={(e) => setProvince(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2">
          <option value="">Sélectionner une province</option>
          {DRC_PROVINCES.map((prov) => <option key={prov} value={prov}>{prov}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium">Ville (optionnel)
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex. Goma" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
      </label>
      <label className="text-sm font-medium">Taux de commission % (optionnel)
        <input type="number" min="0" max="100" value={commissionRate} onChange={(e) => setCommissionRate(e.target.value)} placeholder="Ex. 15" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
      </label>
      <div className="md:col-span-2 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={resetForm} className="rounded-full border border-border px-4 py-2 text-sm font-semibold">Annuler</button>
        <button disabled={isSaving} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {editing ? "Mettre à jour" : "Ajouter une boutique"}
        </button>
      </div>
    </form>

    <div className="mt-5 divide-y divide-border">
      {shops.length ? shops.map((shop) => (
        <PartnerShopRow key={shop.id} shop={shop} onEdit={() => startEditing(shop)} onDelete={() => { if (window.confirm(`Supprimer ${shop.business_name} ?`)) void deletePartnerShop(shop.id).then(load).catch(() => setNotice("Impossible de supprimer.")); }} onToggleStatus={() => void setPartnerShopStatus(shop.id, shop.status === "active" ? "suspended" : "active").then(load).catch(() => setNotice("Impossible de modifier le statut."))} onToggleFeatured={() => void setPartnerShopFeatured(shop.id, !shop.is_featured).then(load).catch(() => setNotice("Impossible de modifier la mise en avant."))} />
      )) : <p className="py-5 text-sm text-muted-foreground">Aucune boutique partenaire configurée.</p>}
    </div>
  </section>;
}

function PartnerShopRow({ shop, onEdit, onDelete, onToggleStatus, onToggleFeatured }: {
  shop: PartnerShop;
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
  onToggleFeatured: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [stats, setStats] = useState<{ product_count: number; total_orders: number; total_revenue: number }>({ product_count: 0, total_orders: 0, total_revenue: 0 });

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      try {
        const data = await getShopStats(shop.id);
        if (!cancelled) setStats(data);
      } catch (error) {
        console.error("Error loading shop stats:", error);
      }
    }
    if (expanded) loadStats();
    return () => { cancelled = true; };
  }, [expanded, shop.id]);

  return (
    <article className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={() => setExpanded((e) => !e)} className="font-semibold hover:underline text-left">
            {shop.business_name} <span className="text-xs font-normal text-muted-foreground">/{shop.slug}</span>
          </button>
          <p className="text-xs text-muted-foreground">
            {shop.status === "active" ? "Active" : shop.status === "suspended" ? "Suspendue" : "En attente"}
            {shop.shop_name && ` · ${shop.shop_name}`}
            {shop.province && ` · ${shop.province}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {shop.is_featured && <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">En vedette</span>}
          <button type="button" onClick={onToggleFeatured} className="rounded border border-border px-3 py-2 text-xs font-semibold">{shop.is_featured ? "Masquer" : "Mettre en avant"}</button>
          <button type="button" onClick={onToggleStatus} className="rounded border border-border px-3 py-2 text-xs font-semibold">{shop.status === "active" ? "Suspendre" : "Activer"}</button>
          <button type="button" onClick={onEdit} className="rounded border border-border p-2" aria-label="Modifier"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onDelete} className="rounded border border-destructive/30 p-2 text-destructive" aria-label="Supprimer"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4 space-y-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{stats.product_count}</p>
              <p className="text-xs text-muted-foreground">Produits</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{stats.total_orders}</p>
              <p className="text-xs text-muted-foreground">Commandes</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{formatMoney(stats.total_revenue)}</p>
              <p className="text-xs text-muted-foreground">Revenus</p>
            </div>
          </div>
          <PartnerProductManager shopId={shop.id} />
        </div>
      )}
    </article>
  );
}

function PartnerProductManager({ shopId }: { shopId: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [assigned, setAssigned] = useState<ShopProduct[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      const [allProducts, shopProducts] = await Promise.all([getProducts(), getShopProducts(shopId)]);
      setProducts(allProducts.filter((p) => p.is_active !== false && p.is_archived !== true));
      setAssigned(shopProducts);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de charger les produits.");
    }
  };

  useEffect(() => { void load(); }, [shopId]);

  const add = async () => {
    if (!selectedId) return;
    try {
      await addProductToShop(shopId, selectedId);
      setSelectedId("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible d'ajouter le produit.");
    }
  };

  const remove = async (productId: string) => {
    try {
      await removeProductFromShop(shopId, productId);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de retirer le produit.");
    }
  };

  const toggleVisibility = async (productId: string, isVisible: boolean) => {
    try {
      await setShopProductVisibility(shopId, productId, isVisible);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de modifier la visibilité.");
    }
  };

  const candidates = products.filter((p) => !assigned.some((a) => a.product_id === p.id));
  const byId = new Map(products.map((p) => [p.id, p]));

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Produits de la boutique</p>
      {notice && <p className="rounded-lg bg-muted px-3 py-2 text-xs">{notice}</p>}
      <div className="flex flex-wrap gap-2">
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded-lg border border-border bg-background p-2 text-sm">
          <option value="">Ajouter un produit…</option>
          {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" onClick={add} disabled={!selectedId} className="inline-flex items-center gap-1 rounded-lg border border-border p-2 text-sm font-semibold disabled:opacity-50"><Plus className="h-4 w-4" />Ajouter</button>
      </div>
      {assigned.length ? (
        <ul className="divide-y divide-border">
          {assigned.sort((a, b) => a.display_order - b.display_order).map((sp) => {
            const product = byId.get(sp.product_id);
            if (!product) return null;
            return (
              <li key={sp.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-sm font-medium">{product.name}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => toggleVisibility(sp.product_id, !sp.is_visible)} className={`rounded px-2 py-1 text-xs font-semibold ${sp.is_visible ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                    {sp.is_visible ? 'Visible' : 'Masqué'}
                  </button>
                  <button type="button" onClick={() => remove(sp.product_id)} className="rounded border border-destructive/30 p-1 text-destructive" aria-label="Retirer"><X className="h-3.5 w-3.5" /></button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-muted-foreground italic">Aucun produit assigné.</p>}
    </div>
  );
}