"use client";

import { useEffect, useState } from "react";
import Header from "./Header";
import Footer from "./Footer";
import { ComingSoon } from "./ComingSoon";
import { StoreSettings } from "../../types";
import { defaultStoreSettings, isLaunchOpen } from "../../lib/store-config";
import { getStoreSettings } from "../../services/db/settings";
import { isDemoMode, isSupabaseConfigured } from "../../services/db";
import { LanguagePrompt } from "./LanguagePrompt";

export function StorefrontShell({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<StoreSettings>(defaultStoreSettings);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { getStoreSettings().then(setSettings).catch(console.error).finally(() => setLoaded(true)); }, []);
  if (!isSupabaseConfigured && !isDemoMode) return <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 text-center"><p className="text-xs font-semibold tracking-[.2em] text-primary">DLXSTORE</p><h1 className="mt-4 text-3xl font-bold">Store configuration is required</h1><p className="mt-3 text-sm text-muted-foreground">The production data connection has not been configured yet. Please return once DLXSTORE is online.</p></main>;
  if (loaded && !isLaunchOpen(settings)) return <ComingSoon settings={settings} />;
  return <><LanguagePrompt /><Header /><main className="flex-1 w-full mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main><Footer /></>;
}
