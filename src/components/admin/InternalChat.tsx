"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, UserPlus } from "lucide-react";
import { useChat } from "../../context/ChatContext";
import { useAuth } from "../../context/AuthContext";
import { listStaffProfiles, StaffProfile } from "../../services/db/chat";
import {
  ChatEmptyState,
  ConversationListItem,
  MessageBubble,
  MessageComposer,
  RealtimeBadge,
} from "../chat/ChatUi";

export function InternalChat() {
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
    createInternalConversation,
    addConversationParticipant,
  } = useChat();
  const { user } = useAuth();

  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");

  const internalConversations = useMemo(
    () => conversations.filter((c) => c.type === "internal"),
    [conversations]
  );

  useEffect(() => {
    listStaffProfiles().then(setStaff).catch(() => setStaff([]));
  }, []);

  const otherParticipants = (conversationId: string) => {
    const conv = internalConversations.find((c) => c.id === conversationId);
    if (!conv) return [] as { full_name: string }[];
    return conv.participants.filter((p) => p.profile_id !== user?.id);
  };

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const created = await createInternalConversation(trimmed, selected);
    if (created) {
      setShowNew(false);
      setTitle("");
      setSelected([]);
    }
  };

  const handleAdd = async (profileId: string) => {
    if (!activeConversation || !profileId) return;
    await addConversationParticipant(activeConversation.id, profileId);
    setNotice("Participant ajouté.");
    setAdding(false);
    setTimeout(() => setNotice(""), 2000);
  };

  if (isLoading && internalConversations.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="grid h-[640px] overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-[300px_1fr]">
      {/* Internal conversation list */}
      <aside className="hidden flex-col border-r border-border md:flex">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <p className="text-sm font-bold">Discussions internes</p>
          <RealtimeBadge status={realtimeStatus} />
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {internalConversations.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Aucune discussion interne.
            </p>
          ) : (
            internalConversations.map((conversation) => (
              <ConversationListItem
                key={conversation.id}
                conversation={conversation}
                isActive={conversation.id === activeConversation?.id}
                displayName={
                  conversation.title ||
                  otherParticipants(conversation.id)
                    .map((p) => p.full_name)
                    .join(", ") ||
                  "Discussion"
                }
                onClick={() => setActiveConversationId(conversation.id)}
              />
            ))
          )}
        </div>
        <div className="border-t border-border p-2">
          <button
            onClick={() => setShowNew((value) => !value)}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Nouvelle discussion
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
            {showNew ? (
              <InternalNewConversationForm
                staff={staff}
                currentUserId={user?.id}
                title={title}
                selected={selected}
                onTitleChange={setTitle}
                onToggle={(id) =>
                  setSelected((current) =>
                    current.includes(id)
                      ? current.filter((value) => value !== id)
                      : [...current, id]
                  )
                }
                onCancel={() => setShowNew(false)}
                onCreate={() => void handleCreate()}
              />
            ) : (
              <ChatEmptyState
                title="Discussions internes"
                body="Discutez directement avec les membres de l'équipe DLXSTORE : fondateurs, admins et personnel."
                action="Nouvelle discussion"
                onAction={() => setShowNew(true)}
              />
            )}
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
                  {activeConversation.title || "Discussion interne"}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {otherParticipants(activeConversation.id)
                    .map((p) => p.full_name)
                    .join(" · ") || "Membres de l'équipe"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {notice && (
                  <span className="text-[10px] font-semibold text-emerald-600">{notice}</span>
                )}
                {staff.length > 0 && (
                  <div className="relative">
                    {adding ? (
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) void handleAdd(e.target.value);
                          setAdding(false);
                        }}
                        className="rounded-full border border-border bg-background px-2 py-1.5 text-[10px] outline-none"
                      >
                        <option value="">
                          {activeConversation.participants.length > 0
                            ? "Ajouter…"
                            : "Aucun membre libre"}
                        </option>
                        {staff
                          .filter(
                            (p) =>
                              p.id !== user?.id &&
                              !activeConversation.participants.some(
                                (existing) => existing.profile_id === p.id
                              )
                          )
                          .map((person) => (
                            <option key={person.id} value={person.id}>
                              {person.full_name}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <button
                        onClick={() => setAdding(true)}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground hover:bg-muted"
                        title="Ajouter un membre"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Membre
                      </button>
                    )}
                  </div>
                )}
                <RealtimeBadge status={realtimeStatus} />
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <ChatEmptyState
                  title="Lancez la discussion"
                  body="Écrivez le premier message pour cette discussion interne."
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
function InternalNewConversationForm({
  staff,
  currentUserId,
  title,
  selected,
  onTitleChange,
  onToggle,
  onCancel,
  onCreate,
}: {
  staff: StaffProfile[];
  currentUserId?: string;
  title: string;
  selected: string[];
  onTitleChange: (value: string) => void;
  onToggle: (profileId: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-4">
      <div className="rounded-2xl border border-border p-4">
        <p className="text-sm font-bold">Nouvelle discussion interne</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Choisissez un titre et les membres (équipe DLX) à inclure.
        </p>
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="Titre de la discussion"
          className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/70"
        />
        <div className="mt-3 max-h-44 space-y-1 overflow-y-auto">
          {staff
            .filter((p) => p.id !== currentUserId)
            .map((person) => {
              const checked = selected.includes(person.id);
              return (
                <label
                  key={person.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(person.id)}
                  />
                  <span className="flex-1 truncate">{person.full_name}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase">
                    {person.role}
                  </span>
                </label>
              );
            })}
          {staff.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              Aucun autre membre de l'équipe disponible.
            </p>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            onClick={onCreate}
            disabled={!title.trim()}
            className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-40"
          >
            Créer la discussion
          </button>
          <button
            onClick={onCancel}
            className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}
}