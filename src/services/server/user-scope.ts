import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Caller-scoped Supabase helpers for server-side API routes.
 *
 * Design rule: this module NEVER uses a service-role credential. Every request
 * runs with the caller's own JWT and the public/anon key, so the database RLS
 * and the SECURITY DEFINER RPCs remain the only authorization decision. That is
 * the correct boundary for any customer-facing write path.
 *
 * Operations that genuinely require a service-role credential (moving private
 * storage objects, minting signed URLs) are intentionally NOT implemented here.
 * They are reported honestly as `service_role_required` instead of being faked.
 *
 * Shared by the Visual Studio job routes and the AI catalog routes so neither
 * grows its own authentication path.
 */

export type UserScopeAuthFailure = "missing_token" | "invalid_token";

export class UserScopeAuthError extends Error {
  readonly reason: UserScopeAuthFailure;

  constructor(reason: UserScopeAuthFailure) {
    super(reason === "missing_token" ? "Authentication required." : "Session expired.");
    this.name = "UserScopeAuthError";
    this.reason = reason;
  }
}

type ServerSupabaseConfig = { url: string; key: string };

/** Reads the public Supabase coordinates on the server. Returns null when unset. */
function getServerSupabaseConfig(): ServerSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;
  return { url, key };
}

export function isUserScopeSupabaseConfigured(): boolean {
  return getServerSupabaseConfig() !== null;
}

/**
 * Builds a Supabase client bound to the caller's JWT, so `auth.uid()` resolves to
 * the real user and every RLS policy applies as if the browser had called
 * directly. Returns null when the server has no Supabase configuration.
 */
export function createUserScopedClient(accessToken: string): SupabaseClient | null {
  const config = getServerSupabaseConfig();
  if (!config) return null;

  return createClient(config.url, config.key, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Extracts the caller's access token from an incoming request. */
export function readAccessToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (!token || scheme.toLowerCase() !== "bearer") {
    throw new UserScopeAuthError("missing_token");
  }
  return token.trim();
}

/**
 * Resolves the authenticated caller. Throws `UserScopeAuthError` when the token is
 * absent, malformed, or no longer maps to a user.
 */
export async function requireCaller(
  request: Request
): Promise<{ client: SupabaseClient; userId: string }> {
  const accessToken = readAccessToken(request);
  const client = createUserScopedClient(accessToken);

  if (!client) {
    // The server cannot reach Supabase at all. This is a deployment
    // configuration fault, not an authentication failure.
    throw new Error("server_not_configured");
  }

  const { data, error } = await client.auth.getUser(accessToken);
  const userId = data?.user?.id;

  if (error || !userId) {
    throw new UserScopeAuthError("invalid_token");
  }

  return { client, userId };
}

/** True when a Supabase/PostgREST error means the optional schema is not applied. */
export function isMissingSchemaError(error: { code?: string } | null): boolean {
  return (
    error?.code === "PGRST202" ||
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    error?.code === "42703"
  );
}

/**
 * Reads the caller only, never the service role. Used by the workspace to decide
 * whether to render administrative controls. The database re-checks this in
 * `create_visual_job` and `promote_visual_job_output`, so this is presentational.
 */
export async function readCallerRole(
  client: SupabaseClient,
  userId: string
): Promise<"admin" | "customer"> {
  const { data } = await client
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  return data?.role === "admin" ? "admin" : "customer";
}
