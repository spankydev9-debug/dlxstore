import { Conversation, ConversationMessage } from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// DLX Chat data layer (Supabase RPCs + demo/localStorage fallback)
// ---------------------------------------------------------------------------

interface MockChatStorage {
  conversations: Conversation[];
  messagesByConversation: Record<string, ConversationMessage[]>;
}

const DEMO_STORAGE_KEY = "dlxstore_chat";

function readMockChat(): MockChatStorage {
  const raw = localStorage.getItem(DEMO_STORAGE_KEY);
  return raw
    ? (JSON.parse(raw) as MockChatStorage)
    : { conversations: [], messagesByConversation: {} };
}

function writeMockChat(storage: MockChatStorage) {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(storage));
}

function mockError() {
  return "DLXSTORE is not configured.";
}

async function resolveChatMediaPath(value: string | null | undefined): Promise<string | undefined> {
  if (!value) return undefined;
  // Existing public media remains renderable during the forward migration. New
  // rows carry a private object path and require a caller-authorized signed URL.
  if (/^(https?:|blob:)/i.test(value)) return value;
  if (!supabase) return undefined;
  const { data, error } = await supabase.storage.from("chat-media").createSignedUrl(value, 600);
  if (error || !data?.signedUrl) return undefined;
  return data.signedUrl;
}

function toClientConversation(row: Conversation): Conversation {
  return {
    ...row,
    unread_count: row.unread_count ?? 0,
    participants: Array.isArray(row.participants) ? row.participants : [],
  };
}

export interface StaffProfile {
  id: string;
  full_name: string;
  role: "staff" | "admin";
  phone?: string | null;
  email?: string | null;
}

export async function getConversations(): Promise<Conversation[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("list_my_conversations");
    if (error) throw new Error(error.message || "Unable to load conversations.");
    return ((data ?? []) as Conversation[]).map(toClientConversation);
  }
  if (!isDemoMode) throw new Error(mockError());
  return readMockChat().conversations;
}

export async function getOrCreateSupportConversation(
  orderId?: string
): Promise<Conversation> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc(
      "get_or_create_customer_support_conversation",
      { p_order_id: orderId ?? null }
    );
    if (error) throw new Error(error.message || "Unable to start a conversation.");
    return toClientConversation(data as Conversation);
  }
  if (!isDemoMode) throw new Error(mockError());
  const storage = readMockChat();
  const open = storage.conversations.find(
    (c) =>
      c.type === "customer_support" &&
      c.status !== "closed" &&
      (orderId ? c.order_id === orderId : !c.order_id)
  );
  if (open) return open;

  const conversation: Conversation = {
    id: `conv-${Math.random().toString(36).substr(2, 12)}`,
    type: "customer_support",
    title: null,
    customer_profile_id: null,
    order_id: orderId ?? null,
    status: "open",
    last_message_at: new Date().toISOString(),
    last_message_preview: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    unread_count: 0,
    participants: [],
  };
  storage.conversations = [conversation, ...storage.conversations];
  writeMockChat(storage);
  return conversation;
}

export async function createInternalConversation(
  title: string,
  participantIds: string[]
): Promise<Conversation> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("create_internal_conversation", {
      p_title: title,
      p_participant_ids: participantIds,
    });
    if (error) throw new Error(error.message || "Unable to create the conversation.");
    return toClientConversation(data as Conversation);
  }
  if (!isDemoMode) throw new Error(mockError());
  const conversation: Conversation = {
    id: `conv-${Math.random().toString(36).substr(2, 12)}`,
    type: "internal",
    title,
    customer_profile_id: null,
    order_id: null,
    status: "open",
    last_message_at: new Date().toISOString(),
    last_message_preview: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    unread_count: 0,
    participants: [],
  };
  const storage = readMockChat();
  storage.conversations = [conversation, ...storage.conversations];
  writeMockChat(storage);
  return conversation;
}

export async function addConversationParticipant(
  conversationId: string,
  profileId: string
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("add_conversation_participant", {
      p_conversation_id: conversationId,
      p_profile_id: profileId,
    });
    if (error) throw new Error(error.message || "Unable to add the participant.");
    return;
  }
  if (!isDemoMode) throw new Error(mockError());
}

export async function getMessages(
  conversationId: string
): Promise<ConversationMessage[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message || "Unable to load messages.");
    const messages = (data ?? []) as ConversationMessage[];

    if (messages.length === 0) return messages;

    // Attach media rows so attachments actually render. `message_media` lives in
    // its own table (the v2 send path writes there); without a join here the
    // media block in every bubble is dead and sent photos never appear.
    const { data: mediaRows, error: mediaError } = await supabase
      .from("message_media")
      .select("*")
      .in(
        "message_id",
        messages.map((m) => m.id)
      );

    if (mediaError) {
      console.warn("Unable to load message attachments:", mediaError.message);
      return messages;
    }

    if (mediaRows && mediaRows.length > 0) {
      const byMessage = new Map<string, ConversationMessage["media"]>();
      for (const row of mediaRows) {
        const stored = (row as unknown) as NonNullable<ConversationMessage["media"]>[number];
        const fileUrl = await resolveChatMediaPath(stored.file_url);
        if (!fileUrl) continue;
        const thumbnailUrl = await resolveChatMediaPath(stored.thumbnail_url);
        const media = { ...stored, file_url: fileUrl, thumbnail_url: thumbnailUrl };
        const list = byMessage.get(media.message_id) ?? [];
        list.push(media);
        byMessage.set(media.message_id, list);
      }
      return messages.map((m) => ({
        ...m,
        media: byMessage.get(m.id),
      }));
    }

    return messages;
  }
  if (!isDemoMode) throw new Error(mockError());
  return readMockChat().messagesByConversation[conversationId] ?? [];
}

export async function sendMessage(
  conversationId: string,
  body: string
): Promise<ConversationMessage> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("send_conversation_message", {
      p_conversation_id: conversationId,
      p_body: body.trim(),
    });
    if (error) throw new Error(error.message || "Unable to send the message.");
    return data as ConversationMessage;
  }
  if (!isDemoMode) throw new Error(mockError());
  const message: ConversationMessage = {
    id: `msg-${Math.random().toString(36).substr(2, 12)}`,
    conversation_id: conversationId,
    sender_id: "me",
    sender_name: "Vous",
    sender_role: "customer",
    body: body.trim(),
    created_at: new Date().toISOString(),
  };
  const storage = readMockChat();
  const messages = storage.messagesByConversation[conversationId] ?? [];
  storage.messagesByConversation[conversationId] = [...messages, message];
  writeMockChat(storage);
  return message;
}

export async function markConversationRead(
  conversationId: string
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("mark_conversation_read", {
      p_conversation_id: conversationId,
    });
    if (error) throw new Error(error.message || "Unable to mark as read.");
    return;
  }
  if (!isDemoMode) throw new Error(mockError());
}

/** Staff: toggle a support conversation between open and resolved. */
export async function setConversationStatus(
  conversationId: string,
  status: "open" | "resolved" | "closed"
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from("conversations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", conversationId);
    if (error) throw new Error(error.message || "Unable to update the conversation.");
    return;
  }
  if (!isDemoMode) throw new Error(mockError());
  const storage = readMockChat();
  storage.conversations = storage.conversations.map((c) =>
    c.id === conversationId ? { ...c, status } : c
  );
  writeMockChat(storage);
}

/** Staff/admin directory for the internal chat participant picker. */
export async function listStaffProfiles(): Promise<StaffProfile[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("list_staff_profiles");
    if (error) throw new Error(error.message || "Unable to load the staff directory.");
    return (data ?? []) as StaffProfile[];
  }
  if (!isDemoMode) throw new Error(mockError());
  return [];
}

// ---------------------------------------------------------------------------
// Person-to-person (direct) conversations
// ---------------------------------------------------------------------------

/**
 * Open, or re-open, the 1-to-1 conversation with `profileId`.
 *
 * Backed by get_or_create_direct_conversation(), which is the only path that may
 * write conversation_participants for a customer. It is idempotent: two calls
 * for the same pair always resolve to the same conversation, including when they
 * race (a unique index on dm_key settles it server-side).
 *
 * The server deliberately leaves conversations.title NULL for direct chats: the
 * display name is the counterpart, which differs per viewer.
 */
export async function getOrCreateDirectConversation(
  profileId: string
): Promise<Conversation> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc(
      "get_or_create_direct_conversation",
      { p_other_profile_id: profileId }
    );
    if (error) throw new Error(error.message || "Unable to start the conversation.");
    return toClientConversation(data as Conversation);
  }
  if (!isDemoMode) throw new Error(mockError());
  throw new Error(mockError());
}

export interface DiscoverableProfile {
  profile_id: string;
  full_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
}

/**
 * Search people you can start a direct conversation with.
 *
 * search_profiles() already excludes the caller and anyone blocked in either
 * direction, so no client-side filtering is needed for safety.
 */
export async function searchDiscoverableProfiles(
  query: string,
  limit: number = 20
): Promise<DiscoverableProfile[]> {
  if (!isSupabaseConfigured || !supabase) {
    if (!isDemoMode) throw new Error(mockError());
    return [];
  }
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase.rpc("search_profiles", {
    p_query: trimmed,
    p_limit: limit,
  });
  if (error) throw new Error(error.message || "Unable to search for people.");
  return (data ?? []) as DiscoverableProfile[];
}

/**
 * The other person in a conversation, or null when the caller is not a participant.
 *
 * list_my_conversations() orders participants by `(p.id = v_uid) DESC`, which puts
 * the caller FIRST -- participants[0] is you, not your counterpart. Always resolve
 * the counterpart by filtering on profile_id.
 */
export function getCounterpart(
  conversation: Pick<Conversation, "participants">,
  currentUserId: string | null | undefined
): Conversation["participants"][number] | null {
  if (!currentUserId) return null;
  return (
    conversation.participants.find((p) => p.profile_id !== currentUserId) ?? null
  );
}
