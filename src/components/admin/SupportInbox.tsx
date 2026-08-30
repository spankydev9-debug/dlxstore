"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCheck, Phone, Mail, Package } from "lucide-react";
import { useChat } from "../../context/ChatContext";
import { useAuth } from "../../context/AuthContext";
import { ConversationParticipantInfo } from "../../types";
import { setConversationStatus } from "../../services/db/chat";
import {
  ChatEmptyState,
  ConversationListItem,
  MessageBubble,
  MessageComposer,
  RealtimeBadge,
} from "../chat/ChatUi";

function customerOf(
  participants: ConversationParticipantInfo[],
  customerId?: string | null
): ConversationParticipantInfo | undefined {
  return (
    participants.find((p) => p.role === "customer") ??
    participants.find((p) => p.profile_id === customerId)
  );
}

export function SupportInbox() {
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
    refreshConversations,
  } = useChat();
  const { user } = useAuth();

  const supportConversations = useMemo(
    () => conversations.filter((c) => c.type === "customer_support"),
    [conversations]
  );

  const customer = activeConversation
    ? customerOf(activeConversation.participants, activeConversation.customer_profile_id)
    : undefined;

  if (isLoading && supportConversations.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="grid h-[640px] overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[300px_1fr]">
      {/* Customer support conversation list */}
      <aside className="hidden flex-col border-r border-border md:flex">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <p className="text-sm font-bold">Boîte de réception support</p>
          <RealtimeBadge status={realtimeStatus} />
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {supportConversations.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Aucune demande de support.
            </p>
          ) : (
            supportConversations.map((conversation) => {
              const customer = customerOf(
                conversation.participants,
                conversation.customer_profile_id
              );
              return (
                <ConversationListItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === activeConversation?.id}
                  displayName={customer?.full_name || "Client"}
                  onClick={() => setActiveConversationId(conversation.id)}
                />
              );
            })
          )}
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
              title="Boîte de réception support"
              body="Sélectionnez une conversation client pour lire les messages et répondre depuis DLXSTORE."
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <button
                onClick={() => setActiveConversationId(null)}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-muted md:hidden"
                aria-label="Retour"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">
                  {customer?.full_name || "Client"}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                  {customer?.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {customer.phone}
                    </span>
                  )}
                  {customer?.email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {customer.email}
                    </span>
                  )}
                  {activeConversation.order_id && (
                    <Link
                      href={`/order-tracking?orderId=${activeConversation.order_id}`}
                      className="inline-flex items-center gap-1 underline"
                    >
                      <Package className="h-3 w-3" />
                      Commande #{activeConversation.order_id.slice(0, 8)}
                    </Link>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeConversation.status === "open" && (
                  <button
                    onClick={() =>
                      void setConversationStatus(activeConversation.id, "resolved")
                        .then(() => refreshConversations())
                    }
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    Résoudre
                  </button>
                )}
                <RealtimeBadge status={realtimeStatus} />
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <ChatEmptyState
                  title="Aucun message"
                  body="Ce client n'a pas encore envoyé de message."
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
              placeholder="Répondre au client…"
            />
          </>
        )}
      </section>
    </div>
  );
}