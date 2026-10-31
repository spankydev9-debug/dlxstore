"use client";

import Link from "next/link";
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import {
  MessageSquare, Users, Search,
  CheckCircle, AlertCircle, UserPlus, Settings,
  ArrowLeft, Filter, Archive, Trash2, Loader2, Plus, Pin, ChevronUp,
} from "lucide-react";
import { Conversation, ConversationMessage } from "../../types";
import { useChat } from "../../context/ChatContext";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import {
  MessageBubble, 
  MessageComposer, 
  TypingIndicatorDisplay,
  OnlineStatusBadge,
} from "./EnhancedChatUi";
import { ChatTimestamp } from "./chatTime";
import { NewDirectConversationPanel } from "./NewDirectConversationPanel";
import { ChatSocialRail } from "./ChatSocialRail";
import { productSharePreview } from "../../lib/product-share";

export function ModernChatInterface() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const {
    conversations,
    activeConversation,
    messages,
    typingIndicators,
    isLoading,
    isSending,
    error,
    clearError,
    realtimeStatus,
    unreadCount,
    hasMoreMessages,
    isLoadingOlderMessages,
    pinnedMessages,
    setActiveConversationId,
    sendMessage,
    loadOlderMessages,
    markDelivered,
    setTypingStatus,
    addReaction,
    editMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
    refreshActiveConversationData,
    startDirectConversation,
    openSupportConversation,
    searchPeople,
    counterpartOf,
  } = useChat();

  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "direct" | "support" | "internal">("all");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showNewChat, setShowNewChat] = useState(false);
  const [isStartingSupport, setIsStartingSupport] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // Whether the user is reading the latest messages. New messages only jump the
  // list when they are already near the bottom, so history stays readable.
  const nearBottomRef = useRef(true);
  // Inline message editing/deleting: window.prompt/confirm are unusable on
  // mobile and block the whole page.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Restores scroll position after older history is prepended.
  const pendingScrollRestoreRef = useRef<number | null>(null);
  const deliveredRef = useRef<Set<string>>(new Set());

  const handleStartSupportConversation = async () => {
    setIsStartingSupport(true);
    try {
      await openSupportConversation();
    } finally {
      setIsStartingSupport(false);
    }
  };

  const handleContainerScroll = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Prepending a page of history shifts everything down. Without this the reader
  // is thrown to an arbitrary position mid-conversation.
  useLayoutEffect(() => {
    const el = messagesContainerRef.current;
    if (!el || pendingScrollRestoreRef.current === null) return;
    const delta = el.scrollHeight - pendingScrollRestoreRef.current;
    pendingScrollRestoreRef.current = null;
    el.scrollTop += delta;
  }, [messages]);

  const handleLoadOlder = useCallback(async () => {
    const el = messagesContainerRef.current;
    pendingScrollRestoreRef.current = el ? el.scrollHeight : null;
    await loadOlderMessages();
  }, [loadOlderMessages]);

  // Auto-scroll to bottom when new messages arrive — but only when the reader is
  // already at (or near) the latest message, so scrolling through history is never
  // yanked back down.
  useEffect(() => {
    if (nearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Mark received messages as delivered when they become visible. Only messages
  // received from someone else, and only once per id — the observer used to fire
  // one RPC per visible bubble on every messages change.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          if (entry.target.getAttribute("data-mine") === "true") return;
          const messageId = entry.target.getAttribute("data-message-id");
          if (!messageId || deliveredRef.current.has(messageId)) return;
          deliveredRef.current.add(messageId);
          markDelivered(messageId).catch(console.error);
        });
      },
      { threshold: 0.5 }
    );

    messagesContainerRef.current?.querySelectorAll("[data-message-id]").forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [messages, markDelivered]);

  const filteredConversations = conversations.filter((conv) => {
    if (filter === "unread" && conv.unread_count === 0) return false;
    if (filter === "direct" && conv.type !== "direct") return false;
    if (filter === "support" && conv.type !== "customer_support") return false;
    if (filter === "internal" && conv.type !== "internal") return false;
    
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      return (
        conv.title?.toLowerCase().includes(searchLower) ||
        conv.last_message_preview?.toLowerCase().includes(searchLower) ||
        conv.participants.some(p => 
          p.full_name?.toLowerCase().includes(searchLower) ||
          p.email?.toLowerCase().includes(searchLower)
        )
      );
    }
    
    return true;
  });

  const handleSendMessage = useCallback(async (body: string, media?: File[]): Promise<boolean> => {
    if (!activeConversation) return false;
    try {
      const sent = await sendMessage(body, media);
      setTypingStatus(false);
      return sent !== null;
    } catch (err) {
      console.error("Error sending message:", err);
      return false;
    }
  }, [activeConversation, sendMessage, setTypingStatus]);

  const handleTypingChange = useCallback((isTyping: boolean) => {
    if (!activeConversation) return;
    setTypingStatus(isTyping);
  }, [activeConversation, setTypingStatus]);

  const handleReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      await addReaction(messageId, emoji);
    } catch (err) {
      console.error("Error adding reaction:", err);
    }
  }, [addReaction]);

  const handleEditMessage = useCallback((message: ConversationMessage) => {
    if (message.deleted_at) return;
    setEditingMessageId(message.id);
    setEditDraft(message.body ?? "");
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditDraft("");
  }, []);

  const submitEdit = useCallback(async (messageId: string) => {
    const body = editDraft.trim();
    if (!body) return;
    setIsSavingEdit(true);
    try {
      await editMessage(messageId, body);
      setEditingMessageId(null);
      setEditDraft("");
    } catch (err) {
      // The context surfaces the reason (RLS/RPC/network) in its error banner;
      // keep the editor open so the text is not lost.
      console.error("Error editing message:", err);
    } finally {
      setIsSavingEdit(false);
    }
  }, [editDraft, editMessage]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    setPendingDeleteId(messageId);
  }, []);

  const confirmDelete = useCallback(async (messageId: string) => {
    setIsDeleting(true);
    try {
      await deleteMessage(messageId);
      setPendingDeleteId(null);
    } catch (err) {
      console.error("Error deleting message:", err);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteMessage]);

  const handlePinMessage = useCallback(async (messageId: string) => {
    const note = prompt("Add a note for this pinned message (optional):");
    try {
      await pinMessage(messageId, note || undefined);
    } catch (err) {
      console.error("Error pinning message:", err);
    }
  }, [pinMessage]);

  const handleUnpinMessage = useCallback(async (messageId: string) => {
    if (confirm("Unpin this message?")) {
      try {
        await unpinMessage(messageId);
      } catch (err) {
        console.error("Error unpinning message:", err);
      }
    }
  }, [unpinMessage]);

  const renderConversationItem = (conversation: Conversation) => {
    const isActive = conversation.id === activeConversation?.id;
    const hasUnread = conversation.unread_count > 0;
    // Resolve the other person by id. list_my_conversations orders participants
    // with the caller first, so participants[0] is you, not your counterpart.
    const counterpart = counterpartOf(conversation);
    
    return (
      <button
        key={conversation.id}
        onClick={() => {
          setActiveConversationId(conversation.id);
          nearBottomRef.current = true;
          // On phones the sidebar is a full-width drawer, so opening a
          // conversation must reveal the message pane behind it.
          if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches) {
            setIsSidebarOpen(false);
          }
        }}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all ${
          isActive ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-muted"
        }`}
      >
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            isActive ? "bg-primary-foreground/20" : "bg-muted"
          }`}
        >
          <MessageSquare className="h-4.5 w-4.5" />
        </div>
        
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p
              className={`truncate text-sm font-semibold ${
                isActive ? "text-primary-foreground" : "text-foreground"
              }`}
            >
              {conversation.title ||
                (conversation.type === "customer_support"
                  ? "DLX Support"
                  : counterpart?.full_name ||
                    conversation.participants.map(p => p.full_name).filter(Boolean).join(", "))}
            </p>
            {conversation.last_message_at && (
              <span
                className={`shrink-0 text-[10px] ${
                  isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                }`}
              >
                <ChatTimestamp iso={conversation.last_message_at} />
              </span>
            )}
          </div>
          
          <p
            className={`truncate text-xs ${
              isActive ? "text-primary-foreground/80" : "text-muted-foreground"
            }`}
          >
            {(productSharePreview(conversation.last_message_preview) ?? conversation.last_message_preview) || "New conversation"}
          </p>
          
          <div className="mt-1 flex items-center gap-2">
            {hasUnread && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  isActive
                    ? "bg-primary-foreground text-primary"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                {conversation.unread_count}
              </span>
            )}
            
            {conversation.order_id && (
              <span
                className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                  isActive
                    ? "border-primary-foreground/40 text-primary-foreground/80"
                    : "border-border text-muted-foreground"
                }`}
              >
                Order
              </span>
            )}
            
            {counterpart && (
              <OnlineStatusBadge
                userId={counterpart.profile_id}
                conversationId={conversation.id}
                lastSeen={counterpart.presence?.last_seen_at}
              />
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar. On phones it is a full-width drawer that is mutually exclusive
          with the conversation pane; from lg up it sits beside it. */}
      <div className={`${isSidebarOpen ? "w-full lg:w-80" : "w-0 overflow-hidden"} shrink-0 border-r border-border bg-background transition-all duration-300 flex flex-col`}>
        {isSidebarOpen && (
          <>
            {/* Sidebar header */}
            <div className="border-b border-border p-4">
              <div className="flex items-center justify-between mb-4">
                   <h2 className="text-lg font-bold flex items-center gap-2">
                     <MessageSquare className="h-5 w-5" />
                     {t.supportTitle}
                     {unreadCount > 0 && (
                       <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">
                         {unreadCount}
                       </span>
                     )}
                   </h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="hidden h-9 w-9 items-center justify-center rounded hover:bg-muted lg:flex"
                    title="Hide sidebar"
                    aria-label="Hide sidebar"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              {/* Search */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                   placeholder={t.chatSearchConversations}
                   value={searchQuery}
                   onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-foreground"
                />
              </div>
              
              {/* Filters */}
              <div className="flex flex-wrap gap-1">
                {(["all", "unread", "direct", "support", "internal"] as const).map((filterType) => (
                  <button
                    key={filterType}
                    onClick={() => setFilter(filterType)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize ${
                      filter === filterType
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted/50 hover:bg-muted"
                    }`}
                  >
                    {filterType}
                  </button>
                ))}
              </div>
            </div>

            {/* Social rail: stories and friends embedded inline (tap a story to
                open the real viewer, tap a friend to open their conversation)
                plus the live daily streak. */}
            <ChatSocialRail
              onStartConversation={async (profileId) => {
                await startDirectConversation(profileId);
                // Reveal the message pane behind the full-width phone drawer.
                if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches) {
                  setIsSidebarOpen(false);
                }
              }}
            />
            
            {/* New direct conversation */}
            <div className="border-b border-border p-3">
              {showNewChat ? (
                <NewDirectConversationPanel
                  onClose={() => setShowNewChat(false)}
                  onStarted={(id) => {
                    setShowNewChat(false);
                    setActiveConversationId(id);
                    // Reveal the message pane behind the full-width phone drawer.
                    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches) {
                      setIsSidebarOpen(false);
                    }
                  }}
                />
              ) : (
                <button
                  onClick={() => setShowNewChat(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <UserPlus className="h-4 w-4" />
                   {t.chatNewMessage}
                 </button>
              )}
            </div>

            {/* Conversations */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <h3 className="text-sm font-semibold">Conversations</h3>
              <span className="text-xs text-muted-foreground">{filteredConversations.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
              {isLoading ? (
                <div className="flex h-full items-center justify-center">
                   <div className="text-sm text-muted-foreground">{t.chatLoadingConversations}</div>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center">
                  <div>
                    <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {searchQuery ? t.chatNoConversationsFound : t.chatNoConversations}
                    </p>
                    {!searchQuery && filter === "all" ? (
                      <p className="mt-1 text-xs text-muted-foreground">{t.chatContactSupportBody}</p>
                    ) : null}
                  </div>
                  {!searchQuery && filter === "all" ? (
                    <button
                      onClick={handleStartSupportConversation}
                      disabled={isStartingSupport}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isStartingSupport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      {t.chatStartConversation}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredConversations.map(renderConversationItem)}
                </div>
              )}
            </div>
            
            {/* Sidebar footer */}
            <div className="border-t border-border p-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${
                    realtimeStatus === "connected" ? "bg-emerald-500" :
                    realtimeStatus === "fallback" ? "bg-amber-500" :
                    "bg-muted-foreground"
                  }`} />
                  <span className="text-muted-foreground">
                    {realtimeStatus === "connected" ? "Connected" :
                     realtimeStatus === "fallback" ? "Polling" : "Offline"}
                  </span>
                </div>
                <button
                  onClick={refreshActiveConversationData}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Refresh
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* Main chat area */}
      <div className={`${isSidebarOpen ? "hidden lg:flex" : "flex"} min-w-0 flex-1 flex-col`}>
        {/* Chat header */}
        {activeConversation ? (
          <>
            <div className="border-b border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {!isSidebarOpen && (
                    <button
                      onClick={() => setIsSidebarOpen(true)}
                      className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-muted"
                      title="Back to conversations"
                      aria-label="Back to conversations"
                    >
                      <ArrowLeft className="h-5 w-5 lg:hidden" />
                      <MessageSquare className="hidden h-4 w-4 lg:block" />
                    </button>
                  )}
                  <div>
                    <h3 className="font-semibold">
                      {activeConversation.title || 
                        (activeConversation.type === "customer_support" ? "DLX Support" : 
                         activeConversation.participants.map(p => p.full_name).filter(Boolean).join(", "))}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" />
                      <span>{activeConversation.participants.length} participants</span>
                      {activeConversation.order_id && (
                        <>
                          <span>•</span>
                          <span>Order #{activeConversation.order_id.slice(0, 8)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <TypingIndicatorDisplay indicators={typingIndicators} />
                </div>
              </div>
            </div>
            
            {/* Messages area */}
            <div 
              ref={messagesContainerRef}
              onScroll={handleContainerScroll}
              className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-4"
            >
              {/* Pinned messages are staff-authored context (delivery terms, order
                  details). They were fetched nowhere before, so pins existed only
                  in the database. */}
              {pinnedMessages.length > 0 && (
                <div className="rounded-xl border border-border bg-muted/40 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <Pin className="h-3.5 w-3.5" />
                    Pinned ({pinnedMessages.length})
                  </div>
                  <ul className="space-y-1.5">
                    {pinnedMessages.map((pin) => (
                      <li key={pin.message_id} className="text-xs">
                        <span className="font-medium">{pin.pinned_by_name ?? "DLX"}</span>
                        {pin.note ? <span className="text-muted-foreground"> — {pin.note}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {hasMoreMessages && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={handleLoadOlder}
                    disabled={isLoadingOlderMessages}
                    className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border px-4 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    {isLoadingOlderMessages ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ChevronUp className="h-3.5 w-3.5" />
                    )}
                    {isLoadingOlderMessages ? "Loading older messages…" : "Load older messages"}
                  </button>
                </div>
              )}

              {messages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <MessageSquare className="mx-auto h-12 w-12 mb-3 opacity-30" />
                    <p>No messages yet</p>
                    <p className="text-sm mt-1">Start the conversation!</p>
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    data-message-id={message.id}
                    data-mine={message.sender_id === user?.id ? "true" : "false"}
                  >
                    {editingMessageId === message.id ? (
                      <div className="rounded-xl border border-border bg-card p-3">
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">
                          Edit message
                        </label>
                        <textarea
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.target.value)}
                          rows={3}
                          maxLength={4000}
                          className="w-full resize-none rounded-lg border border-border bg-background p-2 text-sm outline-none focus:border-foreground/70"
                          autoFocus
                        />
                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void submitEdit(message.id)}
                            disabled={isSavingEdit || !editDraft.trim()}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                          >
                            {isSavingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <MessageBubble
                        message={message}
                        /* Ownership is decided by sender_id, not sender_role: role is
                           "customer" for every member of a 1-to-1 chat, so comparing
                           the role right-aligned the other person's messages too. */
                        isMine={message.sender_id === user?.id}
                        onReaction={(emoji) => handleReaction(message.id, emoji)}
                        onEdit={() => handleEditMessage(message)}
                        onDelete={() => handleDeleteMessage(message.id)}
                        onPin={() => message.is_pinned ? handleUnpinMessage(message.id) : handlePinMessage(message.id)}
                      />
                    )}

                    {pendingDeleteId === message.id && (
                      <div className="mt-1 flex flex-wrap items-center justify-end gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
                        <span className="mr-auto text-destructive">Delete this message?</span>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="rounded-full px-3 py-1 font-medium text-muted-foreground hover:bg-muted"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void confirmDelete(message.id)}
                          disabled={isDeleting}
                          className="inline-flex items-center gap-1.5 rounded-full bg-destructive px-3 py-1 font-semibold text-white disabled:opacity-50"
                        >
                          {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
              <TypingIndicatorDisplay indicators={typingIndicators} />
              <div ref={messagesEndRef} />
            </div>
            
            {/* Message composer — below `md` it must clear the floating tab bar
                (bottom = safe + 4.375rem) or the input becomes untappable. */}
            <div className="pb-[calc(var(--safe-bottom)+4.5rem)] md:pb-[var(--safe-bottom)]">
              <MessageComposer
                onSend={handleSendMessage}
                disabled={isSending}
                placeholder={t.chatWriteMessage}
                sending={isSending}
                onTypingChange={handleTypingChange}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-8">
            <div className="text-center max-w-md">
              <MessageSquare className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Welcome to DLX Chat</h3>
              <p className="text-muted-foreground mb-6">
                Select a conversation to start messaging, or create a new one to connect with support or team members.
              </p>
              {!isSidebarOpen && (
                <button
                  onClick={() => setIsSidebarOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <MessageSquare className="h-4 w-4" />
                  Browse conversations
                </button>
              )}
            </div>
          </div>
        )}
        
        {/* Error display */}
        {error && (
          <div className="border-t border-destructive/20 bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
               <button
                 onClick={clearError}
                 className="ml-auto text-xs hover:underline"
               >
                 Dismiss
               </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}