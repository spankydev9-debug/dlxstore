"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { useChat } from "../../context/ChatContext";
import { useAuth } from "../../context/AuthContext";
import {
  ChatEmptyState,
  ConversationListItem,
  MessageBubble,
  MessageComposer,
  RealtimeBadge,
} from "./ChatUi";

export function CustomerSupportChat({
  initialOrderId,
}: {
  initialOrderId?: string;
}) {
  const {
    conversations,
    activeConversation,
    messages,
    isLoading,
    isSending,
    error,
    realtimeStatus,
    setActiveConversationId,
    sendMessage,
    openSupportConversation,
  } = useChat();
  const { user } = useAuth();
  const router = useRouter();

  const supportConversations = useMemo(
    () => conversations.filter((c) => c.type === "customer_support"),
    [conversations]
  );

  // If a specific order was requested and no matching open thread exists,
  // open (or create) that order-scoped conversation.
  useEffect(() => {
    if (!initialOrderId || !user) return;
    const exists = supportConversations.some(
      (c) => c.order_id === initialOrderId && c.status !== "closed"
    );
    if (!exists) {
      void openSupportConversation(initialOrderId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOrderId, user]);

  const displayName = (conversationId: string) => {
    const conv = supportConversations.find((c) => c.id === conversationId);
    if (!conv) return "Support DLXSTORE";
    const other = conv.participants.find((p) => p.profile_id !== user?.id);
    return other?.full_name || "Support DLXSTORE";
  };

  /** If the user is not signed in, redirect to login. Otherwise open/create the support thread. */
  const handleStartConversation = (orderId?: string) => {
    if (!user) {
      router.push("/auth?mode=login");
      return;
    }
    void openSupportConversation(orderId);
  };

  if (isLoading && supportConversations.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-[400px] overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[280px_1fr]">
      {/* Conversation list (desktop) */}
      <aside className="hidden flex-col border-r border-border md:flex">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <p className="text-sm font-bold">Support</p>
          <RealtimeBadge status={realtimeStatus} />
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {supportConversations.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Aucune conversation pour le moment.
            </p>
          ) : (
            supportConversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                isActive={conversation.id === activeConversation?.id}
                displayName={displayName(conversation.id)}
                onClick={() => setActiveConversationId(conversation.id)}
              />
            ))
          )}
        </div>
        <div className="border-t border-border p-2">
          <button
            onClick={() => void handleStartConversation()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Nouvelle conversation
          </button>
        </div>
      </aside>

      {/* Thread */}
      <section className="flex min-h-0 flex-col">
        {!activeConversation ? (
          <>
            <div className="flex items-center gap-2 border-b border-border p-3 md:hidden">
              <RealtimeBadge status={realtimeStatus} />
            </div>
            <ChatEmptyState
              title="Contactez le support DLXSTORE"
              body="Posez vos questions sur une commande, une livraison, un remboursement ou tout autre sujet. Un membre de l'équipe vous répondra ici."
              action={user ? "Démarrer une conversation" : "Se connecter pour contacter le support"}
              onAction={() => handleStartConversation()}
            />
            {error && (
              <div className="px-4 py-2 text-center text-xs text-destructive">
                {error}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border p-3">
              <button
                onClick={() => setActiveConversationId(null)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted md:hidden"
                aria-label="Retour"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {displayName(activeConversation.id)}
                </p>
                {activeConversation.order_id && (
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Commande #{activeConversation.order_id.slice(0, 8)}
                  </p>
                )}
              </div>
              <RealtimeBadge status={realtimeStatus} />
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <ChatEmptyState
                  title="Commencez la conversation"
                  body="Décrivez votre demande. L'équipe DLXSTORE vous répondra dans cette discussion."
                />
              ) : (
                messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isMine={message.sender_id === user?.id}
                  />
                ))
              )}
            </div>

            {error && (
              <p className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <MessageComposer
              onSend={(body) => void sendMessage(body)}
              sending={isSending}
              placeholder="Écrivez votre message…"
            />
          </>
        )}
      </section>
    </div>
  );
}