"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2, Layers, X } from "lucide-react";
import { Product, StoreSession } from "../../types";
import {
  addProductToSession,
  createSession,
  deleteSession,
  getSessionProducts,
  getSessions,
  removeProductFromSession,
  reorderSessionProducts,
  reorderSessions,
  updateSession,
} from "../../services/db/sessions";
import { getProducts } from "../../services/db/products";

function slugify(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function SessionControls() {
  const [sessions, setSessions] = useState<StoreSession[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState<StoreSession | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      setSessions(await getSessions({ includeInactive: true }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de charger les collections.");
    }
  };

  useEffect(() => { void load(); }, []);

  const resetForm = () => { setName(""); setDescription(""); setEditing(null); };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setIsSaving(true);
    try {
      if (editing) {
        await updateSession(editing.id, { name: trimmed, description: description.trim() || undefined });
      } else {
        await createSession({ name: trimmed, slug: slugify(trimmed), description: description.trim() || undefined, display_order: sessions.length, is_active: true });
      }
      resetForm();
      await load();
      setNotice("Collection enregistrée.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "La collection n'a pas été enregistrée.");
    } finally {
      setIsSaving(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= sessions.length) return;
    const next = [...sessions];
    [next[index], next[target]] = [next[target], next[index]];
    setSessions(next);
    try { await reorderSessions(next.map((s) => s.id)); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Le classement n'a pas été enregistré."); await load(); }
  };

  const startEditing = (session: StoreSession) => { setEditing(session); setName(session.name); setDescription(session.description ?? ""); };

  return <section className="rounded-2xl border border-border bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold flex items-center gap-2"><Layers className="h-4 w-4" /> Collections (Sessions merchandising)</h3>
        <p className="mt-1 text-sm text-muted-foreground">Créez, activez, réordonnez et gérez les collections affichées en boutique. Un produit peut appartenir à plusieurs collections.</p>
      </div>
      {notice && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs">{notice}</p>}
    </div>

    <form onSubmit={handleSave} className="mt-5 grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-2">
      <label className="text-sm font-medium">Nom
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. The New Drop" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
      </label>
      <label className="md:col-span-2 text-sm font-medium">Description (optionnel)
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
      </label>
      <div className="md:col-span-2 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={resetForm} className="rounded-full border border-border px-4 py-2 text-sm font-semibold">Annuler</button>
        <button disabled={isSaving} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {editing ? "Mettre à jour" : "Ajouter une collection"}
        </button>
      </div>
    </form>

    <div className="mt-5 divide-y divide-border">
      {sessions.length ? sessions.map((session, index) => (
        <SessionRow key={session.id} session={session} index={index} total={sessions.length}
          onMove={move} onToggle={() => void updateSession(session.id, { is_active: session.is_active === false }).then(load).catch(() => setNotice("Impossible de modifier la visibilité."))}
          onEdit={() => startEditing(session)} onDelete={() => { if (window.confirm(`Supprimer ${session.name} ?`)) void deleteSession(session.id).then(load).catch(() => setNotice("Impossible de supprimer.")); }}
        />
      )) : <p className="py-5 text-sm text-muted-foreground">Aucune collection configurée.</p>}
    </div>
  </section>;
function SessionRow({ session, index, total, onMove, onToggle, onEdit, onDelete }: {
  session: StoreSession;
  index: number;
  total: number;
  onMove: (index: number, dir: -1 | 1) => void;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={() => setExpanded((e) => !e)} className="font-semibold hover:underline text-left">
            {session.name} <span className="text-xs font-normal text-muted-foreground">/{session.slug}</span>
          </button>
          <p className="text-xs text-muted-foreground">
            {session.is_active === false ? "Masquée" : "Visible"}
            {session.description ? ` · ${session.description}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} className="rounded border border-border p-2 disabled:opacity-40" aria-label="Monter"><ArrowUp className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => onMove(index, 1)} disabled={index === total - 1} className="rounded border border-border p-2 disabled:opacity-40" aria-label="Descendre"><ArrowDown className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onToggle} className="rounded border border-border px-3 py-2 text-xs font-semibold">{session.is_active === false ? "Afficher" : "Masquer"}</button>
          <button type="button" onClick={onEdit} className="rounded border border-border p-2" aria-label="Modifier"><Pencil className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={onDelete} className="rounded border border-destructive/30 p-2 text-destructive" aria-label="Supprimer"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      {expanded && <div className="mt-3 rounded-xl border border-border bg-muted/20 p-4"><SessionProductManager sessionId={session.id} /></div>}
    </article>
  );
}
function SessionProductManager({ sessionId }: { sessionId: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [assigned, setAssigned] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      const [allProducts, sessionOrder] = await Promise.all([getProducts(), getSessionProducts(sessionId)]);
      setProducts(allProducts.filter((p) => p.is_active !== false && p.is_archived !== true));
      const byId = new Map(allProducts.map((p) => [p.id, p]));
      setAssigned(sessionOrder.map((row) => byId.get(row.product_id)).filter((p): p is Product => Boolean(p)));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de charger les produits.");
    }
  };

  useEffect(() => { void load(); }, []);

  const add = async () => {
    if (!selectedId) return;
    try {
      await addProductToSession(sessionId, selectedId);
      setSelectedId("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible d'ajouter le produit.");
    }
  };

  const remove = async (productId: string) => {
    try {
      await removeProductFromSession(sessionId, productId);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de retirer le produit.");
    }
  };

  const moveItem = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= assigned.length) return;
    const next = [...assigned];
    [next[index], next[target]] = [next[target], next[index]];
    setAssigned(next);
    try {
      await reorderSessionProducts(sessionId, next.map((p) => p.id));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de réordonner.");
      await load();
    }
  };

  const candidates = products.filter((p) => !assigned.some((a) => a.id === p.id));

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Produits de la collection</p>
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
          {assigned.map((p, index) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <span className="text-sm font-medium">{p.name}</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => moveItem(index, -1)} disabled={index === 0} className="rounded border border-border p-1 disabled:opacity-40" aria-label="Monter"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => moveItem(index, 1)} disabled={index === assigned.length - 1} className="rounded border border-border p-1 disabled:opacity-40" aria-label="Descendre"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => remove(p.id)} className="rounded border border-destructive/30 p-1 text-destructive" aria-label="Retirer"><X className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground italic">Aucun produit assigné.</p>}
    </div>
  );
}
}