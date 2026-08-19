"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { Category } from "../../types";
import { createCategory, deleteCategory, getCategories, reorderCategories, updateCategory } from "../../services/db/products";
import { uploadProductImage } from "../../services/db/storage";

function slugify(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function CategoryControls() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [editing, setEditing] = useState<Category | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      setCategories(await getCategories({ includeInactive: true }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de charger les catégories.");
    }
  };

  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setName("");
    setDescription("");
    setImageUrl("");
    setEditing(null);
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setIsSaving(true);
    try {
      setImageUrl(await uploadProductImage(file));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Le téléversement a échoué.");
    } finally {
      setIsSaving(false);
    }
  };

  const saveCategory = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    setIsSaving(true);
    try {
      const fields = { name: trimmedName, slug: editing?.slug ?? slugify(trimmedName), description: description.trim() || undefined, image_url: imageUrl || undefined };
      if (editing) await updateCategory(editing.id, fields);
      else await createCategory({ ...fields, display_order: categories.length, is_active: true });
      resetForm();
      await load();
      setNotice("Catégorie enregistrée.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La catégorie n'a pas été enregistrée.");
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = (category: Category) => {
    setEditing(category);
    setName(category.name);
    setDescription(category.description ?? "");
    setImageUrl(category.image_url ?? "");
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const next = [...categories];
    [next[index], next[target]] = [next[target], next[index]];
    setCategories(next);
    try {
      await reorderCategories(next.map((category) => category.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Le classement n'a pas été enregistré.");
      await load();
    }
  };

  return <section className="rounded-2xl border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Catégories du catalogue</h3><p className="mt-1 text-sm text-muted-foreground">Créez, activez, réordonnez ou retirez les catégories affichées en boutique.</p></div>{notice && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs">{notice}</p>}</div>
    <form onSubmit={saveCategory} className="mt-5 grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-2"><label className="text-sm font-medium">Nom<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" /></label><label className="text-sm font-medium">Photo de catégorie<input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageUpload} disabled={isSaving} className="mt-1 block w-full text-xs" /></label><label className="md:col-span-2 text-sm font-medium">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" /></label><div className="md:col-span-2 flex flex-wrap justify-end gap-2"><button type="button" onClick={resetForm} className="rounded-full border border-border px-4 py-2 text-sm font-semibold">Annuler</button><button disabled={isSaving} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{editing ? "Mettre à jour" : "Ajouter une catégorie"}</button></div></form>
    <div className="mt-5 divide-y divide-border">{categories.length ? categories.map((category, index) => <article key={category.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{category.name}</p><p className="text-xs text-muted-foreground">/{category.slug} · {category.is_active === false ? "Masquée" : "Visible"}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="rounded border border-border p-2 disabled:opacity-40" aria-label="Monter"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" onClick={() => move(index, 1)} disabled={index === categories.length - 1} className="rounded border border-border p-2 disabled:opacity-40" aria-label="Descendre"><ArrowDown className="h-3.5 w-3.5" /></button><button type="button" onClick={() => void updateCategory(category.id, { is_active: category.is_active === false }).then(load).catch(() => setNotice("Impossible de modifier la visibilité."))} className="rounded border border-border px-3 py-2 text-xs font-semibold">{category.is_active === false ? "Afficher" : "Masquer"}</button><button type="button" onClick={() => startEditing(category)} className="rounded border border-border p-2" aria-label="Modifier"><Pencil className="h-3.5 w-3.5" /></button><button type="button" onClick={() => { if (window.confirm(`Supprimer ${category.name} ?`)) void deleteCategory(category.id).then(load).catch(() => setNotice("Impossible de supprimer cette catégorie.")); }} className="rounded border border-destructive/30 p-2 text-destructive" aria-label="Supprimer"><Trash2 className="h-3.5 w-3.5" /></button></div></article>) : <p className="py-5 text-sm text-muted-foreground">Aucune catégorie configurée.</p>}</div>
  </section>;
}
