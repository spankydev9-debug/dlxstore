import React from "react";
import Link from "next/link";
import { Truck, ShieldCheck, MapPin, MessageSquare } from "lucide-react";
import { DownloadApp } from "./DownloadApp";
import { useLanguage } from "../../context/LanguageContext";

export default function Footer() {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="w-full border-t border-border/40 bg-card mt-auto pb-safe-area-inset-bottom">
      {/* Citywide Promises grid */}
      <div className="border-b border-border/40 py-8 px-4 sm:px-6 lg:px-8 mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-start gap-4">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <Truck className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground text-sm sm:text-base">{t.footerFreeDelivery}</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {t.footerFreeDeliveryDesc}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground text-sm sm:text-base">{t.footerPaymentOnDelivery}</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {t.footerPaymentOnDeliveryDesc}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div>
              <h4 className="font-semibold text-foreground text-sm sm:text-base">{t.footerWhatsAppSupport}</h4>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {t.footerWhatsAppSupportDesc}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Footer Links */}
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
        
        {/* Brand */}
        <div className="space-y-4">
          <Link href="/" className="text-xl font-bold tracking-widest text-foreground uppercase">
            DLX<span className="text-primary font-light">STORE</span>
          </Link>
          <p className="text-xs sm:text-sm text-muted-foreground">
            {t.footerBrandDesc}
          </p>
          <div className="flex items-center gap-3 text-xs sm:text-sm text-muted-foreground">
            <MapPin className="h-4.5 w-4.5 text-primary" />
            <span>{t.footerLocation}</span>
          </div>
        </div>

        {/* Categories */}
        <div>
          <h4 className="font-semibold text-foreground text-sm mb-4">{t.footerCategories}</h4>
          <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
            <li><Link href="/shop?category=electronique" className="hover:text-foreground transition-colors">{t.footerElectronics}</Link></li>
            <li><Link href="/shop?category=mode-vetements" className="hover:text-foreground transition-colors">{t.footerFashion}</Link></li>
            <li><Link href="/shop?category=maison-energie" className="hover:text-foreground transition-colors">{t.footerHomeEnergy}</Link></li>
          </ul>
        </div>

        {/* Links */}
        <div>
          <h4 className="font-semibold text-foreground text-sm mb-4">{t.footerUsefulLinks}</h4>
          <ul className="space-y-2 text-xs sm:text-sm text-muted-foreground">
            <li><Link href="/shop" className="hover:text-foreground transition-colors">{t.footerAllProducts}</Link></li>
            <li><Link href="/about" className="hover:text-foreground transition-colors">{t.footerAboutUs}</Link></li>
            <li><Link href="/contact" className="hover:text-foreground transition-colors">{t.footerContactUs}</Link></li>
            <li><Link href="/dashboard" className="hover:text-foreground transition-colors">{t.footerMyAccount}</Link></li>
          </ul>
        </div>

        {/* Contact info */}
        <div>
          <h4 className="font-semibold text-foreground text-sm mb-4">{t.footerContact}</h4>
          <ul className="space-y-3 text-xs sm:text-sm text-muted-foreground">
            <li className="pt-2">
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-xs font-semibold text-white transition-colors"
              >
                {t.footerViewOfficialChannels}
              </Link>
            </li>
          </ul>
        </div>
      </div>

      {/* Download DLXSTORE (PWA install helper) */}
      <div className="border-t border-border/40 py-10 px-4 sm:px-6 lg:px-8 mx-auto max-w-7xl flex flex-col items-center gap-4 text-center">
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-foreground">{t.footerInstallTitle}</p>
          <p className="text-xs text-muted-foreground">{t.footerInstallDesc}</p>
        </div>
        <DownloadApp />
      </div>

      {/* Copyright */}
      <div className="border-t border-border/40 py-6 px-4 sm:px-6 lg:px-8 mx-auto max-w-7xl flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground gap-4">
        <div>
          © {currentYear} DLXSTORE. {t.footerCopyright}
        </div>
        <div className="flex gap-4">
          <span>{t.footerCityDelivery}</span>
        </div>
      </div>
    </footer>
  );
}
