"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Shirt, ShoppingBag, User, MessageCircle } from "lucide-react";
import { useCart } from "../../context/CartContext";
import { useChat } from "../../context/ChatContext";
import { useLanguage } from "../../context/LanguageContext";
import { useOverlay } from "../../context/OverlayContext";

/**
 * Mobile primary navigation — one of the two *intentionally designed* layouts
 * in this pass. It is not the desktop row with items hidden:
 *
 *   Shop · Search · Studio · Chat · Account
 *
 * These are the four DLX pillars (commerce, communication, the mannequin,
 * identity) expressed as navigation. The previous mobile layout had NO
 * persistent navigation anywhere in the app — everything hid behind a hamburger
 * drawer, and `/studio` was missing from that drawer entirely.
 *
 * Cart deliberately stays in the shopping context (badge on the Shop tab plus
 * the header icon) rather than becoming a sixth tab: cart is a state of
 * shopping, not a peer of it.
 *
 * Desktop never renders this bar (`md:hidden`), matching where `DesktopNav`
 * appears (`hidden md:flex`), so there is no breakpoint where neither layout
 * is present.
 */
const TABS = [
  { id: "shop", href: "/shop", icon: ShoppingBag },
  { id: "search", href: null, icon: Search },
  { id: "studio", href: "/studio", icon: Shirt },
  { id: "chat", href: "/chat", icon: MessageCircle },
  { id: "account", href: "/dashboard", icon: User },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { cartCount } = useCart();
  const { unreadCount: chatUnreadCount } = useChat();
  const { activeOverlay, openOverlay, closeOverlay } = useOverlay();

  const isSearchOpen = activeOverlay === "mobile-search";

  const labelFor = (id: (typeof TABS)[number]["id"]): string => {
    if (id === "shop") return t.shop;
    if (id === "search") return t.search;
    if (id === "studio") return t.studio;
    if (id === "chat") return t.messages;
    return t.navAccount;
  };

  const isActive = (href: string | null): boolean => {
    if (!href) return isSearchOpen;
    if (pathname === href) return true;
    // /product/:slug is still "shopping", so the Shop tab stays lit.
    if (href === "/shop" && pathname.startsWith("/product/")) return true;
    if (href !== "/" && pathname.startsWith(`${href}/`)) return true;
    return false;
  };

  return (
    <nav
      aria-label={t.menu}
      className="dlx-tabbar fixed inset-x-3 bottom-[calc(var(--safe-bottom)+0.625rem)] z-40 md:hidden"
    >
      {/* Floating app-control surface, not a footer: a real glass plane with
          its own blur, its own shadow and a lit top edge, sitting above
          safe-area clearance so the content scrolls *under* it instead of
          stopping at it. Width adapts to the viewport (side gutters + max),
          never a hardcoded strip. */}
      <ul className="relative mx-auto flex h-[3.75rem] w-full max-w-md items-stretch gap-1 overflow-hidden rounded-[1.35rem] border border-black/[0.07] bg-card/72 px-1.5 shadow-[0_18px_44px_-14px_rgba(0,0,0,0.75),0_2px_10px_-6px_rgba(0,0,0,0.45)] ring-1 ring-black/[0.06] backdrop-blur-2xl supports-[backdrop-filter]:bg-card/58 dark:border-white/10 dark:ring-white/[0.06]">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-4 top-px h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-black/[0.06]"
        />
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.href);
          const badge =
            tab.id === "shop" && cartCount > 0
              ? cartCount
              : tab.id === "chat" && chatUnreadCount > 0
                ? chatUnreadCount
                : 0;

          const content = (
            <>
              <span
                className={`relative inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors duration-200 ${
                  active ? "bg-[#d4af37]/15" : ""
                }`}
              >
                <Icon
                  aria-hidden
                  className="h-5 w-5"
                  strokeWidth={active ? 2.2 : 1.8}
                />
                {badge > 0 ? (
                  <span
                    aria-hidden
                    className={`absolute -right-2.5 -top-1.5 min-w-4 rounded-full px-1 text-center text-[9px] font-bold leading-4 ${
                      tab.id === "shop"
                        ? "bg-primary text-primary-foreground"
                        : "bg-destructive text-destructive-foreground"
                    }`}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 truncate text-[10px] leading-tight">
                {labelFor(tab.id)}
              </span>
              {/* Gold active indicator — the DLX accent, not a borrowed one. */}
              <span
                aria-hidden
                className={`mt-0.5 h-1 rounded-full transition-all duration-200 ${
                  active ? "w-5 bg-[#d4af37]/90" : "w-0 bg-transparent"
                }`}
              />
            </>
          );

          const baseClass = `flex min-h-full flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
            active
              ? "text-[#d4af37]"
              : "text-muted-foreground hover:text-foreground"
          }`;

          return (
            <li key={tab.id} className="flex flex-1">
              {tab.href ? (
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    // Navigating commits intent: close any open search surface.
                    if (activeOverlay) closeOverlay();
                  }}
                  className={baseClass}
                >
                  {content}
                </Link>
              ) : (
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  aria-expanded={isSearchOpen}
                  onClick={() => {
                    // Search is a destination, not a hidden field: it owns a
                    // full surface so mobile gets desktop parity (autocomplete,
                    // recents, category shortcuts).
                    if (isSearchOpen) closeOverlay();
                    else openOverlay("mobile-search");
                  }}
                  className={baseClass}
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
