import type { Outfit } from "../../lib/studio/outfit";

// ---------------------------------------------------------------------------
// Looks persistence — local-first by explicit decision (D1).
//
// `save_wardrobe_item` and friends return 404 against the production database,
// so there is no wardrobe RPC to call today. Rather than fake a successful
// account save, Looks persist to `localStorage` and the UI says so in words
// (`looksLocalNote` / `lookSavedLocally`).
//
// The abstraction is the point: `LooksStore` is the seam a future
// `save_wardrobe_item` adapter drops into, and switching adapters changes no
// component. `persistence` is part of the contract so the UI can never claim
// a local save was an account save.
// ---------------------------------------------------------------------------

export type SavedLook = {
  id: string;
  name: string;
  profileId: string;
  items: Outfit;
  createdAt: string;
};

export type NewLook = Omit<SavedLook, "createdAt">;

export interface LooksStore {
  /** Identifies which adapter is live, for logs and for the UI caption. */
  readonly id: "local" | "account";
  /**
   * Where looks actually live. `"local"` means this device only — the UI must
   * render that truth and must never say the look reached the account.
   */
  readonly persistence: "local" | "account";
  list(profileId: string): Promise<SavedLook[]>;
  save(look: NewLook): Promise<SavedLook>;
  remove(profileId: string, lookId: string): Promise<void>;
}

const STORAGE_PREFIX = "dlx:looks:";
const MAX_LOOKS = 60;

function storageKey(profileId: string): string {
  return `${STORAGE_PREFIX}${profileId}`;
}

function readAll(profileId: string): SavedLook[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(profileId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SavedLook =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as SavedLook).id === "string" &&
        Array.isArray((entry as SavedLook).items)
    );
  } catch {
    // A corrupt or unavailable store degrades to "no looks", never to a throw
    // that would take the studio down with it.
    return [];
  }
}

function writeAll(profileId: string, looks: SavedLook[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(profileId), JSON.stringify(looks));
  } catch {
    // Quota / private mode. Surfaced by `save()` rejecting below.
    throw new Error("storage_unavailable");
  }
}

export const localLooksStore: LooksStore = {
  id: "local",
  persistence: "local",

  async list(profileId) {
    return readAll(profileId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async save(look) {
    const existing = readAll(look.profileId);
    const record: SavedLook = { ...look, createdAt: new Date().toISOString() };
    const next = [record, ...existing.filter((entry) => entry.id !== look.id)].slice(0, MAX_LOOKS);
    writeAll(look.profileId, next);
    return record;
  },

  async remove(profileId, lookId) {
    writeAll(profileId, readAll(profileId).filter((entry) => entry.id !== lookId));
  },
};

/**
 * Seam for the account-backed adapter.
 *
 * Kept as data rather than as a function that pretends to work: when
 * `save_wardrobe_item` (or a purpose-built looks RPC) exists in production,
 * this object is filled in and `looksStoreFor()` starts returning it. Until
 * then it is inert, and nothing in the UI can be tricked into reading it.
 */
export const ACCOUNT_LOOKS_SEAM = {
  available: false,
  /** RPCs the account adapter will use once they exist in production. */
  rpcs: {
    list: "get_wardrobe_items",
    save: "save_wardrobe_item",
    remove: "remove_wardrobe_item",
  },
} as const;

/**
 * The adapter the studio uses. Always local until an account adapter reports
 * `available: true`.
 */
export function looksStoreFor(): LooksStore {
  if (ACCOUNT_LOOKS_SEAM.available) {
    // Deliberately unreachable today. It is the single line that changes when
    // the account adapter lands.
    return localLooksStore;
  }
  return localLooksStore;
}

/** True when looks are device-only. Drives the honesty caption in the UI. */
export function isLocalOnly(store: LooksStore): boolean {
  return store.persistence === "local";
}
