import { supabase } from "./index";
import type {
  BlockedProfile,
  RestrictedProfile,
  CloseFriend,
  MutedProfile,
  AbuseReport,
  ReportType,
  ProfileSearchResult,
  FriendSuggestion,
} from "@/types";

// ---------------------------------------------------------------------------
// Block / Unblock
// ---------------------------------------------------------------------------

export async function blockProfile(blockedId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("block_profile", {
    p_blocked_id: blockedId,
  });

  if (error) {
    console.error("Error blocking profile:", error);
    throw error;
  }

  return data ?? false;
}

export async function unblockProfile(blockedId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("unblock_profile", {
    p_blocked_id: blockedId,
  });

  if (error) {
    console.error("Error unblocking profile:", error);
    throw error;
  }

  return data ?? false;
}

export async function getBlockedProfiles(): Promise<BlockedProfile[]> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("get_blocked_profiles");

  if (error) {
    console.error("Error fetching blocked profiles:", error);
    return [];
  }

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Restrict / Unrestrict
// ---------------------------------------------------------------------------

export async function restrictProfile(restrictedId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("restrict_profile", {
    p_restricted_id: restrictedId,
  });

  if (error) {
    console.error("Error restricting profile:", error);
    throw error;
  }

  return data ?? false;
}

export async function unrestrictProfile(restrictedId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("unrestrict_profile", {
    p_restricted_id: restrictedId,
  });

  if (error) {
    console.error("Error unrestricting profile:", error);
    throw error;
  }

  return data ?? false;
}

export async function getRestrictedProfiles(): Promise<RestrictedProfile[]> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("get_restricted_profiles");

  if (error) {
    console.error("Error fetching restricted profiles:", error);
    return [];
  }

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Close Friends
// ---------------------------------------------------------------------------

export async function addCloseFriend(profileId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("add_close_friend", {
    p_profile_id: profileId,
  });

  if (error) {
    console.error("Error adding close friend:", error);
    throw error;
  }

  return data ?? false;
}

export async function removeCloseFriend(profileId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("remove_close_friend", {
    p_profile_id: profileId,
  });

  if (error) {
    console.error("Error removing close friend:", error);
    throw error;
  }

  return data ?? false;
}

export async function getCloseFriends(): Promise<CloseFriend[]> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("get_close_friends");

  if (error) {
    console.error("Error fetching close friends:", error);
    return [];
  }

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Mute / Unmute
// ---------------------------------------------------------------------------

export async function muteProfile(mutedId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("mute_profile", {
    p_muted_id: mutedId,
  });

  if (error) {
    console.error("Error muting profile:", error);
    throw error;
  }

  return data ?? false;
}

export async function unmuteProfile(mutedId: string): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("unmute_profile", {
    p_muted_id: mutedId,
  });

  if (error) {
    console.error("Error unmuting profile:", error);
    throw error;
  }

  return data ?? false;
}

export async function getMutedProfiles(): Promise<MutedProfile[]> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("get_muted_profiles");

  if (error) {
    console.error("Error fetching muted profiles:", error);
    return [];
  }

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Abuse Reports
// ---------------------------------------------------------------------------

export async function createAbuseReport(
  reportedId: string | null,
  storyId: string | null,
  reportType: ReportType,
  description: string | null
): Promise<string> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("create_abuse_report", {
    p_reported_id: reportedId,
    p_story_id: storyId,
    p_report_type: reportType,
    p_description: description,
  });

  if (error) {
    console.error("Error creating abuse report:", error);
    throw error;
  }

  return data ?? "";
}

export async function getMyReports(): Promise<AbuseReport[]> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("get_my_reports");

  if (error) {
    console.error("Error fetching my reports:", error);
    return [];
  }

  return data ?? [];
}

export async function adminGetReports(status: string | null = null): Promise<AbuseReport[]> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("admin_get_reports", {
    p_status: status,
  });

  if (error) {
    console.error("Error fetching admin reports:", error);
    return [];
  }

  return data ?? [];
}

export async function adminUpdateReportStatus(
  reportId: string,
  status: string
): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("admin_update_report_status", {
    p_report_id: reportId,
    p_status: status,
  });

  if (error) {
    console.error("Error updating report status:", error);
    throw error;
  }

  return data ?? false;
}

// ---------------------------------------------------------------------------
// Profile Search
// ---------------------------------------------------------------------------

export async function searchProfiles(query: string, limit: number = 20): Promise<ProfileSearchResult[]> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("search_profiles", {
    p_query: query,
    p_limit: limit,
  });

  if (error) {
    console.error("Error searching profiles:", error);
    return [];
  }

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Friend Suggestions
// ---------------------------------------------------------------------------

export async function getFriendSuggestions(limit: number = 10): Promise<FriendSuggestion[]> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("get_friend_suggestions", {
    p_limit: limit,
  });

  if (error) {
    console.error("Error fetching friend suggestions:", error);
    return [];
  }

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Profile Update
// ---------------------------------------------------------------------------

export async function updateMyProfile(
  fullName: string,
  phone: string,
  username?: string | null,
  bio?: string | null
): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("update_my_profile", {
    p_full_name: fullName,
    p_phone: phone,
    p_username: username,
    p_bio: bio,
  });

  if (error) {
    console.error("Error updating profile:", error);
    throw error;
  }

  return data ?? false;
}

// ---------------------------------------------------------------------------
// Privacy Settings
// ---------------------------------------------------------------------------

export async function updatePrivacySettings(
  isPrivate?: boolean | null,
  allowMessagesFrom?: string | null,
  allowFollowsFrom?: string | null
): Promise<boolean> {
  if (!supabase) throw new Error("Supabase not configured");
  const { data, error } = await supabase.rpc("update_my_privacy_settings", {
    p_is_private: isPrivate,
    p_allow_messages_from: allowMessagesFrom,
    p_allow_follows_from: allowFollowsFrom,
  });

  if (error) {
    console.error("Error updating privacy settings:", error);
    throw error;
  }

  return data ?? false;
}
