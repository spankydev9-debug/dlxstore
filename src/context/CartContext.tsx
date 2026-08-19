"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { Product } from "../types";

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

  useEffect(() => {
    const raw = localStorage.getItem("dlxstore_cart");
    if (raw) {
      setItems(JSON.parse(raw));
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      localStorage.setItem("dlxstore_cart", JSON.stringify(items));
    }
  }, [items, mounted]);

  const addToCart = (product: Product, quantity = 1, size?: string, color?: string) => {
    if (product.stock_quantity <= 0) return;
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
  };

  const cartCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => {
    const price = item.product.discount_price ?? item.product.price;
    return sum + price * item.quantity;
  }, 0);
  
  const deliveryFee = 0; // Free delivery always
  const total = subtotal;

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
