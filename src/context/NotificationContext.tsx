"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Notification } from "../types";
import { useAuth } from "./AuthContext";
import {
  getNotifications,
  markAsRead as dbMarkAsRead,
  markAllAsRead as dbMarkAllAsRead,
  deleteNotification as dbDeleteNotification,
  deleteReadNotifications as dbDeleteReadNotifications,
  getNotificationSummary,
  getNotificationPreferences,
  setNotificationPreference
} from "../services/db/notifications";
import { isSupabaseConfigured, supabase } from "../services/db";

type NotificationChannel = "orders" | "social" | "messages" | "rewards" | "system";

type NotificationContextType = {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  activeChannel: NotificationChannel | null;
  preferences: Record<string, { enabled: boolean; mandatory: boolean }>;
  setActiveChannel: (channel: NotificationChannel | null) => void;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: (channel?: NotificationChannel) => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  deleteReadNotifications: () => Promise<number>;
  refreshNotifications: () => Promise<void>;
  refreshPreferences: () => Promise<void>;
  setPreference: (channel: NotificationChannel, enabled: boolean) => Promise<void>;
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // The header badge must reflect the TRUE unread total, not the count of the
  // (capped at 50, channel-filtered) page currently loaded. We keep the server
  // summary separately and reconcile it optimistically on read.
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [activeChannel, setActiveChannel] = useState<NotificationChannel | null>(null);
  const [preferences, setPreferences] = useState<Record<string, { enabled: boolean; mandatory: boolean }>>({});

  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      setUnreadTotal(0);
      return;
    }
    setIsLoading(true);
    try {
      const list = await getNotifications(user.id, {
        channel: activeChannel ?? undefined,
        unreadOnly: false,
        limit: 50,
        offset: 0
      });
      setNotifications(list);
      // Server-side true total (independent of the active channel and page cap).
      try {
        const summary = await getNotificationSummary();
        setUnreadTotal(summary.unread);
      } catch {
        setUnreadTotal(list.filter((n) => !n.is_read).length);
      }
    } catch (err) {
      console.error("Error fetching notifications:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user, activeChannel]);

  const refreshPreferences = useCallback(async () => {
    if (!user) return;
    try {
      const prefs = await getNotificationPreferences();
      setPreferences(prefs);
    } catch (err) {
      console.error("Error fetching notification preferences:", err);
    }
  }, [user]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    void refreshPreferences();
  }, [refreshPreferences]);

  useEffect(() => {
    const client = supabase;
    if (!user || !isSupabaseConfigured || !client) return;

    let pollingFallback: ReturnType<typeof setInterval> | undefined;
    const startPollingFallback = () => {
      if (pollingFallback) return;
      pollingFallback = setInterval(() => {
        void refreshNotifications();
      }, 8000);
    };

    const channel = client
      .channel(`dlxstore-notifications:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void refreshNotifications();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          startPollingFallback();
        }
      });

    return () => {
      if (pollingFallback) clearInterval(pollingFallback);
      void client.removeChannel(channel);
    };
  }, [refreshNotifications, user]);

  const markAsRead = async (id: string) => {
    const wasUnread = notifications.find((n) => n.id === id)?.is_read === false;
    try {
      await dbMarkAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
      );
      if (wasUnread) setUnreadTotal(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const markAllAsRead = async (channel?: NotificationChannel) => {
    if (!user) return;
    try {
      await dbMarkAllAsRead(user.id, channel);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
      if (!channel) setUnreadTotal(0);
      // Channel-scoped reads need the server total to stay exact.
      void refreshNotifications();
    } catch (err) {
      console.error("Error marking all notifications as read:", err);
    }
  };

  const deleteNotif = async (id: string) => {
    const wasUnread = notifications.find((n) => n.id === id)?.is_read === false;
    try {
      await dbDeleteNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (wasUnread) setUnreadTotal(prev => Math.max(0, prev - 1));
    } catch (err) {
      console.error("Error deleting notification:", err);
    }
  };

  const deleteRead = async () => {
    try {
      const count = await dbDeleteReadNotifications();
      setNotifications(prev => prev.filter(n => !n.is_read));
      return count;
    } catch (err) {
      console.error("Error deleting read notifications:", err);
      return 0;
    }
  };

  const setPref = async (channel: NotificationChannel, enabled: boolean) => {
    try {
      const updated = await setNotificationPreference(channel, enabled);
      setPreferences(updated);
    } catch (err) {
      console.error("Error setting notification preference:", err);
    }
  };

  const unreadCount = unreadTotal;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isLoading,
        activeChannel,
        preferences,
        setActiveChannel,
        markAsRead,
        markAllAsRead,
        deleteNotification: deleteNotif,
        deleteReadNotifications: deleteRead,
        refreshNotifications,
        refreshPreferences,
        setPreference: setPref
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
