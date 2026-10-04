"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createStory,
  deleteStory,
  getMyStories,
  getStoriesFeed,
  groupStoriesByAuthor,
  recordStoryView,
  setStoryArchived,
  setStoryReaction,
  StoriesUnavailableError,
} from "../services/db/stories";
import type { CreateStoryInput, MyStoryItem, StoryGroup, StoryItem } from "../types";

export type StoriesLoadState = "loading" | "ready" | "unavailable" | "error";

export interface StoriesActions {
  create: (input: CreateStoryInput) => Promise<void>;
  archive: (storyId: string, archived: boolean) => Promise<void>;
  remove: (storyId: string, objectPath: string | null) => Promise<void>;
  react: (storyId: string, emoji: string) => Promise<void>;
  view: (storyId: string) => Promise<void>;
}

export interface StoriesState {
  /** The rail, one entry per author. */
  groups: StoryGroup[];
  /** Flat rows, so the viewer can page through one author's whole run. */
  stories: StoryItem[];
  mine: MyStoryItem[];
  loadState: StoriesLoadState;
  error: string | null;
  pendingAction: string | null;
  actions: StoriesActions;
  refresh: () => Promise<void>;
}

/**
 * Owns the signed-in customer's story rail and their own story history.
 *
 * Feed and history are fetched together because the panel shows both on one
 * screen, and because a newly created story must appear in the owner's history
 * before the next feed read picks it up.
 *
 * Reactions and views are applied optimistically and then reconciled from the
 * database, which is the only authority: `set_story_reaction` returns the
 * caller's real reaction set and `record_story_view` is idempotent, so a lost
 * re-fetch is corrected by refreshing rather than by guessing.
 */
export function useStories(): StoriesState {
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [mine, setMine] = useState<MyStoryItem[]>([]);
  const [loadState, setLoadState] = useState<StoriesLoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  // Guards against a slow response overwriting a newer one after unmount.
  const requestIdRef = useRef(0);

  const reportError = useCallback((cause: unknown) => {
    if (cause instanceof StoriesUnavailableError) {
      setLoadState("unavailable");
      return;
    }
    setError(cause instanceof Error ? cause.message : "Something went wrong.");
    setLoadState("error");
  }, []);

  const load = useCallback(async () => {
    const ticket = ++requestIdRef.current;
    try {
      const [feed, own] = await Promise.all([getStoriesFeed(), getMyStories()]);
      if (ticket !== requestIdRef.current) return;
      setStories(feed);
      setMine(own);
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

  const groups = useMemo(() => groupStoriesByAuthor(stories), [stories]);

  /**
   * Run a mutation with an optimistic patch, then re-read from the database.
   * A failed run drops the optimistic state rather than leaving it on screen, so
   * the rail can never drift silently from the database.
   */
  const mutate = useCallback(
    async (
      key: string,
      apply: (current: StoryItem[]) => StoryItem[],
      run: () => Promise<void>
    ) => {
      const snapshot = stories;
      setPendingAction(key);
      setError(null);
      setStories((current) => apply(current));
      try {
        await run();
        await load();
      } catch (cause) {
        setStories(snapshot);
        reportError(cause);
      } finally {
        setPendingAction(null);
      }
    },
    [stories, load, reportError]
  );

  const create = useCallback(
    async (input: CreateStoryInput) => {
      setPendingAction("create");
      setError(null);
      try {
        await createStory(input);
        await load();
      } catch (cause) {
        reportError(cause);
      } finally {
        setPendingAction(null);
      }
    },
    [load, reportError]
  );

  const archive = useCallback(
    async (storyId: string, archived: boolean) => {
      setPendingAction(`archive:${storyId}`);
      setError(null);
      // Patch locally so the row moves immediately, then reconcile from source.
      setMine((current) =>
        current.map((story) => (story.id === storyId ? { ...story, is_archived: archived } : story))
      );
      try {
        await setStoryArchived(storyId, archived);
        await load();
      } catch (cause) {
        reportError(cause);
      } finally {
        setPendingAction(null);
      }
    },
    [load, reportError]
  );

  const remove = useCallback(
    async (storyId: string, objectPath: string | null) => {
      const snapshot = mine;
      setPendingAction(`delete:${storyId}`);
      setError(null);
      setMine((current) => current.filter((story) => story.id !== storyId));
      try {
        await deleteStory(storyId, objectPath);
        await load();
      } catch (cause) {
        setMine(snapshot);
        reportError(cause);
      } finally {
        setPendingAction(null);
      }
    },
    [mine, load, reportError]
  );

  const react = useCallback(
    (storyId: string, emoji: string) =>
      mutate(
        `react:${storyId}:${emoji}`,
        (current) =>
          current.map((story) => {
            if (story.id !== storyId) return story;
            const has = story.my_reactions.includes(emoji);
            return {
              ...story,
              my_reactions: has
                ? story.my_reactions.filter((entry) => entry !== emoji)
                : [...story.my_reactions, emoji],
              reaction_count: Math.max(0, story.reaction_count + (has ? -1 : 1)),
            };
          }),
        async () => {
          await setStoryReaction(storyId, emoji);
        }
      ),
    [mutate]
  );

  const view = useCallback(
    (storyId: string) =>
      mutate(
        `view:${storyId}`,
        (current) =>
          current.map((story) => (story.id === storyId ? { ...story, viewed: true } : story)),
        async () => {
          await recordStoryView(storyId);
        }
      ),
    [mutate]
  );

  return {
    groups,
    stories,
    mine,
    loadState,
    error,
    pendingAction,
    actions: { create, archive, remove, react, view },
    refresh: load,
  };
}
