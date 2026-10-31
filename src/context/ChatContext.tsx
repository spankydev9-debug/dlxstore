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
  deleteMessage as dbDeleteMessage,
  editMessage as dbEditMessage,
  getConversations,
  getMessages,
  getOrCreateSupportConversation,
  getOrCreateDirectConversation,
  getCounterpart,
  markConversationRead,
  searchDiscoverableProfiles,
  sendMessage as dbSendMessage,
  type DiscoverableProfile,
} from "../services/db/chat";
import {
  MESSAGE_PAGE_SIZE,
  mergeNewestPage,
  prependOlderPage,
} from "../lib/chat-pagination";
import {
  isRealtimeChatAvailable,
  updateUserPresence,
  setTypingStatus,
  getTypingIndicators,
  updateMessageStatus,
  getReactionsForMessages,
  getStatusesForMessages,
  getConversationWithRealtimeData,
  sendMessageWithMedia,
  addMessageReaction,
  removeMessageReaction,
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
  /** Dismiss the current error banner (bounds the error to the surface that
      raised it instead of forcing a reload). */
  clearError: () => void;
  realtimeStatus: "connected" | "fallback" | "off";
  typingIndicators: TypingIndicator[];
  /** True when older messages exist before the oldest loaded message. */
  hasMoreMessages: boolean;
  /** True while an older page is being fetched (drives "load older" affordance). */
  isLoadingOlderMessages: boolean;
  /** Pinned messages of the open conversation (staff/admin pin them). */
  pinnedMessages: PinnedMessage[];
  // Core actions
  setActiveConversationId: (id: string | null) => void;
  sendMessage: (body: string, media?: File[]) => Promise<ConversationMessage | null>;
  /** Fetch the page of history before the oldest loaded message. */
  loadOlderMessages: () => Promise<void>;
  markRead: (conversationId: string) => Promise<void>;
  markDelivered: (messageId: string) => Promise<void>;
  // Conversation management
  openSupportConversation: (orderId?: string) => Promise<Conversation | null>;
  /** Open (or re-open) the 1-to-1 conversation with another user. */
  startDirectConversation: (profileId: string) => Promise<Conversation | null>;
  /** People the caller may start a direct conversation with (self + blocked excluded). */
  searchPeople: (query: string) => Promise<DiscoverableProfile[]>;
  /** The other participant, resolved by id. Never index participants[0]: it is the caller. */
  counterpartOf: (conversation: Conversation | null) => Conversation["participants"][number] | null;
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
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const activeRef = useRef<string | null>(null);
  const messagesRef = useRef<ConversationMessage[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const presenceIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pushNotificationInitializedRef = useRef<boolean>(false);

  // Update refs in effect to avoid accessing refs during render
  useEffect(() => {
    activeRef.current = activeConversationId;
    messagesRef.current = messages;
    conversationsRef.current = conversations;
  }, [activeConversationId, messages, conversations]);

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
      const page = await getMessages(conversationId, { limit: MESSAGE_PAGE_SIZE });
      let newest = page.messages;
      // Reaction/status enrichment needs the realtime schema. Without it, render
      // the messages as-is instead of issuing failing queries on every load.
      if (newest.length > 0 && (await isRealtimeChatAvailable())) {
        const [reactions, statuses] = await Promise.all([
          getReactionsForMessages(newest.map((message) => message.id)),
          getStatusesForMessages(newest.map((message) => message.id)),
        ]);
        newest = newest.map((message) => ({
          ...message,
          reactions: reactions[message.id] ?? [],
          status: statuses[message.id] ?? [],
        }));
      }
      // A page that arrives after the reader switched threads is discarded.
      if (activeRef.current !== conversationId) return;
      setHasMoreMessages(page.hasMore);
      // Keep older pages the reader already scrolled to; a realtime insert or the
      // polling fallback must not silently truncate loaded history.
      setMessages((current) => mergeNewestPage(conversationId, current, newest));
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

  /** Pinned messages are staff-authored context, not realtime-critical: a
      failure here must never break opening a conversation. */
  const refreshPinnedMessages = useCallback(async (conversationId: string) => {
    try {
      setPinnedMessages(await getPinnedMessages(conversationId));
    } catch (err) {
      console.error("Error loading pinned messages:", err);
      setPinnedMessages([]);
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
            } else if (
              payload.new.sender_id !== user?.id &&
              // The database trigger already sends a push notification; a local
              // one is only useful while the app is in the background.
              typeof document !== "undefined" &&
              document.visibilityState === "hidden"
            ) {
              // Show push notification for messages in other conversations.
              // Read the title from a ref: `conversations` is not a dependency of
              // this effect, so the closure is frozen at subscription time.
              const conversation = conversationsRef.current.find(
                (c) => c.id === payload.new.conversation_id
              );
              PushNotificationService.notifyNewMessage(
                payload.new.conversation_id,
                payload.new.sender_name || "User",
                payload.new.body,
                conversation?.title ?? undefined
              ).catch(() => undefined);
            }
          }
        )
        // Edits and soft deletes are UPDATEs. Without this listener the other
        // participant kept reading the old body until a manual refresh.
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages" },
          (payload) => {
            const activeId = activeRef.current;
            if (activeId && payload.new.conversation_id === activeId) {
              const updated = payload.new as Partial<ConversationMessage> & { id: string };
              setMessages((current) =>
                current.map((message) =>
                  message.id === updated.id
                    ? {
                        ...message,
                        body: updated.body ?? message.body,
                        edited_at: updated.edited_at ?? message.edited_at,
                        deleted_at: updated.deleted_at ?? message.deleted_at,
                      }
                    : message
                )
              );
            }
            void refreshConversations();
          }
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversations" },
          () => {
            void refreshConversations();
          }
        )
        // A direct conversation is INSERTed, not UPDATEd, so without this the
        // recipient never sees the new thread appear until a manual refresh.
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "conversations" },
          () => {
            void refreshConversations();
          }
        )
        // Covers message edit / soft delete propagation.
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages" },
          () => {
            const activeId = activeRef.current;
            if (activeId) {
              void refreshMessages(activeId);
            }
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

  // Safety net so a failed realtime channel degrades to polling instead of
  // silently showing a stale inbox. Only active while the channel is not
  // confirmed SUBSCRIBED, so a healthy realtime session costs nothing.
  useEffect(() => {
    if (!user || realtimeStatus === "connected") return;
    const interval = setInterval(() => {
      void refreshConversations();
      const activeId = activeRef.current;
      if (activeId) {
        void refreshMessages(activeId);
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [user, realtimeStatus, refreshConversations, refreshMessages]);

  // Clean up typing timeout
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // The service worker posts MARK_CONVERSATION_READ when a chat notification is
  // dismissed with the "mark as read" action. Nothing listened for it, so the
  // action did nothing and the badge stayed.
  useEffect(() => {
    if (!user || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type !== "MARK_CONVERSATION_READ") return;
      const conversationId = event.data?.conversationId;
      if (typeof conversationId !== "string" || !conversationId) return;
      // Call the data layer directly: this effect runs before markRead is
      // defined, so referencing the callback here would hit the TDZ.
      void markConversationRead(conversationId).catch((err) => {
        console.error("Error marking conversation as read from notification:", err);
      });
      setConversations((current) =>
        current.map((c) => (c.id === conversationId ? { ...c, unread_count: 0 } : c))
      );
    };
    navigator.serviceWorker.addEventListener("message", onServiceWorkerMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onServiceWorkerMessage);
  }, [user]);

  const openConversation = useCallback(
    async (id: string | null) => {
      setActiveConversationId(id);
      setHasMoreMessages(false);
      setPinnedMessages([]);
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
        refreshPinnedMessages(id),
      ]);
      // Refresh unread counts after marking read.
      await refreshConversations();
    },
    [refreshConversations, refreshMessages, refreshPinnedMessages, refreshTypingIndicators]
  );

  const loadOlderMessages = useCallback(async () => {
    const conversationId = activeRef.current;
    if (!conversationId) return;
    const oldest = messagesRef.current[0];
    if (!oldest) return;

    setIsLoadingOlderMessages(true);
    try {
      const page = await getMessages(conversationId, {
        limit: MESSAGE_PAGE_SIZE,
        before: { createdAt: oldest.created_at, id: oldest.id },
      });
      let older = page.messages;
      if (older.length > 0 && (await isRealtimeChatAvailable())) {
        const [reactions, statuses] = await Promise.all([
          getReactionsForMessages(older.map((message) => message.id)),
          getStatusesForMessages(older.map((message) => message.id)),
        ]);
        older = older.map((message) => ({
          ...message,
          reactions: reactions[message.id] ?? [],
          status: statuses[message.id] ?? [],
        }));
      }
      setHasMoreMessages(page.hasMore);
      if (activeRef.current !== conversationId) return;
      setMessages((current) => prependOlderPage(current, older));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load older messages.");
    } finally {
      setIsLoadingOlderMessages(false);
    }
  }, []);

  const sendMessage = useCallback(
    async (body: string, mediaFiles?: File[]) => {
      const id = activeRef.current;
      if (!id || (!body.trim() && (!mediaFiles || mediaFiles.length === 0))) return null;
      setIsSending(true);
      try {
        let message: ConversationMessage | null = null;
        // Media-only sends need a non-empty body until the migration relaxes
        // send_conversation_message_v2 — use a neutral fallback so the photo is
        // never dropped by the RPC's empty-body guard.
        const text = body.trim() || (mediaFiles && mediaFiles.length > 0 ? "📎" : "");
        let optimisticUrls: string[] = [];

        if (mediaFiles && mediaFiles.length > 0) {
          // Process and send media files
          const processedMedia = await ChatMediaService.processMultipleFiles(id, mediaFiles);
          const sent = (await sendMessageWithMedia(id, text, processedMedia)) as ConversationMessage | null;
          // The RPC returns the bare message row (no media rows), so the sender
          // would otherwise see nothing until the next reload. Attach the local
          // blobs immediately and reconcile with signed URLs below.
          if (sent) {
            optimisticUrls = mediaFiles.map((file) => URL.createObjectURL(file));
            message = {
              ...sent,
              media: processedMedia.map((media, index) => ({
                id: `local-${index}`,
                message_id: sent.id,
                media_type: media.media_type,
                file_url: optimisticUrls[index],
                file_name: media.file_name,
                file_size: media.file_size,
                mime_type: media.mime_type,
                thumbnail_url: media.media_type === "image" ? optimisticUrls[index] : undefined,
                width: media.width,
                height: media.height,
                duration_seconds: media.duration_seconds,
                created_at: new Date().toISOString(),
              })),
            };
          }
        } else {
          // Send text-only message
          message = await dbSendMessage(id, text);
        }

        if (!message) return null;

        // Delivery status needs the realtime schema; never let it fail a successful send.
        if (await isRealtimeChatAvailable()) {
          await updateMessageStatus(message.id, "sent").catch(() => undefined);
        }

        setMessages((current) => [...current, message]);

        // Swap the local object URLs for authorized signed URLs, then release
        // the blobs so a burst of voice notes cannot pin memory for the session.
        if (optimisticUrls.length > 0) {
          void refreshMessages(id).finally(() => {
            optimisticUrls.forEach((url) => URL.revokeObjectURL(url));
          });
        }

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
    [refreshMessages]
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

  const startDirectConversation = useCallback(
    async (profileId: string) => {
      if (!user || !profileId) return null;
      try {
        const conversation = await getOrCreateDirectConversation(profileId);
        // Upsert rather than blind-prepend: the RPC is idempotent, so this must
        // not duplicate an existing row in the inbox.
        setConversations((current) => {
          const without = current.filter((c) => c.id !== conversation.id);
          return [conversation, ...without];
        });
        await openConversation(conversation.id);
        return conversation;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to start the conversation.");
        return null;
      }
    },
    [user, openConversation]
  );

  const searchPeople = useCallback(
    async (query: string) => {
      if (!user) return [];
      try {
        return await searchDiscoverableProfiles(query);
      } catch (err) {
        console.error("Error searching people:", err);
        return [];
      }
    },
    [user]
  );

  const counterpartOf = useCallback(
    (conversation: Conversation | null) =>
      conversation ? getCounterpart(conversation, user?.id) : null,
    [user]
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

    await pinMessage(conversationId, messageId, note);
    await Promise.all([
      refreshPinnedMessages(conversationId),
      refreshConversations(),
    ]);
  }, [refreshConversations, refreshPinnedMessages]);

  const handleUnpinMessage = useCallback(async (messageId: string) => {
    const conversationId = activeRef.current;
    if (!conversationId) return;

    await unpinMessage(conversationId, messageId);
    await Promise.all([
      refreshPinnedMessages(conversationId),
      refreshConversations(),
    ]);
  }, [refreshConversations, refreshPinnedMessages]);

  /**
   * Edit one of your own messages.
   *
   * Goes through edit_conversation_message(): `messages` has no UPDATE grant for
   * `authenticated`, so the previous direct table update was silently dropped by
   * RLS (0 rows, no error) and the UI showed an edit that never persisted. Errors
   * now surface instead of being swallowed.
   */
  const editMessage = useCallback(async (messageId: string, newBody: string) => {
    try {
      const updated = await dbEditMessage(messageId, newBody);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                body: updated.body ?? message.body,
                edited_at: updated.edited_at ?? new Date().toISOString(),
              }
            : message
        )
      );
      void refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to edit the message.");
      throw err;
    }
  }, [refreshConversations]);

  /** Soft-delete one of your own messages through delete_conversation_message(). */
  const deleteMessage = useCallback(async (messageId: string) => {
    try {
      await dbDeleteMessage(messageId);
      const deletedAt = new Date().toISOString();
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId && !message.deleted_at
            ? { ...message, deleted_at: deletedAt, body: "Message deleted" }
            : message
        )
      );
      void refreshConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete the message.");
      throw err;
    }
  }, [refreshConversations]);

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
        refreshPinnedMessages(conversationId),
        refreshConversations(),
      ]);
    } catch (err) {
      console.error("Error refreshing conversation data:", err);
    }
  }, [refreshMessages, refreshPinnedMessages, refreshTypingIndicators, refreshConversations]);

  const clearError = useCallback(() => setError(null), []);
  
  const value = useMemo<ChatContextType>(
    () => ({
      conversations,
      activeConversation,
      messages,
      unreadCount: conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0),
      isLoading,
      isSending,
      error,
      clearError,
      realtimeStatus,
      typingIndicators,
      hasMoreMessages,
      isLoadingOlderMessages,
      pinnedMessages,
      setActiveConversationId: (id) => void openConversation(id),
      sendMessage,
      loadOlderMessages,
      markRead,
      markDelivered,
      openSupportConversation,
      startDirectConversation,
      searchPeople,
      counterpartOf,
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
      clearError,
      createInternalConversation,
      error,
      isLoading,
      isSending,
      markRead,
      markDelivered,
      messages,
      openConversation,
      openSupportConversation,
      startDirectConversation,
      searchPeople,
      counterpartOf,
      realtimeStatus,
      refreshConversations,
      sendMessage,
      loadOlderMessages,
      hasMoreMessages,
      isLoadingOlderMessages,
      pinnedMessages,
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