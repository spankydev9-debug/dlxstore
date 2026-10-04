import type {
  Follow,
  Friend,
  FriendGraph,
  FriendRequestSummary,
} from "../../types";
import { isDemoMode, isSupabaseConfigured, supabase } from "./index";

// ---------------------------------------------------------------------------
// DLX friend graph data layer
//
// Every read and every mutation goes through a SECURITY DEFINER RPC. The browser
// never selects from `profiles` for another customer: that table is self-or-admin
// readable only, and reopening it to everyone would leak email and phone. The
// RPCs return a deliberately narrow column set instead.
//
// Writes stay RPC-first for the same reason the social foundation chose it: a
// block check and the normalised friendship pair must be evaluated atomically in
// the database, never trusted to the UI.
//
// Added by 20261004090000_friend_graph_core.sql. If that migration is not
// applied, `getMyFriendGraph` degrades to an empty graph and `SocialUnavailableError`
// is thrown by the mutations, so the account page still renders.
// ---------------------------------------------------------------------------

/**
 * Thrown when the friend-graph RPCs are missing, i.e. the migration has not been
 * applied. Mirrors `VisualStudioUnavailableError` so the UI can degrade the same way.
 */
export class SocialUnavailableError extends Error {
  constructor(message = "The friend system is not available yet.") {
    super(message);
    this.name = "SocialUnavailableError";
  }
}

const DEMO_KEY = "dlxstore_friend_graph";

function isMissingFriendRpc(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883" || code === "42P01" || code === "42703") {
    return true;
  }
  const message = error.message ?? "";
  return (
    /could not find the function/i.test(message) ||
    /does not exist/i.test(message)
  );
}

/** Throw a typed error when the friend-graph migration has not been applied. */
function rethrow(error: { code?: string; message?: string }): never {
  if (isMissingFriendRpc(error)) throw new SocialUnavailableError();
  throw new Error(error.message || "Unable to load your friends.");
}

function mapFriend(rows: unknown): Friend[] {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      username: (r.username as string) ?? null,
      full_name: String(r.full_name ?? ""),
      avatar_url: (r.avatar_url as string) ?? null,
      bio: (r.bio as string) ?? null,
      friends_since: String(r.friends_since ?? ""),
    };
  });
}

function mapFollow(rows: unknown): Follow[] {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id),
      username: (r.username as string) ?? null,
      full_name: String(r.full_name ?? ""),
      avatar_url: (r.avatar_url as string) ?? null,
      bio: (r.bio as string) ?? null,
      followed_since: String(r.followed_since ?? ""),
    };
  });
}

function mapRequests(rows: unknown): FriendRequestSummary[] {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      request_id: String(r.request_id),
      direction: r.direction === "incoming" ? "incoming" : "outgoing",
      profile_id: String(r.profile_id),
      username: (r.username as string) ?? null,
      full_name: String(r.full_name ?? ""),
      avatar_url: (r.avatar_url as string) ?? null,
      created_at: String(r.created_at ?? ""),
    };
  });
}

function readDemoGraph(): FriendGraph {
  if (typeof window === "undefined") {
    return { friends: [], followers: [], following: [], requests: [] };
  }
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    if (!raw) return { friends: [], followers: [], following: [], requests: [] };
    const parsed = JSON.parse(raw) as Partial<FriendGraph>;
    return {
      friends: parsed.friends ?? [],
      followers: parsed.followers ?? [],
      following: parsed.following ?? [],
      requests: parsed.requests ?? [],
    };
  } catch {
    return { friends: [], followers: [], following: [], requests: [] };
  }
}

function writeDemoGraph(graph: FriendGraph): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_KEY, JSON.stringify(graph));
  } catch {
    // A full or unavailable localStorage must not break the demo surface.
  }
}

/**
 * Load the whole friend graph in one pass.
 *
 * A missing schema throws `SocialUnavailableError` rather than degrading section
 * by section. All four RPCs ship in a single migration, so a partial fallback
 * could only ever hide a uniform failure; the UI shows one honest "not available
 * yet" state instead.
 */
export async function getMyFriendGraph(): Promise<FriendGraph> {
  if (isSupabaseConfigured && supabase) {
    const [friends, followers, following, requests] = await Promise.all([
      supabase.rpc("get_my_friends").then(({ data, error }) => (error ? rethrow(error) : data)),
      supabase
        .rpc("get_my_followers")
        .then(({ data, error }) => (error ? rethrow(error) : data)),
      supabase
        .rpc("get_my_following")
        .then(({ data, error }) => (error ? rethrow(error) : data)),
      supabase
        .rpc("get_my_friend_requests")
        .then(({ data, error }) => (error ? rethrow(error) : data)),
    ]);
    return {
      friends: mapFriend(friends),
      followers: mapFollow(followers),
      following: mapFollow(following),
      requests: mapRequests(requests),
    };
  }

  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");
  return readDemoGraph();
}

/** Accept a pending incoming request. Creates the normalised friendship pair. */
export async function acceptFriendRequest(requestId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("respond_to_friend_request", {
      p_request_id: requestId,
      p_accept: true,
    });
    if (error) rethrow(error);
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  const graph = readDemoGraph();
  const request = graph.requests.find((item) => item.request_id === requestId);
  if (!request || request.direction !== "incoming") {
    throw new Error("This friend request is no longer available.");
  }
  graph.requests = graph.requests.filter((item) => item.request_id !== requestId);
  if (!graph.friends.some((friend) => friend.id === request.profile_id)) {
    graph.friends.unshift({
      id: request.profile_id,
      username: request.username,
      full_name: request.full_name,
      avatar_url: request.avatar_url,
      bio: null,
      friends_since: new Date().toISOString(),
    });
  }
  writeDemoGraph(graph);
}

/** Decline a pending incoming request. */
export async function declineFriendRequest(requestId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("respond_to_friend_request", {
      p_request_id: requestId,
      p_accept: false,
    });
    if (error) rethrow(error);
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  const graph = readDemoGraph();
  const request = graph.requests.find((item) => item.request_id === requestId);
  if (!request || request.direction !== "incoming") {
    throw new Error("This friend request is no longer available.");
  }
  graph.requests = graph.requests.filter((item) => item.request_id !== requestId);
  writeDemoGraph(graph);
}

/** Withdraw a request you sent. */
export async function cancelFriendRequest(requestId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("cancel_friend_request", {
      p_request_id: requestId,
    });
    if (error) rethrow(error);
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  const graph = readDemoGraph();
  const request = graph.requests.find((item) => item.request_id === requestId);
  if (!request || request.direction !== "outgoing") {
    throw new Error("This friend request is no longer available.");
  }
  graph.requests = graph.requests.filter((item) => item.request_id !== requestId);
  writeDemoGraph(graph);
}

/** Unfriend someone. Returns false when there was no friendship to remove. */
export async function removeFriend(profileId: string): Promise<boolean> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("remove_friend", { p_profile_id: profileId });
    if (error) rethrow(error);
    return data === true;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  const graph = readDemoGraph();
  const existed = graph.friends.some((friend) => friend.id === profileId);
  graph.friends = graph.friends.filter((friend) => friend.id !== profileId);
  writeDemoGraph(graph);
  return existed;
}

/** Follow someone. Blocked pairs and self-follows are refused by the database. */
export async function followProfile(profileId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("follow_profile", { p_target_id: profileId });
    if (error) rethrow(error);
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  const graph = readDemoGraph();
  if (!graph.following.some((entry) => entry.id === profileId)) {
    graph.following.unshift({
      id: profileId,
      username: null,
      full_name: "Demo member",
      avatar_url: null,
      bio: null,
      followed_since: new Date().toISOString(),
    });
  }
  writeDemoGraph(graph);
}

/** Unfollow someone. */
export async function unfollowProfile(profileId: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("unfollow_profile", { p_target_id: profileId });
    if (error) rethrow(error);
    return;
  }
  if (!isDemoMode) throw new Error("DLXSTORE is not configured.");

  const graph = readDemoGraph();
  graph.following = graph.following.filter((entry) => entry.id !== profileId);
  writeDemoGraph(graph);
}
