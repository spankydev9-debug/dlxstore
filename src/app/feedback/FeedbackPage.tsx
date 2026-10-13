"use client";

import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { createFeedback, type FeedbackCategory } from "../../services/db/feedback";

const CATEGORIES: Array<{ value: FeedbackCategory; label: string }> = [
  { value: "bug", label: "Bug Report" },
  { value: "order_delivery", label: "Order/Delivery" },
  { value: "product", label: "Product" },
  { value: "payment", label: "Payment" },
  { value: "suggestion", label: "Suggestion" },
  { value: "other", label: "Other" },
];

export default function FeedbackPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState<FeedbackCategory>("suggestion");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) {
      setError("Please enter a message");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await createFeedback({
        category,
        message: message.trim(),
        device_info: typeof navigator !== "undefined" ? navigator.userAgent : null,
        metadata: {
          user_email: user?.email ?? null,
          path: typeof window !== "undefined" ? window.location.pathname : null,
        },
      });
      setSuccess(true);
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit feedback");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto max-w-2xl py-12 px-4">
      <h1 className="text-3xl font-bold tracking-tight">Feedback</h1>
      <p className="mt-3 text-muted-foreground">Help us improve DLXSTORE by sharing your feedback.</p>

      {success && (
        <div className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm">
          Thank you for your feedback. We will review it shortly.
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm min-h-[120px]"
            placeholder="Tell us what happened or what you'd like to see..."
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Submitting..." : "Submit Feedback"}
        </button>

        {user && (
          <p className="text-xs text-muted-foreground">Submitting as {user.email}</p>
        )}
      </form>
    </section>
  );
}
