import { Category, Product, Order, Notification, Profile, Review, StoreSettings, InventoryHistoryEntry } from "../types";
import { defaultStoreSettings } from "./store-config";

export const mockCategories: Category[] = [
  {
    id: "c1111111-1111-1111-1111-111111111111",
    name: "Électronique & High-Tech",
    slug: "electronique",
    description: "Téléphones, ordinateurs, stations solaires et accessoires essentiels pour rester connecté.",
    image_url: "https://images.unsplash.com/photo-1468495244123-6c6c332eeece?w=500&auto=format&fit=crop&q=60",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString()
  },
  {
    id: "c2222222-2222-2222-2222-222222222222",
    name: "Mode & Vêtements",
    slug: "mode-vetements",
    description: "Vêtements, chaussures et accessoires haut de gamme pour hommes et femmes.",
    image_url: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=500&auto=format&fit=crop&q=60",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString()
  },
  {
    id: "c3333333-3333-3333-3333-333333333333",
    name: "Maison & Énergie",
    slug: "maison-energie",
    description: "Solutions solaires, lampes rechargeables, appareils ménagers et café local du Kivu.",
    image_url: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=500&auto=format&fit=crop&q=60",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString()
  }
];

export const mockProducts: Product[] = [
  {
    id: "p1111111-1111-1111-1111-111111111111",
    name: "iPhone 15 Pro Max",
    slug: "iphone-15-pro-max",
    description: "Le nec plus ultra des smartphones avec châssis en titane, puce A17 Pro et zoom optique 5x. Idéal pour capturer les plus beaux paysages du lac Kivu et de Goma.",
    price: 1499,
    discount_price: 1399,
    category_id: "c1111111-1111-1111-1111-111111111111",
    brand: "Apple",
    sizes: ["256GB", "512GB", "1TB"],
    colors: ["Titanium Noir", "Titanium Naturel", "Titanium Bleu"],
    sku: "SKU-IPH15PM",
    rating: 4.8,
    stock_quantity: 15,
    is_featured: true,
    is_best_seller: true,
    is_new_arrival: false,
    images: [
      "https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=500&auto=format&fit=crop&q=60",
      "https://images.unsplash.com/photo-1695048132920-5690558b87ee?w=500&auto=format&fit=crop&q=60"
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 20).toISOString()
  },
  {
    id: "p1111112-1111-1111-1111-111111111112",
    name: 'MacBook Air M3 13"',
    slug: "macbook-air-m3-13",
    description: "Ordinateur portable ultra-fin et léger propulsé par la puce M3. Performance exceptionnelle avec jusqu'à 18 heures d'autonomie. Parfait pour les entrepreneurs et étudiants de Goma.",
    price: 1299,
    category_id: "c1111111-1111-1111-1111-111111111111",
    brand: "Apple",
    sizes: ["8GB/256GB", "16GB/512GB"],
    colors: ["Minuit", "Gris Sidéral", "Argent"],
    sku: "SKU-MBAIRM3",
    rating: 4.9,
    stock_quantity: 8,
    is_featured: true,
    is_best_seller: false,
    is_new_arrival: true,
    images: [
      "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=500&auto=format&fit=crop&q=60"
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString()
  },
  {
    id: "p1111113-1111-1111-1111-111111111113",
    name: "Sony WH-1000XM5",
    slug: "sony-wh-1000xm5",
    description: "Casque sans fil avec réduction de bruit active de pointe. Jusqu'à 30 heures d'autonomie avec charge rapide pour une écoute sans compromis.",
    price: 399,
    discount_price: 349,
    category_id: "c1111111-1111-1111-1111-111111111111",
    brand: "Sony",
    sizes: [],
    colors: ["Noir", "Argent"],
    sku: "SKU-SONYXM5",
    rating: 4.7,
    stock_quantity: 25,
    is_featured: false,
    is_best_seller: true,
    is_new_arrival: false,
    images: [
      "https://images.unsplash.com/photo-1618384887929-16ec33fab9ef?w=500&auto=format&fit=crop&q=60"
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 25).toISOString()
  },
  {
    id: "p2222221-2222-2222-2222-222222222221",
    name: "Baskets Nike Air Max SYSTM",
    slug: "baskets-nike-air-max",
    description: "Baskets confortables au look rétro avec l'amorti Max Air visible. Style intemporel et durabilité pour marcher avec style sur toutes les avenues de Goma.",
    price: 110,
    discount_price: 95,
    category_id: "c2222222-2222-2222-2222-222222222222",
    brand: "Nike",
    sizes: ["39", "40", "41", "42", "43", "44"],
    colors: ["Blanc/Noir", "Noir Total"],
    sku: "SKU-NIKEAMS",
    rating: 4.5,
    stock_quantity: 30,
    is_featured: true,
    is_best_seller: true,
    is_new_arrival: false,
    images: [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=500&auto=format&fit=crop&q=60"
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString()
  },
  {
    id: "p2222222-2222-2222-2222-222222222222",
    name: "Veste Coupe-Vent Imperméable",
    slug: "veste-coupe-vent-impermeable",
    description: "Veste respirante et imperméable, idéale pour les averses soudaines à Goma. Capuche ajustable et poches zippées sécurisées.",
    price: 85,
    category_id: "c2222222-2222-2222-2222-222222222222",
    brand: "The North Face",
    sizes: ["S", "M", "L", "XL"],
    colors: ["Bleu Marine", "Noir Mât", "Vert Olive"],
    sku: "SKU-TNFJACK",
    rating: 4.6,
    stock_quantity: 3, // Low stock!
    is_featured: false,
    is_best_seller: false,
    is_new_arrival: true,
    images: [
      "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=500&auto=format&fit=crop&q=60"
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString()
  },
  {
    id: "p3333331-3333-3333-3333-333333333331",
    name: "Station Solaire EcoFlow River 2",
    slug: "ecoflow-river-2",
    description: "Garantissez votre électricité au quotidien à Goma. Station de recharge portable de 256Wh rechargeable à 100% en 60 minutes. Idéale pour pallier les coupures de courant (délestages) et charger vos appareils de valeur.",
    price: 349,
    discount_price: 319,
    category_id: "c3333333-3333-3333-3333-333333333333",
    brand: "EcoFlow",
    sizes: [],
    colors: ["Gris Foncé"],
    sku: "SKU-ECOFLOWR2",
    rating: 4.9,
    stock_quantity: 12,
    is_featured: true,
    is_best_seller: true,
    is_new_arrival: false,
    images: [
      "https://images.unsplash.com/photo-1620714223084-8fcacc6dfd8d?w=500&auto=format&fit=crop&q=60"
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 18).toISOString()
  },
  {
    id: "p3333332-3333-3333-3333-333333333332",
    name: "Café du Kivu - Arabica Premium (500g)",
    slug: "cafe-du-kivu-premium",
    description: "Café arabica d'exception cultivé sur les rives fertiles du lac Kivu. Torréfaction locale artisanale aux arômes intenses et chocolatés.",
    price: 18,
    discount_price: 15,
    category_id: "c3333333-3333-3333-3333-333333333333",
    brand: "Café de Kivu",
    sizes: ["Grain", "Moulu"],
    colors: ["Original"],
    sku: "SKU-KIVUCOF",
    rating: 5.0,
    stock_quantity: 100,
    is_featured: false,
    is_best_seller: true,
    is_new_arrival: true,
    images: [
      "https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=500&auto=format&fit=crop&q=60"
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString()
  },
  {
    id: "p3333333-3333-3333-3333-333333333333",
    name: "Lanterne Solaire LED Multi-ports",
    slug: "lanterne-solaire-led",
    description: "Lanterne solaire rechargeable haute puissance avec panneau solaire intégré et port USB pour recharger vos téléphones en cas d'urgence.",
    price: 35,
    category_id: "c3333333-3333-3333-3333-333333333333",
    brand: "Philips",
    sizes: [],
    colors: ["Jaune", "Orange"],
    sku: "SKU-PHILAN",
    rating: 4.4,
    stock_quantity: 50,
    is_featured: false,
    is_best_seller: false,
    is_new_arrival: false,
    images: [
      "https://images.unsplash.com/photo-1507668077129-56e32842fceb?w=500&auto=format&fit=crop&q=60"
    ],
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString()
  }
];

export const mockReviews: Review[] = [
  {
    id: "r1",
    product_id: "p1111111-1111-1111-1111-111111111111",
    user_id: "usr-cust1",
    user_name: "Jean-Paul Kabulo",
    rating: 5,
    comment: "Excellent téléphone ! Très rapide, et les photos du lac Kivu au coucher du soleil sont magnifiques. Livraison ultra rapide en 2 heures à Himbi !",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString()
  },
  {
    id: "r2",
    product_id: "p3333331-3333-3333-3333-333333333331",
    user_id: "usr-cust2",
    user_name: "Sarah Muhindo",
    rating: 5,
    comment: "Indispensable à Goma avec les délestages. Je l'utilise tous les soirs pour alimenter ma télé et charger les ordis. Service au top !",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12).toISOString()
  },
  {
    id: "r3",
    product_id: "p3333332-3333-3333-3333-333333333332",
    user_id: "usr-cust3",
    user_name: "Marc Bahati",
    rating: 5,
    comment: "Le meilleur café du Nord-Kivu, tout simplement. Une torréfaction parfaite, j'en achète tous les mois.",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString()
  }
];

export const mockProfiles: Profile[] = [
  {
    id: "usr-admin",
    email: "admin@dlxstore.cd",
    full_name: "Directeur DLXSTORE",
    phone: "+243 999 999 999",
    role: "admin",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString()
  },
  {
    id: "usr-cust1",
    email: "jean.paul@gmail.com",
    full_name: "Jean-Paul Kabulo",
    phone: "+243 812 345 678",
    role: "customer",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15).toISOString()
  },
  {
    id: "usr-driver1",
    email: "claudek@dlxstore.cd",
    full_name: "Claude Kakule (Chauffeur)",
    phone: "+243 990 876 543",
    role: "customer", // standard profile, but listed as a driver in settings
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString()
  }
];

export const mockOrders: Order[] = [
  {
    id: "ord-1001",
    customer_id: "usr-cust1",
    status: "delivered",
    customer_name: "Jean-Paul Kabulo",
    phone_number: "+243 812 345 678",
    municipality: "Goma",
    neighborhood: "Himbi",
    avenue: "Avenue du Lac",
    house_number: "45",
    delivery_notes: "Maison à barrière verte près de l'hôtel Kivu Palace",
    total_amount: 1414.00, // iPhone 1399 + Cafe 15
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    items: [
      {
        id: "item-1",
        order_id: "ord-1001",
        product_id: "p1111111-1111-1111-1111-111111111111",
        quantity: 1,
        price_at_sale: 1399.00,
        size: "256GB",
        color: "Titanium Naturel"
      },
      {
        id: "item-2",
        order_id: "ord-1001",
        product_id: "p3333332-3333-3333-3333-333333333332",
        quantity: 1,
        price_at_sale: 15.00,
        size: "Moulu",
        color: "Original"
      }
    ],
    delivery: {
      id: "del-1001",
      order_id: "ord-1001",
      driver_id: "usr-driver1",
      driver_name: "Claude Kakule (Chauffeur)",
      status: "delivered",
      assigned_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4 + 1000 * 60 * 30).toISOString(),
      delivered_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4).toISOString(),
      updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString()
    }
  },
  {
    id: "ord-1002",
    customer_id: "usr-cust1",
    status: "out_for_delivery",
    customer_name: "Jean-Paul Kabulo",
    phone_number: "+243 812 345 678",
    municipality: "Goma",
    neighborhood: "Keshero",
    avenue: "Avenue de l'Université",
    house_number: "12A",
    delivery_notes: "Appelez-moi à l'arrivée",
    total_amount: 319.00, // EcoFlow 319
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString(),
    items: [
      {
        id: "item-3",
        order_id: "ord-1002",
        product_id: "p3333331-3333-3333-3333-333333333331",
        quantity: 1,
        price_at_sale: 319.00,
        color: "Gris Foncé"
      }
    ],
    delivery: {
      id: "del-1002",
      order_id: "ord-1002",
      driver_id: "usr-driver1",
      driver_name: "Claude Kakule (Chauffeur)",
      status: "out_for_delivery",
      assigned_at: new Date(Date.now() - 1000 * 60 * 60 * 1.5).toISOString(),
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
      updated_at: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString()
    }
  }
];

export const mockNotifications: Notification[] = [
  {
    id: "not-1",
    user_id: "usr-cust1",
    title: "Commande Livrée ! 🎉",
    message: "Votre commande #ord-1001 a été livrée avec succès par Claude Kakule. Merci de votre confiance !",
    is_read: false,
    type: "order_status",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString()
  },
  {
    id: "not-2",
    user_id: "usr-cust1",
    title: "Commande en cours de livraison 🚚",
    message: "Claude Kakule est en route pour vous livrer la commande #ord-1002. Veuillez préparer la somme de 319 $ en espèces.",
    is_read: false,
    type: "order_status",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString()
  },
  {
    id: "not-admin-1",
    user_id: "usr-admin",
    title: "Alerte de Stock Bas ⚠️",
    message: "Le produit 'Veste Coupe-Vent Imperméable' n'a plus que 3 unités en stock.",
    is_read: false,
    type: "low_stock",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString()
  }
];

export const mockStoreSettings: StoreSettings = defaultStoreSettings;

export const mockInventoryHistory: InventoryHistoryEntry[] = [
  {
    id: "inv-h1",
    product_id: "p2222222-2222-2222-2222-222222222222",
    product_name: "Veste Coupe-Vent Imperméable",
    quantity_changed: 10,
    type: "restock",
    notes: "Réapprovisionnement fournisseur",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString()
  },
  {
    id: "inv-h2",
    product_id: "p2222222-2222-2222-2222-222222222222",
    product_name: "Veste Coupe-Vent Imperméable",
    quantity_changed: -7,
    type: "sale",
    notes: "Vente en magasin / Commandes groupées",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString()
  }
];

export const GOMA_MUNICIPALITIES: Record<string, string[]> = {
  "Goma": [
    "Himbi",
    "Keshero",
    "Katindo",
    "Volcans",
    "Mapendo",
    "Lac Vert",
    "Mikeno"
  ],
  "Karisimbi": [
    "Ndosho",
    "Mugunga",
    "Kasika",
    "Mabanga Nord",
    "Mabanga Sud",
    "Katoyi",
    "Majengo",
    "Bujovu"
  ]
};
