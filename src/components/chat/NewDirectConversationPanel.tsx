"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X, Loader, UserRound, ArrowRight } from "lucide-react";
import { useChat } from "../../context/ChatContext";
import type { DiscoverableProfile } from "../../services/db/chat";

/**
 * People picker for starting a person-to-person conversation.
 *
 * Discovery is server-side: search_profiles() already excludes the caller and
 * anyone blocked in either direction, and honours the block list symmetrically,
 * so there is deliberately no client-side filtering of the results.
 */
export function NewDirectConversationPanel({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (conversationId: string) => void;
}) {
  const { searchPeople, startDirectConversation } = useChat();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DiscoverableProfile[]>([]);
  // The query whose results are currently displayed. isSearching is derived from
  // the difference rather than stored, so the effect never setStates synchronously.
  const [settledQuery, setSettledQuery] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery.length > 0 && trimmedQuery !== settledQuery;
  // When the query is cleared the previous results must not linger on screen.
  const visibleResults = trimmedQuery ? results : [];

  // Debounced, race-safe search. requestSeq guards against an earlier, slower
  // response overwriting the results of a later query.
  useEffect(() => {
    const trimmed = trimmedQuery;
    if (!trimmed) return;

    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      try {
        const found = await searchPeople(trimmed);
        if (requestSeq.current === seq) {
          setResults(found);
          setSettledQuery(trimmed);
          setError(null);
        }
      } catch (err) {
        if (requestSeq.current === seq) {
          setError(err instanceof Error ? err.message : "Search failed.");
          setResults([]);
          setSettledQuery(trimmed);
        }
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [trimmedQuery, searchPeople]);

  const handleStart = async (profileId: string) => {
    setStartingId(profileId);
    setError(null);
    try {
      const conversation = await startDirectConversation(profileId);
      if (conversation) {
        onStarted(conversation.id);
      } else {
        setError("Unable to start the conversation.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start the conversation.");
    } finally {
      setStartingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people by name or username"
            aria-label="Search people"
            className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm outline-none focus:border-foreground"
          />
        </div>
        <button
          onClick={onClose}
          aria-label="Cancel"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isSearching && (
        <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
          <Loader className="h-3.5 w-3.5 animate-spin" />
          Searching...
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      {!trimmedQuery && !isSearching && (
        <p className="py-2 text-xs text-muted-foreground">
          Search for someone to start a private conversation.
        </p>
      )}

      {trimmedQuery && !isSearching && visibleResults.length === 0 && !error && (
        <p className="py-2 text-xs text-muted-foreground">No people found.</p>
      )}

      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {visibleResults.map((person) => (
          <li key={person.profile_id}>
            <button
              onClick={() => handleStart(person.profile_id)}
              disabled={startingId !== null}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
                {person.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={person.avatar_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {person.full_name || person.username || "Unknown"}
                </span>
                {person.username && (
                  <span className="block truncate text-xs text-muted-foreground">
                    @{person.username}
                  </span>
                )}
              </span>
              {startingId === person.profile_id ? (
                <Loader className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}