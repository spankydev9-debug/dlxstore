"use client";

import { FormEvent, useEffect, useState } from "react";
import { Plus, TicketPercent } from "lucide-react";
import { Coupon, CouponAudience, CouponType } from "../../types";
import { getCoupons, saveCoupon, updateCoupon } from "../../services/db/coupons";

const AUDIENCES: { value: CouponAudience; label: string }[] = [
  { value: "all", label: "Tous les clients" },
  { value: "returning", label: "Clients fidèles" },
  { value: "referral", label: "Parrainage" },
  { value: "campaign", label: "Campagne" },
];

function isCouponExpired(coupon: Coupon, now = new Date()): boolean {
  return Boolean(coupon.expires_at && new Date(coupon.expires_at).getTime() < now.getTime());
}

function isCouponExhausted(coupon: Coupon): boolean {
  return coupon.max_uses != null && coupon.used_count >= coupon.max_uses;
}

export function CouponControls() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [code, setCode] = useState("");
  const [type, setType] = useState<CouponType>("percentage");
  const [value, setValue] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [audience, setAudience] = useState<CouponAudience>("all");
  const [active, setActive] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      setCoupons(await getCoupons(true));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de charger les coupons.");
    }
  };

  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setCode("");
    setType("percentage");
    setValue("");
    setMinOrder("");
    setMaxUses("");
    setExpiresAt("");
    setAudience("all");
    setActive(true);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    const numericValue = Number(value);
    if (!trimmedCode || !value || Number.isNaN(numericValue) || numericValue <= 0) return;
    if (type === "percentage" && numericValue > 100) {
      setNotice("Un coupon en pourcentage ne peut pas dépasser 100 %.");
      return;
    }
    setIsSaving(true);
    try {
      await saveCoupon({
        code: trimmedCode,
        type,
        value: numericValue,
        min_order: minOrder !== "" ? Number(minOrder) : 0,
        max_uses: maxUses !== "" ? Number(maxUses) : undefined,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        audience,
        active,
      });
      resetForm();
      await load();
      setNotice("Coupon enregistré.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Le coupon n'a pas été enregistré.");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (coupon: Coupon) => {
    try {
      await updateCoupon(coupon.id, { active: !coupon.active });
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Impossible de modifier le coupon.");
    }
  };

  const isExpired = (coupon: Coupon) => isCouponExpired(coupon);
  const isExhausted = (coupon: Coupon) => isCouponExhausted(coupon);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><TicketPercent className="h-4 w-4" /> Coupons & Promotions</h3>
          <p className="mt-1 text-sm text-muted-foreground">Créez des codes de réduction applicables au checkout (validation côté base de données).</p>
        </div>
        {notice && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs">{notice}</p>}
      </div>

      <form onSubmit={handleSave} className="mt-5 grid gap-3 rounded-xl border border-border bg-muted/20 p-4 md:grid-cols-3">
        <label className="text-sm font-medium">Code
          <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ex. GOMA10" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Type
          <select value={type} onChange={(e) => setType(e.target.value as CouponType)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2">
            <option value="percentage">Pourcentage (%)</option>
            <option value="fixed">Montant fixe ($)</option>
          </select>
        </label>
        <label className="text-sm font-medium">{type === "percentage" ? "Valeur (%)" : "Valeur ($)"}
          <input required type="number" min="0" step="0.5" value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "percentage" ? "Ex. 10" : "Ex. 5"} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Commande minimum $ (optionnel)
          <input type="number" min="0" step="0.5" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="Ex. 20" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Utilisations max (optionnel)
          <input type="number" min="1" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Ex. 100" className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Expiration (optionnel)
          <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2" />
        </label>
        <label className="text-sm font-medium">Audience
          <select value={audience} onChange={(e) => setAudience(e.target.value as CouponAudience)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2">
            {AUDIENCES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium pt-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4.5 w-4.5 rounded border-border text-primary" />
          Actif dès la création
        </label>
        <div className="md:col-span-3 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={resetForm} className="rounded-full border border-border px-4 py-2 text-sm font-semibold">Annuler</button>
          <button disabled={isSaving} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            <Plus className="h-4 w-4" />
            Ajouter le coupon
          </button>
        </div>
      </form>

      <div className="mt-5 divide-y divide-border">
        {coupons.length ? coupons.map((coupon) => (
          <article key={coupon.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-semibold">
                {coupon.code}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {coupon.type === "percentage" ? `-${coupon.value} %` : `-${coupon.value} $`}
                  {coupon.min_order > 0 && ` · Min. ${coupon.min_order} $`}
                  {` · ${AUDIENCES.find((a) => a.value === coupon.audience)?.label ?? coupon.audience}`}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {coupon.used_count}{coupon.max_uses != null ? `/${coupon.max_uses}` : ""} utilisation{coupon.used_count === 1 ? "" : "s"}
                {coupon.expires_at && ` · Expire le ${new Date(coupon.expires_at).toLocaleDateString()}`}
                {isExpired(coupon) && " · Expiré"}
                {isExhausted(coupon) && " · Épuisé"}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void toggleActive(coupon)}
                className={`rounded px-3 py-2 text-xs font-semibold ${coupon.active && !isExpired(coupon) && !isExhausted(coupon) ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}
              >
                {coupon.active ? "Actif" : "Inactif"}
              </button>
            </div>
          </article>
        )) : <p className="py-5 text-sm text-muted-foreground">Aucun coupon configuré.</p>}
      </div>
    </section>
  );
}
