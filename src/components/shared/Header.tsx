"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useNotifications } from "../../context/NotificationContext";
import { useChat } from "../../context/ChatContext";
import { useTheme } from "./ThemeProvider";
import { getProducts } from "../../services/db/products";
import { Product } from "../../types";
import {
  Check,
  Globe,
  ShoppingBag,
  Search,
  User,
  Flame,
  Bell,
  Menu,
  X,
  Sun,
  Moon,
  LogOut,
  LayoutDashboard,
  Heart,
  MessageSquare,
  Store,
} from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { languages } from "../../lib/i18n";
import { ProductImage } from "./ProductImage";
import { useLanguage } from "../../context/LanguageContext";
import { useStreakContext } from "../../context/StreakContext";
import { useOverlay } from "../../context/OverlayContext";
import { buildSearchHref, matchProducts, rememberSearch } from "../../lib/product-search";
import { AccountMoreDrawer } from "./AccountMoreDrawer";
import { AvatarBadge } from "../account/AvatarBadge";
import { DesktopNav } from "./DesktopNav";
import { MobileSearchSurface } from "./MobileSearchSurface";
import { CustomerSupportChat } from "../chat/CustomerSupportChat";

/**
 * Global header.
 *
 * This pass split the old single responsive bar into two intentional layouts:
 * `DesktopNav` (journey-ordered row + Categories mega-menu) for pointers, and
 * `MobileTabBar` (persistent 5-item thumb bar) for phones. This component is
 * now the *shared* chrome — logo, search, and the utility cluster — plus the
 * two overlays that are not navigation: the Account & More drawer and the
 * Support sheet.
 *
 * What it no longer does:
 *  - carry nine undifferentiated text links with no active state;
 *  - hold a hamburger drawer that was the only mobile outlet and still omitted
 *    `/studio`;
 *  - duplicate utility rows behind `sm:hidden` / `sm:block`, which produced the
 *    640–767px dead zone.
 *
 * Breakpoints are aligned deliberately: `DesktopNav` appears at `md:`, the tab
 * bar disappears at `md:` — there is no viewport where neither exists.
 */
export default function Header() {
  const { user, signOut } = useAuth();
  const { streak } = useStreakContext();
  const { cartCount } = useCart();
  const {
    unreadCount,
    notifications,
    markAsRead,
    markAllAsRead,
    deleteReadNotifications,
    activeChannel,
    setActiveChannel,
  } = useNotifications();
  const { unreadCount: chatUnreadCount } = useChat();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage();
  const { activeOverlay, closeOverlay, toggleOverlay } = useOverlay();

  // Primary overlays are arbitrated by OverlayProvider: only one can be open at
  // a time, and browser Back closes the active overlay first.
  const isChatOpen = activeOverlay === "chat";
  const isDrawerOpen = activeOverlay === "mobile-menu";
  const isSearchOpen = activeOverlay === "mobile-search";

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  const searchRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);

  // Vertical space covered by the mobile virtual keyboard while Support is open.
  // Populated from the actual VisualViewport geometry (not a guessed offset).
  const [kbInset, setKbInset] = useState(0);

  useEffect(() => {
    getProducts().then(setAllProducts).catch(console.error);
  }, []);

  const searchResults = useMemo(
    () => matchProducts(allProducts, searchQuery, 5),
    [allProducts, searchQuery]
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsSearchFocused(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(event.target as Node)) {
        setIsLangMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keep the Support composer above the virtual keyboard while chat is open.
  useEffect(() => {
    if (!isChatOpen) {
      setKbInset(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    let focusedInOverlay = false;

    const update = () => {
      if (!focusedInOverlay) {
        setKbInset(0);
        return;
      }
      const overlap = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      setKbInset(overlap);
    };
    const onFocusChange = () => {
      const el = document.activeElement;
      focusedInOverlay = !!el && el.closest && el.closest("[data-support-overlay]") !== null;
      update();
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
    };
  }, [isChatOpen]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    rememberSearch(searchQuery);
    setIsSearchFocused(false);
    router.push(buildSearchHref(searchQuery));
  };

  const selectAutocomplete = (slug: string) => {
    if (searchQuery.trim()) rememberSearch(searchQuery);
    setSearchQuery("");
    setIsSearchFocused(false);
    router.push(`/product/${slug}`);
  };

  const iconBtn =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors";

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-border/40 glass pt-safe-area-inset-top">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          {/* LOGO */}
          <Link
            href="/"
            onClick={() => closeOverlay()}
            className="flex shrink-0 items-center"
          >
            <span className="text-base font-bold tracking-widest text-foreground uppercase sm:text-xl lg:text-2xl">
              DLX<span className="text-primary font-light">STORE</span>
            </span>
          </Link>

          {/* Desktop navigation — journey-ordered, active states, mega-menu. */}
          <DesktopNav />

          {/* SEARCH BAR (Desktop) */}
          <div ref={searchRef} className="relative hidden min-w-0 max-w-md flex-1 lg:block">
            <form onSubmit={handleSearchSubmit} className="relative">
              <Search className="absolute left-3 top-2.5 h-4.5 w-4.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                className="h-10 w-full rounded-full border border-border/80 bg-background/50 pl-10 pr-4 text-sm outline-none ring-offset-background transition-all focus:border-foreground/80 focus:ring-1 focus:ring-ring"
              />
            </form>

            {isSearchFocused && searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-border/60 bg-card p-2 shadow-lg animate-fade-in">
                {searchResults.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => selectAutocomplete(product.slug)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <ProductImage
                        src={product.images[0]}
                        alt={product.name}
                        width={32}
                        height={32}
                        className="h-8 w-8 rounded object-cover"
                      />
                      <div>
                        <div className="font-medium text-foreground">{product.name}</div>
                        <div className="text-xs text-muted-foreground">{product.brand}</div>
                      </div>
                    </div>
                    <div className="text-xs font-semibold text-foreground">
                      {product.discount_price ?? product.price} $
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* CONTROLS */}
          <div className="flex min-w-0 shrink items-center gap-1 sm:gap-1.5">
            {/* Language — full pill on pointers, compact globe+menu on phones so
                the utility survives even at 320px without crowding the logo. */}
            <span className="hidden md:inline-flex">
              <LanguageSwitcher />
            </span>
            <span ref={langMenuRef} className="relative md:hidden">
              <button
                onClick={() => setIsLangMenuOpen((open) => !open)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t.language}
                aria-expanded={isLangMenuOpen}
                title={t.language}
              >
                <Globe className="h-4 w-4" />
              </button>

              {isLangMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-44 rounded-xl border border-border/80 bg-card p-1.5 shadow-xl animate-fade-in">
                  {languages.map((item) => {
                    const active = item.code === language;
                    return (
                      <button
                        key={item.code}
                        onClick={() => {
                          setLanguage(item.code);
                          setIsLangMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          active ? "bg-primary/10 font-semibold text-primary" : "text-foreground hover:bg-muted"
                        }`}
                      >
                        {item.label}
                        {active ? <Check className="h-4 w-4" /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </span>

            <button
              onClick={toggleTheme}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={t.changeTheme}
              aria-label={t.changeTheme}
            >
              {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>

            {/* Cart — kept in the shopping context at every breakpoint, with the
                same count driving the tab-bar badge on phones. */}
            <Link
              href="/cart"
              onClick={() => closeOverlay()}
              className={`relative ${iconBtn}`}
              aria-label={t.cart}
            >
              <ShoppingBag className="h-5 w-5" />
              {cartCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex min-h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                  {cartCount}
                </span>
              )}
            </Link>

            {user && (
              <button
                onClick={() => toggleOverlay("chat")}
                className={`${iconBtn} relative hidden lg:flex`}
                title={t.supportTitle}
                aria-label={t.supportTitle}
                aria-expanded={isChatOpen}
              >
                <MessageSquare className="h-5 w-5" />
                {chatUnreadCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex min-h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {chatUnreadCount}
                  </span>
                )}
              </button>
            )}

            {user && (
              <div ref={notificationsRef} className="relative hidden lg:block">
                <button
                  onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                  className={`${iconBtn} relative`}
                  aria-label={t.notifications}
                  aria-expanded={isNotificationsOpen}
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex min-h-4.5 min-w-4.5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {isNotificationsOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-border/80 bg-card p-2 shadow-xl animate-fade-in">
                    <div className="flex items-center justify-between border-b border-border/40 p-3">
                      <span className="text-sm font-semibold text-foreground">{t.notifications}</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={() => void markAllAsRead()}
                          className="text-xs text-primary hover:underline"
                        >
                          {t.markAllRead}
                        </button>
                      )}
                    </div>

                    <div className="border-b border-border/40 px-3 py-2">
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {(
                          [
                            [null, t.all],
                            ["orders", t.orders],
                            ["social", t.social],
                            ["messages", t.messages],
                            ["rewards", t.rewards],
                          ] as const
                        ).map(([channel, label]) => (
                          <button
                            key={label}
                            onClick={() => setActiveChannel(channel)}
                            className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold transition-colors ${
                              activeChannel === channel
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="max-h-60 space-y-2 overflow-y-auto p-3">
                      {notifications.length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">
                          {t.noNotifications}
                        </p>
                      ) : (
                        notifications.slice(0, 5).map((n) => (
                          <div
                            key={n.id}
                            onClick={() => markAsRead(n.id)}
                            className={`cursor-pointer rounded-lg p-2 text-xs transition-colors ${
                              n.is_read
                                ? "hover:bg-muted"
                                : "border-l-2 border-primary bg-muted/40 hover:bg-muted"
                            }`}
                          >
                            <div className="mb-1 flex items-center justify-between font-semibold text-foreground">
                              <span>{n.title}</span>
                              <span className="text-[9px] text-muted-foreground">
                                {new Date(n.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="text-muted-foreground">{n.message}</p>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-border/40 p-3">
                      <Link
                        href="/dashboard?tab=notifications"
                        onClick={() => setIsNotificationsOpen(false)}
                        className="text-xs font-semibold text-primary hover:underline"
                      >
                        {t.viewAllNotifications}
                      </Link>
                      <button
                        onClick={() => void deleteReadNotifications()}
                        className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                      >
                        {t.clearRead}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* User menu */}
            <div ref={userMenuRef} className="relative">
              {user ? (
                <>
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center gap-1 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t.myAccount}
                    aria-expanded={isUserMenuOpen}
                  >
                    <StreakPip count={streak?.current_count ?? 0} />
                    <AvatarBadge user={user} />
                  </button>

                  {isUserMenuOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-border/80 bg-card p-2 shadow-xl animate-fade-in">
                      <div className="border-b border-border/40 px-3 py-2">
                        <p className="text-xs font-medium text-muted-foreground">{t.signedInAs}</p>
                        <p className="truncate text-sm font-semibold text-foreground">
                          {user.full_name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                      </div>

                      <div className="space-y-0.5 p-1">
                        {user.role === "admin" && (
                          <Link
                            href="/admin/dashboard"
                            onClick={() => setIsUserMenuOpen(false)}
                            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                          >
                            <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                            {t.adminDashboard}
                          </Link>
                        )}
                        <Link
                          href="/dashboard"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                        >
                          <User className="h-4 w-4 text-muted-foreground" />
                          {t.myAccount}
                        </Link>
                        <Link
                          href="/dashboard?tab=streak"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                        >
                          <Flame className="h-4 w-4 text-orange-500" />
                          {t.streakTitle}
                        </Link>
                        <Link
                          href="/partner/dashboard"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                        >
                          <Store className="h-4 w-4 text-muted-foreground" />
                          {t.sellerDashboardTitle}
                        </Link>
                        <Link
                          href="/dashboard?tab=wishlist"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted"
                        >
                          <Heart className="h-4 w-4 text-muted-foreground" />
                          {t.wishlist}
                        </Link>
                        <button
                          onClick={() => {
                            signOut();
                            setIsUserMenuOpen(false);
                            router.push("/");
                          }}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
                        >
                          <LogOut className="h-4 w-4" />
                          {t.signOut}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <Link
                  href="/auth?mode=login"
                  className="flex h-11 shrink-0 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/95"
                >
                  {t.signIn}
                </Link>
              )}
            </div>

            {/* Account & More — secondary navigation only. Primary destinations
                live in the mobile tab bar / DesktopNav, so this is never the
                sole route to a core screen. */}
            <button
              onClick={() => toggleOverlay("mobile-menu")}
              className={iconBtn}
              aria-label={t.accountAndMore}
              aria-expanded={isDrawerOpen}
            >
              {isDrawerOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Overlays are siblings of the glass <header>: its backdrop-filter would
          otherwise create a containing block that confines a position:fixed
          descendant to the ~64px header strip instead of the viewport. */}
      {isDrawerOpen && <AccountMoreDrawer />}
      {isSearchOpen && <MobileSearchSurface />}

      {isChatOpen && user && (
        <div
          data-support-overlay
          className="overlay-backdrop animate-fade-in"
          style={{ "--kb-offset": `${kbInset}px` } as React.CSSProperties}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeOverlay();
          }}
        >
          <div className="overlay-panel w-full max-w-4xl" role="dialog" aria-modal="true" aria-label={t.supportTitle}>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-4">
              <h2 className="min-w-0 truncate text-lg font-bold">{t.supportTitle}</h2>
              <button
                onClick={() => closeOverlay()}
                className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t.searchClose}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <CustomerSupportChat />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Compact streak counter in the header bar.
 *
 * Rendered from the shared (non-breakpoint-gated) header row, so desktop and
 * mobile get an identical control with no duplicate implementation. Hides itself
 * at zero so a customer who has not started a streak sees no clutter.
 */
function StreakPip({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      className="flex items-center gap-0.5 rounded-full bg-orange-500/15 px-2 py-0.5 text-[11px] font-extrabold text-orange-600 dark:text-orange-400"
      title="Streak"
    >
      <Flame className="h-3 w-3" />
      {count}
    </span>
  );
}
