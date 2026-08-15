"use client";

import React, { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../../../context/AuthContext";
import { getProducts, createProduct, updateProduct, deleteProduct, adjustInventory, getInventoryHistory } from "../../../services/db/products";
import { getOrders, updateOrderStatus } from "../../../services/db/orders";
import { getDeliveries, assignDriver } from "../../../services/db/deliveries";
import { getProfiles } from "../../../services/auth";
import { Product, Order, Delivery, Profile, InventoryHistoryEntry, OrderItem, OrderStatus } from "../../../types";
import { 
  BarChart3, 
  ShoppingBag, 
  Users, 
  Package, 
  Truck, 
  AlertTriangle, 
  History, 
  Settings, 
  Plus, 
  Edit2, 
  Trash2, 
  FileSpreadsheet, 
  Printer, 
  ArrowLeft,
  ChevronRight,
  TrendingUp,
  X
} from "lucide-react";

function AdminDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: isAuthLoading } = useAuth();

  const tabParam = searchParams.get("tab") || "analytics";
  const [activeTab, setActiveTab] = useState(tabParam);

  // DB States
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [inventoryHistory, setInventoryHistory] = useState<InventoryHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal / Form States
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
  // Product Form Fields
  const [prodName, setProdName] = useState("");
  const [prodDescription, setProdDescription] = useState("");
  const [prodPrice, setProdPrice] = useState("");
  const [prodDiscountPrice, setProdDiscountPrice] = useState("");
  const [prodBrand, setProdBrand] = useState("");
  const [prodCategory, setProdCategory] = useState("c1111111-1111-1111-1111-111111111111");
  const [prodSizes, setProdSizes] = useState("");
  const [prodColors, setProdColors] = useState("");
  const [prodSku, setProdSku] = useState("");
  const [prodStock, setProdStock] = useState("");
  const [prodImages, setProdImages] = useState("");

  // Inventory Adjustment Fields
  const [selectedAdjustProduct, setSelectedAdjustProduct] = useState("");
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustNotes, setAdjustNotes] = useState("");

  // Invoice view State
  const [activeInvoiceOrder, setActiveInvoiceOrder] = useState<Order | null>(null);

  // Auth Guard: Only Admin allowed
  useEffect(() => {
    if (!isAuthLoading) {
      if (!user) {
        router.push("/auth?mode=login");
      } else if (user.role !== "admin") {
        router.push("/dashboard");
      }
    }
  }, [user, isAuthLoading, router]);

  // Sync Tab
  useEffect(() => {
    setActiveTab(tabParam);
  }, [tabParam]);

  // Load Data
  const loadAllData = async () => {
    setIsLoading(true);
    try {
      const [prods, ords, dels, profs, invHist] = await Promise.all([
        getProducts(),
        getOrders(),
        getDeliveries(),
        getProfiles(),
        getInventoryHistory()
      ]);
      setProducts(prods);
      setOrders(ords);
      setDeliveries(dels);
      setProfiles(profs);
      setInventoryHistory(invHist);
    } catch (err) {
      console.error("Error loading admin data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user && user.role === "admin") {
      loadAllData();
    }
  }, [activeTab, user]);

  const handleOpenProductModal = (prod: Product | null = null) => {
    if (prod) {
      setEditingProduct(prod);
      setProdName(prod.name);
      setProdDescription(prod.description);
      setProdPrice(prod.price.toString());
      setProdDiscountPrice(prod.discount_price?.toString() || "");
      setProdBrand(prod.brand);
      setProdCategory(prod.category_id);
      setProdSizes(prod.sizes.join(", "));
      setProdColors(prod.colors.join(", "));
      setProdSku(prod.sku);
      setProdStock(prod.stock_quantity.toString());
      setProdImages(prod.images.join(", "));
    } else {
      setEditingProduct(null);
      setProdName("");
      setProdDescription("");
      setProdPrice("");
      setProdDiscountPrice("");
      setProdBrand("");
      setProdCategory("c1111111-1111-1111-1111-111111111111");
      setProdSizes("");
      setProdColors("");
      setProdSku(`SKU-${Math.floor(100000 + Math.random() * 900000)}`);
      setProdStock("");
      setProdImages("");
    }
    setIsProductModalOpen(true);
  };

  const handleProductSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pData = {
      name: prodName,
      slug: prodName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
      description: prodDescription,
      price: parseFloat(prodPrice),
      discount_price: prodDiscountPrice ? parseFloat(prodDiscountPrice) : undefined,
      category_id: prodCategory,
      brand: prodBrand,
      sizes: prodSizes ? prodSizes.split(",").map(s => s.trim()) : [],
      colors: prodColors ? prodColors.split(",").map(c => c.trim()) : [],
      sku: prodSku,
      stock_quantity: parseInt(prodStock),
      images: prodImages ? prodImages.split(",").map(img => img.trim()) : ["https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500"],
      rating: editingProduct ? editingProduct.rating : 5,
      is_featured: editingProduct ? editingProduct.is_featured : true,
      is_best_seller: editingProduct ? editingProduct.is_best_seller : false,
      is_new_arrival: editingProduct ? editingProduct.is_new_arrival : true
    };

    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, pData as any);
        alert("Produit mis à jour avec succès !");
      } else {
        await createProduct(pData as any);
        alert("Produit créé avec succès !");
      }
      setIsProductModalOpen(false);
      loadAllData();
    } catch (err) {
      console.error(err);
      alert("Erreur lors de l'enregistrement du produit.");
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm("Voulez-vous vraiment supprimer ce produit ?")) return;
    try {
      await deleteProduct(id);
      loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleInventoryAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdjustProduct || !adjustQty) return;
    try {
      await adjustInventory(
        selectedAdjustProduct,
        parseInt(adjustQty),
        "manual_adjustment",
        adjustNotes || "Ajustement manuel de l'administration"
      );
      setAdjustQty("");
      setAdjustNotes("");
      alert("Inventaire mis à jour !");
      loadAllData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleStatusChange = async (orderId: string, status: OrderStatus) => {
    try {
      await updateOrderStatus(orderId, status);
      loadAllData();
      alert("Statut de la commande mis à jour !");
    } catch (err) {
      console.error(err);
    }
  };

  const handleAssignDriver = async (orderId: string, driverId: string) => {
    const driver = profiles.find(p => p.id === driverId);
    if (!driver) return;
    try {
      await assignDriver(orderId, driverId, driver.full_name);
      loadAllData();
      alert("Livreur assigné avec succès !");
    } catch (err) {
      console.error(err);
    }
  };

  const exportOrdersToCSV = () => {
    if (orders.length === 0) return;
    
    // Header
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ID Commande,Client,Telephone,Commune,Quartier,Avenue,Total ($),Statut,Date\n";
    
    // Rows
    orders.forEach((o) => {
      const row = [
        o.id,
        `"${o.customer_name}"`,
        `"${o.phone_number}"`,
        o.municipality,
        o.neighborhood,
        `"${o.avenue}"`,
        o.total_amount,
        o.status,
        new Date(o.created_at).toLocaleDateString()
      ].join(",");
      csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "DLXSTORE_Commandes.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const printInvoice = (order: Order) => {
    setActiveInvoiceOrder(order);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  // Computations
  const totalRevenue = orders
    .filter(o => o.status === "delivered")
    .reduce((sum, o) => sum + o.total_amount, 0);

  const pendingOrdersCount = orders.filter(o => o.status === "pending").length;
  const customersCount = new Set(orders.map(o => o.phone_number)).size;
  const lowStockProducts = products.filter(p => p.stock_quantity <= 3);

  // SVG Chart data
  const chartHeight = 120;
  const chartWidth = 500;
  const last7Days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }).reverse();

  const salesTrendData = last7Days.map(dayStr => {
    const matchingOrders = orders.filter(o => {
      const oDate = new Date(o.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      return oDate === dayStr && o.status === "delivered";
    });
    return matchingOrders.reduce((sum, o) => sum + o.total_amount, 0);
  });

  const maxSales = Math.max(...salesTrendData, 100);

  if (isAuthLoading || !user || user.role !== "admin") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">Authentification Administrateur...</p>
      </div>
    );
  }

  // Sidebar navigation options
  const adminNav = [
    { key: "analytics", label: "Vue Générale", icon: BarChart3 },
    { key: "orders", label: "Commandes", icon: ShoppingBag },
    { key: "products", label: "Articles & CRUD", icon: Package },
    { key: "deliveries", label: "Livraisons & Drivers", icon: Truck },
    { key: "inventory", label: "Gestion Stock", icon: History }
  ];

  return (
    <div className="space-y-8 pb-16 animate-fade-in print:hidden">
      
      {/* Admin Title */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-border/40 pb-5 gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Portail Administrateur</h1>
          <p className="text-sm text-muted-foreground">Supervision en temps réel des ventes, stocks et livreurs de Goma.</p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold hover:bg-muted transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Dashboard Client
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
        
        {/* Sidebar Nav */}
        <nav className="flex flex-col rounded-2xl border border-border/60 bg-card p-2 shadow-sm h-fit">
          {adminNav.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => {
                  setActiveTab(item.key);
                  router.push(`/admin/dashboard?tab=${item.key}`);
                }}
                className={`flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left text-sm font-semibold transition-all ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon className="h-4.5 w-4.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Tab contents */}
        <div className="lg:col-span-3">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            </div>
          ) : (
            <div className="space-y-8">
              
              {/* ANALYTICS / OVERVIEW */}
              {activeTab === "analytics" && (
                <div className="space-y-8">
                  {/* Metrics grid */}
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-2">
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider">Chiffre d'Affaires</span>
                        <TrendingUp className="h-4 w-4 text-emerald-500" />
                      </div>
                      <p className="text-2xl font-extrabold text-foreground">{totalRevenue} $</p>
                      <p className="text-[10px] text-muted-foreground">Basé uniquement sur les commandes livrées (COD)</p>
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-2">
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider">Commandes Totales</span>
                        <ShoppingBag className="h-4 w-4 text-primary" />
                      </div>
                      <p className="text-2xl font-extrabold text-foreground">{orders.length}</p>
                      <p className="text-[10px] text-muted-foreground">{pendingOrdersCount} commande(s) en attente</p>
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-2">
                      <div className="flex justify-between items-center text-muted-foreground">
                        <span className="text-xs font-bold uppercase tracking-wider">Acheteurs Actifs</span>
                        <Users className="h-4 w-4 text-blue-500" />
                      </div>
                      <p className="text-2xl font-extrabold text-foreground">{customersCount}</p>
                      <p className="text-[10px] text-muted-foreground">Clients avec numéro de téléphone unique</p>
                    </div>

                    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-2 bg-amber-500/5 border-amber-500/20">
                      <div className="flex justify-between items-center text-amber-600 dark:text-amber-400">
                        <span className="text-xs font-bold uppercase tracking-wider">Stock Critique</span>
                        <AlertTriangle className="h-4 w-4" />
                      </div>
                      <p className="text-2xl font-extrabold text-amber-600 dark:text-amber-400">{lowStockProducts.length}</p>
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">Articles ayant ≤ 3 unités</p>
                    </div>
                  </div>

                  {/* SVG Chart */}
                  <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
                    <h3 className="font-bold text-base text-foreground">Évolution des Ventes (Livraisons COD validées)</h3>
                    <div className="w-full overflow-x-auto">
                      <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`} className="w-full h-48">
                        {/* Grids */}
                        <line x1="40" y1="20" x2={chartWidth - 20} y2="20" stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3" />
                        <line x1="40" y1={chartHeight / 2 + 20} x2={chartWidth - 20} y2={chartHeight / 2 + 20} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3" />
                        <line x1="40" y1={chartHeight + 20} x2={chartWidth - 20} y2={chartHeight + 20} stroke="var(--border)" strokeWidth="1" />
                        
                        {/* Bars / Path */}
                        {salesTrendData.map((val, idx) => {
                          const x = 50 + idx * ((chartWidth - 80) / 6);
                          const valHeight = (val / maxSales) * chartHeight;
                          const y = chartHeight - valHeight + 20;
                          return (
                            <g key={idx} className="group">
                              {/* Bar */}
                              <rect 
                                x={x - 12} 
                                y={y} 
                                width="24" 
                                height={valHeight} 
                                rx="4" 
                                className="fill-primary/20 group-hover:fill-primary transition-colors duration-200"
                              />
                              {/* Label value hover */}
                              <text x={x} y={y - 6} textAnchor="middle" className="text-[10px] font-bold fill-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                {val} $
                              </text>
                              {/* Date label */}
                              <text x={x} y={chartHeight + 35} textAnchor="middle" className="text-[9px] fill-muted-foreground font-semibold">
                                {last7Days[idx]}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>

                  {/* Low Stock & Alerts details */}
                  {lowStockProducts.length > 0 && (
                    <div className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5 space-y-3">
                      <h4 className="font-bold text-xs uppercase text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" />
                        Alertes d'inventaire critique
                      </h4>
                      <ul className="divide-y divide-amber-500/10 text-xs">
                        {lowStockProducts.map(p => (
                          <li key={p.id} className="py-2 flex justify-between">
                            <span className="font-semibold text-foreground">{p.name} (SKU: {p.sku})</span>
                            <span className="font-bold text-destructive">{p.stock_quantity} restants</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* PRODUCTS CRUD TAB */}
              {activeTab === "products" && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center border-b border-border/40 pb-3">
                    <h3 className="font-bold text-lg text-foreground">Catalogue Articles ({products.length})</h3>
                    <button
                      onClick={() => handleOpenProductModal(null)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground font-semibold px-4 py-2 text-xs hover:bg-primary/95 transition-all shadow-sm"
                    >
                      <Plus className="h-4 w-4" />
                      Ajouter un article
                    </button>
                  </div>

                  {/* Products Table */}
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="min-w-full divide-y divide-border text-left text-xs sm:text-sm">
                      <thead className="bg-muted text-muted-foreground font-bold">
                        <tr>
                          <th className="px-4 py-3">Produit</th>
                          <th className="px-4 py-3">SKU</th>
                          <th className="px-4 py-3">Prix</th>
                          <th className="px-4 py-3">Stock</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {products.map(p => (
                          <tr key={p.id} className="hover:bg-muted/30">
                            <td className="px-4 py-3 flex items-center gap-3">
                              <div className="relative h-8 w-8 rounded overflow-hidden border flex-shrink-0">
                                <Image src={p.images[0]} alt="" fill sizes="32px" className="object-cover" />
                              </div>
                              <div>
                                <div className="font-bold text-foreground">{p.name}</div>
                                <div className="text-[10px] text-muted-foreground">{p.brand}</div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground">{p.sku}</td>
                            <td className="px-4 py-3 font-semibold">
                              {p.discount_price ?? p.price} $
                              {p.discount_price && <span className="ml-1.5 text-[10px] text-muted-foreground line-through">{p.price} $</span>}
                            </td>
                            <td className={`px-4 py-3 font-bold ${p.stock_quantity <= 3 ? 'text-destructive' : 'text-foreground'}`}>
                              {p.stock_quantity}
                            </td>
                            <td className="px-4 py-3 text-right space-x-2">
                              <button
                                onClick={() => handleOpenProductModal(p)}
                                className="text-muted-foreground hover:text-foreground p-1"
                                title="Modifier"
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteProduct(p.id)}
                                className="text-muted-foreground hover:text-destructive p-1"
                                title="Supprimer"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* ORDERS TAB */}
              {activeTab === "orders" && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center border-b border-border/40 pb-3">
                    <h3 className="font-bold text-lg text-foreground">Fichier Commandes ({orders.length})</h3>
                    <button
                      onClick={exportOrdersToCSV}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold hover:bg-muted transition-all"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      Exporter en CSV
                    </button>
                  </div>

                  {/* Orders List */}
                  <div className="space-y-4">
                    {orders.map(order => (
                      <div key={order.id} className="rounded-xl border border-border p-5 space-y-4 bg-card shadow-sm">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-border/40 pb-3 gap-2">
                          <div>
                            <span className="font-bold text-sm text-foreground">Commande #{order.id}</span>
                            <p className="text-[10px] text-muted-foreground mt-0.5">Placée par {order.customer_name} ({order.phone_number})</p>
                          </div>
                          <div className="text-right">
                            <span className="font-extrabold text-sm text-foreground">{order.total_amount} $ (COD)</span>
                            <p className="text-[9px] text-muted-foreground mt-0.5">{new Date(order.created_at).toLocaleString()}</p>
                          </div>
                        </div>

                        {/* Order Details & Drivers */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                          {/* Address Info */}
                          <div className="space-y-1 text-muted-foreground">
                            <span className="font-bold text-foreground">Lieu de livraison :</span>
                            <p>
                              Quartier {order.neighborhood}, Commune de {order.municipality} <br />
                              Avenue {order.avenue} {order.house_number ? `, N° ${order.house_number}` : ""}
                            </p>
                            {order.delivery_notes && <p className="italic text-[11px] pt-1"><strong>Repère :</strong> {order.delivery_notes}</p>}
                          </div>

                          {/* Controls */}
                          <div className="space-y-3">
                            {/* Status selector */}
                            <div className="space-y-1">
                              <label className="font-semibold text-foreground text-[10px] uppercase">Statut Commande</label>
                              <select
                                value={order.status}
                                onChange={(e) => handleStatusChange(order.id, e.target.value as OrderStatus)}
                                className="w-full h-8 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-foreground"
                              >
                                <option value="pending">En attente</option>
                                <option value="confirmed">Confirmée</option>
                                <option value="preparing">En préparation</option>
                                <option value="ready">Prête</option>
                                <option value="out_for_delivery">En livraison</option>
                                <option value="delivered">Livrée</option>
                                <option value="cancelled">Annulée</option>
                              </select>
                            </div>

                            {/* Driver Assign selector */}
                            <div className="space-y-1">
                              <label className="font-semibold text-foreground text-[10px] uppercase">Livreur Assigné</label>
                              <select
                                value={order.delivery?.driver_id || ""}
                                onChange={(e) => handleAssignDriver(order.id, e.target.value)}
                                className="w-full h-8 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-foreground"
                              >
                                <option value="">Aucun livreur</option>
                                {profiles.map(p => (
                                  <option key={p.id} value={p.id}>{p.full_name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        {/* Print Invoice buttons */}
                        <div className="flex justify-end pt-2 border-t border-border/30">
                          <button
                            onClick={() => printInvoice(order)}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                          >
                            <Printer className="h-4 w-4" />
                            Imprimer la Facture
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* DELIVERIES & DRIVERS TAB */}
              {activeTab === "deliveries" && (
                <div className="space-y-6">
                  <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2">Suivi des Livraisons à Goma</h3>
                  
                  {deliveries.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic text-center py-12">Aucune livraison en cours.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-border">
                      <table className="min-w-full divide-y divide-border text-left text-xs sm:text-sm">
                        <thead className="bg-muted text-muted-foreground font-bold">
                          <tr>
                            <th className="px-4 py-3">Commande ID</th>
                            <th className="px-4 py-3">Destinataire</th>
                            <th className="px-4 py-3">Quartier</th>
                            <th className="px-4 py-3">Livreur</th>
                            <th className="px-4 py-3">Statut</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {deliveries.map(d => (
                            <tr key={d.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3 font-semibold text-primary">#{d.order_id}</td>
                              <td className="px-4 py-3 text-foreground font-medium">{(d as any).customer_name}</td>
                              <td className="px-4 py-3 text-muted-foreground">{(d as any).neighborhood}</td>
                              <td className="px-4 py-3 font-semibold text-foreground">
                                {d.driver_name || <span className="text-amber-500 font-bold">Non assigné</span>}
                              </td>
                              <td className="px-4 py-3">
                                <span className={`font-bold text-xs uppercase ${d.status === 'delivered' ? 'text-emerald-600' : 'text-primary'}`}>
                                  {d.status === 'pending' && 'En attente'}
                                  {d.status === 'confirmed' && 'Confirmée'}
                                  {d.status === 'preparing' && 'En préparation'}
                                  {d.status === 'ready' && 'Prête'}
                                  {d.status === 'out_for_delivery' && 'En livraison'}
                                  {d.status === 'delivered' && 'Livrée'}
                                  {d.status === 'cancelled' && 'Annulée'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* INVENTORY ADJUSTMENT TAB */}
              {activeTab === "inventory" && (
                <div className="space-y-8">
                  {/* Adjustment form */}
                  <div className="rounded-2xl border border-border bg-card p-5 shadow-sm space-y-4">
                    <h3 className="font-bold text-base text-foreground border-b border-border/40 pb-2">Ajustement Manuel des Stocks</h3>
                    
                    <form onSubmit={handleInventoryAdjust} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                      <div className="space-y-1.5 sm:col-span-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sélectionner l'article</label>
                        <select
                          required
                          value={selectedAdjustProduct}
                          onChange={(e) => setSelectedAdjustProduct(e.target.value)}
                          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-foreground"
                        >
                          <option value="">Sélectionnez un produit...</option>
                          {products.map(p => (
                            <option key={p.id} value={p.id}>{p.name} (Stock actuel: {p.stock_quantity})</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quantité (Ex. +10 ou -5)</label>
                        <input
                          type="number"
                          required
                          value={adjustQty}
                          onChange={(e) => setAdjustQty(e.target.value)}
                          placeholder="Qté"
                          className="w-full h-9 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:border-foreground"
                        />
                      </div>

                      <button
                        type="submit"
                        className="h-9 rounded-full bg-primary text-primary-foreground font-semibold px-4 text-xs hover:bg-primary/95 transition-all shadow-sm"
                      >
                        Ajuster le stock
                      </button>
                    </form>
                  </div>

                  {/* Audit trail list */}
                  <div className="space-y-4">
                    <h3 className="font-bold text-base text-foreground">Historique d'inventaire</h3>
                    <div className="overflow-x-auto rounded-xl border border-border bg-card">
                      <table className="min-w-full divide-y divide-border text-left text-xs">
                        <thead className="bg-muted text-muted-foreground font-bold uppercase">
                          <tr>
                            <th className="px-4 py-3">Produit</th>
                            <th className="px-4 py-3">Modification</th>
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Date & Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {inventoryHistory.map(entry => (
                            <tr key={entry.id} className="hover:bg-muted/30">
                              <td className="px-4 py-3 font-semibold text-foreground">{entry.product_name}</td>
                              <td className={`px-4 py-3 font-bold ${entry.quantity_changed > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                                {entry.quantity_changed > 0 ? `+${entry.quantity_changed}` : entry.quantity_changed}
                              </td>
                              <td className="px-4 py-3 uppercase font-medium">{entry.type}</td>
                              <td className="px-4 py-3 text-muted-foreground">
                                <div className="font-semibold">{new Date(entry.created_at).toLocaleString()}</div>
                                <div className="text-[10px] italic">{entry.notes}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

      </div>

      {/* Product CRUD Modal Dialog */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-card p-6 shadow-2xl animate-fade-in my-8 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsProductModalOpen(false)}
              className="absolute top-4 right-4 rounded-full p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <h3 className="font-bold text-lg text-foreground border-b border-border/40 pb-2 mb-4">
              {editingProduct ? "Modifier le produit" : "Ajouter un nouveau produit"}
            </h3>

            <form onSubmit={handleProductSubmit} className="space-y-4">
              {/* Product Name & Brand */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Nom de l'article</label>
                  <input
                    type="text"
                    required
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                    placeholder="Ex. iPhone 15 Pro Max"
                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Marque / Fabricant</label>
                  <input
                    type="text"
                    required
                    value={prodBrand}
                    onChange={(e) => setProdBrand(e.target.value)}
                    placeholder="Ex. Apple"
                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                  />
                </div>
              </div>

              {/* SKU & Stock */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">SKU unique</label>
                  <input
                    type="text"
                    required
                    value={prodSku}
                    onChange={(e) => setProdSku(e.target.value)}
                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Quantité en Stock</label>
                  <input
                    type="number"
                    required
                    value={prodStock}
                    onChange={(e) => setProdStock(e.target.value)}
                    placeholder="Ex. 15"
                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                  />
                </div>
              </div>

              {/* Price & Discount */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Prix de vente ($)</label>
                  <input
                    type="number"
                    required
                    value={prodPrice}
                    onChange={(e) => setProdPrice(e.target.value)}
                    placeholder="Ex. 1499"
                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Prix promotionnel ($) - Optionnel</label>
                  <input
                    type="number"
                    value={prodDiscountPrice}
                    onChange={(e) => setProdDiscountPrice(e.target.value)}
                    placeholder="Ex. 1399"
                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                  />
                </div>
              </div>

              {/* Sizes & Colors (comma separated lists) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tailles (Séparées par virgules)</label>
                  <input
                    type="text"
                    value={prodSizes}
                    onChange={(e) => setProdSizes(e.target.value)}
                    placeholder="Ex. S, M, L ou 256GB, 512GB"
                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Couleurs (Séparées par virgules)</label>
                  <input
                    type="text"
                    value={prodColors}
                    onChange={(e) => setProdColors(e.target.value)}
                    placeholder="Ex. Noir, Argent, Bleu"
                    className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                  />
                </div>
              </div>

              {/* Category selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Catégorie</label>
                <select
                  value={prodCategory}
                  onChange={(e) => setProdCategory(e.target.value)}
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                >
                  <option value="c1111111-1111-1111-1111-111111111111">Électronique & High-Tech</option>
                  <option value="c2222222-2222-2222-2222-222222222222">Mode & Vêtements</option>
                  <option value="c3333333-3333-3333-3333-333333333333">Maison & Énergie</option>
                </select>
              </div>

              {/* Images URLs (comma separated lists) */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Images URLs (Séparées par virgules)</label>
                <input
                  type="text"
                  value={prodImages}
                  onChange={(e) => setProdImages(e.target.value)}
                  placeholder="Ex. http://url1.com, http://url2.com"
                  className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
                />
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
                <textarea
                  required
                  rows={4}
                  value={prodDescription}
                  onChange={(e) => setProdDescription(e.target.value)}
                  placeholder="Présentez les détails de l'article..."
                  className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-foreground"
                />
              </div>

              <div className="pt-4 border-t border-border/40 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-full border border-border px-5 text-xs font-semibold hover:bg-muted transition-all"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center rounded-full bg-primary text-primary-foreground px-6 text-xs font-semibold hover:bg-primary/95 transition-all shadow-md"
                >
                  Sauvegarder l'article
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RENDER INVOICE WINDOW ON PRINT OVERLAY ONLY */}
      {activeInvoiceOrder && (
        <div className="hidden print:block fixed inset-0 z-50 bg-white text-black p-8 text-xs font-sans">
          <div className="space-y-8">
            {/* Header info */}
            <div className="flex justify-between items-start border-b border-gray-300 pb-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">DLXSTORE</h1>
                <p className="text-gray-500 font-semibold">Shop Smart. Delivered Free.</p>
                <p>Goma, Nord-Kivu, RDC</p>
                <p>contact@dlxstore.cd | +243 990 123 456</p>
              </div>
              <div className="text-right">
                <h2 className="text-lg font-bold">FACTURE COMMANDE</h2>
                <p className="font-semibold text-gray-700">#{activeInvoiceOrder.id}</p>
                <p className="mt-1">Date: {new Date(activeInvoiceOrder.created_at).toLocaleDateString()}</p>
                <p>Statut: {activeInvoiceOrder.status.toUpperCase()}</p>
              </div>
            </div>

            {/* Address */}
            <div className="grid grid-cols-2 gap-8 border-b border-gray-300 pb-4">
              <div className="space-y-1">
                <h3 className="font-bold text-gray-700 uppercase">Adresse du Client</h3>
                <p className="font-bold">{activeInvoiceOrder.customer_name}</p>
                <p>{activeInvoiceOrder.phone_number}</p>
                <p>
                  Quartier {activeInvoiceOrder.neighborhood}, Commune de {activeInvoiceOrder.municipality} <br />
                  Avenue {activeInvoiceOrder.avenue} {activeInvoiceOrder.house_number ? `, N° ${activeInvoiceOrder.house_number}` : ""}
                </p>
                {activeInvoiceOrder.delivery_notes && <p className="italic text-gray-500 pt-1">Indications: {activeInvoiceOrder.delivery_notes}</p>}
              </div>
              
              <div className="space-y-1">
                <h3 className="font-bold text-gray-700 uppercase">Informations de livraison</h3>
                <p>Frais d'expédition: <span className="font-bold text-green-700">GRATUIT</span></p>
                <p>Moyen de paiement: <span className="font-bold">CASH ON DELIVERY (COD)</span></p>
                <p className="italic text-gray-500 pt-2 font-bold">
                  “Le paiement doit être effectué en espèces uniquement après réception et vérification de la commande.”
                </p>
              </div>
            </div>

            {/* Items Table */}
            <div className="space-y-3">
              <h3 className="font-bold text-gray-700 uppercase">Articles Commandés</h3>
              <table className="min-w-full text-left border-collapse border border-gray-300">
                <thead>
                  <tr className="bg-gray-100 font-bold border-b border-gray-300">
                    <th className="px-4 py-2 border-r border-gray-300">Article</th>
                    <th className="px-4 py-2 border-r border-gray-300 text-center">Quantité</th>
                    <th className="px-4 py-2 border-r border-gray-300 text-right">Prix Unitaire</th>
                    <th className="px-4 py-2 text-right">Sous-total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-300">
                  {activeInvoiceOrder.items.map((item: OrderItem) => (
                    <tr key={item.id}>
                      <td className="px-4 py-2 border-r border-gray-300">
                        <span className="font-bold">{item.product?.name || "Article"}</span>
                        {(item.size || item.color) && (
                          <span className="block text-[10px] text-gray-500">
                            {item.size ? `Taille: ${item.size}` : ""} {item.color ? `| Couleur: ${item.color}` : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 border-r border-gray-300 text-center">{item.quantity}</td>
                      <td className="px-4 py-2 border-r border-gray-300 text-right">{item.price_at_sale} $</td>
                      <td className="px-4 py-2 text-right">{item.price_at_sale * item.quantity} $</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end pt-4">
              <div className="w-64 space-y-2 text-sm">
                <div className="flex justify-between border-b border-gray-200 pb-1">
                  <span>Sous-total</span>
                  <span>{activeInvoiceOrder.total_amount} $</span>
                </div>
                <div className="flex justify-between border-b border-gray-200 pb-1">
                  <span>Livraison</span>
                  <span className="text-green-700 font-bold">GRATUIT</span>
                </div>
                <div className="flex justify-between font-extrabold text-base border-t-2 border-gray-800 pt-2">
                  <span>Montant Total à payer</span>
                  <span>{activeInvoiceOrder.total_amount} $</span>
                </div>
              </div>
            </div>
            
            {/* Signature */}
            <div className="pt-20 border-t border-gray-200 flex justify-between text-gray-500 text-[10px]">
              <div>
                <p>Signature Livreur DLXSTORE</p>
                <div className="h-10 border-b border-gray-300 w-32 mt-6"></div>
              </div>
              <div className="text-right">
                <p>Signature Client (Paiement effectué)</p>
                <div className="h-10 border-b border-gray-300 w-32 mt-6"></div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        <p className="text-sm text-muted-foreground">Chargement du dashboard...</p>
      </div>
    }>
      <AdminDashboardContent />
    </Suspense>
  );
}
