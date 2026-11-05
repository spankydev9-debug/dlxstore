"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Star,
  Store,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import type { FoodVendor, PartnerShop } from "../../../types";
import {
  addDepartmentVendor,
  removeDepartmentVendor,
  reorderDepartmentVendors,
  updateDepartmentVendor,
  type DepartmentVendorRow,
} from "../../../services/db/departments";
import { useConfirm } from "./useConfirm";

/**
 * Curated vendor cards for a department.
 *
 * Both vendor systems in DLX are offered here — partner shops (`vendors`) and
 * restaurants (`food_vendors`) — because merging them into one editor is what
 * lets a `vendor_grid` be generic. Neither table is duplicated or reshaped.
 */

const fieldClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export default function DepartmentVendorsEditor({
  departmentId,
  rows,
  foodVendors,
  shops,
  onChanged,
}: {
  departmentId: string;
  rows: DepartmentVendorRow[];
  foodVendors: FoodVendor[];
  shops: PartnerShop[];
  onChanged: (next: DepartmentVendorRow[]) => void;
}) {
  const { ask, dialog } = useConfirm();
  const [source, setSource] = useState<"food" | "partner">("food");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const ordered = useMemo(
    () => [...rows].sort((a, b) => a.sort_order - b.sort_order),
    [rows]
  );

  const foodById = useMemo(
    () => new Map(foodVendors.map((vendor) => [vendor.id, vendor])),
    [foodVendors]
  );
  const shopById = useMemo(() => new Map(shops.map((shop) => [shop.id, shop])), [shops]);

  const available = useMemo(() => {
    const used = new Set(rows.map((row) => row.food_vendor_id ?? row.vendor_id));
    return source === "food"
      ? foodVendors.filter((vendor) => !used.has(vendor.id))
      : shops.filter((shop) => !used.has(shop.id));
  }, [foodVendors, shops, rows, source]);

  function rowName(row: DepartmentVendorRow): string {
    if (row.food_vendor_id) {
      return foodById.get(row.food_vendor_id)?.name ?? "Restaurant supprimé";
    }
    if (row.vendor_id) {
      const shop = shopById.get(row.vendor_id);
      return shop?.display_name ?? shop?.shop_name ?? shop?.business_name ?? "Boutique supprimée";
    }
    return "—";
  }

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

  async function add() {
    if (!selected) return;
    setBusy("add");
    setError("");
    try {
      const sortOrder = (ordered.at(-1)?.sort_order ?? 0) + 10;
      await addDepartmentVendor({
        department_id: departmentId,
        food_vendor_id: source === "food" ? selected : null,
        vendor_id: source === "partner" ? selected : null,
        sort_order: sortOrder,
        is_active: true,
      });
      // The insert returns no row, so build the local copy from what we sent.
      const created: DepartmentVendorRow = {
        id: `local-${selected}`,
        department_id: departmentId,
        vendor_id: source === "partner" ? selected : null,
        food_vendor_id: source === "food" ? selected : null,
        sort_order: sortOrder,
        is_featured: false,
        label: null,
        is_active: true,
      };
      onChanged([...rows, created]);
      setSelected("");
      setNotice("Vendeur ajouté à la sélection.");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Ajout impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {dialog}

      <div className="grid gap-3 rounded-2xl border border-border/60 p-4 sm:grid-cols-[auto_1fr_auto]">
        <div>
          <label className={labelClass} htmlFor="vendor-source">Type</label>
          <select
            id="vendor-source"
            className={fieldClass}
            value={source}
            onChange={(event) => {
              setSource(event.target.value as "food" | "partner");
              setSelected("");
            }}
          >
            <option value="food">Restaurant DLX Food</option>
            <option value="partner">Boutique partenaire</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="vendor-pick">Vendeur</label>
          <select
            id="vendor-pick"
            className={fieldClass}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="">Choisir…</option>
            {available.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {"name" in vendor ? vendor.name : vendor.business_name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={add}
            disabled={!selected || busy === "add"}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            Ajouter
          </button>
        </div>
      </div>

      {notice && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

      <ul className="space-y-2">
        {ordered.map((row, index) => {
          const Icon = row.food_vendor_id ? UtensilsCrossed : Store;
          const persisted = !row.id.startsWith("local-");
          return (
            <li key={row.id} className="rounded-2xl border border-border/60 bg-card p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-muted">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{rowName(row)}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.food_vendor_id ? "Restaurant" : "Boutique partenaire"}
                    {row.is_active ? "" : " · masqué"}
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
                      const withOrder = next.map((item, position) => ({
                        ...item,
                        sort_order: (position + 1) * 10,
                      }));
                      onChanged(withOrder);
                      run("move", () =>
                        reorderDepartmentVendors(
                          withOrder.filter((item) => !item.id.startsWith("local-")).map((item) => item.id)
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
                      const withOrder = next.map((item, position) => ({
                        ...item,
                        sort_order: (position + 1) * 10,
                      }));
                      onChanged(withOrder);
                      run("move", () =>
                        reorderDepartmentVendors(
                          withOrder.filter((item) => !item.id.startsWith("local-")).map((item) => item.id)
                        )
                      );
                    }}
                    className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={row.is_featured ? "Retirer la mise en avant" : "Mettre en avant"}
                    disabled={!persisted}
                    onClick={() =>
                      run(row.id, async () => {
                        await updateDepartmentVendor(row.id, { is_featured: !row.is_featured });
                        onChanged(
                          rows.map((item) =>
                            item.id === row.id ? { ...item, is_featured: !item.is_featured } : item
                          )
                        );
                      })
                    }
                    className={`rounded-lg p-1.5 transition hover:bg-muted disabled:opacity-30 ${
                      row.is_featured ? "text-amber-500" : "text-muted-foreground"
                    }`}
                  >
                    <Star className={`h-4 w-4 ${row.is_featured ? "fill-amber-400" : ""}`} aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={row.is_active ? "Masquer" : "Afficher"}
                    disabled={!persisted}
                    onClick={() =>
                      run(row.id, async () => {
                        await updateDepartmentVendor(row.id, { is_active: !row.is_active });
                        onChanged(
                          rows.map((item) =>
                            item.id === row.id ? { ...item, is_active: !item.is_active } : item
                          )
                        );
                      })
                    }
                    className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
                  >
                    {row.is_active ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
                  </button>
                  <button
                    type="button"
                    aria-label="Retirer de la sélection"
                    onClick={() =>
                      ask({
                        title: "Retirer ce vendeur ?",
                        body: `« ${rowName(row)} » ne sera plus affiché dans ce département.`,
                        confirmLabel: "Retirer",
                        onConfirm: async () => {
                          if (persisted) await removeDepartmentVendor(row.id);
                          onChanged(rows.filter((item) => item.id !== row.id));
                        },
                      })
                    }
                    className="rounded-lg p-1.5 text-destructive transition hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
              <div className="mt-2">
                <input
                  aria-label="Badge du vendeur"
                  className={`${fieldClass} max-w-xs text-xs`}
                  defaultValue={row.label ?? ""}
                  placeholder="Badge (ex. Nouveau partenaire)"
                  disabled={!persisted}
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    if (value === (row.label ?? "")) return;
                    run(row.id, async () => {
                      await updateDepartmentVendor(row.id, { label: value || null });
                      onChanged(
                        rows.map((item) =>
                          item.id === row.id ? { ...item, label: value || null } : item
                        )
                      );
                    });
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {ordered.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Aucun vendeur sélectionné. Une grille « sélection curatée » sera vide.
        </p>
      )}
    </div>
  );
}
