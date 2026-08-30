"use client";

import { FormEvent, KeyboardEvent, useState } from "react";
import { Clock, Send, MessageSquare, Wifi, WifiOff } from "lucide-react";
import { Conversation, ConversationMessage } from "../../types";
import { useLanguage } from "../../context/LanguageContext";

export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${date.toLocaleDateString([], { day: "2-digit", month: "short" })} · ${time}`;
}

export function MessageBubble({
  message,
  isMine,
}: {
  message: ConversationMessage;
  isMine: boolean;
}) {
  const isStaff = message.sender_role === "admin" || message.sender_role === "staff";
  return (
    <div className={`flex w-full ${isMine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
          isMine
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : isStaff
              ? "rounded-bl-sm bg-muted/70 text-foreground border border-border/50"
              : "rounded-bl-sm bg-card border border-border text-foreground"
        }`}
      >
        {!isMine && (
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider opacity-80">
            {message.sender_name || "DLXSTORE"}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>
        <p
          className={`mt-1 flex items-center gap-1 text-[10px] ${
            isMine ? "text-primary-foreground/70" : "text-muted-foreground"
          }`}
        >
          <Clock className="h-3 w-3" />
          {formatChatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}

export function MessageComposer({
  onSend,
  disabled,
  placeholder,
  sending,
}: {
  onSend: (body: string) => void;
  disabled?: boolean;
  sending?: boolean;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || disabled) return;
    onSend(body);
    setDraft("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-border bg-card/60 p-3">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        className="min-h-[42px] flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-foreground/70 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={disabled || !draft.trim() || sending}
        aria-label="Send"
        className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40"
      >
        <Send className="h-4.5 w-4.5" />
      </button>
    </form>
  );
}

export function ConversationListItem({
  conversation,
  isActive,
  displayName,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  displayName: string;
  onClick: () => void;
}) {
  const hasUnread = (conversation.unread_count || 0) > 0;
  return (
    <button
      onClick={onClick}
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
            {displayName}
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
          {conversation.last_message_preview || "Nouvelle conversation"}
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
              Commande
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function ChatEmptyState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <MessageSquare className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 font-bold">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">{body}</p>
      {action && onAction && (
        <button
          onClick={onAction}
          className="mt-5 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {action}
        </button>
      )}
    </div>
  );
}

export function RealtimeBadge({
  status,
}: {
  status: "connected" | "fallback" | "off";
}) {
  const { t } = useLanguage();
  const delta = {
    connected: {
      label: t.chatRealtime,
      icon: <Wifi className="h-3 w-3" />,
      className: "text-emerald-600 border-emerald-600/30 bg-emerald-600/10",
    },
    fallback: {
      label: t.chatFallback,
      icon: <Clock className="h-3 w-3" />,
      className: "text-amber-600 border-amber-600/30 bg-amber-600/10",
    },
    off: {
      label: t.chatOffline,
      icon: <WifiOff className="h-3 w-3" />,
      className: "text-muted-foreground border-border bg-muted",
    },
  }[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${delta.className}`}
    >
      {delta.icon}
      {delta.label}
    </span>
  );
}
