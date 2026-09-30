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
import { Conversation, ConversationMessage, TypingIndicator, UserPresenceStatus, MessageReaction, PinnedMessage } from "../types";
import { useAuth } from "./AuthContext";
import type { RealtimeChannel } from "@supabase/supabase-js";
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
import {
  isRealtimeChatAvailable,
  updateUserPresence,
  setTypingStatus,
  getTypingIndicators,
  updateMessageStatus,
  getMessageStatuses,
  getConversationWithRealtimeData,
  sendMessageWithMedia,
  addMessageReaction,
  removeMessageReaction,
  getMessageReactions,
  pinMessage,
  unpinMessage,
  getPinnedMessages,
  forwardMessage,
  replyToMessage,
} from "../services/db/chat-realtime";
import { PushNotificationService } from "../services/notifications/push-notifications";
import { ChatMediaService } from "../services/media/chat-media";

type ChatContextType = {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: ConversationMessage[];
  unreadCount: number;
  isLoading: boolean;
  isSending: boolean;
  error: string | null;
  realtimeStatus: "connected" | "fallback" | "off";
  typingIndicators: TypingIndicator[];
  // Core actions
  setActiveConversationId: (id: string | null) => void;
  sendMessage: (body: string, media?: any[]) => Promise<ConversationMessage | null>;
  markRead: (conversationId: string) => Promise<void>;
  markDelivered: (messageId: string) => Promise<void>;
  // Conversation management
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
  // Realtime features
  setTypingStatus: (isTyping: boolean) => Promise<void>;
  updatePresence: (status: UserPresenceStatus, deviceId?: string) => Promise<void>;
  // Message actions
  addReaction: (messageId: string, emoji: string) => Promise<void>;
  removeReaction: (messageId: string, emoji: string) => Promise<void>;
  pinMessage: (messageId: string, note?: string) => Promise<void>;
  unpinMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, newBody: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  forwardMessage: (messageId: string, targetConversationId: string, additionalText?: string) => Promise<ConversationMessage | null>;
  replyToMessage: (messageId: string, replyText: string) => Promise<ConversationMessage | null>;
  // Enhanced data
  refreshActiveConversationData: () => Promise<void>;
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
  const [typingIndicators, setTypingIndicators] = useState<TypingIndicator[]>([]);
  const activeRef = useRef<string | null>(null);
  const messagesRef = useRef<ConversationMessage[]>([]);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const presenceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pushNotificationInitializedRef = useRef<boolean>(false);

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
      // Reaction/status enrichment needs the realtime schema. Without it, render the
      // messages as-is instead of issuing two failing queries per message.
      if (await isRealtimeChatAvailable()) {
        const enrichedMessages = await Promise.all(
          list.map(async (message) => {
            try {
              const [reactions, statuses] = await Promise.all([
                getMessageReactions(message.id),
                getMessageStatuses(message.id),
              ]);
              return {
                ...message,
                reactions,
                status: statuses,
              };
            } catch {
              return message;
            }
          })
        );
        setMessages(enrichedMessages);
      } else {
        setMessages(list);
      }
      // Mark as read automatically whenever we load the open thread.
      await markConversationRead(conversationId);
    } catch (err) {
      console.error("Error refreshing messages:", err);
    }
  }, []);

  const refreshTypingIndicators = useCallback(async (conversationId: string) => {
    try {
      // Typing indicators are realtime-only: stay silent and idle without that schema.
      if (!(await isRealtimeChatAvailable())) {
        setTypingIndicators([]);
        return;
      }
      const indicators = await getTypingIndicators(conversationId);
      setTypingIndicators(indicators);
    } catch (err) {
      console.error("Error refreshing typing indicators:", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!user) {
      setConversations([]);
      setMessages([]);
      setActiveConversationId(null);
      setTypingIndicators([]);
      return;
    }
    setIsLoading(true);
    
    // Initialize push notifications
    if (!pushNotificationInitializedRef.current && "Notification" in window) {
      PushNotificationService.initialize(user.id).then((success) => {
        if (success) {
          pushNotificationInitializedRef.current = true;
        }
      });
    }
    
    Promise.all([
      refreshConversations(),
      // Presence is a realtime-only nicety: its failure must never fail the whole load.
      // This is what produced the false "Chat unavailable." state before the schema
      // migrations were applied.
      updateUserPresence("online").catch(() => undefined),
    ])
      .catch((err) => setError(err instanceof Error ? err.message : "Chat unavailable."))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refreshConversations]);

  // Realtime subscriptions
  useEffect(() => {
    if (!user || !isSupabaseConfigured || !supabase) {
      setRealtimeStatus("off");
      return;
    }

    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let realtimeAvailable = false;

    const start = async () => {
      // Subscribe only to tables that exist, and only run presence/heartbeat when the
      // realtime schema is applied (otherwise every call fails and the UI shows errors).
      realtimeAvailable = await isRealtimeChatAvailable();
      if (cancelled || !supabase) return;

      const next = supabase
        .channel("dlxstore-chat-realtime")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            void refreshConversations();
            const activeId = activeRef.current;
            if (activeId && activeId === payload.new.conversation_id) {
              void refreshMessages(activeId);
              void markConversationRead(activeId);
              // Delivery receipts need the realtime schema.
              if (realtimeAvailable && payload.new.sender_id !== user?.id) {
                updateMessageStatus(payload.new.id, "delivered").catch(() => undefined);
              }
            } else if (payload.new.sender_id !== user?.id) {
              // Show push notification for messages in other conversations
              const conversation = conversations.find(c => c.id === payload.new.conversation_id);
              PushNotificationService.notifyNewMessage(
                payload.new.conversation_id,
                payload.new.sender_name || "User",
                payload.new.body,
                conversation?.title ?? undefined
              ).catch(() => undefined);
            }
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversations" },
          () => {
            void refreshConversations();
          }
        );

      if (realtimeAvailable) {
        next
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "typing_indicators" },
            () => {
              const activeId = activeRef.current;
              if (activeId) {
                void refreshTypingIndicators(activeId);
              }
            }
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "message_reactions" },
            () => {
              const activeId = activeRef.current;
              if (activeId) {
                void refreshMessages(activeId);
              }
            }
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "user_presence" },
            () => {
              void refreshConversations();
            }
          );
      }

      next.subscribe((status) => {
        setRealtimeStatus(status === "SUBSCRIBED" ? "connected" : "fallback");
      });
      channel = next;

      // Presence heartbeat — only meaningful once the realtime schema exists.
      if (realtimeAvailable) {
        heartbeat = setInterval(() => {
          void updateUserPresence("online").catch(() => undefined);
        }, 30000); // Every 30 seconds
        presenceIntervalRef.current = heartbeat;
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (channel) void supabase?.removeChannel(channel);
      if (heartbeat) clearInterval(heartbeat);
      if (presenceIntervalRef.current) {
        clearInterval(presenceIntervalRef.current);
        presenceIntervalRef.current = null;
      }
      if (realtimeAvailable) void updateUserPresence("offline").catch(() => undefined);
    };
  }, [user, refreshConversations, refreshMessages, refreshTypingIndicators]);

  // Polling fallback for typing indicators
  useEffect(() => {
    if (!user || !activeConversationId) return;
    const interval = setInterval(() => {
      void refreshTypingIndicators(activeConversationId);
    }, 2000); // Check typing indicators every 2 seconds
    return () => clearInterval(interval);
  }, [user, activeConversationId, refreshTypingIndicators]);

  // Clean up typing timeout
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const openConversation = useCallback(
    async (id: string | null) => {
      setActiveConversationId(id);
      if (!id) {
        setMessages([]);
        setTypingIndicators([]);
        return;
      }
      setMessages([]);
      setTypingIndicators([]);
      await Promise.all([
        refreshMessages(id),
        refreshTypingIndicators(id),
      ]);
      // Refresh unread counts after marking read.
      await refreshConversations();
    },
    [refreshConversations, refreshMessages, refreshTypingIndicators]
  );

  const sendMessage = useCallback(
    async (body: string, mediaFiles?: File[]) => {
      const id = activeRef.current;
      if (!id || (!body.trim() && (!mediaFiles || mediaFiles.length === 0))) return null;
      setIsSending(true);
      try {
        let message;
        
        if (mediaFiles && mediaFiles.length > 0) {
          // Process and send media files
          const processedMedia = await ChatMediaService.processMultipleFiles(id, mediaFiles);
          message = await sendMessageWithMedia(id, body.trim(), processedMedia);
        } else {
          // Send text-only message
          message = await dbSendMessage(id, body.trim());
        }
        
        // Delivery status needs the realtime schema; never let it fail a successful send.
        if (await isRealtimeChatAvailable()) {
          await updateMessageStatus(message.id, "sent").catch(() => undefined);
        }
        
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

  const markDelivered = useCallback(async (messageId: string) => {
    try {
      await updateMessageStatus(messageId, "delivered");
    } catch (err) {
      console.error("Error marking message as delivered:", err);
    }
  }, []);

  const handleSetTypingStatus = useCallback(async (isTyping: boolean) => {
    const conversationId = activeRef.current;
    if (!conversationId) return;
    
    try {
      // Typing status is realtime-only: skip silently without that schema.
      if (!(await isRealtimeChatAvailable())) return;
      await setTypingStatus(conversationId, isTyping);
      
      // Clear previous timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      // Automatically set typing to false after 3 seconds
      if (isTyping) {
        typingTimeoutRef.current = setTimeout(() => {
          setTypingStatus(conversationId, false).catch(console.error);
        }, 3000);
      }
    } catch (err) {
      console.error("Error updating typing status:", err);
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

  const updatePresence = useCallback(async (status: UserPresenceStatus, deviceId?: string) => {
    try {
      await updateUserPresence(status, deviceId);
    } catch (err) {
      console.error("Error updating presence:", err);
    }
  }, []);

  const addReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      await addMessageReaction(messageId, emoji);
      // Refresh messages to show new reaction
      const conversationId = activeRef.current;
      if (conversationId) {
        await refreshMessages(conversationId);
      }
    } catch (err) {
      console.error("Error adding reaction:", err);
    }
  }, [refreshMessages]);

  const removeReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      await removeMessageReaction(messageId, emoji);
      // Refresh messages to remove reaction
      const conversationId = activeRef.current;
      if (conversationId) {
        await refreshMessages(conversationId);
      }
    } catch (err) {
      console.error("Error removing reaction:", err);
    }
  }, [refreshMessages]);

  const handlePinMessage = useCallback(async (messageId: string, note?: string) => {
    const conversationId = activeRef.current;
    if (!conversationId) return;
    
    try {
      await pinMessage(conversationId, messageId, note);
      // Refresh conversation data
      await refreshConversations();
    } catch (err) {
      console.error("Error pinning message:", err);
    }
  }, [refreshConversations]);

  const handleUnpinMessage = useCallback(async (messageId: string) => {
    const conversationId = activeRef.current;
    if (!conversationId) return;
    
    try {
      await unpinMessage(conversationId, messageId);
      // Refresh conversation data
      await refreshConversations();
    } catch (err) {
      console.error("Error unpinning message:", err);
    }
  }, [refreshConversations]);

  const editMessage = useCallback(async (messageId: string, newBody: string) => {
    if (!isSupabaseConfigured || !supabase) return;
    
    try {
      const { error } = await supabase
        .from("messages")
        .update({ 
          body: newBody.trim(),
          edited_at: new Date().toISOString()
        })
        .eq("id", messageId);
      
      if (error) throw error;
      
      // Refresh messages
      const conversationId = activeRef.current;
      if (conversationId) {
        await refreshMessages(conversationId);
      }
    } catch (err) {
      console.error("Error editing message:", err);
    }
  }, [refreshMessages]);

  const deleteMessage = useCallback(async (messageId: string) => {
    if (!isSupabaseConfigured || !supabase) return;
    
    try {
      const { error } = await supabase
        .from("messages")
        .update({ 
          deleted_at: new Date().toISOString()
        })
        .eq("id", messageId);
      
      if (error) throw error;
      
      // Refresh messages
      const conversationId = activeRef.current;
      if (conversationId) {
        await refreshMessages(conversationId);
      }
    } catch (err) {
      console.error("Error deleting message:", err);
    }
  }, [refreshMessages]);

  const handleForwardMessage = useCallback(async (messageId: string, targetConversationId: string, additionalText?: string) => {
    try {
      const forwardedMessage = await forwardMessage(messageId, targetConversationId, additionalText);
      // Switch to target conversation if not already there
      if (targetConversationId !== activeRef.current) {
        await openConversation(targetConversationId);
      }
      return forwardedMessage;
    } catch (err) {
      console.error("Error forwarding message:", err);
      return null;
    }
  }, [openConversation]);

  const handleReplyToMessage = useCallback(async (messageId: string, replyText: string) => {
    const conversationId = activeRef.current;
    if (!conversationId || !replyText.trim()) return null;
    
    try {
      const replyMessage = await replyToMessage(messageId, conversationId, replyText);
      setMessages((current) => [...current, replyMessage]);
      return replyMessage;
    } catch (err) {
      console.error("Error replying to message:", err);
      return null;
    }
  }, []);

  const refreshActiveConversationData = useCallback(async () => {
    const conversationId = activeRef.current;
    if (!conversationId) return;
    
    try {
      await Promise.all([
        refreshMessages(conversationId),
        refreshTypingIndicators(conversationId),
        refreshConversations(),
      ]);
    } catch (err) {
      console.error("Error refreshing conversation data:", err);
    }
  }, [refreshMessages, refreshTypingIndicators, refreshConversations]);

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
      typingIndicators,
      setActiveConversationId: (id) => void openConversation(id),
      sendMessage,
      markRead,
      markDelivered,
      openSupportConversation,
      createInternalConversation,
      addConversationParticipant,
      refreshConversations,
      setTypingStatus: handleSetTypingStatus,
      updatePresence,
      addReaction,
      removeReaction,
      pinMessage: handlePinMessage,
      unpinMessage: handleUnpinMessage,
      editMessage,
      deleteMessage,
      forwardMessage: handleForwardMessage,
      replyToMessage: handleReplyToMessage,
      refreshActiveConversationData,
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
      markDelivered,
      messages,
      openConversation,
      openSupportConversation,
      realtimeStatus,
      refreshConversations,
      sendMessage,
      typingIndicators,
      handleSetTypingStatus,
      updatePresence,
      addReaction,
      removeReaction,
      handlePinMessage,
      handleUnpinMessage,
      editMessage,
      deleteMessage,
      handleForwardMessage,
      handleReplyToMessage,
      refreshActiveConversationData,
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