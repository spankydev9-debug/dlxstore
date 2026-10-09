"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Product } from "../types";
import { useAuth } from "./AuthContext";
import { markCartRecovered, trackAbandonedCart } from "../services/db/loyalty";
import { getProducts } from "../services/db/products";
import { isSupabaseConfigured } from "../services/db/index";
import { getProductAvailability, type ProductAvailability } from "../lib/product-availability";

export interface CartItem {
  id: string; // unique item representation: productId + size + color
  product: Product;
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
}

type CartContextType = {
  items: CartItem[];
  /** Only the items that can actually be bought right now. Drives checkout. */
  purchasableItems: CartItem[];
  /** Items that are out of stock or withdrawn; shown but excluded from totals. */
  unavailableItems: Array<CartItem & { availability: ProductAvailability }>;
  cartCount: number;
  subtotal: number;
  deliveryFee: 0;
  total: number;
  /** True when the cart has items but none of them can be bought. */
  hasOnlyUnavailable: boolean;
  addToCart: (product: Product, quantity?: number, size?: string, color?: string) => boolean;
  removeFromCart: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, qty: number) => void;
  clearCart: () => void;
  /** Re-read the live catalogue so availability and totals reflect what the store can sell now. */
  revalidateCart: () => Promise<void>;
};

const CartContext = createContext<CartContextType | undefined>(undefined);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const raw = localStorage.getItem("dlxstore_cart");
    if (raw) {
      try {
        const parsedItems = JSON.parse(raw);
        // Validate product IDs are valid UUIDs
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const validItems = parsedItems.filter((item: CartItem) => 
          uuidRegex.test(item.product.id)
        );
        
        if (validItems.length !== parsedItems.length) {
          console.log(`[CART] Filtered out ${parsedItems.length - validItems.length} invalid items from cart`);
          localStorage.setItem("dlxstore_cart", JSON.stringify(validItems));
        }
        
        setItems(validItems);
      } catch (e) {
        console.error("[CART] Failed to parse cart data, clearing cart:", e);
        localStorage.removeItem("dlxstore_cart");
        setItems([]);
      }
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("dlxstore_cart", JSON.stringify(items));
    }
  }, [items, mounted]);

  // Cart lines persist in localStorage, so each one carries a snapshot of the
  // product taken when it was added. Stock and prices move on the server, and
  // create_customer_order rejects any order whose total does not match the live
  // catalogue — so a stale snapshot fails only at the final step, after the
  // customer has filled in their address. Revalidate against the real catalogue
  // so availability and totals are computed from what the store can sell now.
  const itemsRef = useRef<CartItem[]>(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const inFlightRef = useRef<Promise<void> | null>(null);
  const revalidateCart = useCallback(async (): Promise<void> => {
    if (!isSupabaseConfigured) return;
    if (inFlightRef.current) return inFlightRef.current;
    if (itemsRef.current.length === 0) return;

    const task = (async () => {
      try {
        const live = await getProducts();
        // An empty catalogue means the read told us nothing usable. Marking every
        // line unavailable here would silently zero the total, so leave the cart
        // as it is and let the server validate at submission.
        if (live.length === 0) return;
        const byId = new Map(live.map((product) => [product.id, product]));
        setItems((prev) =>
          prev.map((item) => {
            const current = byId.get(item.product.id);
            if (!current) {
              // Withdrawn, deactivated or deleted: no longer sellable. Keep the
              // line for reference and let the UI mark it unavailable.
              return { ...item, product: { ...item.product, is_active: false } };
            }
            const max = Number.isFinite(current.stock_quantity)
              ? Math.max(1, Math.trunc(current.stock_quantity))
              : 1;
            return { ...item, product: current, quantity: Math.min(item.quantity, max) };
          }),
        );
      } catch {
        // A failed lookup must never destroy the cart. Availability stays as
        // last known, and the server still re-validates stock and price.
      }
    })();

    inFlightRef.current = task;
    try {
      await task;
    } finally {
      inFlightRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (mounted) void revalidateCart();
  }, [mounted, revalidateCart]);

  const addToCart = (product: Product, quantity = 1, size?: string, color?: string): boolean => {
    // Never add a product that cannot be bought. Report it, so the caller does
    // not tell the customer something was added when nothing was.
    if (!getProductAvailability(product).purchasable) return false;

    setItems(prevItems => {
      const cartItemId = `${product.id}-${size || ""}-${color || ""}`;
      const existing = prevItems.find(item => item.id === cartItemId);

      if (existing) {
        return prevItems.map(item =>
          item.id === cartItemId
            ? { ...item, quantity: Math.min(product.stock_quantity, item.quantity + quantity) }
            : item
        );
      }

      return [
        ...prevItems,
        {
          id: cartItemId,
          product,
          quantity: Math.min(product.stock_quantity, Math.max(1, quantity)),
          selectedSize: size,
          selectedColor: color
        }
      ];
    });

    return true;
  };

  const removeFromCart = (cartItemId: string) => {
    setItems(prevItems => prevItems.filter(item => item.id !== cartItemId));
  };

  const updateQuantity = (cartItemId: string, qty: number) => {
    setItems(prevItems =>
      prevItems.map(item =>
        item.id === cartItemId
          ? { ...item, quantity: Math.max(1, Math.min(item.product.stock_quantity, qty)) }
          : item
      )
    );
  };

  const clearCart = () => {
    setItems([]);
    // Whether the cart emptied because the order completed or because the
    // customer changed their mind, it is no longer an abandoned cart.
    void markCartRecovered();
  };

  const cartCount = items.reduce((sum, item) => sum + item.quantity, 0);

  // Split by buyability. A stale cart can hold a product that has since gone
  // out of stock or been archived; those stay visible for reference but must
  // not count toward what the customer is asked to pay.
  const purchasableItems = items.filter((item) => getProductAvailability(item.product).purchasable);
  const unavailableItems = items
    .filter((item) => !getProductAvailability(item.product).purchasable)
    .map((item) => ({ ...item, availability: getProductAvailability(item.product).availability }));

  const subtotal = purchasableItems.reduce((sum, item) => {
    const price = item.product.discount_price ?? item.product.price;
    return sum + price * item.quantity;
  }, 0);

  const deliveryFee = 0; // Free delivery always
  const total = subtotal;
  const hasOnlyUnavailable = items.length > 0 && purchasableItems.length === 0;

  // Abandoned-cart recovery (Phase 11). Debounced and sign-in gated so that
  // browsing does not generate a write per render, and anonymous visitors
  // never create rows. Failures are swallowed on purpose: recovery is a
  // marketing feature and must never interrupt shopping.
  const trackedRef = useRef<string>("");
  useEffect(() => {
    if (!mounted || !user || purchasableItems.length === 0 || subtotal <= 0) return;

    const payload = purchasableItems.map((item) => ({
      id: item.product.id,
      qty: item.quantity,
      size: item.selectedSize ?? null,
      color: item.selectedColor ?? null,
    }));
    const signature = JSON.stringify(payload);
    if (signature === trackedRef.current) return;
    trackedRef.current = signature;

    const timer = setTimeout(() => {
      void trackAbandonedCart(payload, subtotal);
    }, 2500);
    return () => clearTimeout(timer);
  }, [purchasableItems, subtotal, mounted, user]);

  return (
    <CartContext.Provider
      value={{
        items,
        purchasableItems,
        unavailableItems,
        cartCount,
        subtotal,
        deliveryFee,
        total,
        hasOnlyUnavailable,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart,
        revalidateCart
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
