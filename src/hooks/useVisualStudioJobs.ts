"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelVisualJob,
  canCancelVisualJob,
  canRetryVisualJob,
  createVisualJob,
  getVisualJobs,
  getWardrobeItems,
  isVisualJobActive,
  removeWardrobeItem,
  retryVisualJob,
  saveWardrobeItem,
  VisualStudioUnavailableError,
  type VisualJob,
  type VisualWorkflow,
  type WardrobeItem,
} from "../services/db/visual-studio";
import type { CustomerAvatar, Product, ProductMediaAsset } from "../types";

/** Capability as reported by `/api/visual-studio/status`. */
export type VisualCapability = {
  available: boolean;
  reason:
    | "ready"
    | "provider_not_configured"
    | "provider_not_implemented"
    | "provider_unavailable";
  providerNamePresent: boolean;
  credentialPresent: boolean;
  serviceRolePresent: boolean;
  requiredEnvironment?: readonly string[];
};

export type VisualStudioLoadState =
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_MS = 20000;

type UseVisualStudioJobsArgs = {
  profileId: string | undefined;
  avatar: CustomerAvatar | null;
};

/**
 * Owns the Visual Studio job lifecycle for the workspace.
 *
 * Responsibilities:
 *  - load the job ledger and the wardrobe, and report which failure is real;
 *  - keep polling only while at least one job is genuinely still moving;
 *  - back off as the wait grows, and stop entirely once nothing is active;
 *  - expose cancel/retry as state transitions rather than page reloads.
 *
 * It never fabricates a result: if the job service is unavailable, or the
 * provider is not configured, the returned state says so.
 */
export function useVisualStudioJobs({ profileId, avatar }: UseVisualStudioJobsArgs) {
  const [jobs, setJobs] = useState<VisualJob[]>([]);
  const [wardrobe, setWardrobe] = useState<WardrobeItem[]>([]);
  const [loadState, setLoadState] = useState<VisualStudioLoadState>("loading");
  const [capability, setCapability] = useState<VisualCapability | null>(null);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollDelayRef = useRef(POLL_INTERVAL_MS);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reportError = useCallback((cause: unknown, fallback: string) => {
    if (cause instanceof VisualStudioUnavailableError) {
      setLoadState("unavailable");
      return;
    }
    setError(cause instanceof Error ? cause.message : fallback);
    setLoadState("error");
  }, []);

  const load = useCallback(async () => {
    if (!profileId) {
      setLoadState("unavailable");
      return;
    }
    try {
      const [nextJobs, nextWardrobe] = await Promise.all([
        getVisualJobs(profileId),
        // The wardrobe table is additive and may not be applied yet; a missing
        // wardrobe must not make the whole workspace look broken.
        getWardrobeItemsSafe(profileId),
      ]);
      setJobs(nextJobs);
      setWardrobe(nextWardrobe);
      setError(null);
      setLoadState("ready");
      pollDelayRef.current = POLL_INTERVAL_MS;
    } catch (cause) {
      reportError(cause, "Unable to load your Visual Studio jobs.");
    }
  }, [profileId, reportError]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/visual-studio/status", { cache: "no-store" });
        const body = (await response.json()) as VisualCapability;
        if (!cancelled) setCapability(body);
      } catch {
        // A missing capability signal is itself an honest unavailable state.
        if (!cancelled) {
          setCapability({
            available: false,
            reason: "provider_unavailable",
            providerNamePresent: false,
            credentialPresent: false,
            serviceRolePresent: false,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasActiveJob = jobs.some(isVisualJobActive);

  // Poll only while something is actually moving, and back off so a long wait
  // does not hammer the API. No timer survives an unmount or a full stop.
  useEffect(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (!hasActiveJob) return;

    pollTimerRef.current = setTimeout(() => {
      pollDelayRef.current = Math.min(pollDelayRef.current * 2, MAX_POLL_MS);
      void load();
    }, pollDelayRef.current);

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [hasActiveJob, jobs, load]);

  const request = useCallback(
    async (input: {
      workflow: VisualWorkflow;
      product: Product;
      sourceMedia: ProductMediaAsset;
    }) => {
      if (!profileId) return;
      if (!avatar && input.workflow === "try_on") {
        setError("Save your Avatar before requesting a try-on.");
        return;
      }

      setPendingJobId("new");
      setError(null);
      try {
        const job = await createVisualJob({
          workflow: input.workflow,
          product: input.product,
          sourceMedia: input.sourceMedia,
          avatar: avatar as CustomerAvatar,
        });
        setJobs((current) => [job, ...current]);
      } catch (cause) {
        reportError(cause, "Unable to queue this visual job.");
      } finally {
        setPendingJobId(null);
      }
    },
    [avatar, profileId, reportError]
  );

  const cancel = useCallback(
    async (jobId: string) => {
      setPendingJobId(jobId);
      try {
        const job = await cancelVisualJob(jobId);
        setJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
      } catch (cause) {
        reportError(cause, "Unable to cancel this job.");
      } finally {
        setPendingJobId(null);
      }
    },
    [reportError]
  );

  const retry = useCallback(
    async (jobId: string) => {
      setPendingJobId(jobId);
      try {
        const job = await retryVisualJob(jobId);
        setJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
      } catch (cause) {
        reportError(cause, "Unable to retry this job.");
      } finally {
        setPendingJobId(null);
      }
    },
    [reportError]
  );

  const saveToWardrobe = useCallback(
    async (input: { productId: string; sourceProductImageId?: string | null }) => {
      try {
        const item = await saveWardrobeItem(input);
        setWardrobe((current) => [
          item,
          ...current.filter((entry) => entry.id !== item.id),
        ]);
      } catch (cause) {
        reportError(cause, "Unable to save to your wardrobe.");
      }
    },
    [reportError]
  );

  const removeFromWardrobe = useCallback(
    async (itemId: string) => {
      setWardrobe((current) => current.filter((item) => item.id !== itemId));
      try {
        await removeWardrobeItem(itemId);
      } catch (cause) {
        reportError(cause, "Unable to remove that wardrobe item.");
        await load();
      }
    },
    [load, reportError]
  );

  return {
    jobs,
    wardrobe,
    loadState,
    capability,
    error,
    pendingJobId,
    hasActiveJob,
    isSubmitting: pendingJobId === "new",
    canRetry: canRetryVisualJob,
    canCancel: canCancelVisualJob,
    request,
    cancel,
    retry,
    saveToWardrobe,
    removeFromWardrobe,
    refresh: load,
  };
}

/**
 * The wardrobe table is additive and may not be applied yet, so a missing
 * wardrobe degrades to an empty list instead of making the whole workspace look
 * broken. Any other failure still surfaces.
 */
async function getWardrobeItemsSafe(profileId: string): Promise<WardrobeItem[]> {
  try {
    return await getWardrobeItems(profileId);
  } catch (cause) {
    if (cause instanceof VisualStudioUnavailableError) return [];
    throw cause;
  }
}
