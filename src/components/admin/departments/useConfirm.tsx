"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Modal } from "../../shared/Modal";

/**
 * Reusable destructive-action confirmation.
 *
 * Replaces `window.confirm`, which cannot be relied on here: the admin surface
 * also runs inside the embedded webview, where blocking browser dialogs are
 * either suppressed or freeze the page. This keeps the confirmation inside the
 * app's own overlay system (safe-area aware, keyboard aware, Escape-closable).
 */
export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = (next: ConfirmRequest) => setRequest(next);

  const dialog = request ? (
    <Modal open onClose={() => (busy ? undefined : setRequest(null))} size="sm" ariaLabel={request.title}>
      <div className="space-y-4 p-1">
        <div className="flex items-start gap-3">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${
              request.destructive === false
                ? "bg-primary/10 text-primary"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            <AlertTriangle className="h-4.5 w-4.5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-bold">{request.title}</h2>
            <p className="text-sm text-muted-foreground">{request.body}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setRequest(null)}
            disabled={busy}
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request.onConfirm();
                setRequest(null);
              } finally {
                setBusy(false);
              }
            }}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white transition disabled:opacity-50 ${
              request.destructive === false
                ? "bg-primary hover:bg-primary/90"
                : "bg-destructive hover:bg-destructive/90"
            }`}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            {request.confirmLabel ?? "Confirmer"}
          </button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { ask, dialog };
}
