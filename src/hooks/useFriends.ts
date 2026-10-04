"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  followProfile,
  getMyFriendGraph,
  removeFriend,
  SocialUnavailableError,
  unfollowProfile,
} from "../services/db/social";
import type { Friend, FriendGraph, FriendRequestSummary } from "../types";

export type FriendLoadState = "loading" | "ready" | "unavailable" | "error";

export interface FriendActions {
  accept: (requestId: string) => Promise<void>;
  decline: (requestId: string) => Promise<void>;
  cancel: (requestId: string) => Promise<void>;
  unfriend: (profileId: string) => Promise<void>;
  follow: (profileId: string) => Promise<void>;
  unfollow: (profileId: string) => Promise<void>;
}

const EMPTY_GRAPH: FriendGraph = {
  friends: [],
  followers: [],
  following: [],
  requests: [],
};

/**
 * Owns the signed-in customer's friend graph.
 *
 * Every mutation is optimistic: the local graph is patched immediately and then
 * re-fetched from the database, which is the only authority. If the re-fetch
 * fails the optimistic state is dropped rather than left on screen, so the list
 * can never drift silently from the database.
 */
export function useFriends(): {
  friends: Friend[];
  followers: FriendGraph["followers"];
  following: FriendGraph["following"];
  incoming: FriendRequestSummary[];
  outgoing: FriendRequestSummary[];
  loadState: FriendLoadState;
  error: string | null;
  pendingAction: string | null;
  hasPendingRequests: boolean;
  actions: FriendActions;
  refresh: () => Promise<void>;
} {
  const [graph, setGraph] = useState<FriendGraph>(EMPTY_GRAPH);
  const [loadState, setLoadState] = useState<FriendLoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  // Guards against a slow response overwriting a newer one after unmount.
  const requestIdRef = useRef(0);

  const reportError = useCallback((cause: unknown) => {
    if (cause instanceof SocialUnavailableError) {
      setLoadState("unavailable");
      return;
    }
    setError(cause instanceof Error ? cause.message : "Something went wrong.");
    setLoadState("error");
  }, []);

  const load = useCallback(async () => {
    const ticket = ++requestIdRef.current;
    try {
      const next = await getMyFriendGraph();
      if (ticket !== requestIdRef.current) return;
      setGraph(next);
      setLoadState("ready");
      setError(null);
    } catch (cause) {
      if (ticket !== requestIdRef.current) return;
      reportError(cause);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (key: string, optimistic: (current: FriendGraph) => FriendGraph, run: () => Promise<void>) => {
      const snapshot = graph;
      setPendingAction(key);
      setError(null);
      setGraph((current) => optimistic(current));
      try {
        await run();
        await load();
      } catch (cause) {
        setGraph(snapshot);
        reportError(cause);
      } finally {
        setPendingAction(null);
      }
    },
    [graph, load, reportError]
  );

  const accept = useCallback(
    (requestId: string) =>
      mutate(
        `accept:${requestId}`,
        (current) => {
          const request = current.requests.find((item) => item.request_id === requestId);
          const friends = current.friends.slice();
          if (request && !friends.some((friend) => friend.id === request.profile_id)) {
            friends.unshift({
              id: request.profile_id,
              username: request.username,
              full_name: request.full_name,
              avatar_url: request.avatar_url,
              bio: null,
              friends_since: new Date().toISOString(),
            });
          }
          return {
            ...current,
            friends,
            requests: current.requests.filter((item) => item.request_id !== requestId),
          };
        },
        () => acceptFriendRequest(requestId)
      ),
    [mutate]
  );

  const decline = useCallback(
    (requestId: string) =>
      mutate(
        `decline:${requestId}`,
        (current) => ({
          ...current,
          requests: current.requests.filter((item) => item.request_id !== requestId),
        }),
        () => declineFriendRequest(requestId)
      ),
    [mutate]
  );

  const cancel = useCallback(
    (requestId: string) =>
      mutate(
        `cancel:${requestId}`,
        (current) => ({
          ...current,
          requests: current.requests.filter((item) => item.request_id !== requestId),
        }),
        () => cancelFriendRequest(requestId)
      ),
    [mutate]
  );

  const unfriend = useCallback(
    (profileId: string) =>
      mutate(
        `unfriend:${profileId}`,
        (current) => ({
          ...current,
          friends: current.friends.filter((friend) => friend.id !== profileId),
        }),
        async () => {
          await removeFriend(profileId);
        }
      ),
    [mutate]
  );

  const follow = useCallback(
    (profileId: string) =>
      mutate(
        `follow:${profileId}`,
        (current) =>
          current.following.some((entry) => entry.id === profileId)
            ? current
            : {
                ...current,
                following: [
                  ...current.following,
                  {
                    id: profileId,
                    username: null,
                    full_name: "",
                    avatar_url: null,
                    bio: null,
                    followed_since: new Date().toISOString(),
                  },
                ],
              },
        () => followProfile(profileId)
      ),
    [mutate]
  );

  const unfollow = useCallback(
    (profileId: string) =>
      mutate(
        `unfollow:${profileId}`,
        (current) => ({
          ...current,
          following: current.following.filter((entry) => entry.id !== profileId),
        }),
        () => unfollowProfile(profileId)
      ),
    [mutate]
  );

  return {
    friends: graph.friends,
    followers: graph.followers,
    following: graph.following,
    incoming: graph.requests.filter((request) => request.direction === "incoming"),
    outgoing: graph.requests.filter((request) => request.direction === "outgoing"),
    loadState,
    error,
    pendingAction,
    hasPendingRequests: graph.requests.some((request) => request.direction === "incoming"),
    actions: { accept, decline, cancel, unfriend, follow, unfollow },
    refresh: load,
  };
}
