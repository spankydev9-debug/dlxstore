"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Eye,
  EyeOff,
  LayoutGrid,
  Loader2,
  Megaphone,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Store,
  Trash2,
  Type,
} from "lucide-react";
import type { Category } from "../../../types";
import {
  createDepartmentSection,
  deleteDepartmentSection,
  reorderDepartmentSections,
  updateDepartmentSection,
  type DepartmentSection,
  type DepartmentSectionConfig,
  type DepartmentSectionKind,
} from "../../../services/db/departments";
import { useConfirm } from "./useConfirm";

/**
 * Section editor.
 *
 * A department's page *is* this ordered list. Each row is one block on the
 * storefront, and the fields offered here are exactly the fields the renderer
 * reads — no setting is decorative. `config` is edited through typed controls
 * (selects, numbers, category pickers) rather than a JSON box, so an admin
 * cannot produce a block that renders nothing.
 */

const KIND_LABELS: Record<DepartmentSectionKind, string> = {
  hero: "Bandeau d'identité",
  product_grid: "Grille de produits",
  vendor_grid: "Grille de vendeurs",
  category_grid: "Grille de catégories",
  promo: "Bandeau promotionnel",
  text: "Bloc de texte",
};

const KIND_ICONS: Record<DepartmentSectionKind, typeof LayoutGrid> = {
  hero: Sparkles,
  product_grid: LayoutGrid,
  vendor_grid: Store,
  category_grid: LayoutGrid,
  promo: Megaphone,
  text: Type,
};

const DEFAULT_CONFIG: Record<DepartmentSectionKind, DepartmentSectionConfig> = {
  hero: { cta_label: "", cta_href: "" },
  product_grid: { source: "placements", limit: 8, columns: 3 },
  vendor_grid: { vendor_source: "curated", limit: 12 },
  category_grid: { limit: 8, category_slugs: [] },
  promo: { tone: "emerald", cta_label: "", cta_href: "" },
  text: { cta_label: "", cta_href: "" },
};

const fieldClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export default function DepartmentSectionsEditor({
  departmentId,
  sections,
  categories,
  onChanged,
}: {
  departmentId: string;
  sections: DepartmentSection[];
  categories: Category[];
  onChanged: (next: DepartmentSection[]) => void;
}) {
  const { ask, dialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<DepartmentSectionKind>("product_grid");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const ordered = useMemo(
    () => [...sections].sort((a, b) => a.sort_order - b.sort_order),
    [sections]
  );

  async function run(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action impossible.");
    } finally {
      setBusy(null);
    }
  }

  function replace(next: DepartmentSection) {
    onChanged(sections.map((section) => (section.id === next.id ? next : section)));
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    const withOrder = next.map((section, position) => ({
      ...section,
      sort_order: (position + 1) * 10,
    }));
    // Optimistic: the list reorders immediately, the write follows.
    onChanged(withOrder);
    await run(`move-${ordered[index].id}`, async () => {
      await reorderDepartmentSections(withOrder.map((section) => section.id));
    });
  }

  async function addSection() {
    setBusy("add");
    setError("");
    setNotice("");
    try {
      const created = await createDepartmentSection({
        department_id: departmentId,
        kind: adding,
        title: KIND_LABELS[adding],
        config: DEFAULT_CONFIG[adding],
        sort_order: (ordered.at(-1)?.sort_order ?? 0) + 10,
        is_active: true,
      });
      onChanged([...sections, created]);
      setEditingId(created.id);
      setNotice("Bloc ajouté. Complétez son contenu puis enregistrez.");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Ajout impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {dialog}

      <div className="rounded-2xl border border-border/60 p-4">
        <p className="text-sm font-semibold">Ajouter un bloc</p>
        <p className="mb-3 text-xs text-muted-foreground">
          L&apos;ordre de cette liste est l&apos;ordre de la page.
        </p>
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Type de bloc"
            className={`${fieldClass} max-w-56`}
            value={adding}
            onChange={(event) => setAdding(event.target.value as DepartmentSectionKind)}
          >
            {(Object.keys(KIND_LABELS) as DepartmentSectionKind[]).map((kind) => (
              <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={addSection}
            disabled={busy === "add"}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "add" ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Ajouter
          </button>
        </div>
      </div>

      {notice && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

      <ul className="space-y-3">
        {ordered.map((section, index) => {
          const Icon = KIND_ICONS[section.kind];
          const isEditing = editingId === section.id;
          return (
            <li key={section.id} className="rounded-2xl border border-border/60 bg-card">
              <div className="flex flex-wrap items-center gap-3 p-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">
                    {section.title || <span className="text-muted-foreground">Sans titre</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {KIND_LABELS[section.kind]}
                    {section.config.anchor ? ` · #${section.config.anchor}` : ""}
                    {section.is_active ? "" : " · masqué"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Monter"
                    disabled={index === 0 || busy !== null}
                    onClick={() => move(index, -1)}
                    className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="Descendre"
                    disabled={index === ordered.length - 1 || busy !== null}
                    onClick={() => move(index, 1)}
                    className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={section.is_active ? "Masquer" : "Afficher"}
                    onClick={() =>
                      run(section.id, async () => {
                        const next = await updateDepartmentSection(section.id, {
                          is_active: !section.is_active,
                        });
                        replace(next);
                      })
                    }
                    className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"
                  >
                    {section.is_active ? (
                      <Eye className="h-4 w-4" aria-hidden />
                    ) : (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(isEditing ? null : section.id)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    {isEditing ? "Fermer" : "Modifier"}
                    <ChevronDown className={`h-3 w-3 transition-transform ${isEditing ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="Supprimer"
                    onClick={() =>
                      ask({
                        title: "Supprimer ce bloc ?",
                        body: `« ${section.title || KIND_LABELS[section.kind]} » disparaîtra de la vitrine.`,
                        confirmLabel: "Supprimer",
                        onConfirm: async () => {
                          await deleteDepartmentSection(section.id);
                          onChanged(sections.filter((item) => item.id !== section.id));
                          setNotice("Bloc supprimé.");
                        },
                      })
                    }
                    className="rounded-lg p-1.5 text-destructive transition hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>

              {isEditing && (
                <SectionForm
                  key={section.id}
                  section={section}
                  categories={categories}
                  onSaved={(next) => {
                    replace(next);
                    setNotice("Bloc enregistré.");
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>

      {ordered.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Aucun bloc. Ajoutez-en un pour construire la page.
        </p>
      )}
    </div>
  );
}

function SectionForm({
  section,
  categories,
  onSaved,
}: {
  section: DepartmentSection;
  categories: Category[];
  onSaved: (next: DepartmentSection) => void;
}) {
  const [title, setTitle] = useState(section.title ?? "");
  const [subtitle, setSubtitle] = useState(section.subtitle ?? "");
  const [body, setBody] = useState(section.body ?? "");
  const [config, setConfig] = useState<DepartmentSectionConfig>(section.config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof DepartmentSectionConfig>(
    key: K,
    value: DepartmentSectionConfig[K]
  ) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await updateDepartmentSection(section.id, {
        title: title.trim() || null,
        subtitle: subtitle.trim() || null,
        body: body.trim() || null,
        config,
      });
      onSaved(next);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 border-t border-border/60 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor={`t-${section.id}`}>Titre</label>
          <input id={`t-${section.id}`} className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <div>
          <label className={labelClass} htmlFor={`s-${section.id}`}>Sous-titre</label>
          <input id={`s-${section.id}`} className={fieldClass} value={subtitle} onChange={(event) => setSubtitle(event.target.value)} />
        </div>
        {(section.kind === "promo" || section.kind === "text" || section.kind === "hero") && (
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor={`b-${section.id}`}>Texte</label>
            <textarea id={`b-${section.id}`} rows={3} className={fieldClass} value={body} onChange={(event) => setBody(event.target.value)} />
          </div>
        )}
      </div>

      {section.kind === "product_grid" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`src-${section.id}`}>Source des produits</label>
            <select
              id={`src-${section.id}`}
              className={fieldClass}
              value={config.source ?? "placements"}
              onChange={(event) => set("source", event.target.value as DepartmentSectionConfig["source"])}
            >
              <option value="placements">Produits placés dans ce département</option>
              <option value="featured">Produits mis en avant du catalogue</option>
              <option value="category">Tout un rayon (catégorie)</option>
            </select>
          </div>
          {(config.source ?? "placements") === "category" && (
            <div>
              <label className={labelClass} htmlFor={`cat-${section.id}`}>Catégorie</label>
              <select
                id={`cat-${section.id}`}
                className={fieldClass}
                value={config.category_slug ?? ""}
                onChange={(event) => set("category_slug", event.target.value)}
              >
                <option value="">Choisir…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.slug}>{category.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className={labelClass} htmlFor={`lim-${section.id}`}>Nombre maximum</label>
            <input
              id={`lim-${section.id}`}
              type="number"
              min={1}
              max={48}
              className={fieldClass}
              value={config.limit ?? 8}
              onChange={(event) => set("limit", Number(event.target.value))}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor={`col-${section.id}`}>Cartes par ligne (bureau)</label>
            <select
              id={`col-${section.id}`}
              className={fieldClass}
              value={config.columns ?? 3}
              onChange={(event) => set("columns", Number(event.target.value) as 2 | 3 | 4)}
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </div>
        </div>
      )}

      {section.kind === "vendor_grid" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor={`vsrc-${section.id}`}>Source des vendeurs</label>
            <select
              id={`vsrc-${section.id}`}
              className={fieldClass}
              value={config.vendor_source ?? "curated"}
              onChange={(event) =>
                set("vendor_source", event.target.value as DepartmentSectionConfig["vendor_source"])
              }
            >
              <option value="curated">Sélection curatée de ce département</option>
              <option value="food">Tous les restaurants DLX Food</option>
              <option value="partners">Toutes les boutiques partenaires actives</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor={`vlim-${section.id}`}>Nombre maximum</label>
            <input
              id={`vlim-${section.id}`}
              type="number"
              min={1}
              max={48}
              className={fieldClass}
              value={config.limit ?? 12}
              onChange={(event) => set("limit", Number(event.target.value))}
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            La sélection curatée se gère dans l&apos;onglet <strong>Vendeurs</strong>.
          </p>
        </div>
      )}

      {section.kind === "category_grid" && (
        <div className="space-y-3">
          <div className="w-40">
            <label className={labelClass} htmlFor={`clim-${section.id}`}>Nombre maximum</label>
            <input
              id={`clim-${section.id}`}
              type="number"
              min={1}
              max={24}
              className={fieldClass}
              value={config.limit ?? 8}
              onChange={(event) => set("limit", Number(event.target.value))}
            />
          </div>
          <fieldset>
            <legend className={labelClass}>Catégories affichées (aucune = toutes)</legend>
            <div className="mt-2 grid max-h-52 gap-1.5 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2">
              {categories.map((category) => {
                const picked = config.category_slugs ?? [];
                const checked = picked.includes(category.slug);
                return (
                  <label key={category.id} className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        set(
                          "category_slugs",
                          checked
                            ? picked.filter((slug) => slug !== category.slug)
                            : [...picked, category.slug]
                        )
                      }
                    />
                    {category.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}

      {section.kind === "promo" && (
        <div>
          <label className={labelClass} htmlFor={`tone-${section.id}`}>Couleur du bandeau</label>
          <select
            id={`tone-${section.id}`}
            className={fieldClass}
            value={config.tone ?? "emerald"}
            onChange={(event) => set("tone", event.target.value as DepartmentSectionConfig["tone"])}
          >
            <option value="emerald">Émeraude</option>
            <option value="amber">Ambre</option>
            <option value="primary">Bleu DLX</option>
            <option value="neutral">Neutre</option>
          </select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {section.kind !== "text" && section.kind !== "category_grid" && section.kind !== "vendor_grid" && (
          <>
            <div>
              <label className={labelClass} htmlFor={`cta-${section.id}`}>Texte du bouton</label>
              <input
                id={`cta-${section.id}`}
                className={fieldClass}
                value={config.cta_label ?? ""}
                onChange={(event) => set("cta_label", event.target.value)}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`href-${section.id}`}>Lien du bouton</label>
              <input
                id={`href-${section.id}`}
                className={fieldClass}
                value={config.cta_href ?? ""}
                onChange={(event) => set("cta_href", event.target.value)}
                placeholder="/contact ou #products"
              />
            </div>
          </>
        )}
        <div>
          <label className={labelClass} htmlFor={`anc-${section.id}`}>Ancre (navigation)</label>
          <input
            id={`anc-${section.id}`}
            className={fieldClass}
            value={config.anchor ?? ""}
            onChange={(event) => set("anchor", event.target.value.replace(/^#/, ""))}
            placeholder="products"
          />
        </div>
      </div>

      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          Enregistrer le bloc
        </button>
      </div>
    </form>
  );
}
