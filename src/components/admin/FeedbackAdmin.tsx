"use client";

import { useEffect, useState } from "react";
import { listFeedbacks, updateFeedbackStatus, FeedbackUnavailableError, type Feedback, type FeedbackStatus, type FeedbackCategory } from "../../services/db/feedback";
import { useLanguage } from "../../context/LanguageContext";

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "new", label: "New" },
  { value: "in_review", label: "In Review" },
  { value: "resolved", label: "Resolved" },
];

const CATEGORY_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "bug", label: "Bug" },
  { value: "order_delivery", label: "Order/Delivery" },
  { value: "product", label: "Product" },
  { value: "payment", label: "Payment" },
  { value: "suggestion", label: "Suggestion" },
  { value: "other", label: "Other" },
];

export default function FeedbackAdmin() {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const filters: { status?: FeedbackStatus | null; category?: FeedbackCategory | null } = {};
      if (statusFilter) filters.status = statusFilter as FeedbackStatus;
      if (categoryFilter) filters.category = categoryFilter as FeedbackCategory;
      const data = await listFeedbacks(filters);
      setFeedbacks(data);
      setUnavailable(false);
    } catch (err) {
      if (err instanceof FeedbackUnavailableError) {
        // The table is not created yet on this installation. Show that truth
        // rather than an empty list an admin might read as "no feedback".
        setFeedbacks([]);
        setUnavailable(true);
      } else {
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, categoryFilter]);

  const handleStatusChange = async (id: string, status: FeedbackStatus) => {
    try {
      await updateFeedbackStatus(id, status);
      void load();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Feedback Management</h2>
          <p className="text-muted-foreground">Review and manage customer feedback.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          {CATEGORY_FILTERS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left text-xs font-semibold text-muted-foreground px-6 py-3">Created</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-6 py-3">Category</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-6 py-3">Message</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-6 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-6 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-sm text-muted-foreground text-center">
                    Loading...
                  </td>
                </tr>
              ) : unavailable ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-sm text-muted-foreground text-center">
                    Feedback is not available yet. The feedback system migration has not been applied on this installation.
                  </td>
                </tr>
              ) : feedbacks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-sm text-muted-foreground text-center">
                    No feedback found
                  </td>
                </tr>
              ) : (
                feedbacks.map((f) => (
                  <tr key={f.id}>
                    <td className="px-6 py-3 text-sm">
                      {new Date(f.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-3 text-sm capitalize">{f.category.replace("_", " ")}</td>
                    <td className="px-6 py-3 text-sm max-w-md truncate" title={f.message}>
                      {f.message}
                    </td>
                    <td className="px-6 py-3 text-sm">
                      <span className="inline-flex rounded-full bg-muted px-2 py-1 text-xs">
                        {f.status === "new" ? "New" : f.status === "in_review" ? "In Review" : "Resolved"}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-sm">
                      <select
                        value={f.status}
                        onChange={(e) => handleStatusChange(f.id, e.target.value as FeedbackStatus)}
                        className="rounded border border-border bg-background px-2 py-1 text-xs"
                      >
                        <option value="new">New</option>
                        <option value="in_review">In Review</option>
                        <option value="resolved">Resolved</option>
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
