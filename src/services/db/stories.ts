import {
  type CreateStoryInput,
  type MyStoryItem,
  type StoryGroup,
  type StoryItem,
  type StoryMediaType,
  type StoryProductRef,
  type StoryViewer,
  type StoryVisibility,
} from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// DLX Stories data layer (ROADMAP Phase 5)
//
// Like the friend graph, every read and every write goes through a SECURITY
// DEFINER RPC added by 20261006090000_story_ecosystem.sql. Nothing here selects
// from `profiles`, `stories` or `story_products` directly: the RPCs pre-join the
// author and return a narrow column set, and `can_view_story()` stays the single
// visibility decision in the database rather than being re-implemented here.
//
// Story media lives in a PRIVATE `story-media` bucket, so the object path from a
// feed row is not a displayable URL. `getStoryMediaUrl` mints a short-lived signed
// URL with the caller's own JWT; there is no service-role key anywhere in this app.
//
// If 20261006090000_story_ecosystem.sql has not been applied, every read degrades
// to an empty rail and `StoriesUnavailableError` is thrown by the mutations, so
// the account page still renders.
// ---------------------------------------------------------------------------

/** Thrown when the Stories RPCs are missing, i.e. the migration is unapplied. */
export class StoriesUnavailableError extends Error {
  constructor(message = "The stories system is not available yet.") {
    super(message);
    this.name = "StoriesUnavailableError";
  }
}

const DEMO_FEED_KEY = "dlxstore_stories_feed";
const DEMO_MINE_KEY = "dlxstore_stories_mine";
const BUCKET = "story-media";
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
]);
/** Signed story media is short-lived on purpose: a story URL is not a permanent link. */
const SIGNED_URL_TTL_SECONDS = 60 * 30;

function isMissingStoryRpc(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883" || code === "42P01" || code === "42703") {
    return true;
  }
  const message = error.message ?? "";
  return /could not find the function/i.test(message) || /does not exist/i.test(message);
}

function rethrow(error: { code?: string; message?: string }): never {
  if (isMissingStoryRpc(error)) throw new StoriesUnavailableError();
  throw new Error(error.message || "Stories are unavailable right now.");
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function mapProducts(value: unknown): StoryProductRef[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const p = entry as Record<string, unknown>;
    return {
      id: String(p.id ?? ""),
      name: String(p.name ?? ""),
      slug: String(p.slug ?? ""),
      price: Number(p.price ?? 0),
      discount_price:
        p.discount_price === null || p.discount_price === undefined
          ? null
          : Number(p.discount_price),
      image_url: (p.image_url as string) ?? null,
    };
  });
}

function mapBase(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    author_id: String(row.author_id),
    author_username: (row.author_username as string) ?? null,
    author_name: String(row.author_name ?? ""),
    author_avatar_url: (row.author_avatar_url as string) ?? null,
    media_type: String(row.media_type ?? "text") as StoryMediaType,
    storage_object_path: (row.storage_object_path as string) ?? null,
    text_content: (row.text_content as string) ?? null,
    background_color: (row.background_color as string) ?? null,
    visibility: String(row.visibility ?? "followers") as StoryVisibility,
    expires_at: String(row.expires_at ?? ""),
    created_at: String(row.created_at ?? ""),
    reaction_count: Number(row.reaction_count ?? 0),
    my_reactions: Array.isArray(row.my_reactions) ? (row.my_reactions as string[]) : [],
    products: mapProducts(row.products),
  };
}

function mapFeedRow(row: unknown): StoryItem {
  const r = row as Record<string, unknown>;
  return {
    ...mapBase(r),
    is_mine: Boolean(r.is_mine),
    viewed: Boolean(r.viewed),
    viewer_count:
      r.viewer_count === null || r.viewer_count === undefined ? null : Number(r.viewer_count),
  };
}

function mapMineRow(row: unknown): MyStoryItem {
  const r = row as Record<string, unknown>;
  return {
    ...mapBase(r),
    viewer_count: Number(r.viewer_count ?? 0),
    is_archived: Boolean(r.is_archived),
    is_expired: Boolean(r.is_expired),
  };
}

function mapViewerRow(row: unknown): StoryViewer {
  const r = row as Record<string, unknown>;
  return {
    viewer_id: String(r.viewer_id),
    username: (r.username as string) ?? null,
    full_name: String(r.full_name ?? ""),
    avatar_url: (r.avatar_url as string) ?? null,
    viewed_at: String(r.viewed_at ?? ""),
  };
}

/**
 * Collapse the flat feed into one ring per author.
 *
 * The RPC returns rows in `created_at` order across all authors, so the grouping
 * and the unseen flag are both derived here. A ring is "unseen" while any of its
 * stories is unviewed, which is what drives the gradient ring in the rail.
 */
export function groupStoriesByAuthor(rows: StoryItem[]): StoryGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, StoryItem[]>();

  for (const story of rows) {
    const key = story.author_id;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(story);
  }

  return order.map((authorId) => {
    const stories = buckets.get(authorId)!;
    const first = stories[0];
    return {
      author: {
        id: first.author_id,
        username: first.author_username,
        full_name: first.author_name,
        avatar_url: first.author_avatar_url,
      },
      stories,
      hasUnseen: stories.some((story) => !story.viewed),
      isMine: first.is_mine,
    };
  });
}

// ---------------------------------------------------------------------------
// Demo persistence
// ---------------------------------------------------------------------------

function readDemo<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeDemo(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full or unavailable localStorage must not break the demo surface.
  }
}

function requireDemo(): void {
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The rail: stories from people the caller follows, plus their friends. */
export async function getStoriesFeed(): Promise<StoryItem[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_stories_feed");
    if (error) rethrow(error);
    return (Array.isArray(data) ? data : []).map(mapFeedRow);
  }
  requireDemo();
  return readDemo<StoryItem[]>(DEMO_FEED_KEY, []);
}

/** The caller's own stories, including archived and expired ones. */
export async function getMyStories(): Promise<MyStoryItem[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_my_stories");
    if (error) rethrow(error);
    return (Array.isArray(data) ? data : []).map(mapMineRow);
  }
  requireDemo();
  return readDemo<MyStoryItem[]>(DEMO_MINE_KEY, []);
}

/** Who watched one of the caller's own stories. Owner-only; the RPC enforces it. */
export async function getStoryViewers(storyId: string): Promise<StoryViewer[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("get_story_viewers", { p_story_id: storyId });
    if (error) rethrow(error);
    return (Array.isArray(data) ? data : []).map(mapViewerRow);
  }
  requireDemo();
  return [];
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

function extensionFor(file: File): string {
  const byType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };
  return byType[file.type] ?? "bin";
}

/**
 * Upload story media and return the object path.
 *
 * The path is `<profile_id>/<story_id>.<ext>` because that is the shape
 * `story_id_from_media_path()` parses to authorize a read: the storage policy
 * resolves the story from the path and then asks `can_view_story()`. The caller
 * therefore has to know both ids before the upload, which is why `create_story`
 * takes the story id from the client.
 */
export async function uploadStoryMedia(
  storyId: string,
  profileId: string,
  file: File,
): Promise<string> {
  if (!ALLOWED_MEDIA_TYPES.has(file.type)) {
    throw new Error("Stories accept JPEG, PNG, WebP, MP4 or WebM.");
  }
  if (file.size > MAX_MEDIA_BYTES) {
    throw new Error("Story media must be 8 MB or smaller.");
  }

  const path = `${profileId}/${storyId}.${extensionFor(file)}`;

  if (!isSupabaseConfigured || !supabase) {
    requireDemo();
    return path;
  }

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** Remove story media. Best-effort: a failure must not block deleting the story. */
export async function removeStoryMedia(objectPath: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const { error } = await supabase.storage.from(BUCKET).remove([objectPath]);
  if (error) throw new Error(error.message);
}

/**
 * Mint a short-lived signed URL for private story media.
 *
 * Returns null for a text story or when signing fails, so a media problem shows
 * as a missing image rather than an error boundary over the whole rail.
 */
export async function getStoryMediaUrl(objectPath: string | null): Promise<string | null> {
  if (!objectPath) return null;
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);
  if (error) return null;
  return data?.signedUrl ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create a story. The RPC re-validates the media rule, the object path, the
 * visibility, the caption length and every tagged product, so this is a
 * convenience wrapper and not a trust boundary.
 */
export async function createStory(input: CreateStoryInput): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("create_story", {
      p_story_id: input.storyId,
      p_media_type: input.mediaType,
      p_storage_object_path: input.storageObjectPath ?? null,
      p_text_content: input.textContent ?? null,
      p_background_color: input.backgroundColor ?? null,
      p_visibility: input.visibility,
      p_product_ids: input.productIds?.length ? input.productIds : [],
    });
    if (error) rethrow(error);
    return;
  }

  requireDemo();
  const mine = readDemo<MyStoryItem[]>(DEMO_MINE_KEY, []);
  mine.unshift({
    id: input.storyId,
    author_id: "demo-profile",
    author_username: null,
    author_name: "You",
    author_avatar_url: null,
    media_type: input.mediaType,
    storage_object_path: input.storageObjectPath ?? null,
    text_content: input.textContent ?? null,
    background_color: input.backgroundColor ?? null,
    visibility: input.visibility,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    reaction_count: 0,
    my_reactions: [],
    products: [],
    viewer_count: 0,
    is_archived: false,
    is_expired: false,
  });
  writeDemo(DEMO_MINE_KEY, mine);
}

/** Record that the caller opened a story. Idempotent, and never self-counted. */
export async function recordStoryView(storyId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("record_story_view", { p_story_id: storyId });
    if (error) rethrow(error);
    return;
  }
  requireDemo();
  const feed = readDemo<StoryItem[]>(DEMO_FEED_KEY, []);
  writeDemo(
    DEMO_FEED_KEY,
    feed.map((story) => (story.id === storyId ? { ...story, viewed: true } : story))
  );
}

/** Toggle one reaction. Returns the caller's full reaction set for that story. */
export async function setStoryReaction(storyId: string, emoji: string): Promise<string[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("set_story_reaction", {
      p_story_id: storyId,
      p_emoji: emoji,
    });
    if (error) rethrow(error);
    return Array.isArray(data) ? (data as string[]) : [];
  }

  requireDemo();
  const feed = readDemo<StoryItem[]>(DEMO_FEED_KEY, []);
  const next = feed.map((story) => {
    if (story.id !== storyId) return story;
    const has = story.my_reactions.includes(emoji);
    const myReactions = has
      ? story.my_reactions.filter((entry) => entry !== emoji)
      : [...story.my_reactions, emoji];
    return {
      ...story,
      my_reactions: myReactions,
      reaction_count: Math.max(0, story.reaction_count + (has ? -1 : 1)),
    };
  });
  writeDemo(DEMO_FEED_KEY, next);
  return next.find((story) => story.id === storyId)?.my_reactions ?? [];
}

/** Archive or restore one of the caller's own stories. */
export async function setStoryArchived(storyId: string, archived: boolean): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("set_story_archived", {
      p_story_id: storyId,
      p_archived: archived,
    });
    if (error) rethrow(error);
    return;
  }

  requireDemo();
  const mine = readDemo<MyStoryItem[]>(DEMO_MINE_KEY, []);
  writeDemo(
    DEMO_MINE_KEY,
    mine.map((story) => (story.id === storyId ? { ...story, is_archived: archived } : story))
  );
}

/**
 * Delete one of the caller's own stories.
 *
 * The row cascade removes its viewers, reactions, mentions and product tags, but
 * NOT the storage object, so media is removed first and a storage failure is
 * swallowed rather than leaving an orphaned story row.
 */
export async function deleteStory(storyId: string, objectPath: string | null): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("delete_story", { p_story_id: storyId });
    if (error) rethrow(error);
    if (objectPath) {
      try {
        await removeStoryMedia(objectPath);
      } catch {
        // The story is gone; an orphaned object is a storage-cleanup concern.
      }
    }
    return;
  }

  requireDemo();
  const mine = readDemo<MyStoryItem[]>(DEMO_MINE_KEY, []);
  writeDemo(DEMO_MINE_KEY, mine.filter((story) => story.id !== storyId));
}
