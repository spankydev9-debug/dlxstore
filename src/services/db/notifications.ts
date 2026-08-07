import { Notification } from "../../types";
import { supabase, isSupabaseConfigured, initMockDb } from "./index";

export async function getNotifications(userId: string): Promise<Notification[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data || [];
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

    if (error) throw error;
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

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  type: "order_status" | "low_stock" | "new_order"
): Promise<Notification> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("notifications")
      .insert([{ user_id: userId, title, message, type, is_read: false }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  const notifications: Notification[] = raw ? JSON.parse(raw) : [];

  const newNotification: Notification = {
    id: `not-${Math.random().toString(36).substr(2, 9)}`,
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
