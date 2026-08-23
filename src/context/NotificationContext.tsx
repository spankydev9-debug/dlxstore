"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
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
    refreshNotifications();

    if (!user || !isSupabaseConfigured || !supabase) {
      const interval = setInterval(() => {
        if (user) {
          getNotifications(user.id).then(list => setNotifications(list)).catch(() => undefined);
        }
      }, 10000);
      return () => clearInterval(interval);
    }

    const channelName = "notifications:user:" + user.id;
    const channel = supabase.channel(channelName);

    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: "user_id=eq." + user.id
        },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => {
            if (prev.some((n) => n.id === newNotif.id)) return prev;
            return [newNotif, ...prev];
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: "user_id=eq." + user.id
        },
        (payload) => {
          const updatedNotif = payload.new as Notification;
          setNotifications((prev) =>
            prev.map((n) => (n.id === updatedNotif.id ? updatedNotif : n))
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "notifications",
          filter: "user_id=eq." + user.id
        },
        (payload) => {
          const deletedId = (payload.old as { id?: string })?.id;
          if (deletedId) {
            setNotifications((prev) => prev.filter((n) => n.id !== deletedId));
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          getNotifications(user.id).then(list => setNotifications(list)).catch(() => undefined);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, refreshNotifications]);

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
