"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { 
  MessageSquare, Users, Search, MoreVertical, Pin, 
  CheckCircle, AlertCircle, UserPlus, Settings,
  ArrowLeft, Filter, Archive, Trash2
} from "lucide-react";
import { Conversation, ConversationMessage } from "../../types";
import { useChat } from "../../context/ChatContext";
import { useLanguage } from "../../context/LanguageContext";
import { 
  MessageBubble, 
  MessageComposer, 
  TypingIndicatorDisplay,
  OnlineStatusBadge,
  formatChatTime 
} from "./EnhancedChatUi";

export function ModernChatInterface() {
  const { t } = useLanguage();
  const {
    conversations,
    activeConversation,
    messages,
    typingIndicators,
    isLoading,
    isSending,
    error,
    realtimeStatus,
    unreadCount,
    setActiveConversationId,
    sendMessage,
    markDelivered,
    setTypingStatus,
    addReaction,
    editMessage,
    deleteMessage,
    pinMessage,
    unpinMessage,
    refreshActiveConversationData,
  } = useChat();

  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "support" | "internal">("all");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark messages as delivered when they become visible
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const messageId = entry.target.getAttribute("data-message-id");
            if (messageId) {
              markDelivered(messageId).catch(console.error);
            }
          }
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

  const handleSendMessage = useCallback(async (body: string, media?: any[]) => {
    if (!activeConversation) return;
    
    try {
      await sendMessage(body, media);
      setTypingStatus(false);
    } catch (err) {
      console.error("Error sending message:", err);
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

  const handleEditMessage = useCallback(async (messageId: string) => {
    const newBody = prompt("Edit your message:");
    if (newBody && newBody.trim()) {
      try {
        await editMessage(messageId, newBody.trim());
      } catch (err) {
        console.error("Error editing message:", err);
      }
    }
  }, [editMessage]);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (confirm("Are you sure you want to delete this message?")) {
      try {
        await deleteMessage(messageId);
      } catch (err) {
        console.error("Error deleting message:", err);
      }
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
    const lastParticipant = conversation.participants.find(p => p.profile_id !== "current-user");
    
    return (
      <button
        key={conversation.id}
        onClick={() => setActiveConversationId(conversation.id)}
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
                (conversation.type === "customer_support" ? "DLX Support" : 
                 conversation.participants.map(p => p.full_name).filter(Boolean).join(", "))}
            </p>
            {conversation.last_message_at && (
              <span
                className={`shrink-0 text-[10px] ${
                  isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                }`}
              >
                {formatChatTime(conversation.last_message_at)}
              </span>
            )}
          </div>
          
          <p
            className={`truncate text-xs ${
              isActive ? "text-primary-foreground/80" : "text-muted-foreground"
            }`}
          >
            {conversation.last_message_preview || "New conversation"}
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
            
            {lastParticipant && (
              <OnlineStatusBadge
                userId={lastParticipant.profile_id}
                conversationId={conversation.id}
                lastSeen={lastParticipant.presence?.last_seen_at}
              />
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className={`${isSidebarOpen ? "w-80" : "w-0"} border-r border-border transition-all duration-300 flex flex-col`}>
        {isSidebarOpen && (
          <>
            {/* Sidebar header */}
            <div className="border-b border-border p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  DLX Chat
                  {unreadCount > 0 && (
                    <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full">
                      {unreadCount}
                    </span>
                  )}
                </h2>
                <div className="flex gap-2">
                  <button
                    onClick={() => setIsSidebarOpen(false)}
                    className="p-1 hover:bg-muted rounded"
                    title="Hide sidebar"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <button className="p-1 hover:bg-muted rounded">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              {/* Search */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-foreground"
                />
              </div>
              
              {/* Filters */}
              <div className="flex gap-1">
                {(["all", "unread", "support", "internal"] as const).map((filterType) => (
                  <button
                    key={filterType}
                    onClick={() => setFilter(filterType)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${
                      filter === filterType
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    {filterType}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto p-2">
              {isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-sm text-muted-foreground">Loading conversations...</div>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex h-full items-center justify-center p-4">
                  <div className="text-center">
                    <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {searchQuery ? "No conversations found" : "No conversations yet"}
                    </p>
                  </div>
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
      <div className="flex-1 flex flex-col">
        {/* Chat header */}
        {activeConversation ? (
          <>
            <div className="border-b border-border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {!isSidebarOpen && (
                    <button
                      onClick={() => setIsSidebarOpen(true)}
                      className="p-1 hover:bg-muted rounded"
                    >
                      <MessageSquare className="h-4 w-4" />
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
                  <div className="flex gap-1">
                    <button className="p-2 hover:bg-muted rounded">
                      <Search className="h-4 w-4" />
                    </button>
                    <button className="p-2 hover:bg-muted rounded">
                      <Pin className="h-4 w-4" />
                    </button>
                    <button className="p-2 hover:bg-muted rounded">
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Messages area */}
            <div 
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
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
                  <div key={message.id} data-message-id={message.id}>
                    <MessageBubble
                      message={message}
                      isMine={message.sender_role === "customer"}
                      onReaction={(emoji) => handleReaction(message.id, emoji)}
                      onEdit={() => handleEditMessage(message.id)}
                      onDelete={() => handleDeleteMessage(message.id)}
                      onPin={() => message.is_pinned ? handleUnpinMessage(message.id) : handlePinMessage(message.id)}
                    />
                  </div>
                ))
              )}
              <TypingIndicatorDisplay indicators={typingIndicators} />
              <div ref={messagesEndRef} />
            </div>
            
            {/* Message composer */}
            <MessageComposer
              onSend={handleSendMessage}
              disabled={isSending}
              placeholder={t.chatWriteMessage}
              sending={isSending}
              onTypingChange={handleTypingChange}
            />
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
                onClick={() => {}}
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