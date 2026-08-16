export const languages = [
  { code: "fr", label: "Français" }, { code: "en", label: "English" }, { code: "sw", label: "Kiswahili" },
  { code: "ln", label: "Lingála" }, { code: "kg", label: "Kikongo" }, { code: "lu", label: "Tshiluba" },
] as const;
export type Language = (typeof languages)[number]["code"];

const messages = {
  fr: { home: "Accueil", shop: "Boutique", partner: "Devenir partenaire", contact: "Contact", language: "Langue", launchTitle: "DLXSTORE arrive bientôt", launchBody: "Le futur marché numérique de la RDC se prépare.", explore: "Découvrir DLXSTORE" },
  en: { home: "Home", shop: "Shop", partner: "Become a partner", contact: "Contact", language: "Language", launchTitle: "DLXSTORE is coming soon", launchBody: "The DRC's digital marketplace is getting ready.", explore: "Explore DLXSTORE" },
  sw: { home: "Mwanzo", shop: "Duka", partner: "Kuwa mshirika", contact: "Mawasiliano", language: "Lugha", launchTitle: "DLXSTORE inakuja hivi karibuni", launchBody: "Soko la kidijitali la DRC linaandaliwa.", explore: "Gundua DLXSTORE" },
  ln: { home: "Ebandeli", shop: "Zando", partner: "Koma mosangani", contact: "Bokutani", language: "Lokota", launchTitle: "DLXSTORE ekoya mosika te", launchBody: "Zando ya nimero ya RDC ezali kobongisama.", explore: "Tala DLXSTORE" },
  kg: { home: "Luyantiku", shop: "Zandu", partner: "Kuma ndongani", contact: "Kusolola", language: "Ndinga", launchTitle: "DLXSTORE ke kwiza ntama ve", launchBody: "Zandu ya numérique ya RDC ke kubongama.", explore: "Tala DLXSTORE" },
  lu: { home: "Ku ntuadijilu", shop: "Musalà", partner: "Kuma muntu wa mudimu", contact: "Kusangisha", language: "Muakulu", launchTitle: "DLXSTORE udi upingana", launchBody: "Musalà wa dijital wa RDC udi ubongesha.", explore: "Tala DLXSTORE" },
} as const;
export function translate(language: Language) { return messages[language]; }
