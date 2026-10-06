"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  Flame,
  Heart,
  Home,
  LogOut,
  Mail,
  MessageSquare,
  Moon,
  Package,
  Settings,
  Shirt,
  Store,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useChat } from "../../context/ChatContext";
import { useLanguage } from "../../context/LanguageContext";
import { useNotifications } from "../../context/NotificationContext";
import { useOverlay } from "../../context/OverlayContext";
import { useStreakContext } from "../../context/StreakContext";
import { DownloadApp } from "./DownloadApp";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useTheme } from "./ThemeProvider";
import { AvatarBadge } from "../account/AvatarBadge";

/**
 * "Account & More" — the secondary navigation drawer, opened from the header
 * menu button on phones.
 *
 * This replaces the old hamburger drawer. The distinction matters:
 *
 *  - the old drawer was the ONLY mobile outlet for primary destinations, which
 *    is why it had 9 links and still omitted `/studio`;
 *  - this drawer holds only secondary content. Primary destinations live in
 *    `MobileTabBar`, so nothing here is the sole path to a core screen.
 *
 * It is also the reason the 640–767px dead zone is gone: its utility rows are
 * no longer `sm:hidden` (the old drawer hid them from `sm:` while the header
 * only showed them from `sm:`, so neither branch applied).
 */
function Row({
  href,
  onClick,
  children,
  danger = false,
}: {
  href?: string;
  onClick?: () => void;
  children: React.ReactNode;
  danger?: boolean;
}) {
  const cls = `flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
    danger
      ? "text-destructive hover:bg-destructive/10"
      : "text-foreground hover:bg-muted"
  }`;
  if (href) {
    return (
      <Link href={href} onClick={onClick} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-5 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

export function AccountMoreDrawer() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { closeOverlay, toggleOverlay } = useOverlay();
  const { streak } = useStreakContext();
  const {
    unreadCount,
    notifications,
    markAsRead,
    markAllAsRead,
    activeChannel,
    setActiveChannel,
  } = useNotifications();
  const { unreadCount: chatUnreadCount } = useChat();

  const done = () => closeOverlay();

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <button
        type="button"
        aria-label={t.searchClose}
        onClick={done}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.accountAndMore}
        className="relative flex h-full w-[min(23rem,100%)] flex-col border-l border-border bg-card shadow-2xl animate-fade-in"
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <h2 className="min-w-0 truncate text-base font-bold">{t.accountAndMore}</h2>
          <button
            type="button"
            onClick={done}
            aria-label={t.searchClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {/* Identity */}
          {user ? (
            <div className="flex items-center gap-3 rounded-xl bg-muted/50 px-3 py-3">
              <AvatarBadge user={user} className="h-11 w-11" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{user.full_name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  done();
                  router.push("/dashboard");
                }}
                className="shrink-0 text-xs font-semibold text-primary"
              >
                {t.myAccount}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                done();
                router.push("/auth?mode=login");
              }}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t.signIn}
            </button>
          )}

          {user ? (
            <>
              <SectionTitle>{t.myAccount}</SectionTitle>
              <div className="grid grid-cols-2 gap-2">
                <Row href="/dashboard?tab=orders" onClick={done}>
                  <Package className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
                  {t.myOrders}
                </Row>
                <Row href="/dashboard?tab=wishlist" onClick={done}>
                  <Heart className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
                  {t.wishlist}
                </Row>
                <Row href="/dashboard?tab=streak" onClick={done}>
                  <Flame className="h-4.5 w-4.5 text-orange-500" aria-hidden />
                  {t.streakTitle}
                  {(streak?.current_count ?? 0) > 0 ? (
                    <span className="ml-auto rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-extrabold text-orange-600 dark:text-orange-400">
                      {streak?.current_count}
                    </span>
                  ) : null}
                </Row>
                <Row href="/studio" onClick={done}>
                  <Shirt className="h-4.5 w-4.5 text-[#d4af37]" aria-hidden />
                  {t.studio}
                </Row>
                {user.role === "admin" ? (
                  <Row href="/admin/dashboard" onClick={done}>
                    <Settings className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
                    {t.adminDashboard}
                  </Row>
                ) : null}
              </div>

              {/* Notifications, inline so they are one tap away without a page load. */}
              <SectionTitle>{t.notifications}</SectionTitle>
              <div className="rounded-xl border border-border bg-background/50 px-3 py-3">
                <div className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {(
                    [
                      ["", t.all],
                      ["orders", t.orders],
                      ["social", t.social],
                      ["messages", t.messages],
                      ["rewards", t.rewards],
                    ] as const
                  ).map(([channel, label]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setActiveChannel(channel || null)}
                      className={`shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${
                        (activeChannel ?? "") === channel
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => void markAllAsRead()}
                    className="mb-2 text-xs font-semibold text-primary"
                  >
                    {t.markAllRead}
                  </button>
                ) : null}
                <ul className="space-y-1.5">
                  {notifications.length === 0 ? (
                    <li className="py-2 text-xs text-muted-foreground">{t.noNotifications}</li>
                  ) : (
                    notifications.slice(0, 5).map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => markAsRead(n.id)}
                          className={`w-full rounded-lg p-2 text-left text-xs transition-colors ${
                            n.is_read
                              ? "hover:bg-muted"
                              : "border-l-2 border-primary bg-muted/40 hover:bg-muted"
                          }`}
                        >
                          <span className="mb-0.5 flex items-center justify-between gap-2 font-semibold text-foreground">
                            <span className="truncate">{n.title}</span>
                            <span className="shrink-0 text-[9px] font-normal text-muted-foreground">
                              {new Date(n.created_at).toLocaleDateString()}
                            </span>
                          </span>
                          <span className="block text-muted-foreground">{n.message}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              <Row
                onClick={() => {
                  if (!user) return;
                  done();
                  toggleOverlay("chat");
                }}
              >
                <MessageSquare className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
                {t.supportTitle}
                {chatUnreadCount > 0 ? (
                  <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                    {chatUnreadCount}
                  </span>
                ) : null}
              </Row>
              <Row href="/dashboard?tab=notifications" onClick={done}>
                <Bell className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
                {t.viewAllNotifications}
              </Row>
            </>
          ) : null}

          {/* Explore — not in the tab bar, so these belong here. */}
          <SectionTitle>{t.explore}</SectionTitle>
          <Row href="/" onClick={done}>
            <Home className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
            {t.home}
          </Row>
          <Row href="/discover" onClick={done}>
            <Users className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
            {t.discoverTab}
          </Row>
          <Row href="/food" onClick={done}>
            <Store className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
            {t.food}
          </Row>
          <Row href="/partners" onClick={done}>
            <Store className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
            {t.shops}
          </Row>

          {/* Utility */}
          <SectionTitle>{t.language}</SectionTitle>
          <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={t.changeTheme}
              title={t.changeTheme}
              className="flex h-11 items-center gap-2 rounded-full border border-border px-3 text-xs font-semibold transition-colors hover:bg-muted"
            >
              {theme === "light" ? <Moon className="h-4 w-4" aria-hidden /> : <Sun className="h-4 w-4" aria-hidden />}
              {t.changeTheme}
            </button>
          </div>

          <div className="mt-4">
            <DownloadApp variant="drawer" />
          </div>

          {/* Footer utility — deliberately not competing with shopping links. */}
          <SectionTitle>DLX</SectionTitle>
          <Row href="/about" onClick={done}>
            <Home className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
            {t.about}
          </Row>
          <Row href="/contact" onClick={done}>
            <Mail className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
            {t.contact}
          </Row>
          <Row href="/partner" onClick={done}>
            <Store className="h-4.5 w-4.5 text-muted-foreground" aria-hidden />
            {t.partner}
          </Row>

          {user ? (
            <div className="mt-4 border-t border-border pt-3">
              <Row
                danger
                onClick={() => {
                  signOut();
                  done();
                  router.push("/");
                }}
              >
                <LogOut className="h-4.5 w-4.5" aria-hidden />
                {t.signOut}
              </Row>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
