import { Notification } from "../../types";
import { supabase, isSupabaseConfigured, initMockDb } from "./index";

export async function getNotifications(
  userId: string,
  options?: {
    channel?: "orders" | "social" | "messages" | "rewards" | "system";
    unreadOnly?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<Notification[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_my_notifications", {
      p_channel: options?.channel ?? null,
      p_unread_only: options?.unreadOnly ?? false,
      p_limit: options?.limit ?? 50,
      p_offset: options?.offset ?? 0
    });

    if (error) throw new Error(error.message || "An error occurred.");
    return (data || []) as Notification[];
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  const notifications: Notification[] = raw ? JSON.parse(raw) : [];
  let filtered = notifications.filter(n => n.user_id === userId);

  if (options?.unreadOnly) {
    filtered = filtered.filter(n => !n.is_read);
  }

  if (options?.channel) {
    // Simple channel mapping for fallback
    const channelMap: Record<string, string[]> = {
      orders: ["order_status", "new_order"],
      social: ["friend_request", "friend_accepted", "story_reaction", "story_mention", "product_share", "product_reaction"],
      messages: ["chat_message"],
      rewards: ["reward", "streak_milestone", "promotion", "new_drop"],
      system: ["low_stock", "partner_application"]
    };
    const types = channelMap[options.channel] || [];
    filtered = filtered.filter(n => types.includes(n.type));
  }

  return filtered;
}

export async function markAsRead(id: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true, read_at: new Date().toISOString() })
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
      notifications[index].read_at = new Date().toISOString();
      localStorage.setItem("dlxstore_notifications", JSON.stringify(notifications));
    }
  }
}

export async function markAllAsRead(userId: string, channel?: "orders" | "social" | "messages" | "rewards" | "system"): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("mark_all_notifications_read", {
      p_channel: channel ?? null
    });

    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  if (raw) {
    const notifications: Notification[] = JSON.parse(raw);
    let updated = notifications.map(n => n.user_id === userId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n);

    if (channel) {
      const channelMap: Record<string, string[]> = {
        orders: ["order_status", "new_order"],
        social: ["friend_request", "friend_accepted", "story_reaction", "story_mention", "product_share", "product_reaction"],
        messages: ["chat_message"],
        rewards: ["reward", "streak_milestone", "promotion", "new_drop"],
        system: ["low_stock", "partner_application"]
      };
      const types = channelMap[channel] || [];
      updated = notifications.map(n =>
        n.user_id === userId && types.includes(n.type)
          ? { ...n, is_read: true, read_at: new Date().toISOString() }
          : n
      );
    }

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

export async function deleteReadNotifications(): Promise<number> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("delete_my_read_notifications");

    if (error) throw new Error(error.message || "An error occurred.");
    return data ?? 0;
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  if (raw) {
    const notifications: Notification[] = JSON.parse(raw);
    const filtered = notifications.filter(n => !n.is_read);
    const deletedCount = notifications.length - filtered.length;
    localStorage.setItem("dlxstore_notifications", JSON.stringify(filtered));
    return deletedCount;
  }
  return 0;
}

export async function createNotification(
  userId: string,
  title: string,
  message: string,
  type: Notification["type"]
): Promise<Notification> {
  if (isSupabaseConfigured && supabase) {
    throw new Error("Notifications must be created by an authorized server-side workflow.");
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

export async function getNotificationSummary(): Promise<{
  total: number;
  unread: number;
  channels: Record<string, { total: number; unread: number }>;
}> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_my_notification_summary");

    if (error) throw new Error(error.message || "An error occurred.");
    return data ?? { total: 0, unread: 0, channels: {} };
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_notifications");
  const notifications: Notification[] = raw ? JSON.parse(raw) : [];

  const channelMap: Record<string, string[]> = {
    orders: ["order_status", "new_order"],
    social: ["friend_request", "friend_accepted", "story_reaction", "story_mention", "product_share", "product_reaction"],
    messages: ["chat_message"],
    rewards: ["reward", "streak_milestone", "promotion", "new_drop"],
    system: ["low_stock", "partner_application"]
  };

  const channels: Record<string, { total: number; unread: number }> = {
    orders: { total: 0, unread: 0 },
    social: { total: 0, unread: 0 },
    messages: { total: 0, unread: 0 },
    rewards: { total: 0, unread: 0 },
    system: { total: 0, unread: 0 }
  };

  for (const n of notifications) {
    for (const [channel, types] of Object.entries(channelMap)) {
      if (types.includes(n.type)) {
        channels[channel].total++;
        if (!n.is_read) channels[channel].unread++;
        break;
      }
    }
  }

  return {
    total: notifications.length,
    unread: notifications.filter(n => !n.is_read).length,
    channels
  };
}

export async function getNotificationPreferences(): Promise<
  Record<string, { enabled: boolean; mandatory: boolean }>
> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_my_notification_preferences");

    if (error) throw new Error(error.message || "An error occurred.");
    return data ?? {};
  }

  // Local Storage Fallback - default all enabled
  return {
    orders: { enabled: true, mandatory: true },
    social: { enabled: true, mandatory: false },
    messages: { enabled: true, mandatory: false },
    rewards: { enabled: true, mandatory: false },
    system: { enabled: true, mandatory: false }
  };
}

export async function setNotificationPreference(
  channel: "orders" | "social" | "messages" | "rewards" | "system",
  enabled: boolean
): Promise<Record<string, { enabled: boolean; mandatory: boolean }>> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("set_my_notification_preference", {
      p_channel: channel,
      p_enabled: enabled
    });

    if (error) throw new Error(error.message || "An error occurred.");
    return data ?? {};
  }

  // Local Storage Fallback - no-op (preferences not persisted)
  return {
    orders: { enabled: true, mandatory: true },
    social: { enabled: true, mandatory: false },
    messages: { enabled: true, mandatory: false },
    rewards: { enabled: true, mandatory: false },
    system: { enabled: true, mandatory: false }
  };
}
