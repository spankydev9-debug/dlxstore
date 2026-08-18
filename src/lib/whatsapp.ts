import { StoreSettings } from "../types";

export function formatWhatsAppNumber(number: string): string {
  return number.replace(/\D/g, "");
}

export function buildWhatsAppUrl(number: string, message: string): string | null {
  const digits = formatWhatsAppNumber(number);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Resolves the centralized DLX WhatsApp number from admin store settings. */
export function getWhatsAppBuyNumber(settings: StoreSettings): string | null {
  const candidates = [
    settings.whatsapp_buy_number,
    settings.contacts.orders?.whatsapp,
    settings.contacts.general?.whatsapp,
    settings.whatsapp_enabled ? settings.contact_phone : undefined,
  ];

  for (const candidate of candidates) {
    if (candidate && formatWhatsAppNumber(candidate)) return candidate;
  }
  return null;
}

export function buildProductWhatsAppMessage(
  productName: string,
  options: { size?: string; color?: string; quantity: number; price: number }
): string {
  const lines = [
    "Bonjour DLXSTORE, je souhaite commander l'article suivant :",
    "",
    `• Produit : ${productName}`,
  ];
  if (options.size) lines.push(`• Taille : ${options.size}`);
  if (options.color) lines.push(`• Couleur : ${options.color}`);
  lines.push(
    `• Quantité : ${options.quantity}`,
    `• Prix : ${options.price} $`,
    "",
    "Merci de me contacter pour la livraison."
  );
  return lines.join("\n");
}

export function buildOrderOperationalMessage(order: {
  id: string;
  customer_name: string;
  phone_number: string;
  municipality: string;
  neighborhood: string;
  avenue: string;
  house_number?: string;
  delivery_notes?: string;
  total_amount: number;
  status?: string;
  items: Array<{ product?: { name?: string }; quantity: number; price_at_sale: number; size?: string; color?: string }>;
}): string {
  const lines = [
    "🔔 NOUVELLE COMMANDE DLXSTORE",
    "",
    `• Référence : ${order.id}`,
    `• Statut : ${order.status || "pending"}`,
    "",
    "👤 Client",
    `• Nom : ${order.customer_name}`,
    `• Téléphone : ${order.phone_number}`,
    "",
    "📍 Livraison",
    `• Commune : ${order.municipality}`,
    `• Quartier : ${order.neighborhood}`,
    `• Avenue : ${order.avenue}${order.house_number ? `, N° ${order.house_number}` : ""}`,
  ];
  if (order.delivery_notes) lines.push(`• Repère : ${order.delivery_notes}`);
  lines.push("", "🛒 Articles");
  for (const item of order.items) {
    const name = item.product?.name || "Produit";
    const variant = [item.size, item.color].filter(Boolean).join(" / ");
    lines.push(`• ${name}${variant ? ` (${variant})` : ""} × ${item.quantity} — ${item.price_at_sale * item.quantity} $`);
  }
  lines.push("", `💵 Total COD : ${order.total_amount} $`, "", "Merci de traiter cette commande via le portail admin DLXSTORE.");
  return lines.join("\n");
}
