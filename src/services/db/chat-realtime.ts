// DLXSTORE — DLX Chat Realtime Service
// Extended realtime features for modern messaging: presence, typing indicators,
// read receipts, reactions, media, and message actions.
//
// This service extends the existing chat.ts service with realtime capabilities.

import { 
  TypingIndicator, 
  MessageReaction, 
  MessageMedia, 
  MessageStatus,
  PinnedMessage,
  UserPresenceStatus,
  MessageStatusType,
  MediaType,
  ConversationMessage
} from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// Realtime schema capability probe
//
// The realtime chat objects ship in `20260929100000_chat_realtime_features.sql`
// (together with `20260928101000_chat_lifecycle_foundation.sql`). Until those
// migrations are applied every realtime call fails, so the UI must degrade
// silently instead of erroring. One cheap read decides it, cached per page load.
// ---------------------------------------------------------------------------
let realtimeSchemaState: "unknown" | "available" | "unavailable" = "unknown";

/**
 * True only when the chat realtime migrations are applied. Any error (missing
 * table, missing column, RLS refusal, transient failure) is treated as
 * "unavailable" so that realtime features stay inert rather than noise-making.
 */
export async function isRealtimeChatAvailable(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  if (realtimeSchemaState !== "unknown") return realtimeSchemaState === "available";

  try {
    // `user_presence` is created by the realtime migration and is readable by any
    // authenticated principal, so it is a good liveness signal for that schema.
    const { error } = await supabase.from("user_presence").select("user_id").limit(1);
    // Treat PGRST errors (missing table/column, RLS refusal) as unavailable
    realtimeSchemaState = (error?.code === "PGRST202" || error?.code === "PGRST205" || error?.code === "42P01" || error?.code === "42703") ? "unavailable" : (error ? "unavailable" : "available");
  } catch {
    realtimeSchemaState = "unavailable";
  }

  return realtimeSchemaState === "available";
}

/** Clears the cached probe result (call after a migration is applied). */
export function resetRealtimeChatAvailability(): void {
  realtimeSchemaState = "unknown";
}

/**
 * Returns true if the error indicates the realtime schema is unavailable
 * (missing table, missing column, or RLS refusal). This allows graceful degradation
 * when migrations are not yet applied.
 */
function isRealtimeSchemaError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const codeMatch = error.code === "PGRST202" 
    || error.code === "PGRST205" 
    || error.code === "42P01" 
    || error.code === "42703";
  const messageMatch = error.message?.includes("does not exist") 
    || (error.message?.includes("column") && error.message?.includes("does not exist"));
  return codeMatch || messageMatch || false;
}

// ---------------------------------------------------------------------------
// User Presence
// ---------------------------------------------------------------------------

export async function updateUserPresence(
  status: UserPresenceStatus = "online",
  deviceId?: string
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("update_user_presence", {
      p_status: status,
      p_device_id: deviceId,
    });
    // Gracefully degrade if RPC doesn't exist (migration not applied)
    if (error && !isRealtimeSchemaError(error)) {
      throw new Error(error.message || "Unable to update presence.");
    }
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  // Demo mode: store presence in localStorage
  const presenceKey = "dlxstore_user_presence";
  const presence = {
    status,
    deviceId,
    lastSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(presenceKey, JSON.stringify(presence));
}

export async function getUserPresence(userId: string): Promise<{
  status: UserPresenceStatus;
  last_seen_at: string;
}> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("user_presence")
      .select("status, last_seen_at")
      .eq("user_id", userId)
      .single();

    if (error) {
      // Return offline if table doesn't exist or no presence record
      if (isRealtimeSchemaError(error)) {
        return { status: "offline", last_seen_at: new Date().toISOString() };
      }
      return { status: "offline", last_seen_at: new Date().toISOString() };
    }
    
    return {
      status: data.status as UserPresenceStatus,
      last_seen_at: data.last_seen_at,
    };
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: read from localStorage
  const presenceKey = "dlxstore_user_presence";
  const raw = localStorage.getItem(presenceKey);
  if (raw) {
    const presence = JSON.parse(raw);
    return {
      status: presence.status || "offline",
      last_seen_at: presence.lastSeenAt || new Date().toISOString(),
    };
  }
  
  return { status: "offline", last_seen_at: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Typing Indicators
// ---------------------------------------------------------------------------

export async function setTypingStatus(
  conversationId: string,
  isTyping: boolean
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("set_typing_status", {
      p_conversation_id: conversationId,
      p_is_typing: isTyping,
    });
    // Gracefully degrade if RPC doesn't exist (migration not applied)
    if (error && !isRealtimeSchemaError(error)) {
      throw new Error(error.message || "Unable to update typing status.");
    }
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  // Demo mode: store in localStorage
  const typingKey = `dlxstore_typing_${conversationId}`;
  const typingData = {
    isTyping,
    lastUpdatedAt: new Date().toISOString(),
    userId: "demo-user",
  };
  localStorage.setItem(typingKey, JSON.stringify(typingData));
}

export async function getTypingIndicators(
  conversationId: string
): Promise<TypingIndicator[]> {
  if (isSupabaseConfigured && supabase) {
    // `profiles` is embedded through the existing typing_indicators_user_id_fkey so
    // one request answers the question. This used to issue one extra profiles query
    // per indicator, and the caller polls.
    const { data, error } = await supabase
      .from("typing_indicators")
      .select("conversation_id, user_id, is_typing, last_updated_at, profiles(full_name)")
      .eq("conversation_id", conversationId)
      .eq("is_typing", true)
      .gt("last_updated_at", new Date(Date.now() - 10000).toISOString()); // Last 10 seconds

    if (error) {
      // Return empty if table doesn't exist (migration not applied)
      if (isRealtimeSchemaError(error)) return [];
      return [];
    }

    return (data || []).map((row) => {
      const { profiles, ...indicator } = row as typeof row & {
        profiles?: { full_name: string | null } | null;
      };
      return {
        ...indicator,
        user_name: profiles?.full_name || "User",
      } as TypingIndicator;
    });
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: read from localStorage
  const typingKey = `dlxstore_typing_${conversationId}`;
  const raw = localStorage.getItem(typingKey);
  if (raw) {
    const typingData = JSON.parse(raw);
    if (typingData.isTyping && 
        new Date(typingData.lastUpdatedAt) > new Date(Date.now() - 10000)) {
      return [{
        conversation_id: conversationId,
        user_id: typingData.userId,
        is_typing: true,
        last_updated_at: typingData.lastUpdatedAt,
        user_name: "Demo User",
      }];
    }
  }
  
  return [];
}

// ---------------------------------------------------------------------------
// Message Reactions
// ---------------------------------------------------------------------------

export async function addMessageReaction(
  messageId: string,
  emoji: string
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("add_message_reaction", {
      p_message_id: messageId,
      p_emoji: emoji,
    });
    // Gracefully degrade if RPC doesn't exist (migration not applied)
    if (error && !isRealtimeSchemaError(error)) {
      throw new Error(error.message || "Unable to add reaction.");
    }
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  // Demo mode: store in localStorage
  const reactionsKey = `dlxstore_reactions_${messageId}`;
  const existing = JSON.parse(localStorage.getItem(reactionsKey) || "[]");
  const newReaction = {
    message_id: messageId,
    user_id: "demo-user",
    emoji,
    created_at: new Date().toISOString(),
  };
  localStorage.setItem(reactionsKey, JSON.stringify([...existing, newReaction]));
}

export async function removeMessageReaction(
  messageId: string,
  emoji: string
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("remove_message_reaction", {
      p_message_id: messageId,
      p_emoji: emoji,
    });
    // Gracefully degrade if RPC doesn't exist (migration not applied)
    if (error && !isRealtimeSchemaError(error)) {
      throw new Error(error.message || "Unable to remove reaction.");
    }
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  // Demo mode: remove from localStorage
  const reactionsKey = `dlxstore_reactions_${messageId}`;
  const existing = JSON.parse(localStorage.getItem(reactionsKey) || "[]");
  const filtered = existing.filter(
    (r: any) => !(r.user_id === "demo-user" && r.emoji === emoji)
  );
  localStorage.setItem(reactionsKey, JSON.stringify(filtered));
}

export async function getMessageReactions(
  messageId: string
): Promise<MessageReaction[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("message_reactions")
      .select("message_id, user_id, emoji, created_at")
      .eq("message_id", messageId)
      .order("created_at", { ascending: true });

    if (error) {
      // Return empty if table doesn't exist (migration not applied)
      if (isRealtimeSchemaError(error)) return [];
      return [];
    }
    
    // Enrich with user names
    const enrichedReactions = await Promise.all(
      (data || []).map(async (reaction) => {
        try {
          const { data: userData } = await supabase!
            .from("profiles")
            .select("full_name")
            .eq("id", reaction.user_id)
            .single();
          
          return {
            ...reaction,
            user_name: userData?.full_name || "User",
          } as MessageReaction;
        } catch {
          return {
            ...reaction,
            user_name: "User",
          } as MessageReaction;
        }
      })
    );
    
    return enrichedReactions;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: read from localStorage
  const reactionsKey = `dlxstore_reactions_${messageId}`;
  const raw = localStorage.getItem(reactionsKey);
  if (raw) {
    return JSON.parse(raw).map((r: any) => ({
      ...r,
      user_name: "Demo User",
    }));
  }
  
  return [];
}

// ---------------------------------------------------------------------------
// Message Status (Read Receipts)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Batched enrichment for a whole page of messages
//
// The thread used to issue two queries per message (plus one profile query per
// reaction) on every load, every realtime insert and every 8s poll. A bounded
// page already caps that growth; batching makes it two queries per page instead
// of 2N.
// ---------------------------------------------------------------------------

async function getProfileNames(userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!supabase || userIds.length === 0) return names;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", userIds);
  if (error) return names;
  for (const row of (data ?? []) as { id: string; full_name: string | null }[]) {
    names.set(row.id, row.full_name || "User");
  }
  return names;
}

export async function getReactionsForMessages(
  messageIds: string[]
): Promise<Record<string, MessageReaction[]>> {
  const byMessage: Record<string, MessageReaction[]> = {};
  if (!isSupabaseConfigured || !supabase || messageIds.length === 0) {
    return byMessage;
  }

  const { data, error } = await supabase
    .from("message_reactions")
    .select("message_id, user_id, emoji, created_at")
    .in("message_id", messageIds)
    .order("created_at", { ascending: true });

  if (error) {
    if (!isRealtimeSchemaError(error)) {
      console.warn("Unable to load reactions:", error.message);
    }
    return byMessage;
  }

  const rows = (data ?? []) as MessageReaction[];
  if (rows.length === 0) return byMessage;

  const names = await getProfileNames([...new Set(rows.map((r) => r.user_id))]);
  for (const row of rows) {
    const reaction = { ...row, user_name: names.get(row.user_id) ?? "User" };
    const list = byMessage[row.message_id] ?? [];
    list.push(reaction);
    byMessage[row.message_id] = list;
  }
  return byMessage;
}

export async function getStatusesForMessages(
  messageIds: string[]
): Promise<Record<string, MessageStatus[]>> {
  const byMessage: Record<string, MessageStatus[]> = {};
  if (!isSupabaseConfigured || !supabase || messageIds.length === 0) {
    return byMessage;
  }

  const { data, error } = await supabase
    .from("message_status")
    .select("message_id, user_id, status, updated_at")
    .in("message_id", messageIds);

  if (error) {
    if (!isRealtimeSchemaError(error)) {
      console.warn("Unable to load message statuses:", error.message);
    }
    return byMessage;
  }

  for (const row of (data ?? []) as MessageStatus[]) {
    const list = byMessage[row.message_id] ?? [];
    list.push(row);
    byMessage[row.message_id] = list;
  }
  return byMessage;
}

export async function updateMessageStatus(
  messageId: string,
  status: MessageStatusType
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("update_message_status", {
      p_message_id: messageId,
      p_status: status,
    });
    // Gracefully degrade if RPC doesn't exist (migration not applied)
    if (error && !isRealtimeSchemaError(error)) {
      throw new Error(error.message || "Unable to update message status.");
    }
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  // Demo mode: store in localStorage
  const statusKey = `dlxstore_message_status_${messageId}`;
  const statusData = {
    message_id: messageId,
    user_id: "demo-user",
    status,
    updated_at: new Date().toISOString(),
  };
  localStorage.setItem(statusKey, JSON.stringify(statusData));
}

export async function getMessageStatuses(
  messageId: string
): Promise<MessageStatus[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("message_status")
      .select("message_id, user_id, status, updated_at")
      .eq("message_id", messageId);

    if (error) {
      // Return empty if table doesn't exist (migration not applied)
      if (isRealtimeSchemaError(error)) return [];
      return [];
    }
    return data as MessageStatus[];
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: read from localStorage
  const statusKey = `dlxstore_message_status_${messageId}`;
  const raw = localStorage.getItem(statusKey);
  if (raw) {
    return [JSON.parse(raw)];
  }
  
  return [];
}

// ---------------------------------------------------------------------------
// Message Media
// ---------------------------------------------------------------------------

export interface MediaUpload {
  file: File;
  mediaType: MediaType;
  fileName?: string;
  thumbnail?: File;
}

export async function uploadMessageMedia(
  conversationId: string,
  media: MediaUpload
): Promise<{ fileUrl: string; thumbnailUrl?: string }> {
  if (isSupabaseConfigured && supabase) {
    // Upload main file
    const fileExt = media.file.name.split(".").pop();
    const filePath = `chat-media/${conversationId}/${Date.now()}-${Math.random()
      .toString(36)
      .substring(2)}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(filePath, media.file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) throw new Error("Unable to upload media file.");

    // Persist private object paths. The chat read path mints signed URLs only
    // after Storage/RLS authorizes the conversation participant.
    let thumbnailUrl: string | undefined;
    
    // Upload thumbnail if provided
    if (media.thumbnail) {
      const thumbExt = media.thumbnail.name.split(".").pop();
      const thumbPath = `chat-media/${conversationId}/thumbnails/${Date.now()}-${Math.random()
        .toString(36)
        .substring(2)}.${thumbExt}`;

      const { error: thumbError } = await supabase.storage
        .from("chat-media")
        .upload(thumbPath, media.thumbnail, {
          cacheControl: "3600",
          upsert: false,
        });

        if (!thumbError) thumbnailUrl = thumbPath;
    }

    return {
      fileUrl: filePath,
      thumbnailUrl,
    };
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: create mock URLs
  return {
    fileUrl: `https://example.com/media/${media.file.name}`,
    thumbnailUrl: media.thumbnail 
      ? `https://example.com/thumbnails/${media.thumbnail.name}` 
      : undefined,
  };
}

export async function sendMessageWithMedia(
  conversationId: string,
  body: string,
  mediaItems?: Array<{
    media_type: MediaType;
    file_url: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
    thumbnail_url?: string;
    width?: number;
    height?: number;
    duration_seconds?: number;
  }>
): Promise<any> {
  if (isSupabaseConfigured && supabase) {
    // PostgREST delivers a JS value as JSON. Passing a pre-stringified value
    // would arrive as a JSON *string* scalar, and the RPC's jsonb_array_elements
    // would fail with "cannot extract elements from a scalar". Send the array.
    const { data, error } = await supabase.rpc("send_conversation_message_v2", {
      p_conversation_id: conversationId,
      p_body: body.trim(),
      p_media: mediaItems && mediaItems.length > 0 ? mediaItems : null,
    });
    if (error) throw new Error(error.message || "Unable to send the message.");
    return data;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: create mock message
  return {
    id: `msg-${Math.random().toString(36).substr(2, 12)}`,
    conversation_id: conversationId,
    sender_id: "demo-user",
    sender_name: "Demo User",
    sender_role: "customer",
    body: body.trim(),
    created_at: new Date().toISOString(),
    media: mediaItems || [],
  };
}

// ---------------------------------------------------------------------------
// Pinned Messages
// ---------------------------------------------------------------------------

export async function pinMessage(
  conversationId: string,
  messageId: string,
  note?: string
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("pin_message", {
      p_conversation_id: conversationId,
      p_message_id: messageId,
      p_note: note,
    });
    // Gracefully degrade if RPC doesn't exist (migration not applied)
    if (error && !isRealtimeSchemaError(error)) {
      throw new Error(error.message || "Unable to pin message.");
    }
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  // Demo mode: store in localStorage
  const pinnedKey = `dlxstore_pinned_${conversationId}`;
  const existing = JSON.parse(localStorage.getItem(pinnedKey) || "[]");
  const newPin = {
    conversation_id: conversationId,
    message_id: messageId,
    pinned_by: "demo-user",
    pinned_at: new Date().toISOString(),
    note,
  };
  localStorage.setItem(pinnedKey, JSON.stringify([...existing, newPin]));
}

export async function unpinMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("unpin_message", {
      p_conversation_id: conversationId,
      p_message_id: messageId,
    });
    // Gracefully degrade if RPC doesn't exist (migration not applied)
    if (error && !isRealtimeSchemaError(error)) {
      throw new Error(error.message || "Unable to unpin message.");
    }
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  // Demo mode: remove from localStorage
  const pinnedKey = `dlxstore_pinned_${conversationId}`;
  const existing = JSON.parse(localStorage.getItem(pinnedKey) || "[]");
  const filtered = existing.filter(
    (p: any) => p.message_id !== messageId
  );
  localStorage.setItem(pinnedKey, JSON.stringify(filtered));
}

export async function getPinnedMessages(
  conversationId: string
): Promise<PinnedMessage[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("pinned_messages")
      .select("conversation_id, message_id, pinned_by, pinned_at, note")
      .eq("conversation_id", conversationId)
      .order("pinned_at", { ascending: false });

    if (error) {
      // Return empty if table doesn't exist (migration not applied)
      if (isRealtimeSchemaError(error)) return [];
      return [];
    }

    // Author names are resolved by the caller from the conversation's
    // participants. `profiles` is readable only for yourself (or as an admin),
    // so a customer querying `pinned_by` here always got null -- every pin was
    // attributed to a literal "User" and cost one extra request per pin.
    return (data ?? []) as PinnedMessage[];
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: read from localStorage
  const pinnedKey = `dlxstore_pinned_${conversationId}`;
  const raw = localStorage.getItem(pinnedKey);
  if (raw) {
    return JSON.parse(raw).map((p: any) => ({
      ...p,
      pinned_by_name: "Demo User",
    }));
  }
  
  return [];
}

// ---------------------------------------------------------------------------
// Message Actions (Reply, Forward)
// ---------------------------------------------------------------------------

export async function forwardMessage(
  originalMessageId: string,
  targetConversationId: string,
  additionalText?: string
): Promise<ConversationMessage> {
  if (isSupabaseConfigured && supabase) {
    // Get original message
    const { data: originalMessage, error: fetchError } = await supabase
      .from("messages")
      .select("*")
      .eq("id", originalMessageId)
      .single();
    
    if (fetchError) throw new Error("Original message not found.");
    
    // Create forwarded message
    const forwardedBody = additionalText 
      ? `${additionalText}\n\n---\nForwarded from ${originalMessage.sender_name}:\n${originalMessage.body}`
      : `Forwarded from ${originalMessage.sender_name}:\n${originalMessage.body}`;
    
    const { data: forwardedMessage, error: sendError } = await supabase.rpc(
      "send_conversation_message",
      {
        p_conversation_id: targetConversationId,
        p_body: forwardedBody,
      }
    );
    
    if (sendError) throw new Error("Unable to forward message.");
    
    // Record the forward relationship - degrade gracefully if table doesn't exist
    try {
      await supabase.from("forwarded_messages").insert({
        original_message_id: originalMessageId,
        forwarded_message_id: forwardedMessage.id,
      });
    } catch (insertError) {
      // Ignore if forwarded_messages table doesn't exist (migration not applied)
      if (!isRealtimeSchemaError(insertError as any)) {
        console.warn("Failed to record forward relationship:", insertError);
      }
    }
    
    return forwardedMessage;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: create mock forwarded message
  return {
    id: `msg-${Math.random().toString(36).substr(2, 12)}`,
    conversation_id: targetConversationId,
    sender_id: "demo-user",
    sender_name: "Demo User",
    sender_role: "customer",
    body: additionalText 
      ? `${additionalText}\n\n---\nForwarded from Original Sender:\nDemo forwarded message`
      : "Forwarded: Demo forwarded message",
    created_at: new Date().toISOString(),
  };
}

export async function replyToMessage(
  originalMessageId: string,
  conversationId: string,
  replyText: string
): Promise<ConversationMessage> {
  if (isSupabaseConfigured && supabase) {
    // Get original message for context
    const { data: originalMessage, error: fetchError } = await supabase
      .from("messages")
      .select("sender_name, body")
      .eq("id", originalMessageId)
      .single();
    
    if (fetchError) {
      // If original message not found, just send normal message
      return await sendMessageWithMedia(conversationId, replyText);
    }
    
    // Create reply with reference
    const replyBody = `Replying to ${originalMessage.sender_name}: "${originalMessage.body.length > 50 ? originalMessage.body.substring(0, 50) + '...' : originalMessage.body}"\n\n${replyText}`;
    
    const { data: replyMessage, error: sendError } = await supabase.rpc(
      "send_conversation_message",
      {
        p_conversation_id: conversationId,
        p_body: replyBody,
      }
    );
    
    if (sendError) throw new Error("Unable to send reply.");
    return replyMessage;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: create mock reply
  return {
    id: `msg-${Math.random().toString(36).substr(2, 12)}`,
    conversation_id: conversationId,
    sender_id: "demo-user",
    sender_name: "Demo User",
    sender_role: "customer",
    body: `Replying to Original Sender: "Demo message..."\n\n${replyText}`,
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Enhanced Conversation Data
// ---------------------------------------------------------------------------

export async function getConversationWithRealtimeData(
  conversationId: string
): Promise<{
  conversation_id: string;
  conversation_type: string;
  conversation_title?: string;
  conversation_status: string;
  last_message_at?: string;
  participants: any[];
  typing_users: TypingIndicator[];
  pinned_messages: PinnedMessage[];
  unread_count: number;
}> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc(
      "get_conversation_with_realtime_data",
      { p_conversation_id: conversationId }
    );
    
    // Gracefully degrade if RPC doesn't exist (migration not applied)
    if (error) {
      if (isRealtimeSchemaError(error)) {
        // Return basic data when realtime RPC is unavailable
        return {
          conversation_id: conversationId,
          conversation_type: "customer_support",
          conversation_status: "open",
          last_message_at: new Date().toISOString(),
          participants: [],
          typing_users: [],
          pinned_messages: [],
          unread_count: 0,
        };
      }
      throw new Error(error.message || "Unable to load conversation data.");
    }
    return data;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  
  // Demo mode: return mock data
  return {
    conversation_id: conversationId,
    conversation_type: "customer_support",
    conversation_status: "open",
    last_message_at: new Date().toISOString(),
    participants: [],
    typing_users: [],
    pinned_messages: [],
    unread_count: 0,
  };
}
