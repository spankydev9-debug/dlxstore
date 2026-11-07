"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { languages, translate, type Language } from "../../../lib/i18n";
import { defaultStoreSettings } from "../../../lib/store-config";
import {
  heroDefaults,
  heroDraft,
  resolveHeroCopy,
  sanitizeHref,
  withHeroCopy,
  type HeroField,
} from "../../../lib/homepage-content";
import { getStoreSettings, updateStoreSettings } from "../../../services/db/settings";
import type { HomepageHeroCopy, StoreSettings } from "../../../types";
import { useConfirm } from "../departments/useConfirm";

/**
 * Homepage copy editor.
 *
 * Everything here lands in `settings.value.homepage` (no migration, no code
 * change) and is read back by the storefront hero on the next page load. Each
 * language is edited separately on purpose: the resolver never borrows another
 * language's words, so a French override cannot appear to an English visitor.
 */

const FIELDS: { field: HeroField; label: string; hint: string; multiline?: boolean; href?: boolean }[] = [
  { field: "badge", label: "Bandeau (au-dessus du titre)", hint: "Petite étiquette dorée, ex. « Livraison premium dans tout Goma »." },
  { field: "title", label: "Titre — première ligne", hint: "Affiché en blanc, en très grand." },
  { field: "highlight", label: "Titre — seconde ligne", hint: "Affiché en doré, juste sous la première ligne." },
  { field: "description", label: "Description", hint: "Deux ou trois phrases : ce que le client comprend en 5 secondes.", multiline: true },
  { field: "primary_label", label: "Bouton principal — texte", hint: "Ex. « Découvrir la boutique »." },
  { field: "primary_href", label: "Bouton principal — lien", hint: "/shop, #produits, https://…, mailto:… ou tel:…", href: true },
  { field: "secondary_label", label: "Bouton secondaire — texte", hint: "Ex. « Comment ça marche ? »." },
  { field: "secondary_href", label: "Bouton secondaire — lien", hint: "Lien interne, ancre, https://, mailto: ou tel:.", href: true },
];

const fieldClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground";

type Drafts = Record<Language, Required<HomepageHeroCopy>>;

function seedDrafts(settings: StoreSettings): Drafts {
  const drafts = {} as Drafts;
  for (const { code } of languages) drafts[code] = heroDraft(settings, code);
  return drafts;
}

export default function HomepageControls() {
  const [settings, setSettings] = useState<StoreSettings>(defaultStoreSettings);
  const [language, setLanguage] = useState<Language>("fr");
  const [drafts, setDrafts] = useState<Drafts>(() => seedDrafts(defaultStoreSettings));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const { ask, dialog } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    getStoreSettings()
      .then((store) => {
        if (cancelled) return;
        setSettings(store);
        setDrafts(seedDrafts(store));
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Impossible de charger le contenu de la page d'accueil.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const draft = drafts[language];
  const defaults = heroDefaults(language, translate(language));
  const saved = useMemo(() => heroDraft(settings, language), [settings, language]);
  const dirty = FIELDS.some(({ field }) => draft[field] !== saved[field]);
  const preview = resolveHeroCopy(withHeroCopy(settings, language, draft), language, translate(language));

  function setField(field: HeroField, value: string) {
    setDrafts((current) => ({ ...current, [language]: { ...current[language], [field]: value } }));
    setNotice("");
  }

  async function persist(nextSettings: StoreSettings, message: string) {
    setBusy(true);
    setError("");
    try {
      const stored = await updateStoreSettings(nextSettings);
      setSettings(stored);
      setDrafts(seedDrafts(stored));
      setNotice(message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "L'enregistrement a échoué.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    for (const { field, href } of FIELDS) {
      if (!href) continue;
      const value = draft[field].trim();
      if (value && !sanitizeHref(value)) {
        setNotice("");
        setError(
          `Lien refusé pour « ${field === "primary_href" ? "Bouton principal" : "Bouton secondaire"} » : utilisez /page, #ancre, https://…, mailto:… ou tel:…`
        );
        return;
      }
    }
    await persist(withHeroCopy(settings, language, draft), `Textes de la page d'accueil enregistrés (${language}).`);
  }

  function resetLanguage() {
    ask({
      title: "Réinitialiser cette langue ?",
      body: `Les textes de la page d'accueil en ${language} reviendront aux textes livrés avec le site. Les autres langues ne sont pas touchées.`,
      confirmLabel: "Réinitialiser",
      destructive: true,
      onConfirm: () => persist(withHeroCopy(settings, language, {}), `Textes ${language} réinitialisés.`),
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Page d'accueil</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les textes de la première section (bandeau, titre, description, boutons) de la page d'accueil, langue par
          langue. Un champ vide garde le texte livré avec le site : rien ne peut disparaître par accident.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Langue éditée">
        {languages.map(({ code, label }) => {
          const isActive = code === language;
          const edited = FIELDS.some(({ field }) => drafts[code][field] !== "");
          return (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setLanguage(code);
                setError("");
                setNotice("");
              }}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                isActive
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-card text-foreground hover:border-foreground/40"
              }`}
            >
              {label}
              {edited && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-label="personnalisée" />}
            </button>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          {notice}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <form onSubmit={handleSave} className="grid gap-4 rounded-2xl border border-border bg-card p-5">
          <h3 className="font-semibold">Textes ({language})</h3>
          {FIELDS.map(({ field, label, hint, multiline }) => (
            <div key={field}>
              <label className={labelClass} htmlFor={`hero-${field}`}>
                {label}
              </label>
              {multiline ? (
                <textarea
                  id={`hero-${field}`}
                  rows={3}
                  value={draft[field]}
                  onChange={(event) => setField(field, event.target.value)}
                  placeholder={defaults[field]}
                  className={`mt-1 ${fieldClass}`}
                />
              ) : (
                <input
                  id={`hero-${field}`}
                  value={draft[field]}
                  onChange={(event) => setField(field, event.target.value)}
                  placeholder={defaults[field]}
                  className={`mt-1 ${fieldClass}`}
                />
              )}
              <div className="mt-1 flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {hint} Par défaut : «&nbsp;{defaults[field]}&nbsp;»
                </p>
                {draft[field] !== "" && (
                  <button
                    type="button"
                    onClick={() => setField(field, "")}
                    className="shrink-0 text-xs font-semibold text-primary hover:underline"
                  >
                    Par défaut
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={busy || !dirty}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
              Enregistrer ({language})
            </button>
            <button
              type="button"
              disabled={busy || !FIELDS.some(({ field }) => saved[field] !== "")}
              onClick={resetLanguage}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
              Réinitialiser {language}
            </button>
            {dirty && <span className="text-xs text-muted-foreground">Modifications non enregistrées.</span>}
          </div>
        </form>

        <section aria-label="Aperçu" className="space-y-3">
          <h3 className="font-semibold">Aperçu en direct ({language})</h3>
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-neutral-950 p-6 text-white shadow-xl">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(212,175,55,0.15),transparent_60%)]" />
            <div className="relative space-y-4">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-gold/20 bg-gold/10 px-3 py-1 text-[11px] font-medium text-gold">
                {preview.badge}
              </div>
              <p className="text-2xl font-light leading-tight tracking-tight">
                {preview.title}
                <br />
                <span className="bg-gradient-to-r from-gold via-gold-muted to-white bg-clip-text font-bold text-transparent">
                  {preview.highlight}
                </span>
              </p>
              <p className="text-xs leading-relaxed text-neutral-400">{preview.description}</p>
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-black">
                  {preview.primary.label}
                </span>
                <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-semibold">
                  {preview.secondary.label}
                </span>
              </div>
              <p className="text-[11px] text-neutral-500">
                Liens : {preview.primary.href} · {preview.secondary.href}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            L'aperçu utilise les textes en cours d'édition. La page d'accueil publique les affiche après
            enregistrement, dans la langue choisie par le visiteur.
          </p>
        </section>
      </div>
      {dialog}
    </div>
  );
}
