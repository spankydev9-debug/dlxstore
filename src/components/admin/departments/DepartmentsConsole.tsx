"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  ExternalLink,
  LayoutGrid,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Store,
  Trash2,
  Users,
} from "lucide-react";
import type { Category, FoodVendor, PartnerShop, Product } from "../../../types";
import DepartmentStorefrontView from "../../departments/DepartmentStorefront";
import {
  createDepartment,
  deleteDepartment,
  getDepartmentNavigationForAdmin,
  getDepartmentPlacementsForAdmin,
  getDepartmentSectionsForAdmin,
  getDepartmentStorefront,
  getDepartmentVendors,
  getDepartments,
  getMyDepartments,
  reorderDepartments,
  updateDepartment,
  type Department,
  type DepartmentNavigationItem,
  type DepartmentPlacement,
  type DepartmentSection,
  type DepartmentStorefront as DepartmentStorefrontData,
  type DepartmentVendorRow,
} from "../../../services/db/departments";
import { getCategories, getProducts } from "../../../services/db/products";
import { getFoodVendors } from "../../../services/db/food";
import { getPartnerShops } from "../../../services/db/partner-shops";
import { useLanguage } from "../../../context/LanguageContext";
import { departmentStorefrontLabels, departmentHref } from "../../../lib/departments";
import DepartmentBasicsForm from "./DepartmentBasicsForm";
import DepartmentSectionsEditor from "./DepartmentSectionsEditor";
import DepartmentNavigationEditor from "./DepartmentNavigationEditor";
import DepartmentPlacementsEditor from "./DepartmentPlacementsEditor";
import DepartmentVendorsEditor from "./DepartmentVendorsEditor";
import { useConfirm } from "./useConfirm";

/**
 * Departments console.
 *
 * The admin Control Center and a partner's "Ma vitrine" render this same
 * component; `scope` only decides which actions are offered. Authority is not
 * decided here — the database policies in
 * `20261102090000_departments_control_center.sql` are what actually stop a
 * partner from touching someone else's storefront or the platform-owned
 * columns. Hiding a button is UX, not security.
 */

type Tab = "content" | "sections" | "navigation" | "products" | "vendors" | "preview";

const TABS: { key: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { key: "content", label: "Contenu & thème", icon: Sparkles },
  { key: "sections", label: "Blocs", icon: LayoutGrid },
  { key: "navigation", label: "Navigation", icon: Link2 },
  { key: "products", label: "Produits", icon: Store },
  { key: "vendors", label: "Vendeurs", icon: Users },
  { key: "preview", label: "Aperçu", icon: Eye },
];

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function DepartmentsConsole({
  scope = "admin",
}: {
  scope?: "admin" | "partner";
}) {
  const { language } = useLanguage();
  const { ask, dialog } = useConfirm();
  const isAdmin = scope === "admin";

  const [departments, setDepartments] = useState<Department[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Shared reference data, loaded once for every panel.
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [foodVendors, setFoodVendors] = useState<FoodVendor[]>([]);
  const [shops, setShops] = useState<PartnerShop[]>([]);

  // New-department form (admin only).
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", slug: "", icon: "sparkles" });
  const [creatingBusy, setCreatingBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rows, nextProducts, nextCategories, nextFood, nextShops] = await Promise.all([
        isAdmin ? getDepartments({ includeInactive: true }) : getMyDepartments(),
        getProducts(),
        getCategories({ includeInactive: true }),
        getFoodVendors(true),
        isAdmin ? getPartnerShops({ includeInactive: true }) : Promise.resolve<PartnerShop[]>([]),
      ]);
      setDepartments(rows);
      setProducts(nextProducts);
      setCategories(nextCategories);
      setFoodVendors(nextFood);
      setShops(nextShops);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const editing = useMemo(
    () => departments.find((department) => department.id === editingId) ?? null,
    [departments, editingId]
  );

  function replaceDepartment(next: Department) {
    setDepartments((current) =>
      current.map((department) => (department.id === next.id ? next : department))
    );
  }

  async function handleCreate() {
    const name = draft.name.trim();
    const slug = slugify(draft.slug || draft.name);
    if (!name || !slug) return;
    setCreatingBusy(true);
    setError("");
    try {
      // A new department is created as a draft with one hero block, so opening
      // it shows something real instead of an empty page.
      const created = await createDepartment({
        name,
        slug,
        icon: draft.icon,
        tagline: "",
        description: "",
        sort_order: (departments.at(-1)?.sort_order ?? 0) + 10,
        is_active: false,
        show_in_navigation: false,
        metadata: {},
      });
      setDepartments((current) => [...current, created]);
      setDraft({ name: "", slug: "", icon: "sparkles" });
      setCreating(false);
      setEditingId(created.id);
      setNotice("Département créé en brouillon. Complétez son contenu puis activez-le.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Création impossible.");
    } finally {
      setCreatingBusy(false);
    }
  }

  async function moveDepartment(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= departments.length) return;
    const next = [...departments];
    [next[index], next[target]] = [next[target], next[index]];
    const withOrder = next.map((department, position) => ({
      ...department,
      sort_order: (position + 1) * 10,
    }));
    setDepartments(withOrder);
    try {
      await reorderDepartments(withOrder.map((department) => department.id));
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Réordonnancement impossible.");
      void load();
    }
  }

  async function toggleActive(department: Department, key: "is_active" | "show_in_navigation") {
    try {
      const next = await updateDepartment(department.id, { [key]: !department[key] });
      replaceDepartment(next);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Modification impossible.");
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (editing) {
    return (
      <>
        {dialog}
        <DepartmentEditor
          department={editing}
          scope={scope}
          products={products}
          categories={categories}
          foodVendors={foodVendors}
          shops={shops}
          language={language}
          onBack={() => {
            setEditingId(null);
            void load();
          }}
          onChanged={(next) => {
            replaceDepartment(next);
            setNotice("Modifications enregistrées.");
          }}
          onDeleted={() => {
            setEditingId(null);
            void load();
          }}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      {dialog}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">
            {isAdmin ? "Départements" : "Ma vitrine"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Créez et pilotez les rayons du magasin : contenu, blocs, navigation, produits, vendeurs, thème et URL. Aucun changement ne demande de code."
              : "Gérez le contenu, les blocs, les produits et les vendeurs de la vitrine DLX qui vous appartient."}
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nouveau département
          </button>
        )}
      </header>

      {notice && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

      {isAdmin && creating && (
        <div className="grid gap-3 rounded-2xl border border-border/60 p-4 sm:grid-cols-[1fr_1fr_auto_auto]">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="new-dept-name">
              Nom
            </label>
            <input
              id="new-dept-name"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="DLX Beauté"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="new-dept-slug">
              Slug (URL)
            </label>
            <input
              id="new-dept-slug"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
              value={draft.slug}
              onChange={(event) => setDraft((current) => ({ ...current, slug: event.target.value }))}
              placeholder={slugify(draft.name) || "dlx-beaute"}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="new-dept-icon">
              Icône
            </label>
            <select
              id="new-dept-icon"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/40"
              value={draft.icon}
              onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))}
            >
              {["sparkles", "shop", "store", "utensils", "zap"].map((icon) => (
                <option key={icon} value={icon}>{icon}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creatingBusy || !draft.name.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {creatingBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
              Créer
            </button>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-4">
            Le département est créé en brouillon, invisible pour les clients, avec une adresse{" "}
            <code>/d/{slugify(draft.slug || draft.name) || "slug"}</code>.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {departments.map((department, index) => (
          <li key={department.id} className="rounded-2xl border border-border/60 bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${department.accent_from ?? "#0f172a"}, ${
                    department.accent_to ?? "#334155"
                  })`,
                }}
                aria-hidden
              >
                <Sparkles className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">
                  {department.name}
                  {!department.is_active && (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                      brouillon
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {departmentHref(department)} · {department.tagline || "sans sous-titre"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      aria-label="Monter"
                      disabled={index === 0}
                      onClick={() => moveDepartment(index, -1)}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label="Descendre"
                      disabled={index === departments.length - 1}
                      onClick={() => moveDepartment(index, 1)}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      aria-label={department.is_active ? "Dépublier" : "Publier"}
                      onClick={() => toggleActive(department, "is_active")}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"
                    >
                      {department.is_active ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
                    </button>
                    <button
                      type="button"
                      aria-label={department.show_in_navigation ? "Retirer de la navigation" : "Ajouter à la navigation"}
                      onClick={() => toggleActive(department, "show_in_navigation")}
                      className={`rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase transition hover:bg-muted ${
                        department.show_in_navigation ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      nav
                    </button>
                  </>
                )}
                <Link
                  href={`/d/${department.slug}`}
                  target="_blank"
                  className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"
                  aria-label="Ouvrir la vitrine"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </Link>
                <button
                  type="button"
                  onClick={() => setEditingId(department.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
                >
                  Gérer
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    aria-label="Supprimer"
                    onClick={() =>
                      ask({
                        title: `Supprimer « ${department.name} » ?`,
                        body: "Ses blocs, sa navigation, ses placements et ses vendeurs curatés seront supprimés. Les produits eux-mêmes ne sont pas supprimés.",
                        confirmLabel: "Supprimer le département",
                        onConfirm: async () => {
                          await deleteDepartment(department.id);
                          setDepartments((current) =>
                            current.filter((row) => row.id !== department.id)
                          );
                          setNotice("Département supprimé.");
                        },
                      })
                    }
                    className="rounded-lg p-1.5 text-destructive transition hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {departments.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center">
          <Store className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-semibold">
            {isAdmin ? "Aucun département" : "Aucune vitrine ne vous est attribuée"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin
              ? "Créez le premier département pour construire une vitrine sans code."
              : "Contactez DLXSTORE pour obtenir une vitrine département."}
          </p>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */

function DepartmentEditor({
  department,
  scope,
  products,
  categories,
  foodVendors,
  shops,
  language,
  onBack,
  onChanged,
  onDeleted,
}: {
  department: Department;
  scope: "admin" | "partner";
  products: Product[];
  categories: Category[];
  foodVendors: FoodVendor[];
  shops: PartnerShop[];
  language: Parameters<typeof departmentStorefrontLabels>[0];
  onBack: () => void;
  onChanged: (next: Department) => void;
  onDeleted: () => void;
}) {
  const isAdmin = scope === "admin";
  const [tab, setTab] = useState<Tab>("content");
  const [sections, setSections] = useState<DepartmentSection[]>([]);
  const [navigation, setNavigation] = useState<DepartmentNavigationItem[]>([]);
  const [placements, setPlacements] = useState<DepartmentPlacement[]>([]);
  const [vendorRows, setVendorRows] = useState<DepartmentVendorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  // Its own instance: the editor is rendered in place of the list, so the list's
  // dialog is not mounted while a department is open.
  const { ask, dialog } = useConfirm();

  const loadChildren = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSections, nextNavigation, nextPlacements, nextVendors] = await Promise.all([
        getDepartmentSectionsForAdmin(department.id),
        getDepartmentNavigationForAdmin(department.id),
        getDepartmentPlacementsForAdmin(department.id),
        getDepartmentVendors(department.id),
      ]);
      setSections(nextSections);
      setNavigation(nextNavigation);
      setPlacements(nextPlacements);
      setVendorRows(nextVendors);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [department.id]);

  useEffect(() => {
    void loadChildren();
  }, [loadChildren]);

  return (
    <div className="space-y-5">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Retour
          </button>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Département</p>
            <h2 className="text-lg font-extrabold tracking-tight">{department.name}</h2>
          </div>
        </div>
        <Link
          href={`/d/${department.slug}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          {departmentHref(department)}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold transition ${
              tab === key
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

      {tab === "content" && (
        <DepartmentBasicsForm
          department={department}
          canManageStructure={isAdmin}
          shops={shops}
          onSaved={(next) => {
            onChanged(next);
            setVersion((value) => value + 1);
          }}
        />
      )}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : (
        <>
          {tab === "sections" && (
            <DepartmentSectionsEditor
              departmentId={department.id}
              sections={sections}
              categories={categories}
              onChanged={(next) => {
                setSections(next);
                setVersion((value) => value + 1);
              }}
            />
          )}

          {tab === "navigation" && (
            <DepartmentNavigationEditor
              departmentId={department.id}
              items={navigation}
              sections={sections}
              onChanged={(next) => {
                setNavigation(next);
                setVersion((value) => value + 1);
              }}
            />
          )}

          {tab === "products" && (
            <DepartmentPlacementsEditor
              departmentId={department.id}
              placements={placements}
              products={products}
              onChanged={(next) => {
                setPlacements(next);
                setVersion((value) => value + 1);
              }}
            />
          )}

          {tab === "vendors" && (
            <DepartmentVendorsEditor
              departmentId={department.id}
              rows={vendorRows}
              foodVendors={foodVendors}
              shops={shops}
              onChanged={(next) => {
                setVendorRows(next);
                setVersion((value) => value + 1);
              }}
            />
          )}

          {tab === "preview" && (
            <DepartmentPreview
              slug={department.slug}
              language={language}
              version={version}
            />
          )}
        </>
      )}

      {isAdmin && (
        <div className="flex justify-end border-t border-border/40 pt-3">
          <button
            type="button"
            onClick={() =>
              ask({
                title: `Supprimer « ${department.name} » ?`,
                body: "Cette action supprime la vitrine et tout son contenu éditorial. Les produits restent.",
                confirmLabel: "Supprimer",
                onConfirm: async () => {
                  await deleteDepartment(department.id);
                  onDeleted();
                },
              })
            }
            className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 px-3 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            Supprimer ce département
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The preview is the real storefront.
 *
 * It renders the same component the public route renders, fed by the same
 * resolver, so what an admin sees here is what a customer gets — including
 * section ordering, hidden blocks, badges and vendor cards. It re-fetches when
 * anything is saved. Pointer events are disabled because a preview must not
 * navigate the admin away.
 */
function DepartmentPreview({
  slug,
  language,
  version,
}: {
  slug: string;
  language: Parameters<typeof departmentStorefrontLabels>[0];
  version: number;
}) {
  const [storefront, setStorefront] = useState<DepartmentStorefrontData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getDepartmentStorefront(slug, { includeInactive: true });
      if (!next) setError("Cette vitrine n'a pas pu être résolue.");
      setStorefront(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Aperçu impossible.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload, version]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Aperçu réel — mêmes données que la page publique. Les liens sont désactivés ici.
        </p>
        <button
          type="button"
          onClick={reload}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
          Rafraîchir
        </button>
      </div>

      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

      <div className="pointer-events-none overflow-hidden rounded-2xl border border-border bg-background p-4">
        {storefront ? (
          <DepartmentStorefrontView
            storefront={storefront}
            labels={departmentStorefrontLabels(language)}
          />
        ) : (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
