import { Notification } from "../../types";
import { supabase, isSupabaseConfigured, initMockDb } from "./index";

export async function getNotifications(userId: string): Promise<Notification[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message || "An error occurred.");
    return (data || []) as Notification[];
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  const notifications: Notification[] = raw ? JSON.parse(raw) : [];
  return notifications.filter(n => n.user_id === userId);
}

export async function markAsRead(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);

    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  if (raw) {
    const notifications: Notification[] = JSON.parse(raw);
    const index = notifications.findIndex(n => n.id === id);
    if (index !== -1) {
      notifications[index].is_read = true;
      localStorage.setItem("dlxstore_notifications", JSON.stringify(notifications));
    }
  }
}

export async function markAllAsRead(userId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);

    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  if (raw) {
    const notifications: Notification[] = JSON.parse(raw);
    const updated = notifications.map(n => n.user_id === userId ? { ...n, is_read: true } : n);
    localStorage.setItem("dlxstore_notifications", JSON.stringify(updated));
  }
}

export async function deleteNotification(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", id);

    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  if (raw) {
    const notifications: Notification[] = JSON.parse(raw);
    const filtered = notifications.filter(n => n.id !== id);
    localStorage.setItem("dlxstore_notifications", JSON.stringify(filtered));
  }
}

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  type: Notification["type"]
): Promise<Notification> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("notifications")
      .insert([{ user_id: userId, title, message, type, is_read: false }])
      .select()
      .single();

    if (error) throw new Error(error.message || "An error occurred.");
    return data as Notification;
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  const notifications: Notification[] = raw ? JSON.parse(raw) : [];

  const newNotification: Notification = {
    id: "not-" + Math.random().toString(36).substring(2, 11),
    user_id: userId,
    title,
    message,
    is_read: false,
    type,
    created_at: new Date().toISOString()
  };

  notifications.unshift(newNotification);
  localStorage.setItem("dlxstore_notifications", JSON.stringify(notifications));
  return newNotification;
}
