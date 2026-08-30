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
    return (data ?? []) as ConversationMessage[];
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
