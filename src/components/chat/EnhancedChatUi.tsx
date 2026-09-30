"use client";

import { FormEvent, KeyboardEvent, useState, useEffect, useRef } from "react";
import { 
  Clock, Send, MessageSquare, Wifi, WifiOff, 
  Image, Video, Mic, Smile, MoreVertical,
  Pin, Reply, Edit, Trash2, ThumbsUp,
  Check, CheckCheck, Eye
} from "lucide-react";
import { ConversationMessage, TypingIndicator, MessageReaction } from "../../types";
import { useChat } from "../../context/ChatContext";
import { useLanguage } from "../../context/LanguageContext";

export function formatChatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return time;
  return `${date.toLocaleDateString([], { day: "2-digit", month: "short" })} · ${time}`;
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatChatTime(iso);
}

export function MessageStatusIndicator({ status }: { status: string }) {
  switch (status) {
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <Eye className="h-3 w-3 text-primary" />;
    default:
      return null;
  }
}

export function MessageBubble({
  message,
  isMine,
  onReaction,
  onReply,
  onEdit,
  onDelete,
  onPin,
}: {
  message: ConversationMessage;
  isMine: boolean;
  onReaction?: (emoji: string) => void;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
}) {
  const isStaff = message.sender_role === "admin" || message.sender_role === "staff";
  const [showActions, setShowActions] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const commonEmojis = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

  // Close reactions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (bubbleRef.current && !bubbleRef.current.contains(event.target as Node)) {
        setShowReactions(false);
        setShowActions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleReaction = (emoji: string) => {
    onReaction?.(emoji);
    setShowReactions(false);
  };

  const getMessageStatus = () => {
    if (!message.status || message.status.length === 0) return null;
    const myStatus = message.status.find(s => s.user_id === message.sender_id);
    return myStatus?.status || null;
  };

  return (
    <div 
      ref={bubbleRef}
      className={`flex w-full ${isMine ? "justify-end" : "justify-start"}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => {
        if (!showReactions) setShowActions(false);
      }}
    >
      <div className="relative max-w-[85%]">
        {!isMine && (
          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider opacity-80">
            {message.sender_name || "DLXSTORE"}
          </p>
        )}
        
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm shadow-sm relative ${
            isMine
              ? "rounded-br-sm bg-primary text-primary-foreground"
              : isStaff
                ? "rounded-bl-sm bg-muted/70 text-foreground border border-border/50"
                : "rounded-bl-sm bg-card border border-border text-foreground"
          }`}
        >
          {/* Media attachments */}
          {message.media && message.media.length > 0 && (
            <div className="mb-2 space-y-2">
              {message.media.map((media) => (
                <div key={media.id} className="rounded-lg overflow-hidden">
                  {media.media_type === "image" && (
                    <img 
                      src={media.thumbnail_url || media.file_url} 
                      alt={media.file_name || "Image"}
                      className="max-w-full max-h-48 object-cover"
                      loading="lazy"
                    />
                  )}
                  {media.media_type === "video" && (
                    <video 
                      src={media.file_url}
                      controls
                      className="max-w-full max-h-48"
                      poster={media.thumbnail_url}
                    />
                  )}
                  {media.media_type === "audio" && (
                    <audio 
                      src={media.file_url}
                      controls
                      className="w-full"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Message body */}
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.body}</p>

          {/* Message metadata */}
          <div className={`mt-1 flex items-center gap-2 text-[10px] ${
            isMine ? "text-primary-foreground/70" : "text-muted-foreground"
          }`}>
            <Clock className="h-3 w-3" />
            {formatChatTime(message.created_at)}
            
            {message.edited_at && (
              <span className="italic">(edited)</span>
            )}
            
            {isMine && getMessageStatus() && (
              <MessageStatusIndicator status={getMessageStatus()!} />
            )}
            
            {message.is_pinned && (
              <Pin className="h-3 w-3" />
            )}
          </div>

          {/* Message reactions */}
          {message.reactions && message.reactions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(
                message.reactions.reduce((acc: Record<string, string[]>, reaction) => {
                  if (!acc[reaction.emoji]) acc[reaction.emoji] = [];
                  acc[reaction.emoji].push(reaction.user_name || "User");
                  return acc;
                }, {})
              ).map(([emoji, users]) => (
                <button
                  key={emoji}
                  onClick={() => onReaction?.(emoji)}
                  className="rounded-full bg-background/80 border border-border px-2 py-0.5 text-xs hover:bg-background"
                  title={`${users.join(", ")} reacted with ${emoji}`}
                >
                  {emoji} {users.length > 1 && users.length}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message actions */}
        {showActions && (
          <div className={`absolute flex gap-1 ${isMine ? "-left-2 top-0" : "-right-2 top-0"}`}>
            <div className="bg-background border border-border rounded-lg shadow-lg p-1 flex gap-1">
              <button
                onClick={() => setShowReactions(!showReactions)}
                className="p-1 hover:bg-muted rounded"
                title="React"
              >
                <ThumbsUp className="h-3 w-3" />
              </button>
              <button
                onClick={onReply}
                className="p-1 hover:bg-muted rounded"
                title="Reply"
              >
                <Reply className="h-3 w-3" />
              </button>
              {isMine && (
                <>
                  <button
                    onClick={onEdit}
                    className="p-1 hover:bg-muted rounded"
                    title="Edit"
                  >
                    <Edit className="h-3 w-3" />
                  </button>
                  <button
                    onClick={onDelete}
                    className="p-1 hover:bg-muted rounded text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </>
              )}
              <button
                onClick={onPin}
                className="p-1 hover:bg-muted rounded"
                title="Pin"
              >
                <Pin className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Reaction picker */}
        {showReactions && (
          <div className="absolute -top-10 left-0 bg-background border border-border rounded-lg shadow-lg p-2 flex gap-1">
            {commonEmojis.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReaction(emoji)}
                className="p-1 hover:bg-muted rounded text-lg"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TypingIndicatorDisplay({ indicators }: { indicators: TypingIndicator[] }) {
  if (indicators.length === 0) return null;
  
  return (
    <div className="px-4 py-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="flex gap-1">
          <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
          <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
          <div className="h-2 w-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span>
          {indicators.length === 1 
            ? `${indicators[0].user_name} is typing...`
            : `${indicators.length} people are typing...`}
        </span>
      </div>
    </div>
  );
}

export function MessageComposer({
  onSend,
  disabled,
  placeholder,
  sending,
  onTypingChange,
}: {
  onSend: (body: string, media?: any[]) => void;
  disabled?: boolean;
  sending?: boolean;
  placeholder: string;
  onTypingChange?: (isTyping: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [showMediaPreview, setShowMediaPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLanguage();

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if ((!body && mediaFiles.length === 0) || disabled) return;
    
    // Prepare media data
    const mediaItems = mediaFiles.map(file => ({
      media_type: file.type.startsWith("image/") ? "image" : 
                  file.type.startsWith("video/") ? "video" : 
                  file.type.startsWith("audio/") ? "audio" : "document",
      file_url: URL.createObjectURL(file), // In real app, upload first
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
    }));
    
    onSend(body, mediaItems);
    setDraft("");
    setMediaFiles([]);
    setShowMediaPreview(false);
    onTypingChange?.(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const handleInput = (value: string) => {
    setDraft(value);
    onTypingChange?.(value.trim().length > 0);
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setMediaFiles(prev => [...prev, ...files.slice(0, 5)]); // Limit to 5 files
    setShowMediaPreview(true);
  };

  const removeMedia = (index: number) => {
    setMediaFiles(prev => prev.filter((_, i) => i !== index));
    if (mediaFiles.length === 1) {
      setShowMediaPreview(false);
    }
  };

  return (
    <div className="border-t border-border bg-card/60">
      {/* Media preview */}
      {showMediaPreview && mediaFiles.length > 0 && (
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              {mediaFiles.length} file{mediaFiles.length > 1 ? "s" : ""} selected
            </span>
            <button
              type="button"
              onClick={() => {
                setMediaFiles([]);
                setShowMediaPreview(false);
              }}
              className="text-xs text-destructive hover:text-destructive/80"
            >
              Clear all
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {mediaFiles.map((file, index) => (
              <div key={index} className="relative shrink-0">
                {file.type.startsWith("image/") ? (
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="h-16 w-16 object-cover rounded-lg"
                  />
                ) : file.type.startsWith("video/") ? (
                  <div className="h-16 w-16 bg-muted rounded-lg flex items-center justify-center">
                    <Video className="h-6 w-6 text-muted-foreground" />
                  </div>
                ) : file.type.startsWith("audio/") ? (
                  <div className="h-16 w-16 bg-muted rounded-lg flex items-center justify-center">
                    <Mic className="h-6 w-6 text-muted-foreground" />
                  </div>
                ) : (
                  <div className="h-16 w-16 bg-muted rounded-lg flex items-center justify-center">
                    <File className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => removeMedia(index)}
                  className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center text-[10px]"
                >
                  ×
                </button>
                <div className="mt-1 text-[10px] text-muted-foreground truncate max-w-16">
                  {file.name.length > 12 ? `${file.name.slice(0, 10)}...` : file.name}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Composer form */}
      <form onSubmit={submit} className="flex items-end gap-2 p-3">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-muted text-foreground transition-all hover:bg-muted/80 disabled:opacity-40"
            title="Attach file"
          >
            <Image className="h-4.5 w-4.5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          
          <button
            type="button"
            disabled={disabled}
            className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-muted text-foreground transition-all hover:bg-muted/80 disabled:opacity-40"
            title="Emoji"
          >
            <Smile className="h-4.5 w-4.5" />
          </button>
        </div>
        
        <textarea
          value={draft}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          className="min-h-[42px] flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-foreground/70 disabled:opacity-60"
        />
        
        <button
          type="submit"
          disabled={disabled || (!draft.trim() && mediaFiles.length === 0) || sending}
          aria-label="Send"
          className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-40"
        >
          <Send className="h-4.5 w-4.5" />
        </button>
      </form>
    </div>
  );
}

// Helper component for file icon
function File({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

export function OnlineStatusBadge({ 
  userId, 
  conversationId,
  lastSeen
}: { 
  userId: string; 
  conversationId: string;
  lastSeen?: string;
}) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<"online" | "away" | "offline">("offline");
  
  // In a real app, you would subscribe to presence updates
  useEffect(() => {
    // Mock presence check
    const checkPresence = () => {
      if (lastSeen) {
        const lastSeenDate = new Date(lastSeen);
        const minutesAgo = (Date.now() - lastSeenDate.getTime()) / 60000;
        if (minutesAgo < 2) {
          setStatus("online");
        } else if (minutesAgo < 10) {
          setStatus("away");
        } else {
          setStatus("offline");
        }
      }
    };
    
    checkPresence();
    const interval = setInterval(checkPresence, 30000);
    return () => clearInterval(interval);
  }, [lastSeen]);
  
  const statusConfig = {
    online: {
      label: "Online",
      className: "text-emerald-600 border-emerald-600/30 bg-emerald-600/10",
    },
    away: {
      label: "Away",
      className: "text-amber-600 border-amber-600/30 bg-amber-600/10",
    },
    offline: {
      label: lastSeen ? `Last seen ${formatRelativeTime(lastSeen)}` : "Offline",
      className: "text-muted-foreground border-border bg-muted",
    },
  }[status];
  
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusConfig.className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {statusConfig.label}
    </span>
  );
}