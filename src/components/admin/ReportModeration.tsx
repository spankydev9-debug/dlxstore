"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, X, Eye } from "lucide-react";
import { adminGetReports, adminUpdateReportStatus } from "../../services/db/safety";
import type { AbuseReport, ReportStatus } from "../../types";

const STATUS_LABELS: Record<ReportStatus, string> = {
  pending: "Pending",
  reviewed: "Reviewed",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

const TYPE_LABELS: Record<string, string> = {
  harassment: "Harassment",
  spam: "Spam",
  inappropriate_content: "Inappropriate Content",
  fake_account: "Fake Account",
  other: "Other",
};

export function ReportModeration() {
  const [reports, setReports] = useState<AbuseReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<ReportStatus | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const loadReports = async () => {
    setLoading(true);
    try {
      const data = await adminGetReports(filterStatus);
      setReports(data);
    } catch (err) {
      console.error("Error loading reports:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, [filterStatus]);

  const handleUpdateStatus = async (reportId: string, status: ReportStatus) => {
    setUpdating(reportId);
    try {
      await adminUpdateReportStatus(reportId, status);
      await loadReports();
    } catch (err) {
      console.error("Error updating report:", err);
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          Abuse Reports
        </h3>
        <div className="flex gap-2">
          <select
            value={filterStatus || "all"}
            onChange={(e) => setFilterStatus((e.target.value === "all" ? null : e.target.value as ReportStatus))}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <button
            type="button"
            onClick={() => void loadReports()}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : reports.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">No reports found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <div
              key={report.id}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      {TYPE_LABELS[report.report_type] || report.report_type}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      {STATUS_LABELS[report.status]}
                    </span>
                  </div>
                  {report.description && (
                    <p className="text-sm text-foreground mb-2">{report.description}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Reported: {new Date(report.created_at).toLocaleString()}
                  </p>
                </div>

                <div className="flex gap-1.5">
                  {report.status === "pending" && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleUpdateStatus(report.id, "resolved")}
                        disabled={updating === report.id}
                        className="inline-flex min-h-11 items-center rounded-lg border border-green-500/50 px-3 text-xs font-bold text-green-700 hover:bg-green-500/10 disabled:opacity-50"
                      >
                        {updating === report.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdateStatus(report.id, "dismissed")}
                        disabled={updating === report.id}
                        className="inline-flex min-h-11 items-center rounded-lg border border-destructive/50 px-3 text-xs font-bold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                      >
                        {updating === report.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </>
                  )}
                  {report.status === "resolved" && (
                    <button
                      type="button"
                      onClick={() => void handleUpdateStatus(report.id, "pending")}
                      disabled={updating === report.id}
                      className="inline-flex min-h-11 items-center rounded-lg border border-border px-3 text-xs font-bold text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      Reopen
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
