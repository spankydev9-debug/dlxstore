"use client";

import { useEffect, useState } from "react";
import Header from "./Header";
import Footer from "./Footer";
import { ComingSoon } from "./ComingSoon";
import { StoreSettings } from "../../types";
import { defaultStoreSettings, isLaunchOpen } from "../../lib/store-config";
import { getStoreSettings } from "../../services/db/settings";

export function StorefrontShell({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<StoreSettings>(defaultStoreSettings);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { getStoreSettings().then(setSettings).catch(console.error).finally(() => setLoaded(true)); }, []);
  if (loaded && !isLaunchOpen(settings)) return <ComingSoon settings={settings} />;
  return <><Header /><main className="flex-1 w-full mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main><Footer /></>;
}
