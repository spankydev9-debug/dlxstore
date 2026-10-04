"use client";

import { useState, useEffect } from "react";
import {
  AlertCircle,
  Ban,
  Check,
  Loader2,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useFriends } from "../../hooks/useFriends";
import { useLanguage } from "../../context/LanguageContext";
import type { Follow, Friend, FriendRequestSummary } from "../../types";
import {
  getBlockedProfiles,
  getRestrictedProfiles,
  getMutedProfiles,
  getCloseFriends,
  blockProfile,
  unblockProfile,
  restrictProfile,
  unrestrictProfile,
  muteProfile,
  unmuteProfile,
  addCloseFriend,
  removeCloseFriend,
  searchProfiles,
  getFriendSuggestions,
} from "../../services/db/safety";
import type { BlockedProfile, RestrictedProfile, MutedProfile, CloseFriend, ProfileSearchResult, FriendSuggestion } from "../../types";
import { ReportModal } from "./ReportModal";

type ListKey = "friends" | "followers" | "following" | "blocked" | "restricted" | "muted" | "close_friends";

/**
 * The customer-facing friend graph (ROADMAP Phase 8, core) plus safety features (ROADMAP Phase 16).
 *
 * Now includes blocking, muting, restrictions, and close friends.
 */
export function FriendsPanel() {
  const { t } = useLanguage();
  const {
    friends,
    followers,
    following,
    incoming,
    outgoing,
    loadState,
    error,
    pendingAction,
    actions,
    refresh,
  } = useFriends();

  const [list, setList] = useState<ListKey>("friends");
  const [confirmUnfriend, setConfirmUnfriend] = useState<string | null>(null);

  // Safety lists
  const [blocked, setBlocked] = useState<BlockedProfile[]>([]);
  const [restricted, setRestricted] = useState<RestrictedProfile[]>([]);
  const [muted, setMuted] = useState<MutedProfile[]>([]);
  const [closeFriends, setCloseFriends] = useState<CloseFriend[]>([]);
  const [loadingSafety, setLoadingSafety] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);

  // Search and suggestions
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<FriendSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Report modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTargetId, setReportTargetId] = useState<string | null>(null);
  const [reportTargetName, setReportTargetName] = useState<string | null>(null);

  const loadSafetyLists = async () => {
    setLoadingSafety(true);
    setSafetyError(null);
    try {
      const [blockedData, restrictedData, mutedData, closeFriendsData] = await Promise.all([
        getBlockedProfiles(),
        getRestrictedProfiles(),
        getMutedProfiles(),
        getCloseFriends(),
      ]);
      setBlocked(blockedData);
      setRestricted(restrictedData);
      setMuted(mutedData);
      setCloseFriends(closeFriendsData);
    } catch (err) {
      setSafetyError(err instanceof Error ? err.message : "Failed to load safety lists");
    } finally {
      setLoadingSafety(false);
    }
  };

  useEffect(() => {
    void loadSafetyLists();
  }, []);

  const handleBlock = async (profileId: string) => {
    try {
      await blockProfile(profileId);
      await loadSafetyLists();
    } catch (err) {
      console.error("Error blocking profile:", err);
    }
  };

  const handleUnblock = async (profileId: string) => {
    try {
      await unblockProfile(profileId);
      await loadSafetyLists();
    } catch (err) {
      console.error("Error unblocking profile:", err);
    }
  };

  const handleRestrict = async (profileId: string) => {
    try {
      await restrictProfile(profileId);
      await loadSafetyLists();
    } catch (err) {
      console.error("Error restricting profile:", err);
    }
  };

  const handleUnrestrict = async (profileId: string) => {
    try {
      await unrestrictProfile(profileId);
      await loadSafetyLists();
    } catch (err) {
      console.error("Error unrestricting profile:", err);
    }
  };

  const handleMute = async (profileId: string) => {
    try {
      await muteProfile(profileId);
      await loadSafetyLists();
    } catch (err) {
      console.error("Error muting profile:", err);
    }
  };

  const handleUnmute = async (profileId: string) => {
    try {
      await unmuteProfile(profileId);
      await loadSafetyLists();
    } catch (err) {
      console.error("Error unmuting profile:", err);
    }
  };

  const handleAddCloseFriend = async (profileId: string) => {
    try {
      await addCloseFriend(profileId);
      await loadSafetyLists();
    } catch (err) {
      console.error("Error adding close friend:", err);
    }
  };

  const handleRemoveCloseFriend = async (profileId: string) => {
    try {
      await removeCloseFriend(profileId);
      await loadSafetyLists();
    } catch (err) {
      console.error("Error removing close friend:", err);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const results = await searchProfiles(query, 20);
      setSearchResults(results);
    } catch (err) {
      console.error("Error searching profiles:", err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const loadSuggestions = async () => {
    setLoadingSuggestions(true);
    try {
      const recs = await getFriendSuggestions(10);
      setSuggestions(recs);
    } catch (err) {
      console.error("Error loading suggestions:", err);
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  useEffect(() => {
    if (list === "friends" && friends.length === 0) {
      void loadSuggestions();
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [list, friends.length]);

  if (loadState === "loading") {
    return (
      <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.friendsLoading}
      </p>
    );
  }

  if (loadState === "unavailable") {
    return (
      <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
        <p className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
          <LockKeyhole className="h-4 w-4" />
          {t.friendsUnavailableTitle}
        </p>
        <p className="text-sm text-amber-700/90 dark:text-amber-400/90">
          {t.friendsUnavailableBody}
        </p>
      </div>
    );
  }

  const lists: Record<ListKey, Friend[] | Follow[] | BlockedProfile[] | RestrictedProfile[] | MutedProfile[] | CloseFriend[]> = {
    friends,
    followers,
    following,
    blocked,
    restricted,
    muted,
    close_friends: closeFriends,
  };
  const current = lists[list];
  const isEmpty = current.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <Users className="h-5 w-5 text-primary" />
            {t.friendsTitle}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t.friendsIntro}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t.friendsRefresh}
        </button>
      </div>

      {error ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {safetyError ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {safetyError}
        </p>
      ) : null}

      {incoming.length > 0 ? (
        <section className="space-y-3">
          <h4 className="text-sm font-bold text-foreground">
            {t.friendsIncoming} ({incoming.length})
          </h4>
          <ul className="space-y-2">
            {incoming.map((request) => (
              <IncomingRequestRow
                key={request.request_id}
                request={request}
                busy={pendingAction === `accept:${request.request_id}`}
                declining={pendingAction === `decline:${request.request_id}`}
                labels={{
                  accept: t.friendsAccept,
                  decline: t.friendsDecline,
                  requestedOn: t.friendsRequestedOn,
                }}
                onAccept={() => void actions.accept(request.request_id)}
                onDecline={() => void actions.decline(request.request_id)}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {outgoing.length > 0 ? (
        <section className="space-y-3">
          <h4 className="text-sm font-bold text-foreground">
            {t.friendsOutgoing} ({outgoing.length})
          </h4>
          <ul className="space-y-2">
            {outgoing.map((request) => (
              <li
                key={request.request_id}
                className="flex items-center gap-3 rounded-xl border border-border/60 p-3"
              >
                <PersonAvatar
                  name={request.full_name}
                  url={request.avatar_url}
                  className="h-10 w-10"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{request.full_name}</p>
                  <p className="text-[11px] text-muted-foreground">{t.friendsRequestSent}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void actions.cancel(request.request_id)}
                  disabled={pendingAction === `cancel:${request.request_id}`}
                  className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold disabled:opacity-50"
                >
                  {pendingAction === `cancel:${request.request_id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    t.friendsCancel
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Search bar */}
      <section className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => void handleSearch(e.target.value)}
            placeholder="Search people..."
            className="w-full rounded-xl border border-border bg-card pl-10 pr-4 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        {searchResults.length > 0 && (
          <ul className="space-y-2">
            {searchResults.map((result) => (
              <li
                key={result.profile_id}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3"
              >
                <PersonAvatar name={result.full_name} url={result.avatar_url} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{result.full_name}</p>
                  {result.username ? (
                    <p className="truncate text-[11px] text-muted-foreground">@{result.username}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void actions.follow(result.profile_id)}
                  disabled={pendingAction === `follow:${result.profile_id}`}
                  className="inline-flex min-h-11 items-center rounded-xl border border-primary/50 px-3 text-xs font-bold text-primary disabled:opacity-50"
                >
                  {pendingAction === `follow:${result.profile_id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="h-3.5 w-3.5" />
                      {t.friendsFollow}
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Friend suggestions */}
      {showSuggestions && suggestions.length > 0 && (
        <section className="space-y-3">
          <h4 className="text-sm font-bold text-foreground">
            People you may know {loadingSuggestions && <Loader2 className="inline h-3.5 w-3.5 animate-spin" />}
          </h4>
          <ul className="space-y-2">
            {suggestions.map((suggestion) => (
              <li
                key={suggestion.profile_id}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3"
              >
                <PersonAvatar name={suggestion.full_name} url={suggestion.avatar_url} className="h-10 w-10" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{suggestion.full_name}</p>
                  {suggestion.mutual_friends_count > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      {suggestion.mutual_friends_count} mutual friend{suggestion.mutual_friends_count > 1 ? "s" : ""}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void actions.follow(suggestion.profile_id)}
                  disabled={pendingAction === `follow:${suggestion.profile_id}`}
                  className="inline-flex min-h-11 items-center rounded-xl border border-primary/50 px-3 text-xs font-bold text-primary disabled:opacity-50"
                >
                  {pendingAction === `follow:${suggestion.profile_id}` ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="h-3.5 w-3.5" />
                      {t.friendsFollow}
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted/40 p-1">
          {(["friends", "followers", "following", "blocked", "restricted", "muted", "close_friends"] as ListKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setList(key)}
              aria-pressed={list === key}
              className={`flex-1 min-w-[80px] rounded-lg px-2 py-2 text-[10px] font-bold transition-colors ${
                list === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {key === "friends"
                ? `${t.friendsTab} (${friends.length})`
                : key === "followers"
                  ? `${t.followersTab} (${followers.length})`
                  : key === "following"
                    ? `${t.followingTab} (${following.length})`
                    : key === "blocked"
                      ? `Blocked (${blocked.length})`
                      : key === "restricted"
                        ? `Restricted (${restricted.length})`
                        : key === "muted"
                          ? `Muted (${muted.length})`
                          : `Close Friends (${closeFriends.length})`}
            </button>
          ))}
        </div>

        {loadingSafety && list !== "friends" && list !== "followers" && list !== "following" ? (
          <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </p>
        ) : isEmpty ? (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-xs italic text-muted-foreground">
            {list === "friends"
              ? t.friendsEmpty
              : list === "followers"
                ? t.followersEmpty
                : list === "following"
                  ? t.followingEmpty
                  : list === "blocked"
                    ? "No blocked profiles"
                    : list === "restricted"
                      ? "No restricted profiles"
                      : list === "muted"
                        ? "No muted profiles"
                        : "No close friends"}
          </p>
        ) : (
          <ul className="divide-y divide-border/40">
            {current.map((person) => {
              const personId = (person as any).profile_id || (person as any).id;
              const fullName = (person as any).full_name;
              const avatarUrl = (person as any).avatar_url;
              const isFriend = friends.some((friend) => friend.id === personId);
              const isFollowing = following.some((entry) => entry.id === personId);
              const isPendingUnfriend = confirmUnfriend === personId;
              const since =
                list === "friends"
                  ? (person as Friend).friends_since
                  : list === "followers" || list === "following"
                    ? (person as Follow).followed_since
                    : null;

              const blockedAt = list === "blocked" ? (person as BlockedProfile).blocked_at : null;
              const restrictedAt = list === "restricted" ? (person as RestrictedProfile).restricted_at : null;
              const mutedAt = list === "muted" ? (person as MutedProfile).muted_at : null;
              const addedAt = list === "close_friends" ? (person as CloseFriend).added_at : null;

              return (
                <li key={personId} className="flex items-center gap-3 py-3">
                  <PersonAvatar name={fullName} url={avatarUrl} className="h-11 w-11" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{fullName}</p>
                    {blockedAt ? (
                      <p className="text-[10px] text-muted-foreground/80">
                        Blocked {new Date(blockedAt).toLocaleDateString()}
                      </p>
                    ) : restrictedAt ? (
                      <p className="text-[10px] text-muted-foreground/80">
                        Restricted {new Date(restrictedAt).toLocaleDateString()}
                      </p>
                    ) : mutedAt ? (
                      <p className="text-[10px] text-muted-foreground/80">
                        Muted {new Date(mutedAt).toLocaleDateString()}
                      </p>
                    ) : addedAt ? (
                      <p className="text-[10px] text-muted-foreground/80">
                        Added {new Date(addedAt).toLocaleDateString()}
                      </p>
                    ) : since ? (
                      <p className="text-[10px] text-muted-foreground/80">
                        {new Date(since).toLocaleDateString()}
                      </p>
                    ) : null}
                  </div>

                  {list === "blocked" ? (
                    <button
                      type="button"
                      onClick={() => void handleUnblock(personId)}
                      className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Unblock
                    </button>
                  ) : list === "restricted" ? (
                    <button
                      type="button"
                      onClick={() => void handleUnrestrict(personId)}
                      className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Unrestrict
                    </button>
                  ) : list === "muted" ? (
                    <button
                      type="button"
                      onClick={() => void handleUnmute(personId)}
                      className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Unmute
                    </button>
                  ) : list === "close_friends" ? (
                    <button
                      type="button"
                      onClick={() => void handleRemoveCloseFriend(personId)}
                      className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-destructive"
                    >
                      Remove
                    </button>
                  ) : isPendingUnfriend ? (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmUnfriend(null);
                          void actions.unfriend(personId);
                        }}
                        disabled={pendingAction === `unfriend:${personId}`}
                        className="inline-flex min-h-11 items-center rounded-xl bg-destructive px-3 text-xs font-bold text-destructive-foreground disabled:opacity-50"
                      >
                        {pendingAction === `unfriend:${personId}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          t.friendsConfirmRemove
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmUnfriend(null)}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold"
                      >
                        {t.friendsKeepFriend}
                      </button>
                    </div>
                  ) : isFriend ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setConfirmUnfriend(personId)}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <UserMinus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleAddCloseFriend(personId)}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-primary"
                        title="Add to close friends"
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleBlock(personId)}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-destructive"
                        title="Block"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReportTargetId(personId);
                          setReportTargetName(fullName);
                          setReportModalOpen(true);
                        }}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-destructive"
                        title="Report"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : isFollowing ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void actions.unfollow(personId)}
                        disabled={pendingAction === `unfollow:${personId}`}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground disabled:opacity-50"
                      >
                        {pendingAction === `unfollow:${personId}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          t.followingTab
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleBlock(personId)}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-destructive"
                        title="Block"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReportTargetId(personId);
                          setReportTargetName(fullName);
                          setReportModalOpen(true);
                        }}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-destructive"
                        title="Report"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void actions.follow(personId)}
                        disabled={pendingAction === `follow:${personId}`}
                        className="inline-flex min-h-11 items-center rounded-xl border border-primary/50 px-3 text-xs font-bold text-primary disabled:opacity-50"
                      >
                        {pendingAction === `follow:${personId}` ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <UserPlus className="h-3.5 w-3.5" />
                            {t.friendsFollow}
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleBlock(personId)}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-destructive"
                        title="Block"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReportTargetId(personId);
                          setReportTargetName(fullName);
                          setReportModalOpen(true);
                        }}
                        className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-destructive"
                        title="Report"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ReportModal
        isOpen={reportModalOpen}
        onClose={() => {
          setReportModalOpen(false);
          setReportTargetId(null);
          setReportTargetName(null);
        }}
        reportedId={reportTargetId}
        reportedName={reportTargetName || undefined}
      />

      <p className="rounded-xl bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
        {t.friendsSafetyNote}
      </p>
    </div>
  );
}

function IncomingRequestRow({
  request,
  busy,
  declining,
  labels,
  onAccept,
  onDecline,
}: {
  request: FriendRequestSummary;
  busy: boolean;
  declining: boolean;
  labels: { accept: string; decline: string; requestedOn: string };
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <PersonAvatar name={request.full_name} url={request.avatar_url} className="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{request.full_name}</p>
        <p className="text-[11px] text-muted-foreground">
          {labels.requestedOn} {new Date(request.created_at).toLocaleDateString()}
        </p>
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onAccept}
          disabled={busy || declining}
          className="inline-flex min-h-11 items-center gap-1 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {labels.accept}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={busy || declining}
          className="inline-flex min-h-11 items-center rounded-xl border border-border px-3 text-xs font-bold disabled:opacity-50"
        >
          {declining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          {labels.decline}
        </button>
      </div>
    </li>
  );
}

/**
 * `profiles.avatar_url` exists but has no upload path yet, so it is almost always
 * null. Falling back to initials keeps the list readable instead of showing an
 * empty box. When avatars do arrive this renders the image unchanged.
 */
function PersonAvatar({
  name,
  url,
  className,
}: {
  name: string;
  url: string | null;
  className: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase();

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        aria-hidden="true"
        className={`${className} shrink-0 rounded-full border border-border object-cover`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${className} flex shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-extrabold text-primary`}
    >
      {initial || <UserCheck className="h-4 w-4" />}
    </span>
  );
}
