"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  createDepartmentNavigation,
  deleteDepartmentNavigation,
  reorderDepartmentNavigation,
  updateDepartmentNavigation,
  type DepartmentNavigationItem,
  type DepartmentSection,
} from "../../../services/db/departments";
import { useConfirm } from "./useConfirm";

/**
 * In-department navigation.
 *
 * `href` is either a route (`/shop?sort=new`) or an anchor (`#products`); the
 * anchors offered as suggestions are read from the sections that actually
 * declare one, so an admin cannot create a link that scrolls nowhere.
 */

const fieldClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

export default function DepartmentNavigationEditor({
  departmentId,
  items,
  sections,
  onChanged,
}: {
  departmentId: string;
  items: DepartmentNavigationItem[];
  sections: DepartmentSection[];
  onChanged: (next: DepartmentNavigationItem[]) => void;
}) {
  const { ask, dialog } = useConfirm();
  const [label, setLabel] = useState("");
  const [href, setHref] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const ordered = useMemo(
    () => [...items].sort((a, b) => a.sort_order - b.sort_order),
    [items]
  );
  const anchors = useMemo(
    () =>
      sections
        .map((section) => section.config.anchor)
        .filter((anchor): anchor is string => Boolean(anchor)),
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

  async function addItem(event: FormEvent) {
    event.preventDefault();
    const trimmedLabel = label.trim();
    const trimmedHref = href.trim();
    if (!trimmedLabel || !trimmedHref) return;
    setBusy("add");
    setError("");
    try {
      const created = await createDepartmentNavigation({
        department_id: departmentId,
        label: trimmedLabel,
        href: trimmedHref.startsWith("#") || trimmedHref.startsWith("/")
          ? trimmedHref
          : `#${trimmedHref}`,
        sort_order: (ordered.at(-1)?.sort_order ?? 0) + 10,
        is_active: true,
      });
      onChanged([...items, created]);
      setLabel("");
      setHref("");
      setNotice("Lien ajouté.");
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Ajout impossible.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {dialog}

      <form onSubmit={addItem} className="grid gap-3 rounded-2xl border border-border/60 p-4 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label className={labelClass} htmlFor="nav-label">Libellé</label>
          <input id="nav-label" className={fieldClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Nouveautés" />
        </div>
        <div>
          <label className={labelClass} htmlFor="nav-href">Lien</label>
          <input id="nav-href" className={fieldClass} value={href} onChange={(event) => setHref(event.target.value)} placeholder="#products ou /shop?sort=new" />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={busy === "add" || !label.trim() || !href.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
            Ajouter
          </button>
        </div>
        {anchors.length > 0 && (
          <div className="sm:col-span-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" aria-hidden />
            Ancres disponibles :
            {anchors.map((anchor) => (
              <button
                key={anchor}
                type="button"
                onClick={() => setHref(`#${anchor}`)}
                className="rounded-full border border-border px-2 py-0.5 font-semibold text-foreground hover:bg-muted"
              >
                #{anchor}
              </button>
            ))}
          </div>
        )}
      </form>

      {notice && <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">{notice}</p>}
      {error && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

      <ul className="space-y-2">
        {ordered.map((item, index) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card p-2.5">
            <input
              aria-label="Libellé"
              className={`${fieldClass} max-w-44`}
              defaultValue={item.label}
              onBlur={(event) =>
                event.target.value !== item.label &&
                run(item.id, async () => {
                  await updateDepartmentNavigation(item.id, { label: event.target.value });
                  onChanged(
                    items.map((row) =>
                      row.id === item.id ? { ...row, label: event.target.value } : row
                    )
                  );
                })
              }
            />
            <input
              aria-label="Lien"
              className={`${fieldClass} max-w-56`}
              defaultValue={item.href}
              onBlur={(event) =>
                event.target.value !== item.href &&
                run(item.id, async () => {
                  await updateDepartmentNavigation(item.id, { href: event.target.value });
                  onChanged(
                    items.map((row) =>
                      row.id === item.id ? { ...row, href: event.target.value } : row
                    )
                  );
                })
              }
            />
            <span className="ml-auto flex items-center gap-1">
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
                  run("move", () => reorderDepartmentNavigation(withOrder.map((row) => row.id)));
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
                  run("move", () => reorderDepartmentNavigation(withOrder.map((row) => row.id)));
                }}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                aria-label={item.is_active ? "Masquer" : "Afficher"}
                onClick={() =>
                  run(item.id, async () => {
                    await updateDepartmentNavigation(item.id, { is_active: !item.is_active });
                    onChanged(
                      items.map((row) =>
                        row.id === item.id ? { ...row, is_active: !row.is_active } : row
                      )
                    );
                  })
                }
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-muted"
              >
                {item.is_active ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
              </button>
              <button
                type="button"
                aria-label="Supprimer"
                onClick={() =>
                  ask({
                    title: "Supprimer ce lien ?",
                    body: `« ${item.label} » ne sera plus proposé dans la navigation du département.`,
                    confirmLabel: "Supprimer",
                    onConfirm: async () => {
                      await deleteDepartmentNavigation(item.id);
                      onChanged(items.filter((row) => row.id !== item.id));
                    },
                  })
                }
                className="rounded-lg p-1.5 text-destructive transition hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </span>
          </li>
        ))}
      </ul>

      {ordered.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Aucun lien. La vitrine s&apos;affiche sans barre de navigation.
        </p>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Save className="h-3.5 w-3.5" aria-hidden />
        Les champs s&apos;enregistrent automatiquement en quittant.
      </p>
    </div>
  );
}
