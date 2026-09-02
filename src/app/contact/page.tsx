"use client";

import { useEffect, useState } from "react";
import { Mail, Phone, MessageSquare } from "lucide-react";
import { StoreSettings } from "../../types";
import { defaultStoreSettings } from "../../lib/store-config";
import { getStoreSettings } from "../../services/db/settings";
import { useLanguage } from "../../context/LanguageContext";

export default function ContactPage() {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<StoreSettings>(defaultStoreSettings);
  useEffect(() => { getStoreSettings().then(setSettings).catch(console.error); }, []);
  const contacts = Object.entries(settings.contacts).filter(([, value]) => value?.phone || value?.email || value?.whatsapp);
  return <section className="mx-auto max-w-3xl py-12"><h1 className="text-4xl font-bold tracking-tight">{t.contactTitle}</h1><p className="mt-3 max-w-xl text-muted-foreground">{t.contactSubtitle}</p>{contacts.length === 0 ? <div className="mt-10 rounded-2xl border border-border bg-card p-6"><MessageSquare className="h-6 w-6 text-primary" /><h2 className="mt-4 text-xl font-semibold">{t.contactChannelsConfigTitle}</h2><p className="mt-2 text-sm text-muted-foreground">{t.contactChannelsConfigBody}</p></div> : <div className="mt-10 grid gap-4 sm:grid-cols-2">{contacts.map(([role, value]) => <article key={role} className="rounded-2xl border border-border bg-card p-5"><h2 className="font-semibold capitalize">{role}</h2>{value?.phone && <p className="mt-3 flex items-center gap-2 text-sm"><Phone className="h-4 w-4" />{value.phone}</p>}{value?.email && <a href={`mailto:${value.email}`} className="mt-3 flex items-center gap-2 text-sm underline"><Mail className="h-4 w-4" />{value.email}</a>}{value?.whatsapp && <a href={`https://wa.me/${value.whatsapp.replace(/\D/g, "")}`} className="mt-3 flex items-center gap-2 text-sm underline"><MessageSquare className="h-4 w-4" />{t.whatsapp}</a>}</article>)}</div>}</section>;
}
