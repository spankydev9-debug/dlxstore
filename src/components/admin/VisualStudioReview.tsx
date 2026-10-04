"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ImageIcon,
  Loader2,
  LockKeyhole,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  VisualStudioUnavailableError,
  type VisualJob,
  type VisualWorkflow,
} from "../../services/db/visual-studio";
import { supabase, isSupabaseConfigured } from "../../services/db/index";
import { ProductImage } from "../shared/ProductImage";

type PromoteState = "idle" | "pending" | "done" | "unavailable" | "error";

/**
 * Admin review queue for the Ghost Mannequin / product-visualization workflow.
 *
 * This is the explicit human-approval gate. An operator reviews a generated
 * result and only then may it be published into the public catalogue. Nothing
 * here is ever automatic, and the original supplier image is never modified.
 *
 * The publish step additionally requires moving the object from the private
 * `visual-workspace` bucket into the public `product-images` bucket, which needs
 * a service-role credential this project does not have. Until that credential
 * exists the control reports the missing dependency instead of pretending the
 * asset was published.
 */
export function VisualStudioReview() {
  const [jobs, setJobs] = useState<VisualJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [state, setState] = useState<PromoteState>("idle");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setUnavailable(true);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("try_on_jobs")
        .select(
          "id, profile_id, product_id, avatar_id, workflow, request_key, status, " +
            "provider, provider_job_id, source_product_image_id, result_asset_path, " +
            "result_image_url, approved_product_image_id, error, error_code, " +
            "attempt_count, constraints, created_at, updated_at, started_at, completed_at"
        )
        .in("workflow", ["product_visualization", "ghost_mannequin"])
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw new Error(error.message);
      setJobs((data ?? []) as unknown as VisualJob[]);
      setLoadError(null);
    } catch (cause) {
      if (cause instanceof VisualStudioUnavailableError) {
        setUnavailable(true);
      } else {
        setLoadError(
          cause instanceof Error ? cause.message : "Impossible de charger les visuels."
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const promote = useCallback(
    async (job: VisualJob) => {
      setActiveJobId(job.id);
      setNotice(null);

      if (!job.result_asset_path) {
        setState("error");
        setNotice("Ce visuel n'a pas de fichier généré à publier.");
        setActiveJobId(null);
        return;
      }

      setState("pending");
      try {
        const response = await fetch(`/api/visual-studio/jobs/${job.id}/promote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // The public URL is derived by the server-side copy step. Until that
            // step can run, sending the stored path is enough for the route to
            // report the exact missing dependency.
            publicUrl: `pending://${job.result_asset_path}`,
            storageObjectPath: job.result_asset_path,
          }),
        });
        const body = (await response.json()) as { error?: string; detail?: string };

        if (response.ok) {
          setState("done");
          setNotice("Visuel approuvé et ajouté au catalogue.");
          await load();
        } else if (body.error === "service_role_required") {
          setState("unavailable");
          setNotice(
            body.detail ??
              "SUPABASE_SERVICE_ROLE_KEY est requis pour publier un visuel généré."
          );
        } else {
          setState("error");
          setNotice(body.detail ?? body.error ?? "Publication refusée.");
        }
      } catch {
        setState("error");
        setNotice("Impossible de contacter le serveur de publication.");
      } finally {
        setActiveJobId(null);
      }
    },
    [load]
  );

  if (loading) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement des visuels générés…
      </p>
    );
  }

  if (unavailable) {
    return (
      <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
        Le système de visuels n&apos;est pas encore activé sur cette installation
        (migration non appliquée).
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Wand2 className="h-5 w-5 text-primary" />
          Validation des visuels IA
        </h2>
        <p className="text-sm text-muted-foreground">
          Un opérateur approuve chaque visuel avant sa publication dans le
          catalogue. Rien n&apos;est publié automatiquement, et la photo
          originale du fournisseur n&apos;est jamais modifiée.
        </p>
      </header>

      {notice ? (
        <p
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            state === "unavailable"
              ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
              : state === "done"
                ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                : "border-destructive/40 text-destructive"
          }`}
        >
          {state === "unavailable" ? (
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          ) : state === "done" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          {notice}
        </p>
      ) : null}

      {loadError ? (
        <p className="rounded-xl border border-destructive/40 p-3 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}

      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Aucun visuel IA en attente de validation.
        </p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center"
            >
              <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                {job.result_image_url ? (
                  <ProductImage
                    src={job.result_image_url}
                    alt="Visuel généré"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {workflowLabel(job.workflow)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(job.created_at).toLocaleString()} · statut :{" "}
                  {job.status}
                  {job.attempt_count > 0 ? ` · tentative ${job.attempt_count + 1}` : ""}
                </p>
                {job.error ? (
                  <p className="mt-1 text-xs text-destructive">{job.error}</p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {job.approved_product_image_id ? (
                  <span className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Publié
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void promote(job)}
                    disabled={
                      activeJobId === job.id ||
                      job.status !== "completed" ||
                      !job.result_asset_path
                    }
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {activeJobId === job.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Approuver et publier
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function workflowLabel(workflow: VisualWorkflow): string {
  if (workflow === "ghost_mannequin") return "Ghost Mannequin";
  if (workflow === "product_visualization") return "Visualisation produit";
  return "Essayage";
}
