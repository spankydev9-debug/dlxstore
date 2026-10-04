"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Banknote,
  Check,
  Loader2,
  Package,
  Percent,
  RefreshCw,
  Store,
  Truck,
  Users,
  X
} from "lucide-react";
import { CommissionLedgerEntry, CommissionLedgerStatus, PartnerApplication, PayoutStatus, VendorPayout } from "../../types";
import { getPartnerApplications } from "../../services/db/partner-applications";
import {
  approvePartnerApplication,
  getMarketplaceOverview,
  listCommissionLedger,
  listPayouts,
  settlePayout,
  updatePartnerApplicationStatus
} from "../../services/db/marketplace";
import { StatCard } from "./StatCard";
import { formatMoney } from "../../lib/format";

type Section = "applications" | "payouts" | "ledger";

const PAYOUT_LABEL: Record<PayoutStatus, string> = {
  requested: "Demandée",
  processing: "En cours",
  paid: "Payée",
  cancelled: "Annulée"
};

const PAYOUT_TONE: Record<PayoutStatus, string> = {
  requested: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  processing: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground"
};

/**
 * Marketplace operations for DLX staff: approving sellers and settling payouts.
 *
 * Both actions are deliberately routed through RPCs rather than table writes.
 * Marking an application "approved" by hand would skip vendor creation entirely,
 * and a payout must move the ledger rows with it in one transaction. The console
 * therefore refuses to do anything the database would not let it do anyway.
 */
export function MarketplaceConsole() {
  const [section, setSection] = useState<Section>("applications");
  const [overview, setOverview] = useState<{
    active_vendor_count: number;
    pending_application_count: number;
    open_payout_count: number;
    open_payout_net: number;
    pending_sub_order_count: number;
    delivered_sub_order_count: number;
    commission_earned: number;
    commission_paid: number;
  } | null>(null);
  const [applications, setApplications] = useState<PartnerApplication[]>([]);
  const [payouts, setPayouts] = useState<VendorPayout[]>([]);
  const [ledger, setLedger] = useState<CommissionLedgerEntry[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const [ov, apps, pays, led] = await Promise.all([
        getMarketplaceOverview(),
        getPartnerApplications(),
        listPayouts(null),
        listCommissionLedger()
      ]);
      setOverview(ov);
      setApplications(apps);
      setPayouts(pays);
      setLedger(led);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger la marketplace.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // `load` deliberately never sets isLoading back to true. Doing so would make
  // this mount effect call setState synchronously, which cascades an extra
  // render on every visit; the explicit refresh below owns that flag instead.
  useEffect(() => { void load(); }, [load]);

  const run = async (id: string, action: () => Promise<unknown>, success: string) => {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "L'opération a échoué.");
    } finally {
      setBusyId(null);
    }
  };

  const pendingApplications = applications.filter((a) => a.status === "pending" || a.status === "reviewing");
  const openPayouts = payouts.filter((p) => p.status === "requested" || p.status === "processing");
  const closedPayouts = payouts.filter((p) => p.status === "paid" || p.status === "cancelled");

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {overview && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Vendeurs actifs" value={overview.active_vendor_count} icon={Store} />
          <StatCard label="Commandes vendors en attente" value={overview.pending_sub_order_count} icon={Package} />
          <StatCard label="Payouts ouverts" value={overview.open_payout_count} icon={Banknote}
            hint={formatMoney(overview.open_payout_net)} />
          <StatCard label="Commissions encaissées" value={formatMoney(overview.commission_earned)} icon={Percent}
            hint={`${formatMoney(overview.commission_paid)} versées`} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full border border-border p-1">
          <SectionTab active={section === "applications"} onClick={() => setSection("applications")}
            icon={Users} label={`Demandes (${pendingApplications.length})`} />
          <SectionTab active={section === "payouts"} onClick={() => setSection("payouts")}
            icon={Banknote} label={`Payouts (${openPayouts.length})`} />
          <SectionTab active={section === "ledger"} onClick={() => setSection("ledger")}
            icon={Percent} label="Journal des commissions" />
        </div>
        <button type="button" onClick={() => { setIsLoading(true); void load(); }}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold">
          <RefreshCw className="h-4 w-4" /> Actualiser
        </button>
      </div>

      {notice && <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
      {error && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {section === "ledger" ? (
        <LedgerSection entries={ledger} />
      ) : section === "applications" ? (
        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <h2 className="text-lg font-bold">Demandes de partenariat</h2>
          <p className="text-sm text-muted-foreground">
            Approuver crée la boutique vendeur et fixe la commission. Une demande approuvée à la main
            n&apos;aurait jamais de vendeur rattaché.
          </p>
          <div className="mt-4 divide-y divide-border">
            {pendingApplications.length ? pendingApplications.map((application) => (
              <ApplicationRow
                key={application.id}
                application={application}
                busy={busyId === application.id}
                onReview={() => run(application.id,
                  () => updatePartnerApplicationStatus(application.id, "reviewing"),
                  "Demande marquée en cours de révision.")}
                onDecline={() => run(application.id,
                  () => updatePartnerApplicationStatus(application.id, "declined"),
                  "Demande refusée.")}
                onApprove={(rate) => run(application.id,
                  () => approvePartnerApplication(application.id, rate),
                  `Boutique « ${application.business_name} » créée et activée.`)}
              />
            )) : <p className="py-5 text-sm text-muted-foreground">Aucune demande en attente.</p>}
          </div>
        </section>
      ) : (
        <section className="space-y-6">
          <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <h2 className="text-lg font-bold">Payouts en attente</h2>
            <p className="text-sm text-muted-foreground">
              Marquer « payée » débite réellement le compte du vendeur. Annuler libère les montants
              pour une nouvelle demande.
            </p>
            <div className="mt-4 divide-y divide-border">
              {openPayouts.length ? openPayouts.map((payout) => (
                <PayoutRow
                  key={payout.id}
                  payout={payout}
                  busy={busyId === payout.id}
                  onMarkProcessing={() => run(payout.id,
                    () => settlePayout(payout.id, "processing"), "Payout marqué en cours.")}
                  onPay={() => run(payout.id,
                    () => settlePayout(payout.id, "paid"), "Payout réglé et commissions soldées.")}
                  onCancel={() => run(payout.id,
                    () => settlePayout(payout.id, "cancelled"), "Payout annulé, montants libérés.")}
                />
              )) : <p className="py-5 text-sm text-muted-foreground">Aucun payout en attente.</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
            <h2 className="text-lg font-bold">Historique des payouts</h2>
            <div className="mt-4 divide-y divide-border">
              {closedPayouts.length ? closedPayouts.map((payout) => (
                <PayoutRow key={payout.id} payout={payout} busy={false} />
              )) : <p className="py-5 text-sm text-muted-foreground">Aucun payout réglé pour l&apos;instant.</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function SectionTab({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: typeof Store; label: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}

function ApplicationRow({ application, busy, onReview, onDecline, onApprove }: {
  application: PartnerApplication;
  busy: boolean;
  onReview: () => void;
  onDecline: () => void;
  onApprove: (commissionRate: number | undefined) => void;
}) {
  const [rate, setRate] = useState("");

  return (
    <article className="flex flex-wrap items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{application.business_name}</p>
        <p className="text-xs text-muted-foreground">
          {application.owner_name} · {application.business_category} · {application.city}, {application.province}
        </p>
        {application.phone && <p className="text-xs text-muted-foreground">{application.phone}{application.email ? ` · ${application.email}` : ""}</p>}
        {application.description && <p className="mt-2 text-sm">{application.description}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs font-semibold">
          Commission %
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="10"
            className="w-20 rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-normal" />
        </label>
        <button type="button" disabled={busy} onClick={onReview}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">En revue</button>
        <button type="button" disabled={busy} onClick={onDecline}
          className="inline-flex items-center gap-1 rounded-full border border-destructive/30 px-3 py-1.5 text-xs font-semibold text-destructive disabled:opacity-50">
          <X className="h-3.5 w-3.5" /> Refuser
        </button>
        <button type="button" disabled={busy} onClick={() => onApprove(rate.trim() === "" ? undefined : Number(rate))}
          className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approuver
        </button>
      </div>
    </article>
  );
}

const LEDGER_LABEL: Record<CommissionLedgerStatus, string> = {
  pending: "En attente",
  earned: "Acquise",
  paid: "Payée",
  reversed: "Annulée"
};

const LEDGER_KIND: Record<string, string> = {
  sale: "Vente",
  reversal: "Annulation",
  payout: "Versement",
  adjustment: "Ajustement"
};

const LEDGER_TONE: Record<CommissionLedgerStatus, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  earned: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  paid: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  reversed: "bg-muted text-muted-foreground"
};

/**
 * The commission audit trail. Every figure the payout screens move passes
 * through this table, so it is the only place DLX can answer "why is this
 * seller owed this?". `amount` is DLX's cut, never the seller's revenue.
 */
function LedgerSection({ entries }: { entries: CommissionLedgerEntry[] }) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <h2 className="text-lg font-bold">Journal des commissions</h2>
      <p className="text-sm text-muted-foreground">
        Chaque commission est figée au taux de la vente, n&apos;est acquise qu&apos;à la livraison,
        et revient en cas d&apos;annulation. Les montants affichés sont la part DLX.
      </p>
      <div className="mt-4 divide-y divide-border">
        {entries.length ? entries.map((entry) => (
          <article key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {LEDGER_KIND[entry.kind] ?? entry.kind}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {entry.rate}% · {entry.currency}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {(entry.order_id ?? entry.sub_order_id ?? entry.id).slice(0, 8)}
                {" · "}
                {new Date(entry.created_at).toLocaleDateString("fr-FR")}
                {entry.reversed_at
                  ? ` · annulée le ${new Date(entry.reversed_at).toLocaleDateString("fr-FR")}`
                  : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-bold tabular-nums">{formatMoney(entry.amount)}</span>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${LEDGER_TONE[entry.status]}`}>
                {LEDGER_LABEL[entry.status]}
              </span>
            </div>
          </article>
        )) : (
          <p className="py-5 text-sm text-muted-foreground">Aucune commission enregistrée.</p>
        )}
      </div>
    </section>
  );
}

function PayoutRow({ payout, busy, onMarkProcessing, onPay, onCancel }: {
  payout: VendorPayout;
  busy: boolean;
  onMarkProcessing?: () => void;
  onPay?: () => void;
  onCancel?: () => void;
}) {
  return (
    <article className="flex flex-wrap items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="font-semibold">{payout.vendor_name ?? payout.vendor_id.slice(0, 8)}</p>
        <p className="text-xs text-muted-foreground">
          {payout.method ? payout.method.replace("_", " ") : "—"} · {payout.account_ref ?? "—"}
        </p>
        <p className="text-xs text-muted-foreground">
          Brut {formatMoney(payout.gross_amount)} · Commission {formatMoney(payout.commission_amount)}
          {payout.entry_count != null ? ` · ${payout.entry_count} ligne(s)` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${PAYOUT_TONE[payout.status]}`}>
          {PAYOUT_LABEL[payout.status]}
        </span>
        <span className="text-lg font-bold">{formatMoney(payout.net_amount)}</span>
        {onMarkProcessing && payout.status === "requested" && (
          <button type="button" disabled={busy} onClick={onMarkProcessing}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50">
            <Truck className="h-3.5 w-3.5" /> En cours
          </button>
        )}
        {onPay && (
          <button type="button" disabled={busy} onClick={onPay}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Payer
          </button>
        )}
        {onCancel && (
          <button type="button" disabled={busy} onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-full border border-destructive/30 px-3 py-1.5 text-xs font-semibold text-destructive disabled:opacity-50">
            <X className="h-3.5 w-3.5" /> Annuler
          </button>
        )}
      </div>
    </article>
  );
}
