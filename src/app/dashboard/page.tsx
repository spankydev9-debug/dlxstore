"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { ProductImage } from "../../components/shared/ProductImage";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { getOrders } from "../../services/db/orders";
import { getWishlist, removeFromWishlist } from "../../services/db/wishlist";
import { getNotifications, markAsRead } from "../../services/db/notifications";
import { updateProfile } from "../../services/auth";
import { getMyRewardsSummary, recordShareEvent } from "../../services/db/rewards";
import { Order, Product, Notification, RewardsSummary } from "../../types";
import { useLanguage } from "../../context/LanguageContext";
import { languages } from "../../lib/i18n";
import { GOMA_MUNICIPALITIES } from "../../lib/mock-data";
import { AvatarEditor } from "../../components/account/AvatarEditor";
import {
  ShoppingBag,
  Heart,
  Bell,
  MapPin,
  Settings,
  LogOut,
  ChevronRight,
  Trash2,
  Lock,
  User,
  Phone,
  UserCircle,
  Gift,
  Share2,
  Copy,
  Check,
  Star,
} from "lucide-react";

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, signOut, isLoading: isAuthLoading, refreshUser } = useAuth();
  const { t, language, setLanguage } = useLanguage();

  const tabParam = searchParams.get("tab") || "orders";
  const [activeTab, setActiveTab] = useState(tabParam);

  // States
  const [orders, setOrders] = useState<Order[]>([]);
  const [wishlist, setWishlist] = useState<Product[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [rewardsError, setRewardsError] = useState("");
  const [sharingStatus, setSharingStatus] = useState<"idle" | "loading" | "success" | "cooldown" | "error">("idle");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Address Form States (Persist to localStorage as convenience)
  const [municipality, setMunicipality] = useState("Goma");
  const [neighborhood, setNeighborhood] = useState("");
  const [avenue, setAvenue] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [isSavedAddress, setIsSavedAddress] = useState(false);

  // Profile Form States
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Sync Tab
  useEffect(() => {
    setActiveTab(tabParam);
  }, [tabParam]);

  // Auth Guard
  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push("/auth?mode=login");
    }
  }, [user, isAuthLoading, router]);

  // Load Tab Data
  useEffect(() => {
    async function loadTabData() {
      if (!user) return;
      setIsLoading(true);
      try {
        if (activeTab === "orders") {
          const ords = await getOrders(user.id);
          setOrders(ords);
        } else if (activeTab === "wishlist") {
          const wish = await getWishlist(user.id);
          setWishlist(wish);
        } else if (activeTab === "notifications") {
          const nots = await getNotifications(user.id);
          setNotifications(nots);
        } else if (activeTab === "addresses") {
          // Load address
          const savedAddr = localStorage.getItem(`dlxstore_address_${user.id}`);
          if (savedAddr) {
            const addr = JSON.parse(savedAddr);
            setMunicipality(addr.municipality || "Goma");
            setNeighborhood(addr.neighborhood || "");
            setAvenue(addr.avenue || "");
            setHouseNumber(addr.houseNumber || "");
            setIsSavedAddress(true);
          } else {
            const list = GOMA_MUNICIPALITIES["Goma"] || [];
            if (list.length > 0) setNeighborhood(list[0]);
          }
        } else if (activeTab === "settings") {
          setFullName(user.full_name);
          setPhone(user.phone || "");
        } else if (activeTab === "rewards") {
          setRewardsLoading(true);
          setRewardsError("");
          try {
            const summary = await getMyRewardsSummary();
            setRewards(summary);
          } catch (err) {
            console.error("Error loading rewards:", err);
            setRewardsError(t.rewardsError);
          } finally {
            setRewardsLoading(false);
          }
        }
      } catch (err) {
        console.error("Error loading tab data:", err);
      } finally {
        setIsLoading(false);
      }
    }

    if (user) {
      loadTabData();
    }
  }, [activeTab, user]);

  // Handle default neighborhood sync
  useEffect(() => {
    if (activeTab === "addresses" && !isSavedAddress) {
      const list = GOMA_MUNICIPALITIES[municipality] || [];
      if (list.length > 0) {
        setNeighborhood(list[0]);
      }
    }
  }, [municipality, activeTab, isSavedAddress]);

  const handleSaveAddress = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    const addr = { municipality, neighborhood, avenue, houseNumber };
    localStorage.setItem(`dlxstore_address_${user.id}`, JSON.stringify(addr));
    setIsSavedAddress(true);
    alert(t.addressSaved);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSavingProfile(true);
    try {
      await updateProfile(user.id, { full_name: fullName, phone });
      await refreshUser();
      alert(t.profileUpdated);
    } catch (err) {
      console.error(err);
      alert(t.profileUpdateError);
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleRemoveWishlist = async (productId: string) => {
    if (!user) return;
    try {
      await removeFromWishlist(user.id, productId);
      setWishlist(prev => prev.filter(p => p.id !== productId));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkNotificationRead = async (id: string) => {
    try {
      await markAsRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (err) {
      console.error(err);
    }
  };

  if (isAuthLoading || !user) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">{t.authenticating}</p>
      </div>
    );
  }

  // Nav Items
  const navItems = [
    { key: "orders", label: t.myOrders, icon: ShoppingBag },
    { key: "wishlist", label: t.wishlist, icon: Heart },
    { key: "notifications", label: t.notifications, icon: Bell },
    { key: "addresses", label: t.savedAddresses, icon: MapPin },
    { key: "avatar", label: t.avatarSettings, icon: UserCircle },
    { key: "rewards", label: t.rewardsTab, icon: Gift },
    { key: "language", label: t.languageSettings, icon: Settings },
    { key: "settings", label: t.profileSettings, icon: User },
  ];

  return (
    <div className="space-y-8 animate-fade-in pb-16">
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-border/40 pb-5 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{t.myAccount}</h1>
          <p className="text-sm text-muted-foreground">{t.accountIntro}</p>
        </div>
        <button
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-destructive/20 bg-destructive/5 px-4 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-all"
        >
          <LogOut className="h-4 w-4" />
          {t.signOut}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
        
        {/* Navigation Sidebar */}
        <nav className="flex flex-col rounded-2xl border border-border/60 bg-card p-2 shadow-sm h-fit">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => {
                  setActiveTab(item.key);
                  router.push(`/dashboard?tab=${item.key}`);
                }}
                className={`flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition-all ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon className="h-4.5 w-4.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Tab Contents */}
        <div className="lg:col-span-3">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm min-h-[400px]">
              
              {/* ORDERS TAB */}
              {activeTab === "orders" && (
                <div className="space-y-6">
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">{t.orderTrackingTab}</h3>
                  {orders.length === 0 ? (
                    <div className="text-center py-12 space-y-4">
                      <p className="text-xs sm:text-sm text-muted-foreground">{t.noOrdersYet}</p>
                      <Link href="/shop" className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition-all">{t.visitShop}</Link>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {orders.map((order) => (
                        <div key={order.id} className="rounded-xl border border-border/80 p-4 space-y-3 hover:border-foreground/40 transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/30 pb-2 text-xs sm:text-sm font-semibold">
                            <div>
                              {t.orderLabel} <span className="text-primary">#{order.id}</span>
                            </div>
                            <div className="text-muted-foreground">
                              {new Date(order.created_at).toLocaleDateString()}
                            </div>
                          </div>

                          <div className="flex justify-between items-center text-xs">
                            <div className="space-y-1">
                              <p className="text-muted-foreground">{t.orderStatus} :
                                <span className={`ml-1 font-bold ${order.status === 'delivered' ? 'text-emerald-600' : order.status === 'cancelled' ? 'text-destructive' : 'text-primary'}`}>
                                  {order.status === 'pending' && t.pending}
                                  {order.status === 'confirmed' && t.confirmed}
                                  {order.status === 'preparing' && t.preparing}
                                  {order.status === 'ready' && t.ready}
                                  {order.status === 'out_for_delivery' && t.outForDelivery}
                                  {order.status === 'delivered' && t.delivered}
                                  {order.status === 'cancelled' && t.cancelled}
                                </span>
                              </p>
                              <p className="text-muted-foreground">{t.total} : <span className="font-bold text-foreground">{order.total_amount} $ (COD)</span></p>
                            </div>
                            <Link
                              href={`/order-tracking?orderId=${order.id}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                            >
                              {t.trackOrder}
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* WISHLIST TAB */}
              {activeTab === "wishlist" && (
                <div className="space-y-6">
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">{t.wishlist}</h3>
                  {wishlist.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic text-center py-12">{t.wishlistEmpty}</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                      {wishlist.map((p) => {
                        const finalPrice = p.discount_price ?? p.price;
                        return (
                          <div key={p.id} className="group relative flex flex-col rounded-xl border border-border overflow-hidden bg-card transition-all hover:shadow-sm">
                            <div className="relative aspect-square overflow-hidden bg-muted">
                              <ProductImage
                                src={p.images[0]} 
                                alt={p.name} 
                                fill 
                                sizes="(max-width: 768px) 100vw, 50vw"
                                className="object-cover transition-transform duration-300 group-hover:scale-105" 
                              />
                              <button
                                onClick={() => handleRemoveWishlist(p.id)}
                                className="absolute top-2 right-2 rounded-full bg-white p-2 text-destructive shadow-sm hover:bg-red-50 transition-colors border border-border"
                                title={t.removeFromWishlist}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="p-4 space-y-1">
                              <span className="text-[9px] font-bold text-muted-foreground uppercase">{p.brand}</span>
                              <h4 className="font-bold text-xs line-clamp-1 hover:underline">
                                <Link href={`/product/${p.slug}`}>{p.name}</Link>
                              </h4>
                              <p className="text-xs font-extrabold">{finalPrice} $</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* NOTIFICATIONS TAB */}
              {activeTab === "notifications" && (
                <div className="space-y-6">
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">{t.orderNotifications}</h3>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic text-center py-12">{t.noNotifications}</p>
                  ) : (
                    <div className="divide-y divide-border/40">
                      {notifications.map((n) => (
                        <div 
                          key={n.id} 
                          className={`py-4 first:pt-0 flex flex-col gap-1 cursor-pointer transition-colors ${n.is_read ? 'opacity-70' : 'bg-muted/10 border-l-2 border-primary pl-3'}`}
                          onClick={() => handleMarkNotificationRead(n.id)}
                        >
                          <div className="flex justify-between items-center text-xs font-bold">
                            <span className="text-foreground">{n.title}</span>
                            <span className="text-[9px] text-muted-foreground font-medium">{new Date(n.created_at).toLocaleDateString()}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{n.message}</p>
                          {!n.is_read && (
                            <span className="text-[9px] font-bold text-primary pt-0.5">{t.markRead}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* AVATAR TAB */}
              {activeTab === "avatar" && (
                <div className="space-y-4">
                  <AvatarEditor />
                </div>
              )}

              {/* DLX REWARDS TAB */}
              {activeTab === "rewards" && (
                <div className="space-y-6">
                  {/* Header */}
                  <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-amber-500/5 p-5">
                    <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-amber-500/60 to-transparent" />
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                        <Star className="h-5 w-5 text-amber-500" />
                      </div>
                      <div>
                        <h3 className="font-extrabold text-foreground">{t.rewardsTitle}</h3>
                        <p className="text-xs text-muted-foreground">{t.rewardsIntro}</p>
                      </div>
                    </div>
                  </div>

                  {rewardsLoading && (
                    <div className="flex h-40 items-center justify-center">
                      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                    </div>
                  )}

                  {rewardsError && !rewardsLoading && (
                    <p className="rounded-xl bg-destructive/10 px-4 py-3 text-xs text-destructive font-semibold">
                      {rewardsError}
                    </p>
                  )}

                  {rewards && !rewardsLoading && (
                    <>
                      {/* Progress cards */}
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {/* Purchase progress */}
                        <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <ShoppingBag className="h-3.5 w-3.5" />
                              {t.rewardsPurchaseProgress}
                            </p>
                          </div>
                          {rewards.next_purchase_milestone ? (
                            <>
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs font-semibold">
                                  <span className="text-foreground">
                                    {rewards.qualifying_order_count} / {rewards.next_purchase_milestone.threshold} {t.rewardsOrdersUnit}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {Math.round((rewards.qualifying_order_count / rewards.next_purchase_milestone.threshold) * 100)}%
                                  </span>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-primary to-amber-500 transition-all duration-700"
                                    style={{ width: `${Math.min(100, Math.round((rewards.qualifying_order_count / rewards.next_purchase_milestone.threshold) * 100))}%` }}
                                  />
                                </div>
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                {t.rewardsNextReward}: <span className="font-bold text-foreground">{rewards.next_purchase_milestone.label}</span>
                              </p>
                            </>
                          ) : (
                            <p className="text-xs font-semibold text-emerald-600">{t.rewardsNoMilestone}</p>
                          )}
                        </div>

                        {/* Share progress */}
                        <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                              <Share2 className="h-3.5 w-3.5" />
                              {t.rewardsShareProgress}
                            </p>
                          </div>
                          {rewards.next_share_milestone ? (
                            <>
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs font-semibold">
                                  <span className="text-foreground">
                                    {rewards.share_count} / {rewards.next_share_milestone.threshold} {t.rewardsSharesUnit}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {Math.round((rewards.share_count / rewards.next_share_milestone.threshold) * 100)}%
                                  </span>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all duration-700"
                                    style={{ width: `${Math.min(100, Math.round((rewards.share_count / rewards.next_share_milestone.threshold) * 100))}%` }}
                                  />
                                </div>
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                {t.rewardsNextReward}: <span className="font-bold text-foreground">{rewards.next_share_milestone.label}</span>
                              </p>
                            </>
                          ) : (
                            <p className="text-xs font-semibold text-emerald-600">{t.rewardsNoMilestone}</p>
                          )}
                        </div>
                      </div>

                      {/* Share DLXSTORE button */}
                      <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
                        <div>
                          <h4 className="font-bold text-sm text-foreground">{t.rewardsShareTitle}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5">{t.rewardsShareBody}</p>
                        </div>
                        {sharingStatus === "success" && (
                          <p className="flex items-center gap-2 text-xs font-semibold text-emerald-600">
                            <Check className="h-4 w-4" />{t.rewardsShareSuccess}
                          </p>
                        )}
                        {sharingStatus === "cooldown" && (
                          <p className="text-xs font-semibold text-amber-600">{t.rewardsShareCooldown}</p>
                        )}
                        {sharingStatus === "error" && (
                          <p className="text-xs font-semibold text-destructive">{t.rewardsShareError}</p>
                        )}
                        <button
                          disabled={sharingStatus === "loading" || sharingStatus === "success" || sharingStatus === "cooldown"}
                          onClick={async () => {
                            setSharingStatus("loading");
                            try {
                              // Try native Web Share API first for realistic share UX
                              const channel = typeof navigator !== "undefined" && "share" in navigator
                                ? "native_share" as const
                                : "copy_link" as const;
                              if (channel === "native_share") {
                                await navigator.share({ title: t.rewardsShareWebTitle, text: t.rewardsShareWebText, url: window.location.origin });
                              } else {
                                await navigator.clipboard.writeText(window.location.origin);
                              }
                              const result = await recordShareEvent(channel);
                              setSharingStatus(result.recorded ? (result.awarded ? "success" : "success") : "cooldown");
                              if (result.recorded) {
                                const updated = await getMyRewardsSummary();
                                setRewards(updated);
                              }
                            } catch {
                              setSharingStatus("error");
                            }
                          }}
                          className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-xs font-bold text-white hover:bg-amber-500/90 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Share2 className="h-4 w-4" />
                          {sharingStatus === "loading" ? t.loading : t.rewardsShareButton}
                        </button>
                      </div>

                      {/* Coupons */}
                      <div className="space-y-3">
                        <h4 className="font-bold text-sm text-foreground border-b border-border/40 pb-2">
                          {t.rewardsCoupons}
                        </h4>
                        {rewards.rewards.length === 0 ? (
                          <div className="flex flex-col items-center py-10 gap-2 text-center">
                            <Gift className="h-8 w-8 text-muted-foreground/40" />
                            <p className="text-xs text-muted-foreground">{t.rewardsNoCoupons}</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {rewards.rewards.map((reward) => {
                              const isActive = reward.status === "awarded";
                              const isExpired = reward.status === "expired" ||
                                (reward.expires_at && new Date(reward.expires_at) < new Date());
                              return (
                                <div
                                  key={reward.id}
                                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-4 transition-all ${
                                    isActive && !isExpired
                                      ? "border-amber-500/30 bg-amber-500/5"
                                      : "border-border/60 bg-card opacity-60"
                                  }`}
                                >
                                  <div className="space-y-0.5">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                      {t.rewardsMilestoneLabel}: {reward.milestone_label}
                                    </p>
                                    <div className="flex items-center gap-2">
                                      <code className="rounded bg-muted px-2 py-1 font-mono text-sm font-bold text-foreground">
                                        {reward.coupon_code}
                                      </code>
                                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                                        isExpired ? "bg-muted text-muted-foreground" :
                                        reward.status === "used" ? "bg-muted text-muted-foreground" :
                                        "bg-amber-500/10 text-amber-600"
                                      }`}>
                                        {isExpired ? t.rewardsCouponExpired :
                                         reward.status === "used" ? t.rewardsCouponUsed :
                                         t.rewardsCouponActive}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                      {reward.coupon_type === "percentage"
                                        ? t.rewardsDiscountPercent.replace("{n}", String(reward.coupon_value))
                                        : t.rewardsDiscountFixed.replace("{n}", String(reward.coupon_value))}
                                      {reward.expires_at && !isExpired && (
                                        <> · {t.rewardsCouponExpires} {new Date(reward.expires_at).toLocaleDateString()}</>
                                      )}
                                    </p>
                                  </div>
                                  {isActive && !isExpired && (
                                    <button
                                      onClick={() => {
                                        void navigator.clipboard.writeText(reward.coupon_code);
                                        setCopiedCode(reward.coupon_code);
                                        setTimeout(() => setCopiedCode(null), 2000);
                                      }}
                                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted transition-all shrink-0"
                                    >
                                      {copiedCode === reward.coupon_code
                                        ? <><Check className="h-3.5 w-3.5 text-emerald-600" />{t.rewardsCouponCopied}</>
                                        : <><Copy className="h-3.5 w-3.5" />{t.rewardsCouponCopy}</>
                                      }
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}


              {/* SAVED ADDRESSES TAB */}
              {activeTab === "addresses" && (
                <div className="space-y-6">
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">{t.defaultAddress}</h3>
                  <form onSubmit={handleSaveAddress} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.municipality}</label>
                        <select
                          value={municipality}
                          onChange={(e) => {
                            setMunicipality(e.target.value);
                            setIsSavedAddress(false);
                          }}
                          className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                        >
                          <option value="Goma">Goma</option>
                          <option value="Karisimbi">Karisimbi</option>
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.neighborhood}</label>
                        <select
                          value={neighborhood}
                          onChange={(e) => {
                            setNeighborhood(e.target.value);
                            setIsSavedAddress(false);
                          }}
                          className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                        >
                          {(GOMA_MUNICIPALITIES[municipality] || []).map((q) => (
                            <option key={q} value={q}>{q}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2 space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.avenue}</label>
                        <input
                          type="text"
                          required
                          value={avenue}
                          onChange={(e) => {
                            setAvenue(e.target.value);
                            setIsSavedAddress(false);
                          }}
                          placeholder="Avenue du Lac"
                          className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t.houseNumber}</label>
                        <input
                          type="text"
                          value={houseNumber}
                          onChange={(e) => {
                            setHouseNumber(e.target.value);
                            setIsSavedAddress(false);
                          }}
                          placeholder="45"
                          className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      className="inline-flex h-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold px-6 text-xs hover:bg-primary/95 transition-all shadow-sm"
                    >
                      {t.saveAddress}
                    </button>
                  </form>
                </div>
              )}

              {/* SETTINGS TAB */}
              {activeTab === "language" && (
                <div className="space-y-6">
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">{t.languageSettings}</h3>
                  <p className="text-sm text-muted-foreground">{t.changeLanguageHint}</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {languages.map((item) => (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => setLanguage(item.code)}
                        className={`rounded-xl border p-4 text-left text-sm font-semibold transition-all ${language === item.code ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "settings" && (
                <div className="space-y-6">
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">{t.personalInfo}</h3>
                  <form onSubmit={handleUpdateProfile} className="space-y-4">
                    
                    {/* Name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <User className="h-4 w-4" />
                        {t.fullName}
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Ex. Jean-Paul Kabulo"
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                      />
                    </div>

                    {/* Email (Read-Only) */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Lock className="h-4 w-4" />
                        {t.emailReadonly}
                      </label>
                      <input
                        type="email"
                        disabled
                        value={user.email}
                        className="w-full h-10 rounded-lg border border-border bg-muted px-3 text-sm outline-none cursor-not-allowed opacity-70"
                      />
                    </div>

                    {/* Phone */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <Phone className="h-4 w-4" />
                        {t.whatsappPhone}
                      </label>
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Ex. +243 990 123 456"
                        className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={isSavingProfile}
                      className="inline-flex h-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold px-6 text-xs hover:bg-primary/95 transition-all shadow-sm disabled:opacity-50"
                    >
                      {isSavingProfile ? t.saving : t.updateProfile}
                    </button>
                  </form>
                </div>
              )}

            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export default function CustomerDashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">Chargement de votre compte...</p>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
