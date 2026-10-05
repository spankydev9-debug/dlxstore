"use client";

import React, { useState, useEffect, useRef } from "react";
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
  ShoppingBag, 
  Search, 
  User, 
  Flame,
  Bell, 
  Menu, 
  X, 
  Sun, 
  Moon, 
  Settings, 
  LogOut, 
  LayoutDashboard,
  Heart,
  ChevronRight,
  MessageSquare,
  Store
} from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { ProductImage } from "./ProductImage";
import { DownloadApp } from "./DownloadApp";
import { useLanguage } from "../../context/LanguageContext";
import { useStreakContext } from "../../context/StreakContext";
import { useOverlay } from "../../context/OverlayContext";
import { CustomerSupportChat } from "../chat/CustomerSupportChat";
import { AvatarBadge } from "../account/AvatarBadge";

export default function Header() {
  const { user, signOut } = useAuth();
  const { streak } = useStreakContext();
  const { cartCount } = useCart();
  const { unreadCount, notifications, markAsRead, markAllAsRead, deleteReadNotifications, activeChannel, setActiveChannel } = useNotifications();
  const { unreadCount: chatUnreadCount } = useChat();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const { t } = useLanguage();
  const { activeOverlay, closeOverlay, toggleOverlay } = useOverlay();

  // Primary overlays are arbitrated by OverlayProvider: only one can be open at
  // a time, and browser Back closes the active overlay first.
  const isChatOpen = activeOverlay === "chat";
  const isMobileMenuOpen = activeOverlay === "mobile-menu";

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  const searchRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  // Vertical space covered by the mobile virtual keyboard while Support is open.
  // Populated from the actual VisualViewport geometry (not a guessed offset) so
  // the composer stays above the keyboard on iOS/Android.
  const [kbInset, setKbInset] = useState(0);

  // Load products for client-side search autocomplete
  useEffect(() => {
    getProducts().then(setAllProducts).catch(console.error);
  }, []);

  // Filter products for autocomplete
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const query = searchQuery.toLowerCase();
    const filtered = allProducts.filter(
      p => p.name.toLowerCase().includes(query) || p.brand.toLowerCase().includes(query)
    ).slice(0, 5);
    setSearchResults(filtered);
  }, [searchQuery, allProducts]);

  // Close menus when clicking outside
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
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Keep the Support composer above the virtual keyboard while chat is open.
  // Uses the VisualViewport API (real browser geometry) so there are no guessed
  // offsets. Only applied while a control inside the Support overlay is focused.
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
      const overlap = Math.max(
        0,
        Math.round(window.innerHeight - vv.height - vv.offsetTop)
      );
      setKbInset(overlap);
    };
    const onFocusChange = () => {
      const el = document.activeElement;
      focusedInOverlay =
        !!el && el.closest && el.closest("[data-support-overlay]") !== null;
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
    if (searchQuery.trim()) {
      router.push(`/shop?search=${encodeURIComponent(searchQuery.trim())}`);
      setIsSearchFocused(false);
    }
  };

  const selectAutocomplete = (slug: string) => {
    setSearchQuery("");
    setSearchResults([]);
    setIsSearchFocused(false);
    router.push(`/product/${slug}`);
  };

  return (
    <>
    <header className="sticky top-0 z-40 w-full border-b border-border/40 glass pt-safe-area-inset-top">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* LOGO */}
        <div className="flex min-w-0 items-center gap-8">
          <Link href="/" onClick={() => closeOverlay()} className="flex shrink-0 items-center space-x-2">
            <span className="text-base font-bold tracking-widest text-foreground uppercase sm:text-xl lg:text-2xl">
              DLX<span className="text-primary font-light">STORE</span>
            </span>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center space-x-6 text-sm font-medium text-muted-foreground">
            <Link href="/" onClick={() => closeOverlay()} className="hover:text-foreground transition-colors">{t.home}</Link>
            <Link href="/shop" onClick={() => closeOverlay()} className="hover:text-foreground transition-colors">{t.shop}</Link>
            <Link href="/discover" onClick={() => closeOverlay()} className="hover:text-foreground transition-colors">{t.discoverTab}</Link>
            <Link href="/food" onClick={() => closeOverlay()} className="hover:text-foreground transition-colors">{t.food}</Link>
            <Link href="/partners" onClick={() => closeOverlay()} className="hover:text-foreground transition-colors">{t.shops}</Link>
            <Link href="/studio" onClick={() => closeOverlay()} className="hover:text-foreground transition-colors">{t.studio}</Link>
            <Link href="/partner" onClick={() => closeOverlay()} className="hover:text-foreground transition-colors">{t.partner}</Link>
            <Link href="/about" onClick={() => closeOverlay()} className="hover:text-foreground transition-colors">{t.about}</Link>
            <Link href="/contact" onClick={() => closeOverlay()} className="hover:text-foreground transition-colors">{t.contact}</Link>
          </nav>
        </div>

        {/* SEARCH BAR (Desktop) */}
        <div ref={searchRef} className="relative hidden min-w-0 max-w-md flex-1 px-4 md:block">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute top-2.5 left-3 h-4.5 w-4.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={t.searchProducts}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              className="w-full h-10 rounded-full border border-border/80 bg-background/50 pl-10 pr-4 text-sm outline-none ring-offset-background transition-all focus:border-foreground/80 focus:ring-1 focus:ring-ring"
            />
          </form>

          {/* Autocomplete Dropdown */}
          {isSearchFocused && searchResults.length > 0 && (
            <div className="absolute top-full left-4 right-4 z-50 mt-1 rounded-xl border border-border/60 bg-card p-2 shadow-lg animate-fade-in">
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
        <div className="flex min-w-0 shrink items-center gap-1 sm:space-x-4">
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          
          {/* Theme Toggler */}
          <button
            onClick={toggleTheme}
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors sm:inline-flex"
            title={t.changeTheme}
            aria-label={t.changeTheme}
          >
            {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </button>

          {/* Cart Icon */}
          <Link
            href="/cart"
            onClick={() => closeOverlay()}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ShoppingBag className="h-5 w-5" />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {cartCount}
              </span>
            )}
          </Link>

          {/* Chat Button */}
          {user && (
            <button
              onClick={() => toggleOverlay("chat")}
              className="relative hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors sm:flex"
              title={t.supportTitle}
              aria-label={t.supportTitle}
              aria-expanded={isChatOpen}
            >
              <MessageSquare className="h-5 w-5" />
              {chatUnreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {chatUnreadCount}
                </span>
              )}
            </button>
          )}

          {/* Notifications Dropdown (Bell) */}
          {user && (
            <div ref={notificationsRef} className="relative">
              <button
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="relative hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors sm:flex"
                aria-label={t.notifications}
                aria-expanded={isNotificationsOpen}
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                    {unreadCount}
                  </span>
                )}
              </button>

              {isNotificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-border/80 bg-card shadow-xl animate-fade-in z-50">
                  <div className="flex items-center justify-between border-b border-border/40 p-3">
                    <span className="font-semibold text-sm text-foreground">{t.notifications}</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={async () => {
                          await markAllAsRead();
                        }}
                        className="text-xs text-primary hover:underline"
                      >
                        {t.markAllRead}
                      </button>
                    )}
                  </div>

                  <div className="border-b border-border/40 px-3 py-2">
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      <button
                        onClick={() => setActiveChannel(null)}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap transition-colors ${
                          activeChannel === null
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {t.all}
                      </button>
                      <button
                        onClick={() => setActiveChannel('orders')}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap transition-colors ${
                          activeChannel === 'orders'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {t.orders}
                      </button>
                      <button
                        onClick={() => setActiveChannel('social')}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap transition-colors ${
                          activeChannel === 'social'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {t.social}
                      </button>
                      <button
                        onClick={() => setActiveChannel('messages')}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap transition-colors ${
                          activeChannel === 'messages'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {t.messages}
                      </button>
                      <button
                        onClick={() => setActiveChannel('rewards')}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap transition-colors ${
                          activeChannel === 'rewards'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      >
                        {t.rewards}
                      </button>
                    </div>
                  </div>

                  <div className="max-h-60 overflow-y-auto p-3 space-y-2">
                    {notifications.length === 0 ? (
                      <p className="text-center text-xs text-muted-foreground py-4">{t.noNotifications}</p>
                    ) : (
                      notifications.slice(0, 5).map((n) => (
                        <div
                          key={n.id}
                          className={`flex flex-col text-xs p-2 rounded-lg transition-colors cursor-pointer ${n.is_read ? 'hover:bg-muted' : 'bg-muted/40 border-l-2 border-primary hover:bg-muted'}`}
                          onClick={() => markAsRead(n.id)}
                        >
                          <div className="flex items-center justify-between font-semibold mb-1 text-foreground">
                            <span>{n.title}</span>
                            <span className="text-[9px] text-muted-foreground">{new Date(n.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="text-muted-foreground">{n.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="border-t border-border/40 p-3 flex justify-between items-center">
                    <Link
                      href="/dashboard?tab=notifications"
                      onClick={() => setIsNotificationsOpen(false)}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      {t.viewAllNotifications}
                    </Link>
                    <button
                      onClick={async () => {
                        await deleteReadNotifications();
                      }}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    >
                      {t.clearRead}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* User Menu Dropdown */}
          <div ref={userMenuRef} className="relative">
            {user ? (
              <>
                <button
                  onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                  className="flex items-center gap-1 sm:gap-2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <StreakPip count={streak?.current_count ?? 0} />
                  <AvatarBadge user={user} />
                </button>

                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border/80 bg-card p-2 shadow-xl animate-fade-in z-50">
                    <div className="border-b border-border/40 px-3 py-2">
                      <p className="text-xs text-muted-foreground font-medium">{t.signedInAs}</p>
                      <p className="truncate text-sm font-semibold text-foreground">{user.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>

                    <div className="p-1 space-y-0.5">
                      {user.role === "admin" && (
                        <Link
                          href="/admin/dashboard"
                          onClick={() => setIsUserMenuOpen(false)}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                        >
                          <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                          {t.adminDashboard}
                        </Link>
                      )}
                      <Link
                        href="/dashboard"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <User className="h-4 w-4 text-muted-foreground" />
                        {t.myAccount}
                      </Link>
                      <Link
                        href="/dashboard?tab=streak"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <Flame className="h-4 w-4 text-orange-500" />
                        {t.streakTitle}
                        {(streak?.current_count ?? 0) > 0 ? (
                          <span className="ml-auto rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-extrabold text-orange-600 dark:text-orange-400">
                            {streak?.current_count}
                          </span>
                        ) : null}
                      </Link>
                      <Link
                        href="/partner/dashboard"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <Store className="h-4 w-4 text-muted-foreground" />
                        {t.sellerDashboardTitle}
                      </Link>
                      <Link
                        href="/dashboard?tab=wishlist"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
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
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors"
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
                  className="flex h-11 shrink-0 items-center rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition-colors"
                >
                  Connexion
                </Link>
            )}
          </div>

          {/* Mobile Menu Toggler */}
<button
              onClick={() => toggleOverlay("mobile-menu")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
              aria-label={t.menu}
              aria-expanded={isMobileMenuOpen}
            >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="border-b border-border bg-card py-4 px-6 md:hidden animate-fade-in pb-safe-area-inset-bottom max-h-[calc(100dvh-4rem-env(safe-area-inset-top))] overflow-y-auto overscroll-contain">
          {/* Mobile Search */}
          <form onSubmit={handleSearchSubmit} className="relative mb-4">
            <Search className="absolute top-2.5 left-3 h-4.5 w-4.5 text-muted-foreground" />
            <input
              type="text"
              placeholder={t.searchGoma}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 rounded-full border border-border bg-background pl-10 pr-4 text-sm outline-none"
            />
          </form>

          <nav className="flex flex-col space-y-3 font-medium text-sm text-muted-foreground">
            <Link 
              href="/" 
              onClick={() => closeOverlay()}
              className="hover:text-foreground py-1 transition-colors border-b border-border/40"
            >
              {t.home}
            </Link>
            <Link 
              href="/shop" 
              onClick={() => closeOverlay()}
              className="hover:text-foreground py-1 transition-colors border-b border-border/40"
            >
              {t.shop}
            </Link>
            <Link 
              href="/discover"
              onClick={() => closeOverlay()}
              className="hover:text-foreground py-1 transition-colors border-b border-border/40"
            >
              {t.discoverTab}
            </Link>
            <Link
              href="/about" 
              onClick={() => closeOverlay()}
              className="hover:text-foreground py-1 transition-colors border-b border-border/40"
            >
              {t.about}
            </Link>
            <Link href="/food" onClick={() => closeOverlay()} className="hover:text-foreground py-1 transition-colors border-b border-border/40">{t.food}</Link>
            <Link href="/partners" onClick={() => closeOverlay()} className="hover:text-foreground py-1 transition-colors border-b border-border/40">{t.shops}</Link>
            <Link href="/partner" onClick={() => closeOverlay()} className="hover:text-foreground py-1 transition-colors border-b border-border/40">{t.partner}</Link>
            <Link 
              href="/contact" 
              onClick={() => closeOverlay()}
              className="hover:text-foreground py-1 transition-colors border-b border-border/40"
            >
              {t.contact}
            </Link>
          </nav>

          {/* Download DLXSTORE (PWA install helper) */}
          <div className="pt-5">
<DownloadApp variant="drawer" />
          </div>

            {/* On phones the bar cannot fit the support and notification controls
                without pushing the menu button off-screen, so both live here. */}
            {user && (
              <div className="pt-5 sm:hidden">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{t.notifications}</span>
                  {unreadCount > 0 && (
                    <button
                      onClick={async () => { await markAllAsRead(); }}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      {t.markAllRead}
                    </button>
                  )}
                </div>
                <div className="mt-2 space-y-2">
                  {notifications.length === 0 ? (
                    <p className="py-2 text-xs text-muted-foreground">{t.noNotifications}</p>
                  ) : (
                    notifications.slice(0, 4).map((n) => (
                      <div
                        key={n.id}
                        onClick={() => markAsRead(n.id)}
                        className={`cursor-pointer rounded-lg p-2 text-xs transition-colors ${n.is_read ? "bg-muted/40" : "bg-muted/40 border-l-2 border-primary"}`}
                      >
                        <div className="mb-1 flex items-center justify-between font-semibold text-foreground">
                          <span>{n.title}</span>
                          <span className="text-[9px] text-muted-foreground">{new Date(n.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="text-muted-foreground">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
                <Link
                  href="/chat"
                  onClick={() => closeOverlay()}
                  className="mt-3 flex min-h-11 items-center gap-2 border-t border-border/40 pt-3 text-sm text-muted-foreground"
                >
                  <MessageSquare className="h-4 w-4" />
                  {t.supportTitle}
                  {chatUnreadCount > 0 && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                      {chatUnreadCount}
                    </span>
                  )}
                </Link>
              </div>
            )}

            {/* Language + theme live here on phones, where the header bar cannot
                fit them without overflowing and pushing the menu button off-screen. */}
            <div className="flex items-center justify-between gap-3 pt-5 sm:hidden">
              <LanguageSwitcher />
              <button
                onClick={toggleTheme}
                className="flex h-11 min-w-11 items-center gap-2 rounded-full border border-border/80 px-3 text-xs font-semibold text-foreground"
                title={t.changeTheme}
                aria-label={t.changeTheme}
              >
                {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                <span>{t.changeTheme}</span>
              </button>
            </div>
          </div>
        )}
    </header>

    {/* Support Chat — rendered as a SIBLING of the glass <header>, never inside it.
        The header's backdrop-filter creates a containing block that would confine
        a position:fixed descendant to the ~64px header strip instead of the
        viewport (this is why Support appeared off-screen on iPhone). Notifications
        was never affected because it is position:absolute inside the header. */}
    {isChatOpen && user && (
      <div
        data-support-overlay
        className="overlay-backdrop animate-fade-in"
        style={{ "--kb-offset": `${kbInset}px` } as React.CSSProperties}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeOverlay();
        }}
      >
        <div
          className="overlay-panel w-full max-w-4xl"
          role="dialog"
          aria-modal="true"
          aria-label={t.supportTitle}
        >
          {/* Stable header / close — always reachable */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border p-4">
            <h2 className="min-w-0 truncate text-lg font-bold">
              {t.supportTitle}
            </h2>
            <button
              onClick={() => closeOverlay()}
              className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Scrollable conversation content */}
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
