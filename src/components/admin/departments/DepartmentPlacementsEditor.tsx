"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Search,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import type { Product } from "../../../types";
import {
  addDepartmentPlacement,
  removeDepartmentPlacement,
  reorderDepartmentPlacements,
  updateDepartmentPlacement,
  type DepartmentPlacement,
} from "../../../services/db/departments";
import { formatMoney } from "../../../lib/format";
import { useConfirm } from "./useConfirm";

/**
 * Which products appear in this department, in what order, with what badge.
 *
 * This is the surface that makes `source: "placements"` real: a product placed
 * here is *the same* product row as everywhere else, so changing its price once
 * changes it in every department. `label` is per-placement, which is why the
 * same item can read "Best-seller" in Energy and nothing in Shop.
 */

const fieldClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";

export default function DepartmentPlacementsEditor({
  departmentId,
  placements,
  products,
  onChanged,
}: {
  departmentId: string;
  placements: DepartmentPlacement[];
  products: Product[];
  onChanged: (next: DepartmentPlacement[]) => void;
}) {
  const { ask, dialog } = useConfirm();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const ordered = useMemo(
    () => [...placements].sort((a, b) => a.sort_order - b.sort_order),
    [placements]
  );
  const placed = useMemo(
    () => new Set(placements.map((placement) => placement.product_id)),
    [placements]
  );

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return products
      .filter((product) => !placed.has(product.id))
      .filter(
        (product) =>
          product.name.toLowerCase().includes(needle) ||
          product.brand?.toLowerCase().includes(needle) ||
          product.sku?.toLowerCase().includes(needle)
      )
      .slice(0, 8);
  }, [products, placed, query]);

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

  async function place(product: Product) {
    setBusy(product.id);
    setError("");
    try {
      await addDepartmentPlacement({
        department_id: departmentId,
        product_id: product.id,
        sort_order: (ordered.at(-1)?.sort_order ?? 0) + 10,
        is_active: true,
      });
      onChanged([
        ...placements,
        {
          department_id: departmentId,
          product_id: product.id,
          is_primary: false,
          is_featured: false,
          sort_order: (ordered.at(-1)?.sort_order ?? 0) + 10,
          label: null,
          is_active: true,
          product,
        },
      ]);
      setQuery("");
      setNotice(`« ${product.name} » placé dans le département.`);
    } catch (placeError) {
      setError(placeError instanceof Error ? placeError.message : "Ajout impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {dialog}

      <div className="rounded-2xl border border-border/60 p-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="placement-search">
          Ajouter un produit
        </label>
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input
            id="placement-search"
            className={`${fieldClass} pl-9`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher par nom, marque ou SKU…"
          />
        </div>
        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-border/60 rounded-xl border border-border">
            {results.map((product) => (
              <li key={product.id} className="flex items-center gap-3 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {product.brand} · {formatMoney(product.discount_price ?? product.price)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => place(product)}
                  // One placement at a time: `place()` computes its sort_order
                  // from the current list, so two simultaneous clicks would
                  // both append at the same position.
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
                >
                  {busy === product.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Placer
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim() && results.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Aucun produit disponible pour cette recherche (les produits déjà placés sont masqués).
          </p>
        )}
      </div>

      {notice && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

      <ul className="space-y-2">
        {ordered.map((placement, index) => (
          <li key={placement.product_id} className="rounded-2xl border border-border/60 bg-card p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {placement.product?.name ?? "Produit introuvable"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {placement.product?.brand ?? "—"} ·{" "}
                  {placement.product ? formatMoney(placement.product.price) : "—"}
                  {placement.is_active ? "" : " · masqué"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Monter"
                  disabled={index === 0 || busy !== null}
                  onClick={() => {
                    const next = [...ordered];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    const withOrder = next.map((row, position) => ({
                      ...row,
                      sort_order: (position + 1) * 10,
                    }));
                    onChanged(withOrder);
                    run("move", () =>
                      reorderDepartmentPlacements(
                        departmentId,
                        withOrder.map((row) => row.product_id)
                      )
                    );
                  }}
                  className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Descendre"
                  disabled={index === ordered.length - 1 || busy !== null}
                  onClick={() => {
                    const next = [...ordered];
                    [next[index + 1], next[index]] = [next[index], next[index + 1]];
                    const withOrder = next.map((row, position) => ({
                      ...row,
                      sort_order: (position + 1) * 10,
                    }));
                    onChanged(withOrder);
                    run("move", () =>
                      reorderDepartmentPlacements(
                        departmentId,
                        withOrder.map((row) => row.product_id)
                      )
                    );
                  }}
                  className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={placement.is_featured ? "Retirer la mise en avant" : "Mettre en avant"}
                  onClick={() =>
                    run(placement.product_id, async () => {
                      await updateDepartmentPlacement(departmentId, placement.product_id, {
                        is_featured: !placement.is_featured,
                      });
                      onChanged(
                        placements.map((row) =>
                          row.product_id === placement.product_id
                            ? { ...row, is_featured: !row.is_featured }
                            : row
                        )
                      );
                    })
                  }
                  className={`rounded-lg p-1.5 transition hover:bg-muted ${
                    placement.is_featured ? "text-amber-500" : "text-muted-foreground"
                  }`}
                >
                  <Star className={`h-4 w-4 ${placement.is_featured ? "fill-amber-400" : ""}`} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={placement.is_active ? "Masquer" : "Afficher"}
                  onClick={() =>
                    run(placement.product_id, async () => {
                      await updateDepartmentPlacement(departmentId, placement.product_id, {
                        is_active: !placement.is_active,
                      });
                      onChanged(
                        placements.map((row) =>
                          row.product_id === placement.product_id
                            ? { ...row, is_active: !row.is_active }
                            : row
                        )
                      );
                    })
                  }
                  className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"
                >
                  {placement.is_active ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
                </button>
                <button
                  type="button"
                  aria-label="Retirer du département"
                  onClick={() =>
                    ask({
                      title: "Retirer ce produit ?",
                      body: `« ${placement.product?.name ?? "Ce produit"} » ne sera plus affiché dans ce département. Le produit lui-même n'est pas supprimé.`,
                      confirmLabel: "Retirer",
                      onConfirm: async () => {
                        await removeDepartmentPlacement(departmentId, placement.product_id);
                        onChanged(
                          placements.filter((row) => row.product_id !== placement.product_id)
                        );
                      },
                    })
                  }
                  className="rounded-lg p-1.5 text-destructive transition hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <input
                aria-label="Badge du produit dans ce département"
                className={`${fieldClass} max-w-xs text-xs`}
                defaultValue={placement.label ?? ""}
                placeholder="Badge (ex. Best-seller) — vide pour aucun"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value === (placement.label ?? "")) return;
                  run(placement.product_id, async () => {
                    await updateDepartmentPlacement(departmentId, placement.product_id, {
                      label: value || null,
                    });
                    onChanged(
                      placements.map((row) =>
                        row.product_id === placement.product_id
                          ? { ...row, label: value || null }
                          : row
                      )
                    );
                  });
                }}
              />
            </div>
          </li>
        ))}
      </ul>

      {ordered.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Aucun produit placé. Une grille « produits placés » sera vide.
        </p>
      )}
    </div>
  );
}
