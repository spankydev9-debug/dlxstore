"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../context/AuthContext";
import { getOrders } from "../../services/db/orders";
import { getWishlist, removeFromWishlist } from "../../services/db/wishlist";
import { getNotifications, markAsRead } from "../../services/db/notifications";
import { updateProfile } from "../../services/auth";
import { Order, Product, Notification } from "../../types";
import { GOMA_MUNICIPALITIES } from "../../lib/mock-data";
import { 
  ShoppingBag, 
  Heart, 
  Bell, 
  MapPin, 
  Settings, 
  LogOut, 
  ChevronRight, 
  ExternalLink,
  Trash2,
  Lock,
  User,
  Phone
} from "lucide-react";

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, signOut, isLoading: isAuthLoading } = useAuth();

  const tabParam = searchParams.get("tab") || "orders";
  const [activeTab, setActiveTab] = useState(tabParam);

  // States
  const [orders, setOrders] = useState<Order[]>([]);
  const [wishlist, setWishlist] = useState<Product[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
    alert("Adresse enregistrée avec succès !");
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSavingProfile(true);
    try {
      await updateProfile(user.id, { full_name: fullName, phone });
      alert("Profil mis à jour !");
    } catch (err) {
      console.error(err);
      alert("Erreur lors de la mise à jour.");
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
        <p className="text-sm text-muted-foreground">Authentification en cours...</p>
      </div>
    );
  }

  // Nav Items
  const navItems = [
    { key: "orders", label: "Mes commandes", icon: ShoppingBag },
    { key: "wishlist", label: "Favoris", icon: Heart },
    { key: "notifications", label: "Notifications", icon: Bell },
    { key: "addresses", label: "Adresses sauvées", icon: MapPin },
    { key: "settings", label: "Paramètres profil", icon: Settings }
  ];

  return (
    <div className="space-y-8 animate-fade-in pb-16">
      {/* Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-border/40 pb-5 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Mon Compte</h1>
          <p className="text-sm text-muted-foreground">Gérez vos commandes, favoris et vos adresses de livraison à Goma.</p>
        </div>
        <button
          onClick={async () => {
            await signOut();
            router.push("/");
          }}
          className="inline-flex items-center gap-1.5 rounded-full border border-destructive/20 bg-destructive/5 px-4 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-all"
        >
          <LogOut className="h-4 w-4" />
          Se déconnecter
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
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">Suivi des commandes</h3>
                  {orders.length === 0 ? (
                    <div className="text-center py-12 space-y-4">
                      <p className="text-xs sm:text-sm text-muted-foreground">Vous n'avez pas encore passé de commande.</p>
                      <Link href="/shop" className="inline-flex h-9 items-center justify-center rounded-full bg-primary px-5 text-xs font-semibold text-primary-foreground hover:bg-primary/95 transition-all">
                        Visiter la boutique
                      </Link>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {orders.map((order) => (
                        <div key={order.id} className="rounded-xl border border-border/80 p-4 space-y-3 hover:border-foreground/40 transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/30 pb-2 text-xs sm:text-sm font-semibold">
                            <div>
                              Commande <span className="text-primary">#{order.id}</span>
                            </div>
                            <div className="text-muted-foreground">
                              {new Date(order.created_at).toLocaleDateString()}
                            </div>
                          </div>

                          <div className="flex justify-between items-center text-xs">
                            <div className="space-y-1">
                              <p className="text-muted-foreground">Statut : 
                                <span className={`ml-1 font-bold ${order.status === 'delivered' ? 'text-emerald-600' : order.status === 'cancelled' ? 'text-destructive' : 'text-primary'}`}>
                                  {order.status === 'pending' && 'En attente'}
                                  {order.status === 'confirmed' && 'Confirmée'}
                                  {order.status === 'preparing' && 'En préparation'}
                                  {order.status === 'ready' && 'Prête'}
                                  {order.status === 'out_for_delivery' && 'En livraison'}
                                  {order.status === 'delivered' && 'Livrée'}
                                  {order.status === 'cancelled' && 'Annulée'}
                                </span>
                              </p>
                              <p className="text-muted-foreground">Total : <span className="font-bold text-foreground">{order.total_amount} $ (COD)</span></p>
                            </div>
                            <Link
                              href={`/order-tracking?orderId=${order.id}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline"
                            >
                              Suivre
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
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">Articles Favoris</h3>
                  {wishlist.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic text-center py-12">Aucun article enregistré pour le moment.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                      {wishlist.map((p) => {
                        const finalPrice = p.discount_price ?? p.price;
                        return (
                          <div key={p.id} className="group relative flex flex-col rounded-xl border border-border overflow-hidden bg-card transition-all hover:shadow-sm">
                            <div className="relative aspect-square overflow-hidden bg-muted">
                              <Image 
                                src={p.images[0]} 
                                alt={p.name} 
                                fill 
                                sizes="(max-width: 768px) 100vw, 50vw"
                                className="object-cover transition-transform duration-300 group-hover:scale-105" 
                              />
                              <button
                                onClick={() => handleRemoveWishlist(p.id)}
                                className="absolute top-2 right-2 rounded-full bg-white p-2 text-destructive shadow-sm hover:bg-red-50 transition-colors border border-border"
                                title="Retirer des favoris"
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
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">Notifications de commande</h3>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic text-center py-12">Aucune notification disponible.</p>
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
                            <span className="text-[9px] font-bold text-primary pt-0.5">Marquer comme lu</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SAVED ADDRESSES TAB */}
              {activeTab === "addresses" && (
                <div className="space-y-6">
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">Adresse de livraison par défaut</h3>
                  <form onSubmit={handleSaveAddress} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Commune</label>
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
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Quartier</label>
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
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Avenue</label>
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
                        <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">N° Maison</label>
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
                      Enregistrer l'adresse
                    </button>
                  </form>
                </div>
              )}

              {/* SETTINGS TAB */}
              {activeTab === "settings" && (
                <div className="space-y-6">
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">Informations personnelles</h3>
                  <form onSubmit={handleUpdateProfile} className="space-y-4">
                    
                    {/* Name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <User className="h-4 w-4" />
                        Nom Complet
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
                        Adresse Email (Non modifiable)
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
                        Téléphone WhatsApp
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
                      {isSavingProfile ? "Sauvegarde..." : "Mettre à jour le profil"}
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
