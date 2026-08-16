import { StoreSettings } from "../types";

/** Safe defaults used until an administrator supplies operational information. */
export const defaultStoreSettings: StoreSettings = {
  name: "DLXSTORE",
  tagline: "Your digital mall, built for the DRC.",
  city: "Goma",
  contact_phone: "",
  contact_email: "",
  whatsapp_enabled: false,
  launch: {
    mode: "active",
    starts_at: null,
    timezone: "Africa/Kinshasa",
    announcement: "",
  },
  contacts: {},
  delivery_zones: [
    { country: "CD", province: "Nord-Kivu", city: "Goma", active: true, fee: 0, currency: "USD" },
  ],
};

export function normalizeStoreSettings(value: Partial<StoreSettings> | null | undefined): StoreSettings {
  return {
    ...defaultStoreSettings,
    ...value,
    launch: { ...defaultStoreSettings.launch, ...value?.launch },
    contacts: { ...defaultStoreSettings.contacts, ...value?.contacts },
    delivery_zones: value?.delivery_zones ?? defaultStoreSettings.delivery_zones,
  };
}

export function isLaunchOpen(settings: StoreSettings, now = Date.now()): boolean {
  if (settings.launch.mode === "active") return true;
  if (!settings.launch.starts_at) return false;
  return now >= new Date(settings.launch.starts_at).getTime();
}
