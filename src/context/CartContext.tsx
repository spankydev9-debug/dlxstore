"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Product } from "../types";
import { useAuth } from "./AuthContext";
import { markCartRecovered, trackAbandonedCart } from "../services/db/loyalty";

export interface CartItem {
  id: string; // unique item representation: productId + size + color
  product: Product;
  quantity: number;
  selectedSize?: string;
  selectedColor?: string;
}

type CartContextType = {
  items: CartItem[];
  cartCount: number;
  subtotal: number;
  deliveryFee: 0;
  total: number;
  addToCart: (product: Product, quantity?: number, size?: string, color?: string) => void;
  removeFromCart: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, qty: number) => void;
  clearCart: () => void;
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

  const addToCart = (product: Product, quantity = 1, size?: string, color?: string) => {
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
          quantity,
          selectedSize: size,
          selectedColor: color
        }
      ];
    });
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
  const subtotal = items.reduce((sum, item) => {
    const price = item.product.discount_price ?? item.product.price;
    return sum + price * item.quantity;
  }, 0);
  
  const deliveryFee = 0; // Free delivery always
  const total = subtotal;

  // Abandoned-cart recovery (Phase 11). Debounced and sign-in gated so that
  // browsing does not generate a write per render, and anonymous visitors
  // never create rows. Failures are swallowed on purpose: recovery is a
  // marketing feature and must never interrupt shopping.
  const trackedRef = useRef<string>("");
  useEffect(() => {
    if (!mounted || !user || items.length === 0 || subtotal <= 0) return;

    const payload = items.map((item) => ({
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
  }, [items, subtotal, mounted, user]);

  return (
    <CartContext.Provider
      value={{
        items,
        cartCount,
        subtotal,
        deliveryFee,
        total,
        addToCart,
        removeFromCart,
        updateQuantity,
        clearCart
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
