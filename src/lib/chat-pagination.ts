/**
 * Pure pagination helpers for DLX Chat message history.
 *
 * These live outside the React context (and outside the Supabase services) so the
 * threading rules can be regression-tested without a browser or a database.
 *
 * The rule that matters: realtime inserts and the polling fallback always refresh
 * the *newest* page. If that replaced thread state wholesale, every older page a
 * reader had scrolled back to would vanish mid-read. Merging keeps history and
 * still lets the newest page update in place.
 */

/** Messages fetched per page. The thread loads the newest page first. */
export const MESSAGE_PAGE_SIZE = 40;

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;

/** Clamp a requested page size into the range the queries support. */
export function normalizePageSize(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return MESSAGE_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(requested), MIN_PAGE_SIZE), MAX_PAGE_SIZE);
}

/** The subset of a message the pagination rules depend on. */
export interface PagedMessage {
  id: string;
  conversation_id: string;
  created_at: string;
}

/** True when `message` sorts before the cursor in (created_at, id) order. */
export function isBeforeCursor(
  message: Pick<PagedMessage, "id" | "created_at">,
  cursor: { createdAt: string; id: string }
): boolean {
  if (message.created_at < cursor.createdAt) return true;
  return message.created_at === cursor.createdAt && message.id < cursor.id;
}

/**
 * Merge a freshly fetched newest page into the current thread.
 *
 * Messages older than the newest page's first message are kept; anything inside
 * the page range is replaced by the authoritative server copy. Messages belonging
 * to another conversation are always dropped, so a page that arrives after the
 * reader switched threads can never leak into the new one (callers additionally
 * discard late results for a conversation that is no longer open).
 */
export function mergeNewestPage<T extends PagedMessage>(
  conversationId: string,
  current: T[],
  newest: T[]
): T[] {
  const page = newest.filter((message) => message.conversation_id === conversationId);
  if (page.length === 0) {
    // Nothing visible for this conversation: an empty state beats stale rows the
    // server will not confirm (deleted/withdrawn messages).
    return [];
  }

  const oldest = page[0];
  const kept = current.filter((message) => {
    if (message.conversation_id !== conversationId) return false;
    return isBeforeCursor(message, { createdAt: oldest.created_at, id: oldest.id });
  });

  return kept.length === 0 ? page : [...kept, ...page];
}

/**
 * Prepend an older page, dropping anything already in the thread.
 *
 * Older pages are requested strictly before the oldest loaded message, but a
 * message can still arrive twice across two overlapping fetches (a realtime
 * insert that landed between them, or a retry). Duplication must be impossible
 * rather than merely unlikely.
 */
export function prependOlderPage<T extends PagedMessage>(current: T[], older: T[]): T[] {
  if (older.length === 0) return current;
  const known = new Set(current.map((message) => message.id));
  const additions = older.filter((message) => !known.has(message.id));
  if (additions.length === 0) return current;
  return [...additions, ...current];
}
