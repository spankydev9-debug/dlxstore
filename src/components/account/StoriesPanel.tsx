"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Eye,
  ImagePlus,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import { useStories } from "../../hooks/useStories";
import { getProducts } from "../../services/db/products";
import { getStoryMediaUrl, uploadStoryMedia } from "../../services/db/stories";
import {
  STORY_REACTION_EMOJIS,
  STORY_VISIBILITIES,
  type MyStoryItem,
  type Product,
  type StoryGroup,
  type StoryItem,
  type StoryMediaType,
  type StoryVisibility,
} from "../../types";

/** The database caps a story at five featured products; the picker must not offer more. */
const MAX_TAGGED_PRODUCTS = 5;
/** A caption over this is refused by `create_story`; mirror the limit in the UI. */
const MAX_CAPTION_LENGTH = 1000;

const VISIBILITY_LABEL_KEYS = {
  public: "storiesVisibilityPublic",
  followers: "storiesVisibilityFollowers",
  close_friends: "storiesVisibilityCloseFriends",
} as const;

/**
 * Signed media for a list of stories.
 *
 * The `story-media` bucket is private, so an object path from the feed is not a
 * displayable URL. Each path is signed once and cached by path for the lifetime
 * of the component; a signing failure resolves to null so the tile falls back to
 * its gradient rather than raising an error over the whole rail.
 */
function useStoryMediaUrls(stories: (StoryItem | MyStoryItem)[]): Record<string, string | null> {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  // Every path currently rendered, so the effect does not re-sign on each render.
  const paths = useMemo(
    () =>
      Array.from(
        new Set(
          stories
            .map((story) => story.storage_object_path)
            .filter((path): path is string => Boolean(path))
        )
      ).sort(),
    [stories]
  );
  const key = paths.join("|");

  useEffect(() => {
    let cancelled = false;
    if (paths.length === 0) {
      setUrls({});
      return;
    }
    void Promise.all(
      paths.map(async (path) => [path, await getStoryMediaUrl(path)] as const)
    ).then((entries) => {
      if (!cancelled) setUrls(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // `paths` is a new array each render; `key` is its stable serialisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return urls;
}

/**
 * Create-story form.
 *
 * The story id is minted here, before the upload, because the storage object path
 * must be `<profile_id>/<story_id>.<ext>` for the database's read policy to resolve
 * the story's audience. `create_story` then takes that same id.
 */
function StoryComposer({
  busy,
  onPublish,
  onClose,
}: {
  busy: boolean;
  onPublish: (args: {
    storyId: string;
    file: File;
    caption: string;
    visibility: StoryVisibility;
    productIds: string[];
  }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState<StoryVisibility>("followers");
  const [tagged, setTagged] = useState<string[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void getProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  // The preview is derived from the selected file, so it is memoised rather than
  // stored: that avoids setting state inside an effect and guarantees the object
  // URL is released as soon as the selection changes or the form unmounts.
  const preview = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file]
  );
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const isVideo = file?.type.startsWith("video/") ?? false;
  const canPost = Boolean(file) && !busy;

  const submit = useCallback(async () => {
    if (!file) {
      setLocalError(t.storiesSelectMedia);
      return;
    }
    setLocalError(null);
    // crypto.randomUUID is available in every browser this app supports.
    await onPublish({
      storyId: crypto.randomUUID(),
      file,
      caption: caption.trim(),
      visibility,
      productIds: tagged,
    });
  }, [caption, file, onPublish, t.storiesSelectMedia, tagged, visibility]);

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-sm font-bold text-foreground">
          <ImagePlus className="h-4 w-4 text-primary" />
          {t.storiesNewPost}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          aria-label={t.storiesCancel}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {localError ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {localError}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-border bg-card transition-colors hover:border-primary/50"
          >
            {preview ? (
              isVideo ? (
                <video src={preview} className="h-full w-full object-cover" muted playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-full w-full object-cover" />
              )
            ) : (
              <span className="px-3 text-center text-xs text-muted-foreground">
                {t.storiesSelectMedia}
              </span>
            )}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            className="hidden"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </div>

        <div className="space-y-3">
          <textarea
            value={caption}
            onChange={(event) => setCaption(event.target.value.slice(0, MAX_CAPTION_LENGTH))}
            rows={3}
            placeholder={t.storiesCaption}
            className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
          />

          <label className="block text-xs font-bold text-foreground">
            {t.storiesVisibility}
            <select
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as StoryVisibility)}
              className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-normal text-foreground outline-none focus:border-primary"
            >
              {STORY_VISIBILITIES.map((option) => (
                <option key={option} value={option}>
                  {t[VISIBILITY_LABEL_KEYS[option]]}
                </option>
              ))}
            </select>
          </label>

          <div>
            <p className="text-xs font-bold text-foreground">{t.storiesTaggedProducts}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {products.slice(0, 12).map((product) => {
                const selected = tagged.includes(product.id);
                const full = tagged.length >= MAX_TAGGED_PRODUCTS && !selected;
                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={full}
                    onClick={() =>
                      setTagged((current) =>
                        selected
                          ? current.filter((id) => id !== product.id)
                          : [...current, product.id].slice(0, MAX_TAGGED_PRODUCTS)
                      )
                    }
                    className={`max-w-[9rem] truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {product.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-bold text-muted-foreground transition-colors hover:bg-muted"
        >
          {t.storiesCancel}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canPost}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {busy ? t.storiesPosting : t.storiesPost}
        </button>
      </div>
    </div>
  );
}

/**
 * One story rendered full-bleed: media if a signed URL resolved, otherwise the
 * caption on the story's own background colour. A text story has no object path
 * at all, so the text branch is its normal case rather than a fallback.
 */
function StoryStage({ story, url }: { story: StoryItem; url: string | null }) {
  const { t } = useLanguage();
  const isVideo = story.media_type === "video";

  return (
    <div
      className="relative flex aspect-[9/16] w-full items-center justify-center overflow-hidden rounded-2xl"
      style={{ backgroundColor: story.background_color ?? "#0f172a" }}
    >
      {url ? (
        isVideo ? (
          <video src={url} className="h-full w-full object-cover" controls playsInline />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="h-full w-full object-cover" />
        )
      ) : story.media_type === "text" ? (
        <p className="px-6 text-center text-lg font-bold text-white">{story.text_content}</p>
      ) : (
        <p className="px-6 text-center text-xs text-white/70">{t.storiesSelectMedia}</p>
      )}
    </div>
  );
}

export function StoriesPanel() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { groups, stories, mine, loadState, error, pendingAction, actions, refresh } = useStories();
  const [composing, setComposing] = useState(false);
  const [openGroup, setOpenGroup] = useState<StoryGroup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const urls = useStoryMediaUrls([...stories, ...mine]);

  // Hooks must stay above the early returns below, so the publish and open
  // handlers are declared here rather than next to their call sites.
  const publish = useCallback(
    async ({
      storyId,
      file,
      caption,
      visibility,
      productIds,
    }: {
      storyId: string;
      file: File;
      caption: string;
      visibility: StoryVisibility;
      productIds: string[];
    }) => {
      if (!user) return;
      const mediaType: StoryMediaType = file.type.startsWith("video/") ? "video" : "image";
      // Upload first: the object path embeds the story id and the storage read
      // policy resolves the story from it. A failed upload must not leave a row.
      const objectPath = await uploadStoryMedia(storyId, user.id, file);
      await actions.create({
        storyId,
        mediaType,
        storageObjectPath: objectPath,
        textContent: caption || null,
        visibility,
        productIds,
      });
      setComposing(false);
    },
    [actions, user]
  );

  const openStory = useCallback(
    (group: StoryGroup) => {
      setOpenGroup(group);
      const first = group.stories[0];
      if (first && !first.is_mine && !first.viewed) void actions.view(first.id);
    },
    [actions]
  );

  if (loadState === "loading") {
    return (
      <p className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t.storiesLoading}
      </p>
    );
  }

  if (loadState === "unavailable") {
    return (
      <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-5">
        <p className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
          <LockKeyhole className="h-4 w-4" />
          {t.storiesUnavailableTitle}
        </p>
        <p className="text-sm text-amber-700/90 dark:text-amber-400/90">
          {t.storiesUnavailableBody}
        </p>
      </div>
    );
  }

  const activeMine = mine.filter((story) => !story.is_archived);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-bold text-foreground">
            <ImagePlus className="h-5 w-5 text-primary" />
            {t.storiesTitle}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t.storiesIntro}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border px-3 text-xs font-bold transition-colors hover:bg-muted"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t.storiesRefresh}
        </button>
      </div>

      {error ? (
        <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {composing && user ? (
        <StoryComposer
          busy={pendingAction === "create"}
          onPublish={publish}
          onClose={() => setComposing(false)}
        />
      ) : null}

      {/* The rail. An empty rail is a normal state, not an error. */}
      <section className="space-y-3">
        <div className="flex gap-4 overflow-x-auto pb-2">
          {user ? (
            <button
              type="button"
              onClick={() => setComposing((open) => !open)}
              className="flex shrink-0 flex-col items-center gap-1.5"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-primary text-primary">
                <Plus className="h-6 w-6" />
              </span>
              <span className="max-w-[4.5rem] truncate text-[11px] font-semibold text-muted-foreground">
                {t.storiesYourTurn}
              </span>
            </button>
          ) : null}

          {groups.map((group) => (
            <button
              key={group.author.id}
              type="button"
              onClick={() => openStory(group)}
              className="flex shrink-0 flex-col items-center gap-1.5"
            >
              <span
                className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 ${
                  group.hasUnseen ? "border-primary" : "border-border"
                }`}
              >
                {group.author.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={group.author.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="bg-muted text-sm font-bold text-muted-foreground">
                    {group.author.full_name.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="max-w-[4.5rem] truncate text-[11px] font-semibold text-muted-foreground">
                {group.isMine ? t.storiesYourTurn : group.author.full_name}
              </span>
            </button>
          ))}
        </div>

        {groups.length === 0 && activeMine.length === 0 ? (
          <p className="rounded-xl border border-border/50 bg-muted/20 p-4 text-xs text-muted-foreground">
            {t.storiesEmpty}
          </p>
        ) : null}
      </section>

      <p className="flex items-start gap-2 rounded-xl border border-border/50 bg-muted/20 p-3 text-[11px] text-muted-foreground">
        <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t.storiesSafetyNote}
      </p>

      {activeMine.length > 0 ? (
        <section className="space-y-3">
          <h4 className="text-sm font-bold text-foreground">{t.storiesMine}</h4>
          <ul className="space-y-2">
            {activeMine.map((story) => (
              <li
                key={story.id}
                className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {story.text_content || t[VISIBILITY_LABEL_KEYS[story.visibility]]}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t.storiesViews.replace("{count}", String(story.viewer_count))}
                    {story.is_expired ? ` · ${t.storiesExpired}` : ""}
                  </p>
                </div>
                {confirmDelete === story.id ? (
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDelete(null);
                        void actions.remove(story.id, story.storage_object_path);
                      }}
                      className="rounded-lg bg-destructive px-2.5 py-1.5 text-[11px] font-bold text-destructive-foreground"
                    >
                      {t.storiesDelete}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground"
                    >
                      {t.storiesCancel}
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={() => void actions.archive(story.id, true)}
                      title={t.storiesArchive}
                      className="rounded-lg border border-border p-2 text-muted-foreground transition-colors hover:bg-muted"
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(story.id)}
                      title={t.storiesDelete}
                      className="rounded-lg border border-border p-2 text-destructive/70 transition-colors hover:bg-destructive/5"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mine.some((story) => story.is_archived) ? (
        <section className="space-y-3">
          <h4 className="text-sm font-bold text-foreground">{t.storiesArchived}</h4>
          <ul className="space-y-2">
            {mine
              .filter((story) => story.is_archived)
              .map((story) => (
                <li
                  key={story.id}
                  className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 p-3"
                >
                  <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {story.text_content || t[VISIBILITY_LABEL_KEYS[story.visibility]]}
                  </p>
                  <button
                    type="button"
                    onClick={() => void actions.archive(story.id, false)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground"
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                    {t.storiesRestore}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {openGroup ? (
        <StoryViewer
          group={openGroup}
          urls={urls}
          onClose={() => setOpenGroup(null)}
          onView={actions.view}
          onReact={actions.react}
        />
      ) : null}
    </div>
  );
}

/**
 * Full-screen story viewer.
 *
 * One author's run pages as a single sequence, because a story ring means
 * "everything this person posted today". The view is recorded when a story is
 * first shown and is idempotent server-side, so paging back and forth is safe.
 */
function StoryViewer({
  group,
  urls,
  onClose,
  onView,
  onReact,
}: {
  group: StoryGroup;
  urls: Record<string, string | null>;
  onClose: () => void;
  onView: (storyId: string) => Promise<void>;
  onReact: (storyId: string, emoji: string) => Promise<void>;
}) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const story = group.stories[Math.min(index, group.stories.length - 1)];

  // Record the view once per story id shown, never on every render.
  const viewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!story || story.is_mine) return;
    if (viewedRef.current === story.id) return;
    viewedRef.current = story.id;
    void onView(story.id);
  }, [onView, story]);

  // Escape closes the viewer, matching the rest of the app's dialogs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!story) return null;

  const url = story.storage_object_path ? urls[story.storage_object_path] ?? null : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={group.author.full_name}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm space-y-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white">
            {group.isMine ? t.storiesYourTurn : group.author.full_name}
          </span>
          <span className="text-[11px] text-white/60">
            {index + 1} / {group.stories.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg p-1.5 text-white/80 transition-colors hover:bg-white/10"
            aria-label={t.storiesCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <StoryStage story={story} url={url} />

        {story.text_content && story.media_type !== "text" ? (
          <p className="text-xs text-white/90">{story.text_content}</p>
        ) : null}

        {story.products.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-white/80">{t.storiesTaggedProducts}</p>
            <ul className="flex flex-wrap gap-1.5">
              {story.products.map((product) => (
                <li
                  key={product.id}
                  className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  {product.name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {STORY_REACTION_EMOJIS.map((emoji) => {
            const active = story.my_reactions.includes(emoji);
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => void onReact(story.id, emoji)}
                aria-label={t.storiesReact}
                aria-pressed={active}
                className={`rounded-full px-2.5 py-1.5 text-lg transition-transform hover:scale-110 ${
                  active ? "bg-white/20 ring-2 ring-primary" : "bg-white/10"
                }`}
              >
                {emoji}
              </button>
            );
          })}
          {story.reaction_count > 0 ? (
            <span className="text-[11px] text-white/60">
              {story.reaction_count} · {t.storiesReact}
            </span>
          ) : null}
        </div>

        {group.stories.length > 1 ? (
          <div className="flex justify-between gap-2">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              className="rounded-xl border border-white/20 px-3 py-2 text-xs font-bold text-white disabled:opacity-30"
            >
              ‹
            </button>
            <button
              type="button"
              disabled={index >= group.stories.length - 1}
              onClick={() => setIndex((current) => Math.min(group.stories.length - 1, current + 1))}
              className="rounded-xl border border-white/20 px-3 py-2 text-xs font-bold text-white disabled:opacity-30"
            >
              ›
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The customer-facing story rail, composer and own-story management
 * (ROADMAP Phase 5).
 *
 * Scope note: this covers posting, viewing, reacting, archiving, deleting and
 * viewer counts. Stories are limited to the caller's own social circle, so there
 * is no public browsing, no story mentions from the UI and no story analytics —
 * see docs/CHECKPOINT-F5-STORIES.md.
 */
