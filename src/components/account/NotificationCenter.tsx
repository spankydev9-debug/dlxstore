"use client";

import React, { useState } from "react";
import { useNotifications } from "../../context/NotificationContext";
import { useLanguage } from "../../context/LanguageContext";
import { Filter, Check, Trash2, RefreshCw, Settings } from "lucide-react";

type NotificationChannel = "orders" | "social" | "messages" | "rewards" | "system" | null;

export function NotificationCenter() {
  const { t } = useLanguage();
  const {
    notifications,
    unreadCount,
    isLoading,
    activeChannel,
    preferences,
    setActiveChannel,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    deleteReadNotifications,
    refreshNotifications,
    setPreference
  } = useNotifications();

  const [showPreferences, setShowPreferences] = useState(false);

  const handleMarkAllRead = async () => {
    await markAllAsRead(activeChannel ?? undefined);
  };

  const handleClearRead = async () => {
    await deleteReadNotifications();
  };

  const handleRefresh = async () => {
    await refreshNotifications();
  };

  const channelLabels: Record<string, string> = {
    orders: t.orders,
    social: t.social,
    messages: t.messages,
    rewards: t.rewards,
    system: "System"
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-border/40 pb-4">
        <div>
          <h3 className="font-bold text-lg text-foreground">{t.notifications}</h3>
          <p className="text-xs text-muted-foreground">
            {unreadCount > 0 ? `${unreadCount} ${t.unreadLabel}` : t.noNotifications}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-all disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {t.loading}
          </button>
          <button
            onClick={() => setShowPreferences(!showPreferences)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted transition-all"
          >
            <Settings className="h-3.5 w-3.5" />
            {t.notificationPreferences}
          </button>
        </div>
      </div>

      {/* Channel Filter */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        <button
          onClick={() => setActiveChannel(null)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
            activeChannel === null
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {t.all}
        </button>
        <button
          onClick={() => setActiveChannel('orders')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
            activeChannel === 'orders'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {t.orders}
        </button>
        <button
          onClick={() => setActiveChannel('social')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
            activeChannel === 'social'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {t.social}
        </button>
        <button
          onClick={() => setActiveChannel('messages')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
            activeChannel === 'messages'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {t.messages}
        </button>
        <button
          onClick={() => setActiveChannel('rewards')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
            activeChannel === 'rewards'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {t.rewards}
        </button>
      </div>

      {/* Preferences Panel */}
      {showPreferences && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h4 className="font-semibold text-sm text-foreground">{t.notificationPreferences}</h4>
          <div className="space-y-2">
            {(['orders', 'social', 'messages', 'rewards', 'system'] as const).map((channel) => {
              const pref = preferences[channel];
              const isMandatory = pref?.mandatory ?? false;
              const isEnabled = pref?.enabled ?? true;

              return (
                <div key={channel} className="flex items-center justify-between">
                  <span className="text-xs text-foreground">
                    {channelLabels[channel]}
                    {isMandatory && (
                      <span className="ml-2 text-[9px] text-muted-foreground">({t.channelMandatory})</span>
                    )}
                  </span>
                  <button
                    onClick={() => setPreference(channel, !isEnabled)}
                    disabled={isMandatory}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      isEnabled ? 'bg-primary' : 'bg-muted'
                    } ${isMandatory ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span
                      className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                        isEnabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <Check className="h-3.5 w-3.5" />
            {t.markAllRead}
          </button>
        )}
        <button
          onClick={handleClearRead}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-destructive transition-colors ml-auto"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t.clearRead}
        </button>
      </div>

      {/* Notifications List */}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-12 space-y-4">
          <p className="text-xs text-muted-foreground">{t.noNotifications}</p>
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`py-4 first:pt-0 flex flex-col gap-1 cursor-pointer transition-colors ${
                n.is_read ? 'opacity-70' : 'bg-muted/10 border-l-2 border-primary pl-3'
              }`}
              onClick={() => markAsRead(n.id)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-foreground">{n.title}</span>
                    <span className="text-[9px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{n.message}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNotification(n.id);
                  }}
                  className="ml-2 rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
