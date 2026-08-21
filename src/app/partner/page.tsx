"use client";

import { FormEvent, useState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { DRC_PROVINCES } from "../../lib/drc-geography";
import { submitPartnerApplication } from "../../services/db/partner-applications";

const initial = { business_name: "", owner_name: "", phone: "", email: "", social_media: "", province: "", city: "", business_category: "", description: "", products_services: "", location: "", collaboration_type: "vendor" as const, additional_information: "" };

export default function PartnerPage() {
  const [form, setForm] = useState(initial);
  const [state, setState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const update = (key: keyof typeof initial, value: string) => setForm((previous) => ({ ...previous, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    try {
      console.log("[PARTNER] Submitting application", { businessName: form.business_name });
      await submitPartnerApplication(form);
      console.log("[PARTNER] Application submitted successfully");
      setState("success");
      setForm(initial);
    } catch (err) {
      console.error("[PARTNER] Application submission failed:", err);
      console.error("[PARTNER] Error details:", {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <section className="mx-auto max-w-xl py-20 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
        <h1 className="mt-5 text-3xl font-bold">Application received</h1>
        <p className="mt-3 text-muted-foreground">Your application has been recorded for the DLXSTORE team to review.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl py-8">
      <div className="mb-8">
        <p className="text-sm font-semibold text-primary">DLXSTORE PARTNERS</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">Build the digital mall with us.</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">Apply as a vendor, brand, creator, or business partner. Required contact details are used only to review your application.</p>
      </div>
      <form onSubmit={submit} className="grid gap-5 rounded-2xl border border-border bg-card p-6 sm:grid-cols-2">
        <Field label="Business or brand name" value={form.business_name} onChange={(v) => update("business_name", v)} required />
        <Field label="Owner or contact person" value={form.owner_name} onChange={(v) => update("owner_name", v)} required />
        <Field label="Phone" type="tel" value={form.phone} onChange={(v) => update("phone", v)} required />
        <Field label="Email (optional)" type="email" value={form.email} onChange={(v) => update("email", v)} />
        <Field label="Social media (optional)" value={form.social_media} onChange={(v) => update("social_media", v)} />
        <label className="text-sm font-medium">Province
          <select required value={form.province} onChange={(e) => update("province", e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5">
            <option value="">Select a province</option>
            {DRC_PROVINCES.map((province) => <option key={province}>{province}</option>)}
          </select>
        </label>
        <Field label="City, territory, or commune" value={form.city} onChange={(v) => update("city", v)} required />
        <Field label="Business category" value={form.business_category} onChange={(v) => update("business_category", v)} required />
        <label className="text-sm font-medium">Collaboration type
          <select value={form.collaboration_type} onChange={(e) => update("collaboration_type", e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5">
            <option value="vendor">Vendor</option>
            <option value="brand">Brand</option>
            <option value="creator">Creator</option>
            <option value="partner">Business partner</option>
          </select>
        </label>
        <Field label="Location (optional)" value={form.location} onChange={(v) => update("location", v)} />
        <TextArea label="Describe your business" value={form.description} onChange={(v) => update("description", v)} required />
        <TextArea label="Products or services (optional)" value={form.products_services} onChange={(v) => update("products_services", v)} />
        <TextArea label="Additional information (optional)" value={form.additional_information} onChange={(v) => update("additional_information", v)} />
        {state === "error" && <p role="alert" className="sm:col-span-2 text-sm text-destructive">We could not send the application. Please try again.</p>}
        <button disabled={state === "sending"} className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          <Send className="h-4 w-4" />
          {state === "sending" ? "Sending…" : "Submit application"}
        </button>
      </form>
    </section>
  );
}

function Field({ label, value, onChange, required, type = "text" }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string }) {
  return (
    <label className="text-sm font-medium">
      {label}
      <input type={type} required={required} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
    </label>
  );
}

function TextArea({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return (
    <label className="sm:col-span-2 text-sm font-medium">
      {label}
      <textarea required={required} value={value} onChange={(e) => onChange(e.target.value)} rows={4} className="mt-1 block w-full rounded-lg border border-border bg-background p-2.5" />
    </label>
  );
}
