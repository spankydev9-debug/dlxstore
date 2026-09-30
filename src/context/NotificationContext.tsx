"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Notification } from "../types";
import { useAuth } from "./AuthContext";
import { getNotifications, markAsRead as dbMarkAsRead, markAllAsRead as dbMarkAllAsRead, deleteNotification as dbDeleteNotification } from "../services/db/notifications";
import { isSupabaseConfigured, supabase } from "../services/db";

type NotificationContextType = {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (notificationId: string) => Promise<void>;
  refreshNotifications: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshNotifications = useCallback(async () => {
    if (!user) {
      setNotifications([]);
      return;
    }
    setIsLoading(true);
    try {
      const list = await getNotifications(user.id);
      setNotifications(list);
    } catch (err) {
      console.error("Error fetching notifications:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

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
    try {
      await dbMarkAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (err) {
      console.error("Error marking notification as read:", err);
    }
  };

  const markAllAsRead = async () => {
    if (!user) return;
    try {
      await dbMarkAllAsRead(user.id);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error("Error marking all notifications as read:", err);
    }
  };

  const deleteNotif = async (id: string) => {
    try {
      await dbDeleteNotification(id);
      setNotifications(prev => prev.filter(n => n.id !== id));
    } catch (err) {
      console.error("Error deleting notification:", err);
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isLoading,
        markAsRead,
        markAllAsRead,
        deleteNotification: deleteNotif,
        refreshNotifications
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
