"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { useNotifications } from "../../context/NotificationContext";
import { useTheme } from "./ThemeProvider";
import { getProducts } from "../../services/db/products";
import { Product } from "../../types";
import { 
  ShoppingBag, 
  Search, 
  User, 
  Bell, 
  Menu, 
  X, 
  Sun, 
  Moon, 
  Settings, 
  LogOut, 
  LayoutDashboard,
  Heart,
  ChevronRight
} from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useLanguage } from "../../context/LanguageContext";

export default function Header() {
  const { user, signOut } = useAuth();
  const { cartCount } = useCart();
  const { unreadCount, notifications, markAsRead } = useNotifications();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();
  const { t } = useLanguage();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [allProducts, setAllProducts] = useState<Product[]>([]);

  const searchRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

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
    <header className="sticky top-0 z-40 w-full border-b border-border/40 glass">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* LOGO */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center space-x-2">
            <span className="text-xl font-bold tracking-widest text-foreground sm:text-2xl uppercase">
              DLX<span className="text-primary font-light">STORE</span>
            </span>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center space-x-6 text-sm font-medium text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors">{t.home}</Link>
            <Link href="/shop" className="hover:text-foreground transition-colors">{t.shop}</Link>
            <Link href="/food" className="hover:text-foreground transition-colors">{t.food}</Link>
            <Link href="/partner" className="hover:text-foreground transition-colors">{t.partner}</Link>
            <Link href="/about" className="hover:text-foreground transition-colors">{t.about}</Link>
            <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
          </nav>
        </div>

        {/* SEARCH BAR (Desktop) */}
        <div ref={searchRef} className="relative hidden max-w-md flex-1 px-4 md:block">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="absolute top-2.5 left-3 h-4.5 w-4.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher un produit à Goma..."
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
                    <Image 
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
        <div className="flex items-center space-x-2 sm:space-x-4">
          <LanguageSwitcher />
          
          {/* Theme Toggler */}
          <button
            onClick={toggleTheme}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Changer de thème"
          >
            {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </button>

          {/* Cart Icon */}
          <Link
            href="/cart"
            className="relative rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ShoppingBag className="h-5 w-5" />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {cartCount}
              </span>
            )}
          </Link>

          {/* Notifications Dropdown (Bell) */}
          {user && (
            <div ref={notificationsRef} className="relative">
              <button
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                className="relative rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                    {unreadCount}
                  </span>
                )}
              </button>

              {isNotificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-border/80 bg-card p-4 shadow-xl animate-fade-in z-50">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2 mb-2">
                    <span className="font-semibold text-sm text-foreground">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="text-xs text-muted-foreground">{unreadCount} non lues</span>
                    )}
                  </div>

                  <div className="max-h-60 overflow-y-auto space-y-3">
                    {notifications.length === 0 ? (
                      <p className="text-center text-xs text-muted-foreground py-4">Aucune notification.</p>
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
                  <div className="border-t border-border/40 pt-2 mt-2 text-center">
                    <Link 
                      href="/dashboard?tab=notifications" 
                      onClick={() => setIsNotificationsOpen(false)}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Voir toutes les notifications
                    </Link>
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
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground font-semibold text-sm">
                    {user.full_name.charAt(0).toUpperCase()}
                  </div>
                </button>

                {isUserMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-border/80 bg-card p-2 shadow-xl animate-fade-in z-50">
                    <div className="border-b border-border/40 px-3 py-2">
                      <p className="text-xs text-muted-foreground font-medium">Connecté en tant que</p>
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
                          Dashboard Admin
                        </Link>
                      )}
                      <Link
                        href="/dashboard"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <User className="h-4 w-4 text-muted-foreground" />
                        Mon Compte
                      </Link>
                      <Link
                        href="/dashboard?tab=wishlist"
                        onClick={() => setIsUserMenuOpen(false)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-foreground hover:bg-muted transition-colors"
                      >
                        <Heart className="h-4 w-4 text-muted-foreground" />
                        Favoris
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
                        Se déconnecter
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Link
                href="/auth?mode=login"
                className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition-colors"
              >
                Connexion
              </Link>
            )}
          </div>

          {/* Mobile Menu Toggler */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors md:hidden"
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="border-b border-border bg-card py-4 px-6 md:hidden animate-fade-in">
          {/* Mobile Search */}
          <form onSubmit={handleSearchSubmit} className="relative mb-4">
            <Search className="absolute top-2.5 left-3 h-4.5 w-4.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher à Goma..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 rounded-full border border-border bg-background pl-10 pr-4 text-sm outline-none"
            />
          </form>

          <nav className="flex flex-col space-y-3 font-medium text-sm text-muted-foreground">
            <Link 
              href="/" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="hover:text-foreground py-1 transition-colors border-b border-border/40"
            >
              Accueil
            </Link>
            <Link 
              href="/shop" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="hover:text-foreground py-1 transition-colors border-b border-border/40"
            >
              Boutique
            </Link>
            <Link 
              href="/about" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="hover:text-foreground py-1 transition-colors border-b border-border/40"
            >
              {t.about}
            </Link>
            <Link href="/food" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-foreground py-1 transition-colors border-b border-border/40">{t.food}</Link>
            <Link 
              href="/contact" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="hover:text-foreground py-1 transition-colors border-b border-border/40"
            >
              Contact
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
