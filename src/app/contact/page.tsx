"use client";

import React, { useState } from "react";
import { Mail, Phone, MapPin, MessageSquare, Send } from "lucide-react";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate contact form submission
    setTimeout(() => {
      alert("Votre message a été bien envoyé ! Notre service client à Goma vous recontactera rapidement.");
      setName("");
      setEmail("");
      setMessage("");
      setIsSubmitting(false);
    }, 1000);
  };

  return (
    <div className="mx-auto max-w-4xl py-12 px-4 space-y-12 animate-fade-in">
      
      {/* Title */}
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-extrabold tracking-tight">Contactez-nous</h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
          Des questions sur nos livraisons à Goma ou besoin d'un suivi ? Écrivez-nous ou appelez-nous directement.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        
        {/* Left Column: Direct Info & WhatsApp */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold tracking-tight">Nos Coordonnées</h2>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            Notre bureau client local à Goma est disponible pour vous accompagner de 8h00 à 18h00, du lundi au samedi.
          </p>

          <div className="space-y-4">
            <div className="flex items-start gap-3 text-xs sm:text-sm">
              <Phone className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-foreground">Téléphone & WhatsApp</p>
                <p className="text-muted-foreground">+243 990 123 456</p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-xs sm:text-sm">
              <Mail className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-foreground">Adresse Email</p>
                <p className="text-muted-foreground">contact@dlxstore.cd</p>
              </div>
            </div>

            <div className="flex items-start gap-3 text-xs sm:text-sm">
              <MapPin className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-foreground">Adresse Physique</p>
                <p className="text-muted-foreground">Avenue du Lac, Quartier Himbi, Ville de Goma, RDC</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/80 bg-card p-5 space-y-3 shadow-sm">
            <h4 className="font-bold text-sm text-foreground flex items-center gap-1.5">
              <MessageSquare className="h-4.5 w-4.5 text-emerald-600" />
              Assistance Rapide via WhatsApp
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Pour des réponses en moins de 5 minutes, cliquez ci-dessous pour démarrer une conversation avec notre équipe commerciale.
            </p>
            <a
              href="https://wa.me/243990123456?text=Bonjour%20DLXSTORE%2C%20j'ai%20une%20question%20concernant%20un%20produit"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-full bg-emerald-600 hover:bg-emerald-700 text-white px-5 text-xs font-semibold transition-colors shadow-sm"
            >
              Ouvrir le chat WhatsApp
            </a>
          </div>
        </div>

        {/* Right Column: Contact Form */}
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-base text-foreground border-b border-border/40 pb-2">Envoyer un message</h3>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Votre Nom</label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex. Christian Balume"
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Adresse Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ex. christian@gmail.com"
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-foreground"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="message" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Votre Message</label>
              <textarea
                id="message"
                required
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Décrivez votre demande en détail..."
                className="w-full rounded-lg border border-border bg-background p-3 text-sm outline-none focus:border-foreground"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full inline-flex items-center justify-center gap-2 h-10 rounded-full bg-primary text-primary-foreground font-semibold hover:bg-primary/95 transition-all shadow-sm disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {isSubmitting ? "Envoi en cours..." : "Envoyer mon message"}
            </button>
          </form>
        </div>

      </div>

    </div>
  );
}
