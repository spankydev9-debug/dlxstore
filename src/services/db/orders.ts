import { Order, OrderItem, OrderStatus } from "../../types";
import { supabase, isSupabaseConfigured, initMockDb } from "./index";
import { adjustInventory } from "./products";
import { createNotification } from "./notifications";

export async function createOrder(
  orderData: Omit<Order, "id" | "status" | "created_at" | "updated_at" | "items" | "delivery">,
  items: Array<{ product_id: string; quantity: number; price_at_sale: number; size?: string; color?: string }>
): Promise<Order> {
  if (isSupabaseConfigured && supabase) {
    // Validate product IDs are valid UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const item of items) {
      if (!uuidRegex.test(item.product_id)) {
        console.error("[ORDER RPC] Invalid product ID format:", item.product_id);
        throw new Error(`Invalid product ID format: ${item.product_id}. Please clear your cart and try again.`);
      }
    }

    const { customer_id: _customerId, ...fields } = orderData;
    const rpcPayload = {
      p_customer_name: fields.customer_name,
      p_phone_number: fields.phone_number,
      p_municipality: fields.municipality,
      p_neighborhood: fields.neighborhood,
      p_avenue: fields.avenue,
      p_house_number: fields.house_number ?? "",
      p_delivery_notes: fields.delivery_notes ?? "",
      p_coupon_code: fields.coupon_code ?? "",
      p_discount_amount: fields.discount_amount ?? 0,
      p_total_amount: fields.total_amount,
      p_items: items.map(({ product_id, quantity, size, color }) => ({ product_id, quantity, size, color })),
    };
    
    console.log("[ORDER RPC] Calling create_customer_order with payload:", rpcPayload);
    console.log("[ORDER RPC] Auth user ID check:", orderData.customer_id);
    
    // Verify profile exists before attempting order creation
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, email")
      .eq("id", orderData.customer_id)
      .maybeSingle();
    
    if (profileError) {
      console.error("[ORDER RPC] Profile check failed:", profileError);
      throw new Error("Unable to verify your customer profile. Please try logging out and back in.");
    }
    
    if (!profile) {
      console.error("[ORDER RPC] Profile not found for user ID:", orderData.customer_id);
      throw new Error("Your customer profile was not found. Please try logging out and back in, or contact support.");
    }
    
    console.log("[ORDER RPC] Profile verified:", { id: profile.id, role: profile.role, email: profile.email });
    
    const { data, error } = await supabase.rpc("create_customer_order", rpcPayload);
    
    if (error) {
      console.error("[ORDER RPC] create_customer_order RPC failed:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        fullError: JSON.stringify(error, null, 2)
      });
      
      // Provide user-friendly error messages based on common error codes
      if (error.code === "42501") {
        throw new Error("Permission denied. Your account may not have the necessary permissions to place orders.");
      }
      if (error.message.includes("Authentication is required")) {
        throw new Error("Your session has expired. Please log in again.");
      }
      if (error.message.includes("profile")) {
        throw new Error("There is an issue with your customer profile. Please contact support.");
      }
      throw new Error(error.message || "An unexpected error occurred while placing your order.");
    }
    
    if (!data) {
      console.error("[ORDER RPC] No data returned from create_customer_order");
      throw new Error("The order could not be created.");
    }
    
    console.log("[ORDER RPC] Order created successfully:", data);
    
    const order = data as Omit<Order, "items" | "delivery">;
    return {
      ...order,
      items: items.map((item, index) => ({
        ...item,
        id: `pending-${index}`,
        order_id: order.id,
      })),
    };
  }

  // Local Storage Fallback
  initMockDb();
  const orders = await getOrders();
  
  const orderId = `ord-${Math.floor(1000 + Math.random() * 9000)}`;
  
  const orderItems: OrderItem[] = items.map((item, index) => ({
    id: `item-${orderId}-${index}`,
    order_id: orderId,
    ...item
  }));

  const newOrder: Order = {
    ...orderData,
    id: orderId,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    items: orderItems,
    delivery: {
      id: `del-${orderId}`,
      order_id: orderId,
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  };

  // Adjust stock & log history for mock
  for (const item of items) {
    await adjustInventory(item.product_id, -item.quantity, "sale", `Vente commande #${orderId}`);
  }

  // Save order
  orders.unshift(newOrder);
  localStorage.setItem("dlxstore_orders", JSON.stringify(orders));

  // Trigger admin notification
  await createNotification(
    "usr-admin",
    "Nouvelle Commande Reçue ! 🛒",
    `Nouvelle commande #${orderId} de ${newOrder.customer_name} pour un montant de ${newOrder.total_amount} $.`,
    "new_order"
  );

  return newOrder;
}

export async function recordOrderWhatsAppHandoff(
  orderId: string,
  status: "link_opened" | "unavailable" | "not_configured",
): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.rpc("record_order_whatsapp_handoff", {
      p_order_id: orderId,
      p_status: status,
    });
    if (error) throw new Error(error.message || "An error occurred.");
    return;
  }

  initMockDb();
  const orders = await getOrders();
  const index = orders.findIndex((order) => order.id === orderId);
  if (index === -1) return;
  orders[index] = {
    ...orders[index],
    whatsapp_handoff_status: status,
    whatsapp_handoff_at: new Date().toISOString(),
  };
  localStorage.setItem("dlxstore_orders", JSON.stringify(orders));
}

export async function getOrders(userId?: string): Promise<Order[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase
      .from("orders")
      .select(`
        *,
        order_items (
          *,
          products (
            *
          )
        ),
        deliveries (
          *
        )
      `)
      .order("created_at", { ascending: false });

    if (userId) {
      query = query.eq("customer_id", userId);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message || "An error occurred.");

    return (data || []).map((o: any) => ({
      ...o,
      items: o.order_items.map((i: any) => ({
        ...i,
        product: i.products ? {
          ...i.products,
          images: i.products.product_images ? i.products.product_images.map((img: any) => img.image_url) : []
        } : undefined
      })),
      delivery: o.deliveries ? o.deliveries[0] : undefined
    }));
  }

  // Local Storage Fallback
  initMockDb();
  const raw = localStorage.getItem("dlxstore_orders");
  const orders: Order[] = raw ? JSON.parse(raw) : [];
  
  if (userId) {
    return orders.filter(o => o.customer_id === userId);
  }
  
  return orders;
}

export async function getOrderById(id: string): Promise<Order | null> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("orders")
      .select(`
        *,
        order_items (
          *,
          products (
            *
          )
        ),
        deliveries (
          *
        )
      `)
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }
    if (!data) return null;

    return {
      ...data,
      items: data.order_items.map((i: any) => ({
        ...i,
        product: i.products ? {
          ...i.products,
          images: i.products.product_images ? i.products.product_images.map((img: any) => img.image_url) : []
        } : undefined
      })),
      delivery: data.deliveries ? data.deliveries[0] : undefined
    };
  }

  // Local Storage Fallback
  const orders = await getOrders();
  return orders.find(o => o.id === id) || null;
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<Order> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message || "An error occurred.");

    // Check if live deliveries table needs update
    if (status === "confirmed") {
      await supabase.from("deliveries").upsert({ order_id: id, status: "confirmed" }, { onConflict: "order_id", ignoreDuplicates: true });
    } else {
      await supabase.from("deliveries").update({ status }).eq("order_id", id);
    }

    return data;
  }

  // Local Storage Fallback
  const orders = await getOrders();
  const index = orders.findIndex(o => o.id === id);
  if (index === -1) throw new Error("Order not found");

  orders[index].status = status;
  orders[index].updated_at = new Date().toISOString();

  // Keep delivery status in sync
  if (orders[index].delivery) {
    orders[index].delivery!.status = status;
    orders[index].delivery!.updated_at = new Date().toISOString();
    if (status === "delivered") {
      orders[index].delivery!.delivered_at = new Date().toISOString();
    }
  }

  localStorage.setItem("dlxstore_orders", JSON.stringify(orders));

  // Trigger customer notifications on key transitions
  const customerId = orders[index].customer_id;
  if (customerId) {
    let title = "";
    let message = "";
    
    if (status === "confirmed") {
      title = "Commande Confirmée ! ✔️";
      message = `Votre commande #${id} a été confirmée et est en cours de préparation.`;
    } else if (status === "out_for_delivery") {
      title = "Commande en cours de livraison 🚚";
      const driver = orders[index].delivery?.driver_name || "Notre livreur";
      message = `${driver} est en route pour livrer votre commande #${id}. Veuillez préparer ${orders[index].total_amount} $ en espèces (COD).`;
    } else if (status === "delivered") {
      title = "Commande Livrée ! 🎉";
      message = `Votre commande #${id} a été livrée. Merci d'avoir acheté chez DLXSTORE !`;
    } else if (status === "cancelled") {
      title = "Commande Annulée ❌";
      message = `Votre commande #${id} a été annulée. Contactez le support si vous avez des questions.`;
    }

    if (title && message) {
      await createNotification(customerId, title, message, "order_status");
    }
  }

  return orders[index];
}
