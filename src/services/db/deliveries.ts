import { Delivery, Order, OrderStatus } from "../../types";
import { supabase, isSupabaseConfigured } from "./index";
import { updateOrderStatus, getOrders } from "./orders";
import { createNotification } from "./notifications";

export async function getDeliveries(driverId?: string): Promise<Delivery[]> {
  if (isSupabaseConfigured && supabase) {
    let query = supabase
      .from("deliveries")
      .select(`
        *,
        orders (
          customer_name,
          phone_number,
          municipality,
          neighborhood,
          avenue,
          house_number,
          total_amount
        ),
        driver:profiles(full_name)
      `)
      .order("created_at", { ascending: false });

    if (driverId) {
      query = query.eq("driver_id", driverId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((d: Record<string, unknown> & { driver?: { full_name?: string } }) => ({
      ...(d as unknown as Delivery),
      driver_name: d.driver ? d.driver.full_name : undefined,
    }));
  }

  // Local Storage Fallback: Pull deliveries from orders array
  const orders = await getOrders();
  const deliveries: Delivery[] = [];

  for (const order of orders) {
    if (order.delivery) {
      const del = {
        ...order.delivery,
        // copy details for easy display
        customer_name: order.customer_name,
        phone_number: order.phone_number,
        municipality: order.municipality,
        neighborhood: order.neighborhood,
        avenue: order.avenue,
        house_number: order.house_number,
        total_amount: order.total_amount,
      };

      if (!driverId || order.delivery.driver_id === driverId) {
        deliveries.push(del as Delivery);
      }
    }
  }

  return deliveries;
}

export async function assignDriver(orderId: string, driverId: string, driverName: string): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from("deliveries")
      .update({
        driver_id: driverId,
        assigned_at: new Date().toISOString(),
        status: "confirmed",
      })
      .eq("order_id", orderId);

    if (error) throw error;
    return;
  }

  // Local Storage Fallback
  const orders = await getOrders();
  const index = orders.findIndex((o: Order) => o.id === orderId);
  if (index !== -1) {
    if (!orders[index].delivery) {
      orders[index].delivery = {
        id: `del-${orderId}`,
        order_id: orderId,
        status: "confirmed",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }
    orders[index].delivery!.driver_id = driverId;
    orders[index].delivery!.driver_name = driverName;
    orders[index].delivery!.assigned_at = new Date().toISOString();
    orders[index].delivery!.status = "confirmed";
    orders[index].status = "confirmed";
    orders[index].updated_at = new Date().toISOString();

    localStorage.setItem("dlxstore_orders", JSON.stringify(orders));

    // Notify customer about driver assignment
    if (orders[index].customer_id) {
      await createNotification(
        orders[index].customer_id as string,
        "Livreur assigné ! 🚚",
        `Votre commande #${orderId} sera livrée par ${driverName}.`,
        "order_status"
      );
    }
  }
}

export async function updateDeliveryStatus(orderId: string, status: string): Promise<void> {
  // Syncs through updateOrderStatus
  await updateOrderStatus(orderId, status as OrderStatus);
}
