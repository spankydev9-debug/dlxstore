"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Conversation, ConversationMessage } from "../types";
import { useAuth } from "./AuthContext";
import { supabase, isSupabaseConfigured } from "../services/db";
import {
  addConversationParticipant as dbAddParticipant,
  createInternalConversation as dbCreateInternal,
  getConversations,
  getMessages,
  getOrCreateSupportConversation,
  markConversationRead,
  sendMessage as dbSendMessage,
} from "../services/db/chat";

type ChatContextType = {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: ConversationMessage[];
  unreadCount: number;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  realtimeStatus: "connected" | "fallback" | "off";
  setActiveConversationId: (id: string | null) => void;
  sendMessage: (body: string) => Promise<ConversationMessage | null>;
  markRead: (conversationId: string) => Promise<void>;
  openSupportConversation: (orderId?: string) => Promise<Conversation | null>;
  createInternalConversation: (
    title: string,
    participantIds: string[]
  ) => Promise<Conversation | null>;
  addConversationParticipant: (
    conversationId: string,
    profileId: string
  ) => Promise<void>;
  refreshConversations: () => Promise<void>;
};

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<"connected" | "fallback" | "off">("off");
  const activeRef = useRef<string | null>(null);
  const messagesRef = useRef<ConversationMessage[]>([]);

  // Update refs in effect to avoid accessing refs during render
  useEffect(() => {
    activeRef.current = activeConversationId;
    messagesRef.current = messages;
  }, [activeConversationId, messages]);

  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? null;

  const refreshConversations = useCallback(async () => {
    if (!user) return;
    try {
      const list = await getConversations();
      setConversations(list);
      setError(null);
    } catch (err) {
      console.error("Error refreshing conversations:", err);
    }
  }, [user]);

  const refreshMessages = useCallback(async (conversationId: string) => {
    try {
      const list = await getMessages(conversationId);
      setMessages(list);
      // Mark as read automatically whenever we load the open thread.
      await markConversationRead(conversationId);
    } catch (err) {
      console.error("Error refreshing messages:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!user) {
      setConversations([]);
      setMessages([]);
      setActiveConversationId(null);
      return;
    }
    setIsLoading(true);
    refreshConversations()
      .catch((err) => setError(err instanceof Error ? err.message : "Chat unavailable."))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refreshConversations]);

  // Realtime (primary) + polling (fallback).
  useEffect(() => {
    if (!user || !isSupabaseConfigured || !supabase) {
      setRealtimeStatus("off");
      return;
    }

    const channel = supabase
      .channel("dlxstore-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => {
          void refreshConversations();
          const activeId = activeRef.current;
          if (activeId) {
            void refreshMessages(activeId);
            void markConversationRead(activeId);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conversations" },
        () => {
          void refreshConversations();
        }
      )
      .subscribe((status) => {
        setRealtimeStatus(status === "SUBSCRIBED" ? "connected" : "fallback");
      });

    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [user, refreshConversations, refreshMessages]);

  // Polling fallback keeps everything fresh even when websockets fail.
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      void refreshConversations();
      const activeId = activeRef.current;
      if (activeId) void refreshMessages(activeId);
    }, 8000);
    return () => clearInterval(interval);
  }, [user, refreshConversations, refreshMessages]);

const openConversation = useCallback(
    async (id: string | null) => {
      setActiveConversationId(id);
      if (!id) {
        setMessages([]);
        return;
      }
      setMessages([]);
      await refreshMessages(id);
      // Refresh unread counts after marking read.
      await refreshConversations();
    },
    [refreshConversations, refreshMessages]
  );

  const sendMessage = useCallback(
    async (body: string) => {
      const id = activeRef.current;
      if (!id || !body.trim()) return null;
      setIsSending(true);
      try {
        const message = await dbSendMessage(id, body.trim());
        setMessages((current) => [...current, message]);
        // Optimistically clear unread for this conversation.
        setConversations((current) =>
          current.map((c) =>
            c.id === id
              ? { ...c, unread_count: 0, last_message_preview: message.body }
              : c
          )
        );
        return message;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to send the message.");
        return null;
      } finally {
        setIsSending(false);
      }
    },
    []
  );

  const markRead = useCallback(async (conversationId: string) => {
    try {
      await markConversationRead(conversationId);
      setConversations((current) =>
        current.map((c) =>
          c.id === conversationId ? { ...c, unread_count: 0 } : c
        )
      );
    } catch (err) {
      console.error("Error marking conversation as read:", err);
    }
  }, []);

  const openSupportConversation = useCallback(
    async (orderId?: string) => {
      try {
        const conversation = await getOrCreateSupportConversation(orderId);
        setConversations((current) => {
          const filtered = current.filter((c) => c.id !== conversation.id);
          return [conversation, ...filtered];
        });
        await openConversation(conversation.id);
        return conversation;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to start the conversation.");
        return null;
      }
    },
    [openConversation]
  );

  const createInternalConversation = useCallback(
    async (title: string, participantIds: string[]) => {
      try {
        const conversation = await dbCreateInternal(title, participantIds);
        setConversations((current) => [conversation, ...current]);
        await openConversation(conversation.id);
        return conversation;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to create the conversation.");
        return null;
      }
    },
    [openConversation]
  );

  const addConversationParticipant = useCallback(
    async (conversationId: string, profileId: string) => {
      await dbAddParticipant(conversationId, profileId);
      await refreshConversations();
    },
    [refreshConversations]
  );

  const value = useMemo<ChatContextType>(
    () => ({
      conversations,
      activeConversation,
      messages,
      unreadCount: conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0),
      isLoading,
      isSending,
      error,
      realtimeStatus,
      setActiveConversationId: (id) => void openConversation(id),
      sendMessage,
      markRead,
      openSupportConversation,
      createInternalConversation,
      addConversationParticipant,
      refreshConversations,
    }),
    [
      activeConversation,
      addConversationParticipant,
      conversations,
      createInternalConversation,
      error,
      isLoading,
      isSending,
      markRead,
      messages,
      openConversation,
      openSupportConversation,
      realtimeStatus,
      refreshConversations,
      sendMessage,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
}