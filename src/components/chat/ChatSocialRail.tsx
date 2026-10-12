"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clapperboard, Flame, Loader2, MessageCircle, Users } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useStreakContext } from "../../context/StreakContext";
import { useStories } from "../../hooks/useStories";
import { StoryViewer, useStoryMediaUrls } from "../account/StoriesPanel";
import { getMyFriendGraph } from "../../services/db/social";
import type { Friend, StoryGroup } from "../../types";

/**
 * The social strip at the top of the Messages home.
 *
 * Stories and friends are embedded here, not merely linked: tapping a story
 * avatar opens the real `StoryViewer` in place (with the same signed-media,
 * scroll-lock and reaction behaviour as the dashboard), and tapping a friend
 * starts (or reopens) the direct conversation and focuses it in the message
 * pane. The streak pill reflects the genuine global streak. A trailing link
 * still reaches the full dashboard tabs for story creation and friend
 * management, which are heavier surfaces than this rail.
 */
export function ChatSocialRail({
  onStartConversation,
}: {
  onStartConversation: (profileId: string) => Promise<unknown>;
}) {
  const { t } = useLanguage();
  const { streak } = useStreakContext();
  const { groups, loadState, actions } = useStories();
  const [activeGroup, setActiveGroup] = useState<StoryGroup | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [openingFriendId, setOpeningFriendId] = useState<string | null>(null);
  const urls = useStoryMediaUrls(activeGroup ? activeGroup.stories : []);

  useEffect(() => {
    let cancelled = false;
    getMyFriendGraph()
      .then((graph) => {
        if (!cancelled) setFriends(graph.friends.slice(0, 12));
      })
      .catch(() => {
        if (!cancelled) setFriends([]);
      })
      .finally(() => {
        if (!cancelled) setFriendsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const messageFriend = useCallback(
    async (profileId: string) => {
      setOpeningFriendId(profileId);
      try {
        await onStartConversation(profileId);
      } finally {
        setOpeningFriendId(null);
      }
    },
    [onStartConversation]
  );

  const storiesLoading = loadState === "loading";

  return (
    <div className="space-y-2 border-b border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <Clapperboard className="h-3.5 w-3.5" />
          {t.storiesTab}
        </span>
        <Link
          href="/dashboard?tab=stories"
          className="text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          {t.storiesYourTurn}
        </Link>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {storiesLoading ? (
          <span className="inline-flex h-12 items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        ) : groups.length === 0 ? (
          <span className="inline-flex h-12 items-center text-[11px] text-muted-foreground">
            {t.storiesEmpty}
          </span>
        ) : (
          groups.map((group) => (
            <button
              key={group.author.id}
              type="button"
              onClick={() => setActiveGroup(group)}
              title={group.isMine ? t.storiesYourTurn : group.author.full_name}
              className="flex shrink-0 flex-col items-center gap-1"
            >
              <span
                className={`flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 ${
                  group.hasUnseen ? "border-primary" : "border-border"
                }`}
              >
                {group.author.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={group.author.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="bg-muted text-xs font-bold text-muted-foreground">
                    {group.author.full_name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="max-w-[3.5rem] truncate text-[10px] font-semibold text-muted-foreground">
                {group.isMine ? t.storiesYourTurn : group.author.full_name}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <Link
          href="/dashboard?tab=friends"
          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
        >
          <Users className="h-3.5 w-3.5" />
          {t.friendsTab}
        </Link>
        {streak && streak.current_count > 0 ? (
          <Link
            href="/dashboard?tab=streak"
            title={t.streakTitle}
            className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-extrabold text-orange-600 dark:text-orange-400"
          >
            <Flame className="h-3.5 w-3.5" />
            {streak.current_count}
          </Link>
        ) : null}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {friendsLoading ? (
          <span className="inline-flex h-10 items-center text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          </span>
        ) : friends.length === 0 ? (
          <span className="inline-flex h-10 items-center text-[11px] text-muted-foreground">
            {t.friendsEmpty}
          </span>
        ) : (
          friends.map((friend) => (
            <button
              key={friend.id}
              type="button"
              onClick={() => void messageFriend(friend.id)}
              disabled={openingFriendId === friend.id}
              title={`${t.chatNewMessage} · ${friend.full_name}`}
              className="group flex shrink-0 items-center gap-1.5 rounded-full border border-border py-1 pl-1 pr-2.5 text-left transition-colors hover:bg-muted disabled:opacity-60"
            >
              <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
                {friend.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={friend.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  friend.full_name.slice(0, 1).toUpperCase()
                )}
              </span>
              <span className="max-w-[4.5rem] truncate text-[11px] font-semibold text-foreground">
                {friend.full_name}
              </span>
              {openingFriendId === friend.id ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-70 group-hover:opacity-100" />
              )}
            </button>
          ))
        )}
      </div>

      {activeGroup ? (
        <StoryViewer
          group={activeGroup}
          urls={urls}
          onClose={() => setActiveGroup(null)}
          onView={actions.view}
          onReact={actions.react}
        />
      ) : null}
    </div>
  );
}
