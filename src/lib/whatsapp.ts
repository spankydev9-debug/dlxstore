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
